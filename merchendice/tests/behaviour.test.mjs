import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import worker from '../dist/app.mjs';

const env = {
  MAIL_TO: 'inbox@example.test',
  async sendMail(message, {signal}) {
    const response = await fetch('https://provider.example.test', {method:'POST',body:JSON.stringify(message),signal});
    return response.json();
  },
};
const input = {name:'A creator',email:'creator@example.test',platforms:['YouTube'],description:'A merch idea'};
const request = (value, headers={}) => new Request('https://site.example.test/api/enquiry', {method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(value)});

test('all pages support GET and HEAD without exposing email configuration', async () => {
  for (const route of ['/', '/examples', '/examples/', '/enquiry', '/enquiry/', '/examplepage.com', '/examplepage.com/']) {
    const get = await worker.fetch(new Request(`https://site.example.test${route}`),env);
    assert.equal(get.status,200);
    assert.equal((await get.text()).includes(env.MAIL_TO),false);
    const head = await worker.fetch(new Request(`https://site.example.test${route}`,{method:'HEAD'}),env);
    assert.equal(head.status,200);
    assert.equal(await head.text(),'');
    assert.equal(head.headers.get('content-type'),get.headers.get('content-type'));
  }
});

test('CREATOR example is served on its Merchendice path with working inline layout and images', async () => {
  const response = await worker.fetch(new Request('https://site.example.test/examplepage.com/'));
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /CREATOR — Storefront example/);
  assert.match(html, /images-api\.printify\.com/);
  assert.match(response.headers.get('content-security-policy'), /script-src 'self' 'unsafe-inline'/);
  assert.match(response.headers.get('content-security-policy'), /img-src[^;]*images-api\.printify\.com/);
  const nested = await worker.fetch(new Request('https://site.example.test/examplepage.com/products/sample'));
  assert.equal(nested.status, 200);
  const directory = await worker.fetch(new Request('https://site.example.test/examples/'));
  assert.match(await directory.text(), /href="\/examplepage\.com\/"/);
  assert.doesNotMatch(response.headers.get('content-security-policy'), /unsafe-eval/);
});

test('invalid enquiries and cross-site submissions never call the email provider', async t => {
  t.mock.method(globalThis,'fetch',()=>{throw Error('Email must not be called');});
  for (const change of [{name:'  '},{email:'a@host'},{description:'  '},{description:'a'.repeat(5001)}]) {
    assert.equal((await worker.fetch(request({...input,...change}),env)).status,400);
  }
  assert.equal((await worker.fetch(request(input,{origin:'https://another.example.test'}),env)).status,403);
  assert.equal((await worker.fetch(request(input),{})).status,503);
});

test('valid 5000-character Unicode descriptions can be sent', async t => {
  t.mock.method(globalThis,'fetch',async()=>Response.json({id:'simulated-receipt'}));
  const data={...input,description:'漢'.repeat(5000)};
  const bytes=Buffer.byteLength(JSON.stringify(data));
  const response=await worker.fetch(request(data,{'content-length':String(bytes)}),env);
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{ok:true});
});

test('oversized request bodies are rejected even without Content-Length', async () => {
  const response=await worker.fetch(request({...input,description:'a'.repeat(50000)}),env);
  assert.equal(response.status,413);
});

test('delivery is confirmed only when the provider returns a receipt', async t => {
  const provider=t.mock.method(globalThis,'fetch',async()=>Response.json({}));
  assert.equal((await worker.fetch(request(input),env)).status,502);
  provider.mock.mockImplementation(async()=>Response.json({id:'receipt'}));
  const response=await worker.fetch(request(input),env);
  assert.deepEqual(await response.json(),{ok:true});
  const options=provider.mock.calls.at(-1).arguments[1];
  assert.equal(options.signal instanceof AbortSignal,true);
  const sent=JSON.parse(options.body);
  assert.equal(sent.to,env.MAIL_TO);
  assert.equal(sent.replyTo,input.email);
});

const formScript=await fs.readFile(new URL('../site.js',import.meta.url),'utf8');
function formHarness(fetch, values=input) {
  const fields={};
  for (const name of ['name','email','description']) {
    const field={value:values[name],error:'',addEventListener(){},setCustomValidity(value){this.error=value;}};
    Object.defineProperty(field,'validity',{get:()=>({valid:!field.error && Boolean(field.value)})});
    fields[name]=field;
  }
  const label={textContent:''};
  const button={disabled:false,querySelector:()=>label};
  const status={textContent:'',dataset:{},removeAttribute(){delete this.dataset.state;},focus(){}};
  let submit;
  const form={
    elements:{namedItem:name=>fields[name]},querySelector:()=>button,
    addEventListener:(name,handler)=>{if(name==='submit')submit=handler;},
    reportValidity:()=>Object.values(fields).every(f=>f.validity.valid),
    reset(){this.didReset=true;},didReset:false,
  };
  class FormDataStub {
    get(name){return fields[name]?.value;}
    getAll(){return [];}
  }
  vm.runInNewContext(formScript,{
    document:{querySelector:selector=>selector==='#enquiryForm'?form:status},
    FormData:FormDataStub,fetch,AbortController,setTimeout,clearTimeout,Error,TypeError,
  });
  return {form,status,button,submit:()=>submit({preventDefault(){}})};
}

test('HTML or incomplete success responses do not clear the form or claim delivery', async () => {
  for (const response of [new Response('<html>Sign in</html>'),Response.json({}),Response.json(null)]) {
    const h=formHarness(async()=>response);
    await h.submit();
    assert.equal(h.form.didReset,false);
    assert.equal(h.status.dataset.state,'error');
    assert.equal(h.button.disabled,false);
  }
});

test('confirmed responses clear the form and show success', async () => {
  const h=formHarness(async()=>Response.json({ok:true}));
  await h.submit();
  assert.equal(h.form.didReset,true);
  assert.equal(h.status.dataset.state,'success');
});

test('client rejects the same incomplete email address as the server', async () => {
  let calls=0;
  const h=formHarness(async()=>{calls++;},{...input,email:'a@host'});
  await h.submit();
  assert.equal(calls,0);
  assert.equal(h.status.dataset.state,'error');
});

test('repeated submit events do not send a second request while one is pending', async () => {
  let resolve, calls=0;
  const h=formHarness(()=>{calls++;return new Promise(r=>resolve=r);});
  const pending=h.submit();
  await h.submit();
  assert.equal(calls,1);
  resolve(Response.json({ok:true}));
  await pending;
});

test('directory matches multiple words in any order and restores the empty state', async () => {
  const search={value:'merch CREATOR',addEventListener(name,handler){this.update=handler;}};
  const card={dataset:{search:'creator storefront merch sample',kind:'example'},hidden:false};
  const count={},kind={},empty={};
  vm.runInNewContext(await fs.readFile(new URL('../examples.js',import.meta.url),'utf8'),{
    document:{cookie:'',querySelector:s=>s==='#exampleSearch'?search:s==='#directoryResultCount'?count:s==='#directoryResultKind'?kind:empty,querySelectorAll:s=>s==='.listing-card'?[card]:[]},
    window:{addEventListener(){}},
  });
  assert.equal(card.hidden,false);
  assert.equal(count.textContent,'1 storefront');
  search.value='unlisted'; search.update();
  assert.equal(card.hidden,true); assert.equal(empty.hidden,false);
  search.value=''; search.update();
  assert.equal(card.hidden,false); assert.equal(empty.hidden,true);
});
