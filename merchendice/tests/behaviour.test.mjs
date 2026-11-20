import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
// helpers.mjs rebuilds dist/app.mjs before any test reads it.
import { worker, PAGES, MISSING_PAGE, expectedStatus, page } from './helpers.mjs';

const env = {
  MAIL_TO: 'inbox@example.test',
  async sendMail(message, {signal}) {
    const response = await fetch('https://provider.example.test', {method:'POST',body:JSON.stringify(message),signal});
    return response.json();
  },
};
const input = {name:'A creator',email:'creator@example.test',description:'A merch idea'};
const request = (value, headers={}) => new Request('https://site.example.test/api/enquiry', {method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(value)});

test('all pages, the 404 page included, support GET and HEAD without exposing email configuration', async () => {
  for (const route of [...PAGES, '/example-store/']) {
    const get = await worker.fetch(new Request(`https://site.example.test${route}`),env);
    assert.equal(get.status,expectedStatus(route),route);
    assert.equal((await get.text()).includes(env.MAIL_TO),false,route);
    const head = await worker.fetch(new Request(`https://site.example.test${route}`,{method:'HEAD'}),env);
    assert.equal(head.status,expectedStatus(route),route);
    assert.equal(await head.text(),'');
    assert.equal(head.headers.get('content-type'),get.headers.get('content-type'));
  }
});

test('every page path without a trailing slash 301-redirects to it and keeps the query string', async () => {
  for (const route of [...PAGES, '/example-store/'].filter(route => route.length > 1 && route.endsWith('/')).map(route => route.slice(0, -1))) {
    const response = await worker.fetch(new Request(`https://site.example.test${route}?ref=1`));
    assert.equal(response.status, 301);
    assert.equal(response.headers.get('location'), `${route}/?ref=1`);
    const head = await worker.fetch(new Request(`https://site.example.test${route}`, { method: 'HEAD' }));
    assert.equal(head.status, 301);
    assert.equal(head.headers.get('location'), `${route}/`);
    assert.equal(await head.text(), '');
  }
});

test('CREATOR example is served on its Merchendice path with self-hosted images and no inline code', async () => {
  const response = await worker.fetch(new Request('https://site.example.test/example-store/'));
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /<title>CREATOR \| Storefront example/);
  assert.match(html, /<meta name="robots" content="noindex">/);
  assert.equal(response.headers.get('x-robots-tag'), 'noindex');
  assert.doesNotMatch(html, /printify|images-api/i);
  assert.doesNotMatch(html, /<style|<script>|\sstyle="|\son[a-z]+="/);
  const csp = response.headers.get('content-security-policy');
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval|https:/);
  assert.match(csp, /img-src 'self' data:;/);
  const script = html.match(/<script src="(\/example-store\/store\.[0-9a-f]{10}\.js)" defer><\/script>/)[1];
  const js = await (await worker.fetch(new Request(`https://site.example.test${script}`))).text();
  assert.match(js, /\/images\/store\//);
  assert.doesNotMatch(js, /printify|https?:\/\/|style="/i);
  // Every product and colour the script can show has a self-hosted mockup.
  const products = new vm.Script(`(${js.slice(js.indexOf('const products=[') + 15, js.indexOf('];', js.indexOf('const products=[')) + 1)})`).runInNewContext();
  for (const p of products) for (const id of p.colors.length ? p.colors.map(c => c[1]) : [p.primary]) {
    await fs.access(new URL(`../images/store/${p.id}-${id}.webp`, import.meta.url));
  }
  assert.match(html, /<link rel="stylesheet" href="\/example-store\/store\.[0-9a-f]{10}\.css">/);
  assert.doesNotMatch(html, /archivo/i);
  const storeCssHref = html.match(/href="(\/example-store\/store\.[0-9a-f]{10}\.css)"/)[1];
  const storeCss = await (await worker.fetch(new Request(`https://site.example.test${storeCssHref}`))).text();
  assert.match(storeCss, /\/fonts\/dm-sans\.woff2/);
  assert.doesNotMatch(storeCss, /archivo/i);
  const nested = await worker.fetch(new Request('https://site.example.test/example-store/products/sample'));
  assert.equal(nested.status, 200);
  const directory = await worker.fetch(new Request('https://site.example.test/examples/'));
  assert.match(await directory.text(), /href="\/example-store\/"/);
});

test('example shop renders a product grid, labels it as an example, and loads no payment scripts', async () => {
  const response = await worker.fetch(new Request('https://site.example.test/example-store/'));
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /<div[^>]*id="products"/);
  assert.match(html, /<dialog[^>]*id="productDialog"/);
  assert.match(html, /<dialog[^>]*id="bagDialog"/);
  assert.doesNotMatch(html, /\bkr\b|SEK|\$\d|example prices|card-price|qv-price/);
  assert.match(html, /Purchases are not available/);
  assert.match(html, /Built by Merchendice/);
  const scriptSources = [...html.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)].map(m => m[1]);
  assert.equal(scriptSources.length, 1);
  assert.match(scriptSources[0], /^\/example-store\/store\.[0-9a-f]{10}\.js$/);
  const js = await (await worker.fetch(new Request(`https://site.example.test${scriptSources[0]}`))).text();
  assert.doesNotMatch(js, /money\(|Intl\.NumberFormat|price/);
  assert.doesNotMatch(html, /stripe|checkout\.session|paymentIntent|paypal|klarna/i);
  assert.doesNotMatch(html, /\b(Printify|ShineOn|Webstudios|PolyVault)\b/);
  assert.doesNotMatch(response.headers.get('content-security-policy'), /stripe/i);
});

test('homepage explains the service and sends contact to the enquiry page instead of an email address', async () => {
  const response = await worker.fetch(new Request('https://site.example.test/'));
  const html = await response.text();
  assert.match(html.replace(/<[^>]+>/g, ''), /Merch that looks like it came from you\./);
  assert.match(html, /Start a project/);
  assert.match(html, /<a href="\/enquiry\/">Contact us<\/a>/);
  assert.match(html, /href="\/enquiry\/"/);
  // Shopify is never named; print on demand is described in plain words.
  assert.doesNotMatch(html, /Shopify/i);
  assert.match(html, /print-on-demand/);
  assert.match(html, /printed on demand/);
  assert.doesNotMatch(html, /Printify|ShineOn|\/images\/tee|images-api\.printify\.com/);
  assert.doesNotMatch(html, /merchendices@gmail\.com|mailto:/);
  assert.match(html, /rel="canonical" href="https:\/\/merchendice.com\/"/);
  assert.match(html, /property="og:image"/);
  assert.match(html, /application\/ld\+json/);
  assert.doesNotMatch(html, /Webstudios|PolyVault|testimonial|\$\d/);
  const jsonLd = html.match(/<script type="application\/ld\+json">([^<]*)<\/script>/)[1];
  const digest = (await import('node:crypto')).createHash('sha256').update(jsonLd).digest('base64');
  assert.ok(response.headers.get('content-security-policy').includes(`'sha256-${digest}'`));
  assert.doesNotMatch(response.headers.get('content-security-policy'), /unsafe-inline/);
  const parsed = JSON.parse(jsonLd)['@graph'].find((node) => node['@type'] === 'Organization');
  assert.equal(parsed['@type'], 'Organization');
  assert.equal(parsed.name, 'Merchendice');
  assert.equal(parsed.email, undefined);
  assert.equal(parsed.contactPoint.url, 'https://merchendice.com/enquiry/');
  assert.equal(parsed.address, undefined);
  assert.equal(parsed.founder, undefined);
});

