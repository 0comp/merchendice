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
  for (const route of ['/', '/examples/', '/enquiry/', '/privacy/', '/example-store/']) {
    const get = await worker.fetch(new Request(`https://site.example.test${route}`),env);
    assert.equal(get.status,200);
    assert.equal((await get.text()).includes(env.MAIL_TO),false);
    const head = await worker.fetch(new Request(`https://site.example.test${route}`,{method:'HEAD'}),env);
    assert.equal(head.status,200);
    assert.equal(await head.text(),'');
    assert.equal(head.headers.get('content-type'),get.headers.get('content-type'));
  }
});

test('directory, enquiry, and privacy paths redirect to the trailing slash', async () => {
  for (const route of ['/examples', '/enquiry', '/privacy', '/example-store']) {
    const response = await worker.fetch(new Request(`https://site.example.test${route}?ref=1`));
    assert.equal(response.status, 301);
    assert.equal(response.headers.get('location'), `${route}/?ref=1`);
    const head = await worker.fetch(new Request(`https://site.example.test${route}`, { method: 'HEAD' }));
    assert.equal(head.status, 301);
    assert.equal(head.headers.get('location'), `${route}/`);
    assert.equal(await head.text(), '');
  }
});

test('CREATOR example is served on its Merchendice path with working inline layout and images', async () => {
  const response = await worker.fetch(new Request('https://site.example.test/example-store/'));
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /CREATOR — Storefront example/);
  assert.match(html, /images-api\.printify\.com/);
  assert.match(response.headers.get('content-security-policy'), /script-src 'self' 'unsafe-inline'/);
  assert.match(response.headers.get('content-security-policy'), /img-src[^;]*images-api\.printify\.com/);
  const nested = await worker.fetch(new Request('https://site.example.test/example-store/products/sample'));
  assert.equal(nested.status, 200);
  const directory = await worker.fetch(new Request('https://site.example.test/examples/'));
  assert.match(await directory.text(), /href="\/example-store\/"/);
  assert.doesNotMatch(response.headers.get('content-security-policy'), /unsafe-eval/);
});

test('example shop renders a product grid, labels it as an example, and loads no payment scripts', async () => {
  const response = await worker.fetch(new Request('https://site.example.test/example-store/'));
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /<div[^>]*id="products"/);
  assert.match(html, /<dialog[^>]*id="productDialog"/);
  assert.match(html, /<dialog[^>]*id="bagDialog"/);
  assert.match(html, /example prices/);
  assert.match(html, /Purchases are not available/);
  assert.match(html, /Built by Merchendice/);
  const scriptSources = [...html.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(scriptSources, []);
  assert.doesNotMatch(html, /stripe|checkout\.session|paymentIntent|paypal|klarna/i);
  assert.doesNotMatch(html, /\b(Printify|ShineOn|Webstudios|PolyVault)\b/);
  assert.doesNotMatch(response.headers.get('content-security-policy'), /stripe/i);
});