test('unknown pages use the branded not-found page', async () => {
  const response = await worker.fetch(new Request('https://site.example.test/missing-page'));
  assert.equal(response.status, 404);
  assert.match(response.headers.get('content-type'), /text\/html/);
  assert.match(await response.text(), /That page isn’t here/);
  const icon = await worker.fetch(new Request('https://site.example.test/favicon.ico'));
  assert.equal(icon.status, 200);
  assert.match(icon.headers.get('content-type'), /icon/);
  const bytes = new Uint8Array(await icon.arrayBuffer());
  assert.equal(bytes[0], 0);
  assert.equal(bytes[2], 1);
  const robots = await worker.fetch(new Request('https://site.example.test/robots.txt'));
  assert.match(await robots.text(), /Sitemap: https:\/\/merchendice.com\/sitemap.xml/);
  const sitemap = await (await worker.fetch(new Request('https://site.example.test/sitemap.xml'))).text();
  for (const loc of ['https://merchendice.com/', 'https://merchendice.com/enquiry/', 'https://merchendice.com/examples/', 'https://merchendice.com/privacy/', 'https://merchendice.com/about/']) {
    assert.match(sitemap, new RegExp(`<loc>${loc.replace(/[/.]/g, '\\$&')}</loc><lastmod>\\d{4}-\\d{2}-\\d{2}</lastmod>`));
  }
  assert.doesNotMatch(sitemap, /example-store/, 'the noindex example store is left out of the sitemap');
});

test('a filled website field is ignored and not emailed', async t => {
  const provider = t.mock.method(globalThis, 'fetch', async () => Response.json({ id: 'receipt' }));
  const trapped = await worker.fetch(request({ ...input, website: 'https://spam.example', email: 'not-an-email' }), env);
  assert.equal(trapped.status, 200);
  assert.deepEqual(await trapped.json(), { ok: true });
  assert.equal(provider.mock.calls.length, 0);
  const blank = await worker.fetch(request({ ...input, website: '   ' }), env);
  assert.equal(blank.status, 200);
  assert.equal(provider.mock.calls.length, 1);
});

test('the optional channel links are included, and overlong ones are rejected', async t => {
  const provider = t.mock.method(globalThis, 'fetch', async () => Response.json({ id: 'receipt' }));
  const sent = await worker.fetch(request({ ...input, channels: ' tiktok.com/@creator, @creator on YouTube ' }), env);
  assert.equal(sent.status, 200);
  const message = JSON.parse(provider.mock.calls[0].arguments[1].body);
  assert.match(message.text, /Links to their channels: tiktok.com\/@creator, @creator on YouTube\n/);
  assert.doesNotMatch(message.text, /Website:|Where to find them|Other platforms/);
  const empty = await worker.fetch(request(input), env);
  assert.equal(empty.status, 200);
  assert.match(JSON.parse(provider.mock.calls[1].arguments[1].body).text, /Links to their channels: Not provided/);
  const tooLong = await worker.fetch(request({ ...input, channels: 'y'.repeat(1001) }), env);
  assert.equal(tooLong.status, 400);
  assert.equal(provider.mock.calls.length, 2);
});