test('homepage explains the service and sends contact to the enquiry page instead of an email address', async () => {
  const response = await worker.fetch(new Request('https://site.example.test/'));
  const html = await response.text();
  assert.match(html.replace(/<[^>]+>/g, ''), /Merch your audience would buy even without your name on it\./);
  assert.match(html, /Tell us your idea/);
  assert.match(html, /<a href="\/enquiry\/">Contact us<\/a>/);
  assert.match(html, /href="\/enquiry\/"/);
  assert.match(html, /Shopify/);
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
  const parsed = JSON.parse(jsonLd);
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
  for (const loc of ['https://merchendice.com/', 'https://merchendice.com/enquiry/', 'https://merchendice.com/examples/', 'https://merchendice.com/example-store/', 'https://merchendice.com/privacy/']) {
    assert.match(sitemap, new RegExp(loc.replace(/[/.]/g, '\\$&')));
  }
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

test('optional channel links are included, and overlong ones are rejected', async t => {
  const provider = t.mock.method(globalThis, 'fetch', async () => Response.json({ id: 'receipt' }));
  const sent = await worker.fetch(request({ ...input, youtube: ' @creator ', instagram: '', tiktok: 'tiktok.com/@creator', otherPlatforms: 'newsletter.example' }), env);
  assert.equal(sent.status, 200);
  const message = JSON.parse(provider.mock.calls[0].arguments[1].body);
  assert.match(message.text, /YouTube: @creator/);
  assert.match(message.text, /Instagram: Not provided/);
  assert.match(message.text, /TikTok: tiktok.com\/@creator/);
  assert.match(message.text, /Other platforms: newsletter.example/);
  assert.doesNotMatch(message.text, /Website:/);
  const tooLong = await worker.fetch(request({ ...input, youtube: 'y'.repeat(501) }), env);
  assert.equal(tooLong.status, 400);
  assert.equal(provider.mock.calls.length, 1);
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

test('the empty real-storefront tab stays hidden and a saved real view falls back', async () => {
  const html = await fs.readFile(new URL('../examples/index.html', import.meta.url), 'utf8');
  assert.match(html, /data-filter="real"[^>]*hidden/);
  const search = { value: '', addEventListener() {} };
  const card = { dataset: { search: 'creator storefront merch sample', kind: 'example' }, hidden: false };
  const button = () => ({ dataset: {}, hidden: false, classList: { toggle() {} }, setAttribute() {}, addEventListener() {} });
  const exampleButton = button();
  exampleButton.dataset.filter = 'example';
  const realButton = button();
  realButton.dataset.filter = 'real';
  const count = {};
  const kind = {};
  const empty = {};
  vm.runInNewContext(await fs.readFile(new URL('../examples.js', import.meta.url), 'utf8'), {
    document: {
      cookie: 'merchendice_storefront_view=real',
      querySelector: (selector) => selector === '#exampleSearch' ? search : selector === '#directoryResultCount' ? count : selector === '#directoryResultKind' ? kind : empty,
      querySelectorAll: (selector) => selector === '.listing-card' ? [card] : selector === '.directory-filter' ? [exampleButton, realButton] : [],
    },
    window: { addEventListener() {} },
  });
  assert.equal(realButton.hidden, true);
  assert.equal(card.hidden, false);
  assert.equal(kind.textContent, 'EXAMPLE STOREFRONTS');
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

test('homepage is type-led, with one real store screenshot and none of the old template tells', async () => {
  const html = await (await worker.fetch(new Request('https://site.example.test/'))).text();
  // No drawn illustrations: the only image is a cropped screenshot of the example store's accessories view.
  const images = [...html.matchAll(/<img\b[^>]*src="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(images, ['/images/example-store-accessories.webp']);
  assert.doesNotMatch(html, /hero-illustration|art-piece|hero-art|<circle|<ellipse/);
  const svgs = [...html.matchAll(/<svg class="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual([...new Set(svgs)], ['wordmark-mark'], 'the wordmark is the only inline SVG');
  // No eyebrow labels, accent words, italic flourishes, scroll cue or reveal-on-scroll.
  assert.doesNotMatch(html, /class="[^"]*\b(kicker|accent|reveal|scroll-cue|section-lede)\b/);
  assert.doesNotMatch(html, /<em>|<i>[^<]/);
  assert.doesNotMatch(html, /We help creators turn/i);
  assert.doesNotMatch(html.replace(/<[^>]+>/g, ''), /—/, 'no em dashes in the copy');
  assert.doesNotMatch(html, /\b(tee|hoodie|t-shirt|sweatshirt)\b/i);
  assert.doesNotMatch(html, /service-num|quality-num|process-num|Step 0\d|>0[1-9]</);
  for (const platform of ['TikTok', 'Instagram', 'YouTube']) assert.match(html, new RegExp(`<a class="platform-link" href="/enquiry/">${platform}<`));
  for (const step of ['Idea', 'Designs', 'Samples', 'Your store', 'Launch']) assert.match(html, new RegExp(`<h3>${step}</h3>`));
  assert.match(html, /id="quality"/);
  assert.match(html, /<h2 id="quality-title">“Will my merch look cheap or off-brand\?”<\/h2>/);
  assert.match(html, /No generic templates/);
  assert.doesNotMatch(html, /jewel|tote|clothing|fashion|beauty|lifestyle|\bfree\b|payout|profit|\d+\s?(k|K|M)\b followers/i);
  assert.equal((html.match(/href="\/enquiry\/"/g) || []).length >= 3, true);
  const css = await (await worker.fetch(new Request('https://site.example.test/site.css'))).text();
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /\/fonts\/archivo\.woff2/);
  assert.match(css, /\/fonts\/source-serif-4\.woff2/);
  assert.match(css, /font-display: swap/);
  assert.doesNotMatch(css, /Instrument Serif|font-style: italic|\.reveal|\.kicker|\.accent\b/);
  assert.match(css, /body \{[^}]*font-size: 18px/);
  const js = await (await worker.fetch(new Request('https://site.example.test/site.js'))).text();
  assert.doesNotMatch(js, /IntersectionObserver|reveal/);
});

test('no sentence is repeated across the homepage', async () => {
  const html = await (await worker.fetch(new Request('https://site.example.test/'))).text();
  const body = html.slice(html.indexOf('<main'), html.indexOf('</main>')).replace(/<!--[\s\S]*?-->/g, '').replace(/<span class="sr-only">[^<]*<\/span>/g, '');
  const sentences = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').split(/(?<=[.?!])\s+/).map(t => t.trim().toLowerCase()).filter(t => t.split(' ').length > 3);
  const seen = new Set();
  for (const sentence of sentences) { assert.ok(!seen.has(sentence), `repeated: ${sentence}`); seen.add(sentence); }
});

test('marketing pages use the paper, ink and green theme with no gradient text or glows', async () => {
  const css = await (await worker.fetch(new Request('https://site.example.test/site.css'))).text();
  assert.match(css, /--bg: #f3f1ec/);
  assert.match(css, /--green: #1f3d30/);
  assert.doesNotMatch(css, /#b5553a|#f7f2ea/i);
  assert.doesNotMatch(css, /\.grad\b|glow|#7cc8d9|#9a8be8|#ecd27f|background-clip: text/i);
  for (const route of ['/', '/examples/', '/enquiry/', '/privacy/', '/missing-page']) {
    const html = await (await worker.fetch(new Request(`https://site.example.test${route}`))).text();
    assert.doesNotMatch(html, /class="grad|glow|#7cc8d9|#9a8be8|#ecd27f/, route);
    assert.match(html, /<link rel="preload" href="\/fonts\/source-serif-4\.woff2" as="font" type="font\/woff2" crossorigin>/, route);
    assert.match(html, /<meta name="theme-color" content="#f3f1ec">/, route);
    // No clothing photos on marketing pages: the only raster image is the example store's accessories screenshot.
    for (const [, src] of html.matchAll(/<img\b[^>]*src="([^"]+)"/g)) assert.equal(src, '/images/example-store-accessories.webp', route);
    assert.doesNotMatch(html, /class="[^"]*\bkicker\b|hero-illustration|enquiry-mark/, route);
  }
});

test('no marketing page shows the email address or section numbering', async () => {
  for (const route of ['/', '/examples/', '/enquiry/', '/privacy/', '/missing-page']) {
    const html = await (await worker.fetch(new Request(`https://site.example.test${route}`))).text();
    assert.doesNotMatch(html, /merchendices@gmail\.com|mailto:/, route);
    assert.doesNotMatch(html, /Step 0\d|service-num|quality-num|process-num/, route);
    assert.match(html, /Contact us/, route);
    assert.doesNotMatch(html, /<circle/, route);
  }
});

test('privacy notice is finished, indexable, and leaves the controller identity as an HTML TODO', async () => {
  const html = await (await worker.fetch(new Request('https://site.example.test/privacy/'))).text();
  assert.doesNotMatch(html, /noindex|\(draft\)|draft-banner/i);
  assert.match(html, /<!-- TODO \(Oscar\):[^>]*controller/);
  for (const field of ['Your name', 'Your email address', 'project description', 'How long it’s kept', 'deleted']) assert.match(html, new RegExp(field));
  assert.match(html, /<a href="\/enquiry\/">Contact us<\/a>/);
  assert.doesNotMatch(html, /gmail|Gmail/);
  for (const page of ['/', '/examples/', '/enquiry/', '/missing-page']) {
    assert.doesNotMatch(await (await worker.fetch(new Request(`https://site.example.test${page}`))).text(), /Privacy notice \(draft\)/);
  }
});

test('hero mark has no pointer parallax and the homepage keeps one merged how-it-works flow', async () => {
  const js = await (await worker.fetch(new Request('https://site.example.test/site.js'))).text();
  assert.doesNotMatch(js, /pointermove|mousemove|--mx/);
  const html = await (await worker.fetch(new Request('https://site.example.test/'))).text();
  assert.match(html, /id="how-it-works"/);
  assert.doesNotMatch(html, /id="what-you-get"|id="why"/);
  const steps = [...html.matchAll(/<li class="process-step[^"]*">[\s\S]*?<h3>([^<]+)<\/h3>/g)].map(m => m[1]);
  assert.deepEqual(steps, ['Idea', 'Designs', 'Samples', 'Your store', 'Launch']);
  const withoutCostFaq = html.replace('There’s nothing to pay while we shape the idea, design and sample.', '').replace(/<head>[\s\S]*<\/head>/, '');
  assert.ok((withoutCostFaq.match(/[Ss]amples?\b(?! shop)/g) || []).length <= 3, 'samples is mentioned in the intro and the Samples step only');
  assert.doesNotMatch(html, /href="\/examplepage\.com/);
});

test('the only cost wording is the approved FAQ answer, with no prices, fees, splits or payouts', async () => {
  const approved = 'There’s nothing to pay while we shape the idea, design and sample. You only pay once your store is ready to launch. Commercial terms are agreed with you before any work begins.';
  const home = await (await worker.fetch(new Request('https://site.example.test/'))).text();
  assert.match(home, /<summary>What does it cost to get started\?<\/summary>/);
  assert.ok(home.includes(`<p>${approved}</p>`));
  for (const route of ['/', '/examples/', '/enquiry/', '/privacy/', '/missing-page']) {
    const html = (await (await worker.fetch(new Request(`https://site.example.test${route}`))).text()).replace(approved, '');
    assert.doesNotMatch(html, /[$€£]\s?\d|\d+\s?(kr|sek|usd|eur)\b|\d+\s?%|\bfree\b|\bpay(s|ing|ment)?\b(?! details)|\bfees?\b|payout|revenue split|\bsplit\b|profit|commission|royalt/i, route);
  }
});