test('the enquiry form asks for channels once, in a single optional field', async () => {
  const html = await (await worker.fetch(new Request('https://site.example.test/enquiry/'))).text();
  assert.match(html, /<label for="channels">Links to your channels/);
  assert.doesNotMatch(html, /name="platforms"|name="youtube"|name="instagram"|name="tiktok"|name="otherPlatforms"/);
  assert.doesNotMatch(html.replace(/<[^>]+>/g, ''), /We read every note/);
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
function formHarness(fetch, values=input, dialog=null) {
  const fields={};
  for (const name of ['name','email','description']) {
    const field={value:values[name],error:'',addEventListener(){},setCustomValidity(value){this.error=value;}};
    Object.defineProperty(field,'validity',{get:()=>({valid:!field.error && Boolean(field.value)})});
    fields[name]=field;
  }
  const label={textContent:''};
  const button={disabled:false,querySelector:()=>label,focused:0,focus(){this.focused++;}};
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
    document:{querySelector:selector=>selector==='#enquiryForm'?form:status,getElementById:id=>id==='sentDialog'?dialog:null},
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

function dialogStub() {
  const handlers={};
  const closeButton={focused:0,addEventListener:(name,fn)=>{handlers['close-button:'+name]=fn;},focus(){this.focused++;}};
  return {
    open:false,shown:0,closeButton,handlers,
    querySelector:selector=>selector==='[data-dialog-close]'?closeButton:null,
    addEventListener(name,fn){handlers[name]=fn;},
    showModal(){this.open=true;this.shown++;},
    close(){this.open=false;handlers.close?.();},
  };
}

test('site.js wiring, with a stubbed dialog: a confirmed send opens it, focuses Close, and closing returns focus', async () => {
  const dialog=dialogStub();
  const h=formHarness(async()=>Response.json({ok:true}),input,dialog);
  await h.submit();
  assert.equal(dialog.open,true);
  assert.equal(dialog.closeButton.focused,1);
  // The close button, the backdrop and Esc (the native close event) all return focus to the submit button.
  dialog.handlers['close-button:click']();
  assert.equal(dialog.open,false);
  assert.equal(h.button.focused,1);
  dialog.showModal();
  dialog.handlers.click({target:dialog});
  assert.equal(dialog.open,false);
  assert.equal(h.button.focused,2);
});

test('a failed send never opens the sent dialog', async () => {
  const dialog=dialogStub();
  const h=formHarness(async()=>Response.json({}),input,dialog);
  await h.submit();
  assert.equal(dialog.shown,0);
  assert.equal(h.status.dataset.state,'error');
});

test('the sent dialog markup is a labelled native dialog with the approved wording and a close button', async () => {
  const html = await (await worker.fetch(new Request('https://site.example.test/enquiry/'))).text();
  assert.match(html, /<dialog class="sent-dialog" id="sentDialog" aria-labelledby="sentTitle" aria-describedby="sentText">\s*<h2 id="sentTitle">Thanks, your message is sent\.<\/h2>\s*<p id="sentText">We’ll answer by email, usually within one or two days\.<\/p>\s*<button class="button button-primary" type="button" data-dialog-close>Close<\/button>\s*<\/dialog>/);
});

test('marketing pages never mention samples, quality checks or Shopify, and list jewellery', async () => {
  for (const route of PAGES) {
    const html = await page(route);
    assert.doesNotMatch(html.replaceAll(WHAT_YOU_GET, ''), /sample|quality|shopify/i, route);
    assert.doesNotMatch(html.replace(/<[^>]+>/g, ' '), /\bcolor|\bfavorite|jewelry|\bcenter\b/i, route);
  }
  const home = await (await worker.fetch(new Request('https://site.example.test/'))).text();
  assert.match(home, /<li>Jewellery<\/li>/);
  assert.match(home, /<p class="goods-range">Clothing, totes and bags, mugs, home goods and jewellery\.<\/p>/);
  assert.match(home, /influencers of any size/);
  assert.match(home, /Exclusive designs/);
  assert.match(home, /A store in your look, built and kept running by us/);
  assert.match(home, /<span>Based and designed in Sweden<\/span>/);
  assert.doesNotMatch(home, /mobile-cta|language|guide/i);
});

test('the About page holds Oscar’s approved words and the two names, and is linked from every page', async () => {
  const html = await (await worker.fetch(new Request('https://site.example.test/about/'))).text();
  assert.match(html, /<h1>About Merchendice<\/h1>\s*<p class="v-lead">We started Merchendice after watching a creator’s merch launch fall flat\. We knew it could be done better, so we built the service we wish they’d had\.<\/p>/);
  assert.match(html, /We design every piece from a creator’s own content and colours, then build and run the store for them\. Each order is printed on demand and shipped for them, so they never touch stock\. They have as much say as they want, and we handle the rest\./);
  assert.match(html, /<p class="v-names">Oscar Thomas and Oscar Rodelius<\/p><p class="v-where">Based in Sweden<\/p>/);
  assert.doesNotMatch(html, /Your photo here|v2-points|class="v2c-pt/);
  assert.match(html, /<title>About \| Merchendice<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/merchendice\.com\/about\/">/);
  assert.match(html, /<div class="v2-panel hero-rise hero-rise-2">[\s\S]*<p class="v2-panel-cta"><a class="button button-primary" href="\/enquiry\/">Contact us<\/a><\/p>\s*<\/div>/);
  assert.doesNotMatch(html, /Start a project/);
  const home = await (await worker.fetch(new Request('https://site.example.test/'))).text();
  assert.doesNotMatch(home, /id="about"|Who we are|Oscar Rod[e]lius/);
  for (const route of PAGES) {
    const html = await page(route);
    assert.equal((html.match(/href="\/about\/"/g) || []).length, 2, route);
    assert.doesNotMatch(html, /#about/, route);
  }
});

test('the header Contact us button is a filled terracotta button on dark', async () => {
  const css = await (await worker.fetch(new Request('https://site.example.test/site.css'))).text();
  assert.match(css, /\.nav-cta \{[^}]*background: var\(--accent\);[^}]*color: var\(--on-accent\)/);
  assert.match(css, /\.nav-cta:hover \{ background: var\(--accent-hover\)/);
});

test('log retention configs keep about 30 days, with concrete Docker size caps', async () => {
  const read = (path) => fs.readFile(new URL(`../${path}`, import.meta.url), 'utf8');
  // Proxy access logs (the only ones with visitor IPs) are deleted after 30 days.
  const caddy = await read('Caddyfile');
  assert.match(caddy, /roll_size 1MiB/);
  assert.match(caddy, /roll_keep_for 720h/);
  const logrotate = await read('deploy/logrotate-merchendice');
  for (const line of [/^\s*daily$/m, /^\s*rotate 30$/m, /^\s*maxage 30$/m]) assert.match(logrotate, line);
  // Docker's json-file driver can only rotate by size, never by age. Both containers get the same
  // concrete cap: 3 files of 10 MB. The app logs only start-up lines and errors (no visitor IPs), so
  // 30 MB holds far more than 30 days of them; Caddy's own lines carry no visitor IPs either.
  for (const file of ['compose.yaml', 'compose.https.yaml']) {
    const yaml = await read(file);
    const logging = [...yaml.matchAll(/logging:\s*\n\s*driver: ([\w-]+)\s*\n\s*options:\s*\n\s*max-size: "([^"]+)"\s*\n\s*max-file: "([^"]+)"/g)];
    assert.equal(logging.length, 1, `${file} has one logging block`);
    assert.deepEqual(logging[0].slice(1), ['json-file', '10m', '3'], file);
  }
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

test('the storefront directory has no search or filter for a single store, and sets no cookie', async () => {
  const html = await (await worker.fetch(new Request('https://site.example.test/examples/'))).text();
  assert.doesNotMatch(html, /directory-toolbar|exampleSearch|data-filter|examples\.js/);
  assert.match(html, /href="\/example-store\/"/);
  const privacy = await (await worker.fetch(new Request('https://site.example.test/privacy/'))).text();
  assert.doesNotMatch(privacy, /merchendice_storefront_view/);
  assert.equal((await worker.fetch(new Request('https://site.example.test/examples.js'))).status, 404);
});

test('homepage is image-led with self-hosted mockups, one shirt in the hero, and none of the template tells', async () => {
  const html = await (await worker.fetch(new Request('https://site.example.test/'))).text();
  // Every image is self-hosted under /images/, and has explicit dimensions so nothing shifts while it loads.
  const tags = [...html.matchAll(/<img\b[^>]*>/g)].map(m => m[0]);
  assert.ok(tags.length >= 6, 'the page is image-rich');
  for (const tag of tags) {
    assert.match(tag, /src="\/images\/[a-z0-9-]+\.webp"/, tag);
    assert.match(tag, /width="\d+" height="\d+"/, tag);
  }
  const allowed = ['hero-tee', 'tote-natural', 'knit-stack', 'photo-jewellery-720', 'photo-tote-720', 'photo-crewneck-720', 'hoodie-black-496', 'store-phone-780'];
  // Desktop-only tiles use <picture>. Count the designed photo once (the min-width source, or the img if there isn't one).
  const figures = [...html.matchAll(/<figure class="tile[^"]*">([\s\S]*?)<\/figure>/g)].map(m => m[1]);
  const names = [];
  for (const figure of figures) {
    const desktop = figure.match(/<source media="\(min-width: 901px\)" srcset="\/images\/([a-z0-9-]+)\.webp"/);
    const img = figure.match(/<img\b[^>]*src="\/images\/([a-z0-9-]+)\.webp"/);
    names.push((desktop || img)[1]);
  }
  for (const tag of tags) {
    if (figures.some(figure => figure.includes(tag))) continue;
    names.push(tag.match(/\/images\/([a-z0-9-]+)\.webp/)[1]);
  }
  for (const name of names) assert.ok(allowed.includes(name), name);
  assert.equal(new Set(names).size, names.length, 'no photo is shown twice on the homepage');
  // The colourful songbird (the cartoon bird from the tote) now appears on one homepage image; the sticker tile is the knit stack.
  const songbird = names.filter(name => ['tote-natural', 'sticker', 'goods-flatlay'].includes(name));
  assert.deepEqual(songbird, ['tote-natural']);
  assert.match(html, /<img src="\/images\/knit-stack\.webp" alt="Stack of folded knit sweaters" width="640" height="800"/);
  assert.doesNotMatch(html, /sticker\.webp|Songbird kiss-cut sticker/);
  // The fabric close-ups are gone; the hero mixes three stock product photos with the store mockups.
  assert.doesNotMatch(html, /tote-black|canvas-(black|natural|sand)|canvas weave|goods-flatlay|store-banner/);
  assert.match(html, /Natural canvas tote with a colourful songbird print/);
  for (const name of ['jewellery', 'tote', 'crewneck']) {
    assert.match(html, new RegExp(`srcset="/images/photo-${name}-360\\.webp 360w, /images/photo-${name}-720\\.webp 720w"`), name);
  }
  assert.doesNotMatch(html, /Pictured:/);
  // The hero mosaic has exactly one tee; the store preview uses a different unedited store product.
  assert.equal((html.match(/\/images\/hero-tee\.webp/g) || []).length, 1);
  assert.match(html, /class="hero-mosaic"[\s\S]*hero-tee\.webp[\s\S]*<\/div>\s*<\/section>/);
  const hero = html.slice(html.indexOf('<section class="hero"'), html.indexOf('</section>'));
  assert.match(hero, /\/images\/hero-tee\.webp/);
  assert.doesNotMatch(hero, /See the example store/);
  assert.doesNotMatch(html, /hero-illustration|art-piece|hero-art|<circle|<ellipse|<svg/);
  // No eyebrow labels, accent words, italic flourishes or scroll cue.
  assert.doesNotMatch(html, /class="[^"]*\b(kicker|accent|reveal|scroll-cue|section-lede|eyebrow)\b/);
  assert.doesNotMatch(html, /<em>|<i>[^<]/);
  assert.doesNotMatch(html, /We help creators turn|Merch your audience would buy/i);
  assert.doesNotMatch(html, /We read every note|keep looking after/i);
  assert.doesNotMatch(html.replace(/<[^>]+>/g, ''), /—/, 'no em dashes in the copy');
  assert.doesNotMatch(html, /service-num|quality-num|process-num|Step 0\d|>0[1-9]</);
  assert.doesNotMatch(html, /class="platforms"|platform-link|mid-size creators on/, 'platform line removed at Oscar\'s request');
  for (const step of ['Idea', 'Designs', 'Products', 'Your store', 'Launch']) assert.match(html, new RegExp(`<h3>${step}</h3>`));
  assert.doesNotMatch(html, /id="quality"|href="#quality"|sample check|signed it off/);
  assert.doesNotMatch(html, /Every design starts from what you post|Worried your merch will look cheap/);
  // Mugs are allowed: Oscar's approved 'What can I sell?' answer names them.
  assert.doesNotMatch(html, /Prints and posters/);
  assert.doesNotMatch(html, /class="closer|example-store-accessories|sticker-camel|tote-black-detail/, 'no closer section and no leftover bird or store-chrome shots');
  assert.doesNotMatch(html.replaceAll(WHAT_YOU_GET, ''), /\bfree\b|payout|profit|\d+\s?(k|K|M)\b followers/i);
  assert.equal((html.match(/href="\/enquiry\/"/g) || []).length >= 3, true);
  const css = await (await worker.fetch(new Request('https://site.example.test/site.css'))).text();
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /\/fonts\/cormorant-garamond\.woff2/);
  assert.match(css, /\/fonts\/dm-sans\.woff2/);
  assert.match(css, /font-display: swap/);
  assert.doesNotMatch(css, /Instrument Serif|Archivo|Source Serif|font-style: italic|\.kicker|\.accent\b/);
  assert.match(css, /@keyframes rise-in/);
  assert.match(css, /body \{[^}]*font-size: 17px/);
  const js = await (await worker.fetch(new Request('https://site.example.test/site.js'))).text();
  assert.match(js, /IntersectionObserver/);
  assert.match(js, /unobserve/);
  assert.doesNotMatch(js, /reveal/);
});

test('JSON-LD and the visible hero line both say creators and influencers', async () => {
  const html = await (await worker.fetch(new Request('https://site.example.test/'))).text();
  const json = JSON.parse(html.match(/<script type="application\/ld\+json">([^<]+)<\/script>/)[1])['@graph'].find((node) => node['@type'] === 'Organization');
  assert.match(json.description, /creators and influencers/);
  assert.match(json.audience.audienceType, /Creators and influencers/);
  assert.match(html, /<h2 class="hero-line">A merch studio for creators and influencers<\/h2>/);
});

test('the primary Start a project button sits in the hero under the bullets, and the hero text is top-aligned', async () => {
  const html = await (await worker.fetch(new Request('https://site.example.test/'))).text();
  const hero = html.slice(html.indexOf('<section class="hero"'), html.indexOf('service-strip'));
  const bullets = hero.indexOf('class="hero-points"');
  const actions = hero.indexOf('class="hero-actions');
  const button = hero.indexOf('href="/enquiry/"');
  assert.ok(bullets > 0 && actions > bullets, 'actions follow the bullets');
  assert.ok(button > actions, 'the enquiry button is inside hero-actions');
  assert.match(hero, /<a class="button button-primary" href="\/enquiry\/">Start a project<\/a>/);
  assert.equal((hero.match(/Start a project/g) || []).length, 1);
  const css = await (await worker.fetch(new Request('https://site.example.test/site.css'))).text();
  const heroRule = css.slice(css.indexOf('\n.hero {'), css.indexOf('.hero-copy'));
  assert.match(heroRule, /align-items: start/);
  assert.doesNotMatch(heroRule, /align-items: center/);
});

test('no sentence is repeated across the homepage', async () => {
  const html = await (await worker.fetch(new Request('https://site.example.test/'))).text();
  const body = html.slice(html.indexOf('<main'), html.indexOf('</main>')).replace(/<!--[\s\S]*?-->/g, '').replace(/<span class="sr-only">[^<]*<\/span>/g, '');
  const sentences = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').split(/(?<=[.?!])\s+/).map(t => t.trim().toLowerCase()).filter(t => t.split(' ').length > 3);
  const seen = new Set();
  for (const sentence of sentences) { assert.ok(!seen.has(sentence), `repeated: ${sentence}`); seen.add(sentence); }
});

test('marketing pages use the cream, charcoal and terracotta theme with no green, gradient text or glows', async () => {
  const css = await (await worker.fetch(new Request('https://site.example.test/site.css'))).text();
  assert.match(css, /--bg: #F8F3EB/);
  assert.match(css, /--espresso: #2B2A28/);
  assert.match(css, /--accent: #B03A26/);
  assert.doesNotMatch(css, /--green|#1f3d30|#172e24/i);
  assert.doesNotMatch(css, /\.grad\b|glow|#7cc8d9|#9a8be8|#ecd27f|background-clip: text|linear-gradient|radial-gradient/i);
  for (const route of PAGES) {
    const html = await page(route);
    assert.doesNotMatch(html, /class="grad|glow|#7cc8d9|#9a8be8|#ecd27f/, route);
    assert.match(html, /<link rel="preload" href="\/fonts\/cormorant-garamond\.woff2" as="font" type="font\/woff2" crossorigin>/, route);
    assert.match(html, /<link rel="preload" href="\/fonts\/dm-sans\.woff2" as="font" type="font\/woff2" crossorigin>/, route);
    assert.match(html, /<meta name="theme-color" content="#2B2A28">/, route);
    assert.match(html, /<a class="wordmark" href="[^"]+" aria-label="Merchendice home">Merchendice<\/a>/, route);
    // Other marketing pages only use the natural tote (enquiry) or the example-store product image (examples).
    if (route !== '/') for (const [, src] of html.matchAll(/<img\b[^>]*src="([^"]+)"/g)) assert.match(src, route === '/about/' ? /^\/images\/about-knit-1200\.webp$/ : /^\/images\/(store-desktop-1440|tote-natural)\.webp$/, route);
    assert.doesNotMatch(html, /class="[^"]*\bkicker\b|hero-illustration|enquiry-mark|We read every note/, route);
  }
});

test('no marketing page shows the email address or section numbering', async () => {
  for (const route of PAGES) {
    const html = await page(route);
    assert.doesNotMatch(html, /merchendices@gmail\.com|mailto:/, route);
    assert.doesNotMatch(html, /Step 0\d|service-num|quality-num|process-num/, route);
    assert.match(html, /Contact us/, route);
    assert.doesNotMatch(html, /<circle/, route);
  }
});

test('privacy notice is finished and indexable, and open items live in an unserved TODO.md', async () => {
  const html = await (await worker.fetch(new Request('https://site.example.test/privacy/'))).text();
  assert.doesNotMatch(html, /noindex|\(draft\)|draft-banner/i);
  for (const route of [...PAGES, '/example-store/']) {
    assert.doesNotMatch(route === '/example-store/' ? await (await worker.fetch(new Request(`https://site.example.test${route}`))).text() : await page(route), /<!--/, route);
  }
  const notes = await fs.readFile(new URL('../TODO.md', import.meta.url), 'utf8');
  // The controller line and the 30-day log line are now in the notice itself; TODO.md keeps only the NPM deploy step.
  assert.doesNotMatch(notes, /\*\*Data controller|\*\*Access logs/);
  assert.match(notes, /Nginx Proxy Manager/);
  assert.match(html, /Oscar Thomas is the data controller for the details described here\. To reach him about your data, use the form\./);
  assert.match(html, /Server and proxy logs are kept for 30 days and then deleted\./);
  assert.equal((await worker.fetch(new Request('https://site.example.test/TODO.md'))).status, 404);
  for (const field of ['Your name', 'Your email address', 'project description', 'How long it’s kept', 'deleted']) assert.match(html, new RegExp(field));
  assert.match(html, /<a href="\/enquiry\/">Contact us<\/a>/);
  assert.doesNotMatch(html, /gmail|Gmail/);
  for (const route of PAGES) {
    assert.doesNotMatch(await page(route), /Privacy notice \(draft\)/, route);
  }
});

test('site.js has no pointer or mouse-move effects', async () => {
  const js = await (await worker.fetch(new Request('https://site.example.test/site.js'))).text();
  assert.doesNotMatch(js, /pointermove|mousemove|--mx/);
});

test('the homepage has one how-it-works flow with the five steps and no old example link', async () => {
  const html = await (await worker.fetch(new Request('https://site.example.test/'))).text();
  assert.match(html, /id="how-it-works"/);
  assert.doesNotMatch(html, /id="why"/);
  const steps = [...html.matchAll(/<li class="process-step[^"]*">[\s\S]*?<h3>([^<]+)<\/h3>/g)].map(m => m[1]);
  assert.deepEqual(steps, ['Idea', 'Designs', 'Products', 'Your store', 'Launch']);
  assert.doesNotMatch(html, /href="\/examplepage\.com/);
});

const WHAT_YOU_GET = "A store in your look and a first collection drawn from your content. Nothing to pay while we shape the idea and the designs, and one launch fee when your store is ready to open. Every month you get a report and a payout, so you always know what sold. You can order samples at cost to wear, film or check first. All we ask is at least 3 videos featuring the merch, so your audience knows it's there.";
const APPROVED_COST = 'There’s nothing to pay while we shape the idea and the designs. You only pay once your store is ready to launch. Commercial terms are agreed with you before any work begins.';
const APPROVED_DAMAGED = 'Our supplier is responsible for getting it right. If something arrives damaged or faulty, send us a photo and we’ll replace it.';
const APPROVED_SHIP = 'We ship to the US, Canada and most countries worldwide. Right now we don’t ship to the EU or the UK.';
const homeFaq = (home) => home.slice(home.indexOf('id="faq"'), home.indexOf('class="closing-cta'));

test('the FAQ has exactly the ten approved questions with the approved answers', async () => {
  const faq = homeFaq(await page('/'));
  const questions = [...faq.matchAll(/<summary>([^<]+)<\/summary>/g)].map(m => m[1]);
  assert.deepEqual(questions, ['How does Merchendice work?', 'Who is it for?', 'What can I sell?', 'What do I need to do?', 'How do I get started?', 'How do we choose the products?', 'What does it cost to get started?', 'How long until my store is live?', 'Where do you ship?', 'What if an order arrives damaged?']);
  assert.ok(faq.includes('<p>Send us <a href="/enquiry/">the form</a>, and we’ll reply by email, usually within one or two days.</p>'));
  assert.ok(faq.includes(`<p>${APPROVED_COST}</p>`));
  assert.ok(faq.includes('<p>Usually 2 to 3 weeks.</p>'));
  // Any whitespace between the question and its answer, so a Windows (CRLF) checkout passes too.
  assert.match(faq, /<summary>What can I sell\?<\/summary>\s*<p>Lots of things: clothing, totes and bags, mugs, home goods like pillows and blankets, and jewellery\.<\/p>/);
  assert.doesNotMatch(faq, /Clothing like tees and totes/);
  assert.ok(faq.includes(`<p>${APPROVED_DAMAGED}</p>`));
  assert.match(faq, new RegExp(`<summary>Where do you ship\\?</summary>\\s*<p>${APPROVED_SHIP}</p>`));
  // The FAQPage data is built from these same ten answers; tests/seo.test.mjs checks it word for word.
  assert.match(await page('/'), /"@type":"FAQPage"/);
});

test('every page footer, the 404 page included, says "Got an idea? Contact us"', async () => {
  for (const route of PAGES) {
    const html = await page(route);
    assert.match(html, /<p class="footer-contact">Got an idea\? <a href="(?:\/enquiry\/|#enquiryForm)">Contact us<\/a><\/p>/, route);
    assert.doesNotMatch(html, /or just a channel/, route);
  }
});

test('the only cost wording on any page is the approved FAQ answer', async () => {
  const faq = homeFaq(await page('/'));
  assert.doesNotMatch(faq.replace(APPROVED_COST, '').replace('What does it cost to get started?', ''), /price|pricing|\$|payout|cost|Shopify|Printify|ShineOn|promo/i);
  for (const route of PAGES) {
    const html = (await page(route)).replaceAll(APPROVED_COST, '').replaceAll(APPROVED_DAMAGED, '').replaceAll(WHAT_YOU_GET, '');
    assert.doesNotMatch(html, /[$€£]\s?\d|\d+\s?(kr|sek|usd|eur)\b|\d+\s?%|\bfree\b|\bpay(s|ing|ment)?\b(?! details)|\bfees?\b|payout|revenue split|\bsplit\b|profit|commission|royalt/i, route);
    assert.doesNotMatch(html, /Commercial terms are agreed/, route);
  }
});

// Every declaration of a corner radius in site.css, at any nesting level (inside @media too), with the
// selector it applies to. Comments are stripped first so they can't hide or fake a rule.
function radiusDeclarations(css) {
  const found = [];
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of clean.matchAll(/([^{};]+)\{([^{}]*)\}/g)) {
    for (const d of m[2].matchAll(/(?:^|;)\s*(border(?:-(?:top|bottom|start|end)-(?:left|right|start|end))?-radius)\s*:\s*([^;]+)/g)) {
      found.push({ selector: m[1].trim().replace(/\s+/g, ' '), property: d[1], value: d[2].trim() });
    }
  }
  return found;
}
const BUTTON_SELECTOR = /\b(button|btn|cta|nav-toggle|nav-cta|data-dialog-close)\b/;

test('the header Contact us button has 4px corners and no later rule sets any other radius', async () => {
  const css = await (await worker.fetch(new Request('https://site.example.test/site.css'))).text();
  const navCta = radiusDeclarations(css).filter(d => /\.nav-cta\b/.test(d.selector));
  assert.ok(navCta.length >= 1, 'the .nav-cta rule declares its radius');
  for (const d of navCta) assert.equal(d.value, '4px', `${d.selector} { ${d.property}: ${d.value} }`);
});

test('every button rule in site.css declares exactly 4px corners', async () => {
  const css = await (await worker.fetch(new Request('https://site.example.test/site.css'))).text();
  const declarations = radiusDeclarations(css);
  for (const selector of ['.button', '.nav-toggle', '.nav-cta']) {
    assert.ok(declarations.some(d => d.selector === selector && d.value === '4px'), `${selector} declares 4px`);
  }
  for (const d of declarations.filter(d => BUTTON_SELECTOR.test(d.selector))) {
    assert.equal(d.value, '4px', `${d.selector} { ${d.property}: ${d.value} }`);
  }
  const enquiry = await page('/enquiry/');
  assert.match(enquiry, /<button class="button button-primary button-submit" type="submit">/);
  assert.match(enquiry, /<button class="button button-primary" type="button" data-dialog-close>/);
});

test('the About page uses the same reveal classes as the rest of the site', async () => {
  const html = await (await worker.fetch(new Request('https://site.example.test/about/'))).text();
  assert.match(html, /class="v2-bandwrap hero-rise"/);
  assert.match(html, /class="v2-panel hero-rise hero-rise-2"/);
  assert.match(html, /class="v2c-prose rise"/);
  assert.match(html, /class="v2d-foot rise"/);
  assert.match(html, /<script src="\/site\.[0-9a-f]+\.js" defer>/);
});

test('one call-to-action label, and each idea said only once across the site', async () => {
  const pages = {};
  for (const route of PAGES) {
    const html = await page(route);
    pages[route] = html.slice(html.indexOf('<body'), html.indexOf('</body>')).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  }
  // Buttons and links that lead to the enquiry form say "Start a project" (or "Contact us" in the header and footer).
  for (const [route, html] of Object.entries(pages)) {
    assert.doesNotMatch(html, /Tell us your idea|Send us a note|Send an enquiry|Start your enquiry|Ask what would suit/, route);
  }
  const home = await (await worker.fetch(new Request('https://site.example.test/'))).text();
  for (const label of [...home.matchAll(/<a class="button[^"]*" href="\/enquiry\/">([^<]+)<\/a>/g)].map(m => m[1])) assert.equal(label, 'Start a project');
  const enquiry = await (await worker.fetch(new Request('https://site.example.test/enquiry/'))).text();
  assert.match(enquiry, /<button class="button button-primary button-submit" type="submit"><span>Start a project<\/span><\/button>/);
  const all = Object.values(pages).join(' ');
  const count = (re) => (all.match(re) || []).length;
  assert.equal(count(/A demo store, so you can see the finished standard/g), 1);
  assert.equal(count(/in your look/g), 2, 'hero bullet plus the approved What you get section');
  assert.equal(count(/\bjoke/g), 1, "only the approved enquiry-step wording");
  assert.equal(count(/already recognises/g), 0, "the removed statement line stays gone");
  // The homepage ends on the closing call to action after the FAQ, and the footer carries the contact line.
  assert.match(home, /<\/details>\s*<\/div>\s*<\/section>\s*<section class="closing-cta rise" aria-labelledby="closing-title">\s*<h2 id="closing-title">Let’s make your first drop\.<\/h2>\s*<a class="button button-primary" href="\/enquiry\/">Start a project<\/a>\s*<\/section>\s*<\/main>/);
  assert.match(home, /<p class="footer-contact">[^<]*<a href="\/enquiry\/">Contact us<\/a><\/p>/);
});

test('load-in motion has a reduced-motion path and a no-JS fallback, and does not hide content without JS', async () => {
  const css = await (await worker.fetch(new Request('https://site.example.test/site.css'))).text();
  const js = await (await worker.fetch(new Request('https://site.example.test/site.js'))).text();
  // Hidden state only applies when JS has marked the document and motion is allowed.
  assert.match(css, /@media \(prefers-reduced-motion: no-preference\)[\s\S]*html\.js \.hero-rise[\s\S]*opacity: 0/);
  assert.match(css, /@media \(prefers-reduced-motion: no-preference\)[\s\S]*html\.js-io \.rise:not\(\.is-in\)[\s\S]*opacity: 0/);
  // The first hero step starts immediately so the heading is not delayed more than about 300ms.
  assert.match(css, /animation: rise-in 600ms ease-out forwards/);
  assert.doesNotMatch(css, /html\.js \.hero-rise \{[^}]*animation-delay/);
  assert.match(css, /html\.js \.hero-rise-2 \{ animation-delay: 80ms/);
  assert.match(css, /html\.js \.hero-rise-3 \{ animation-delay: 160ms/);
  assert.match(css, /translateY\(10px\)/);
  // Reduced motion restores visibility and cancels the animation.
  const reduce = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(reduce, /html\.js \.hero-rise/);
  assert.match(reduce, /html\.js-io \.rise/);
  assert.match(reduce, /animation: none/);
  assert.match(reduce, /opacity: 1/);
  // Observer is skipped when the viewer prefers reduced motion, and each target is observed only once.
  assert.match(js, /prefers-reduced-motion: reduce/);
  assert.match(js, /IntersectionObserver/);
  assert.match(js, /unobserve/);
  for (const route of PAGES) {
    const html = await page(route);
    assert.match(html, /<script>document\.documentElement\.classList\.add\('js'\)<\/script>/, route);
    const csp = (await worker.fetch(new Request(`https://site.example.test${route}`))).headers.get('content-security-policy');
    const digest = (await import('node:crypto')).createHash('sha256').update("document.documentElement.classList.add('js')").digest('base64');
    assert.ok(csp.includes(`'sha256-${digest}'`), route);
    assert.doesNotMatch(csp, /unsafe-inline/, route);
    // Without the js class, the markup itself does not start hidden.
    assert.doesNotMatch(html, /style="[^"]*opacity:\s*0/, route);
  }
});

test('the About page tells the story and has no photo placeholder', async () => {
  const html = await (await worker.fetch(new Request('https://site.example.test/about/'))).text();
  assert.match(html, /started Merchendice after watching a creator’s merch launch fall flat/);
  assert.match(html, /<p class="v-where">Based in Sweden<\/p>/);
  assert.doesNotMatch(html, /Your photo here|photo-slot|placeholder/i);
  assert.equal((html.match(/<h1\b/g) || []).length, 1);
});

test('the example store links back to the Merchendice homepage from its top bar', async () => {
  const html = await (await worker.fetch(new Request('https://site.example.test/example-store/'))).text();
  const bar = html.match(/<div class="announce">([\s\S]*?)<\/div>/)[1];
  assert.match(bar, /^<a class="announce-back" href="\/"><span aria-hidden="true">←<\/span> Back to Merchendice<\/a>/);
  // The new top-bar link plus the two that were already in the store footer (Merchendice and Built by Merchendice).
  assert.equal((html.match(/href="\/"/g) || []).length, 3);
  const css = await (await worker.fetch(new Request('https://site.example.test/example-store/store.css'))).text();
  assert.match(css, /\.announce-back:focus-visible\{outline-color:#fff\}/);
  assert.match(css, /@media \(max-width:700px\)\{[\s\S]*?\.announce-back\{position:static/);
});

test('the homepage product band follows the approved FAQ list, and stickers are listed nowhere', async () => {
  const html = await (await worker.fetch(new Request('https://site.example.test/'))).text();
  const strip = html.match(/<ul aria-label="What we make">([\s\S]*?)<\/ul>/)[1];
  assert.deepEqual([...strip.matchAll(/<li>([^<]+)<\/li>/g)].map(m => m[1]), ['Clothing', 'Totes and bags', 'Mugs', 'Home goods', 'Jewellery']);
  assert.match(html, /Lots of things: clothing, totes and bags, mugs, home goods like pillows and blankets, and jewellery\./, 'the FAQ list the band follows');
  assert.match(html, /from clothing and totes to mugs and jewellery\./);
  for (const route of PAGES) assert.doesNotMatch((await page(route)).replace(/<script[\s\S]*?<\/script>/g, ''), /sticker/i, route);
  assert.doesNotMatch(await (await worker.fetch(new Request('https://site.example.test/llms.txt'))).text(), /sticker/i);
});

test('home copy says each idea once: no "for you" pile-up, "build and run" only in the approved FAQ', async () => {
  const html = await (await worker.fetch(new Request('https://site.example.test/'))).text();
  const faqStart = html.indexOf('<section class="faq-section"');
  const body = html.slice(html.indexOf('<main'), faqStart).replace(/<[^>]+>/g, ' ');
  assert.doesNotMatch(body, /build and run|built and run|we run\b|run it\b|handle (the rest|everything)/i);
  assert.doesNotMatch(html.slice(0, html.indexOf('<main')).replace(/<script[\s\S]*?<\/script>/g, ''), /build and run/i, 'not in the meta descriptions either');
  assert.doesNotMatch(html.match(/"@type":"Organization"[^]*?"audience"/)[0], /builds and runs/, 'the structured-data description does not repeat it either');
  const footer = html.slice(html.indexOf('<footer')).replace(/<[^>]+>/g, ' ');
  assert.match(footer, /Designs and stores for creators of any size on TikTok, Instagram and YouTube\./);
  assert.doesNotMatch(footer, /we run|build and run/i);
  assert.ok((body.match(/\bfor you\b/g) || []).length === 0, 'no bare "for you" outside the FAQ');
  assert.match(body, /It starts with a short message\. We take it from there\./);
  assert.match(body, /The store opens and we look after it\./);
});

test('quick fixes: Example store naming, reply time on the enquiry page, no Oxford comma on the examples page', async () => {
  for (const route of PAGES) {
    const html = await page(route);
    assert.doesNotMatch(html, /Storefronts/, route);
    if (route !== '/example-store/') assert.equal((html.match(/<a href="\/examples\/"( aria-current="page")?>Example store<\/a>/g) || []).length, 2, route);
  }
  const examples = await page('/examples/');
  assert.match(examples, /<title>Example store \| Merchendice<\/title>/);
  assert.match(examples, /<h1 id="directory-title" class="hero-rise">Example store<\/h1>/);
  assert.match(examples, /a collection page, quick view and a bag\./);
  const enquiry = await page('/enquiry/');
  assert.match(enquiry, /even if it’s still rough\. We reply by email, usually within one or two days\.<\/p>/);
  assert.match(enquiry, /<p id="sentText">We’ll answer by email, usually within one or two days\.<\/p>/);
  const home = await page('/');
  assert.match(home, /<meta name="description" content="[^"]*on TikTok, Instagram, YouTube or anywhere else\./);
  assert.match(home, /Creators of any size, on any platform\./, 'the FAQ line the meta wording agrees with');
});

test('the share image is a 1200 × 630 PNG under 300 KB, and every page points to it with matching meta', async () => {
  const response = await worker.fetch(new Request('https://site.example.test/og.png'));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/png');
  const png = Buffer.from(await response.arrayBuffer());
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], 'PNG signature');
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
  assert.ok(png.length < 300 * 1024, `${Math.round(png.length / 1024)} KB`);
  assert.deepEqual(png, await fs.readFile(new URL('../og.png', import.meta.url)), 'the served file is the committed one');
  for (const route of PAGES.filter(route => route !== MISSING_PAGE)) {
    const html = await page(route);
    assert.match(html, /<meta property="og:image" content="https:\/\/merchendice\.com\/og\.png\?v=2">\s*<meta property="og:image:width" content="1200">\s*<meta property="og:image:height" content="630">/, route);
    assert.match(html, /<meta name="twitter:image" content="https:\/\/merchendice\.com\/og\.png\?v=2">/, route);
  }
});

test('the homepage hoodie photo has 4px rounded corners', async () => {
  const css = await (await worker.fetch(new Request('https://site.example.test/site.css'))).text();
  const decl = radiusDeclarations(css).filter(d => d.selector === '.goods-feature');
  assert.ok(decl.length >= 1, '.goods-feature declares a radius');
  for (const d of decl) assert.equal(d.value, '4px');
  assert.match(css, /\.goods-feature\s*\{[^}]*overflow:\s*hidden/);
});

test('no marketing page, llms.txt or JSON-LD mentions stickers, and the damaged answer makes no day-count or free promise', async () => {
  for (const route of ['/', '/about/', '/examples/', '/enquiry/', '/privacy/', '/llms.txt', '/404.html']) {
    let body;
    try { body = await page(route); } catch { continue; }
    assert.doesNotMatch(body, /sticker/i, route);
  }
  for (const file of ['index.html', 'llms.txt', 'README.md', 'TODO.md']) {
    assert.doesNotMatch(await fs.readFile(new URL(`../${file}`, import.meta.url), 'utf8'), /sticker/i, file);
  }
  assert.doesNotMatch(APPROVED_DAMAGED, /30 days|free of charge/i);
  const home = await page('/');
  const answer = homeFaq(home).match(/<summary>What if an order arrives damaged\?<\/summary>\s*<p>([^<]+)<\/p>/)[1];
  assert.equal(answer, APPROVED_DAMAGED);
  assert.doesNotMatch(home, /30[ -]days?|free of charge|replaced free/i);
  const ld = JSON.parse(home.match(/<script type="application\/ld\+json">([^<]+)<\/script>/)[1]);
  const faq = ld['@graph'].find(n => n['@type'] === 'FAQPage');
  const jsonAnswer = faq.mainEntity.find(q => q.name === 'What if an order arrives damaged?').acceptedAnswer.text;
  assert.equal(jsonAnswer, APPROVED_DAMAGED);
});

test('the homepage "What you get" section carries the approved text verbatim, once, with no price or profit wording', async () => {
  const html = await page('/');
  const m = html.match(/<section class="gets-section" id="what-you-get" aria-labelledby="gets-title">\s*<h2 id="gets-title"[^>]*>What you get<\/h2>\s*<p class="gets-text[^"]*">([^<]*)<\/p>\s*<\/section>/);
  assert.ok(m, 'section present');
  assert.equal(m[1], WHAT_YOU_GET);
  assert.doesNotMatch(m[1], /\$|profit|split|\bfree\b|printify|shineon|shopify/i);
  assert.ok(html.indexOf('id="how-it-works"') < html.indexOf('id="what-you-get"') && html.indexOf('id="what-you-get"') < html.indexOf('id="faq"'));
  assert.equal(html.split(WHAT_YOU_GET).length - 1, 1);
  for (const route of PAGES.filter((r) => r !== '/')) assert.doesNotMatch(await page(route), /samples at cost|What you get/, route);
});

test('no Oxford commas outside the approved FAQ answers', async () => {
  for (const route of PAGES) {
    let html = (await page(route)).replace(/<script[\s\S]*?<\/script>/g, '');
    const faq = html.indexOf('<section class="faq-section"');
    if (faq !== -1) html = html.slice(0, faq) + html.slice(html.indexOf('</section>', faq));
    const text = html.replace(/<[^>]+>/g, ' ');
    assert.doesNotMatch(text, /\w+, [^,.;:]+, (?:and|or) /, route);
  }
});

test('About band shows the knit stack with responsive webp sources, alt text and no jewellery photo', async () => {
  const html = await page('/about/');
  const img = html.match(/<img\b[^>]*>/)[0];
  assert.match(img, /alt="Stack of folded knitted fabrics in soft grey and cream"/);
  assert.match(img, /srcset="\/images\/about-knit-800\.webp 800w, \/images\/about-knit-1200\.webp 1200w, \/images\/about-knit-1900\.webp 1900w"/);
  assert.match(img, /sizes="[^"]+"/);
  assert.match(img, /width="1900" height="950" class="band-knit"/);
  assert.match(img, /fetchpriority="high"/);
  assert.match(html, /<link rel="preload" as="image" href="\/images\/about-knit-1200\.webp" imagesrcset="\/images\/about-knit-800\.webp 800w, \/images\/about-knit-1200\.webp 1200w, \/images\/about-knit-1900\.webp 1900w" imagesizes="[^"]+" type="image\/webp">/);
  assert.doesNotMatch(html, /photo-jewellery|Gold necklaces/);
  assert.match(html, /We started Merchendice after watching a creator’s merch launch fall flat\./);
});
