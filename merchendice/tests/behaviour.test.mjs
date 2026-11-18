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
const input = {name:'A creator',email:'creator@example.test',description:'A merch idea'};
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
  for (const loc of ['https://merchendice.com/', 'https://merchendice.com/enquiry/', 'https://merchendice.com/examples/', 'https://merchendice.com/privacy/']) {
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

test('a confirmed send opens the sent dialog, focuses its close button, and returns focus when it closes', async () => {
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
  for (const route of ['/', '/examples/', '/enquiry/', '/privacy/', '/missing-page']) {
    const html = await (await worker.fetch(new Request(`https://site.example.test${route}`))).text();
    assert.doesNotMatch(html, /sample|quality|shopify/i, route);
    assert.doesNotMatch(html.replace(/<[^>]+>/g, ' '), /\bcolor|\bfavorite|jewelry|\bcenter\b/i, route);
  }
  const home = await (await worker.fetch(new Request('https://site.example.test/'))).text();
  assert.match(home, /<li>Jewellery<\/li>/);
  assert.match(home, /Bags, apparel, jewellery and small extras, chosen for your audience\./);
  assert.match(home, /influencers of any size/);
  assert.match(home, /Exclusive designs/);
  assert.match(home, /A store in your look, built and run for you/);
  assert.match(home, /<span>Based and designed in Sweden<\/span>/);
  assert.doesNotMatch(home, /mobile-cta|language|guide/i);
});

test('the About section uses Oscar’s approved words and the two names, and sits before the FAQ', async () => {
  const html = await (await worker.fetch(new Request('https://site.example.test/'))).text();
  assert.match(html, /<section class="about-section rise" id="about" aria-labelledby="about-title">\s*<h2 id="about-title">Who we are<\/h2>\s*<p>We watched creators try to launch their own merch and saw how often it fell flat\. Merchendice exists to make it simple, so any creator can launch merch their audience actually wants\.<\/p>\s*<p class="about-names">Oscar Thomas and Oscar Rodhelius<\/p>\s*<\/section>/);
  assert.ok(html.indexOf('id="about"') < html.indexOf('id="faq"'));
  for (const route of ['/', '/examples/', '/enquiry/', '/privacy/', '/missing-page']) {
    const page = await (await worker.fetch(new Request(`https://site.example.test${route}`))).text();
    assert.match(page, /href="(\/)?#about"/, route);
  }
});

test('log retention configs keep about 30 days', async () => {
  const read = (path) => fs.readFile(new URL(`../${path}`, import.meta.url), 'utf8');
  assert.match(await read('Caddyfile'), /roll_keep_for 720h/);
  assert.match(await read('deploy/logrotate-merchendice'), /rotate 30/);
  assert.match(await read('compose.yaml'), /max-size/);
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
  const allowed = ['hero-tee', 'tote-natural', 'sticker', 'photo-jewellery-720', 'photo-tote-720', 'photo-crewneck-720', 'hoodie-black-496', 'store-phone-780'];
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
  // The colourful songbird (the cartoon bird from the tote and sticker) may appear on at most three homepage images.
  const songbird = names.filter(name => ['tote-natural', 'sticker', 'goods-flatlay'].includes(name));
  assert.deepEqual(songbird, ['sticker', 'tote-natural']);
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
  assert.doesNotMatch(html, /Mugs|Prints and posters/);
  assert.doesNotMatch(html, /class="closer|example-store-accessories|sticker-camel|tote-black-detail/, 'no closer section and no leftover bird or store-chrome shots');
  assert.doesNotMatch(html, /\bfree\b|payout|profit|\d+\s?(k|K|M)\b followers/i);
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
  const json = JSON.parse(html.match(/<script type="application\/ld\+json">([^<]+)<\/script>/)[1]);
  assert.match(json.description, /creators and influencers/);
  assert.match(json.audience.audienceType, /Creators and influencers/);
  assert.match(html, /<p class="hero-line">A merch studio for creators and influencers<\/p>/);
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

test('marketing pages use the cream and espresso theme with no green, terracotta, gradient text or glows', async () => {
  const css = await (await worker.fetch(new Request('https://site.example.test/site.css'))).text();
  assert.match(css, /--bg: #f6eee2/);
  assert.match(css, /--espresso: #2e211d/);
  assert.doesNotMatch(css, /--green|#1f3d30|#172e24|#b5553a|#f7f2ea|terracotta/i);
  assert.doesNotMatch(css, /\.grad\b|glow|#7cc8d9|#9a8be8|#ecd27f|background-clip: text|linear-gradient|radial-gradient/i);
  for (const route of ['/', '/examples/', '/enquiry/', '/privacy/', '/missing-page']) {
    const html = await (await worker.fetch(new Request(`https://site.example.test${route}`))).text();
    assert.doesNotMatch(html, /class="grad|glow|#7cc8d9|#9a8be8|#ecd27f/, route);
    assert.match(html, /<link rel="preload" href="\/fonts\/cormorant-garamond\.woff2" as="font" type="font\/woff2" crossorigin>/, route);
    assert.match(html, /<link rel="preload" href="\/fonts\/dm-sans\.woff2" as="font" type="font\/woff2" crossorigin>/, route);
    assert.match(html, /<meta name="theme-color" content="#2e211d">/, route);
    assert.match(html, /<a class="wordmark" href="[^"]+" aria-label="Merchendice home">Merchendice<\/a>/, route);
    // Other marketing pages only use the natural tote (enquiry) or the example-store product image (examples).
    if (route !== '/') for (const [, src] of html.matchAll(/<img\b[^>]*src="([^"]+)"/g)) assert.match(src, /^\/images\/(store-desktop-1440|tote-natural)\.webp$/, route);
    assert.doesNotMatch(html, /class="[^"]*\bkicker\b|hero-illustration|enquiry-mark|We read every note/, route);
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

test('privacy notice is finished and indexable, and open items live in an unserved TODO.md', async () => {
  const html = await (await worker.fetch(new Request('https://site.example.test/privacy/'))).text();
  assert.doesNotMatch(html, /noindex|\(draft\)|draft-banner/i);
  for (const route of ['/', '/privacy/', '/enquiry/', '/examples/', '/example-store/', '/missing-page']) {
    assert.doesNotMatch(await (await worker.fetch(new Request(`https://site.example.test${route}`))).text(), /<!--/, route);
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
  assert.deepEqual(steps, ['Idea', 'Designs', 'Products', 'Your store', 'Launch']);
  assert.doesNotMatch(html, /href="\/examplepage\.com/);
});

test('the only cost wording is the approved FAQ answer, with no prices, fees, splits or payouts', async () => {
  const approved = 'There’s nothing to pay while we shape the idea and the designs. You only pay once your store is ready to launch. Commercial terms are agreed with you before any work begins.';
  const home = await (await worker.fetch(new Request('https://site.example.test/'))).text();
  assert.match(home, /<summary>What does it cost to get started\?<\/summary>/);
  assert.ok(home.includes(`<p>${approved}</p>`));
  for (const route of ['/', '/examples/', '/enquiry/', '/privacy/', '/missing-page']) {
    const html = (await (await worker.fetch(new Request(`https://site.example.test${route}`))).text()).replace(approved, '');
    assert.doesNotMatch(html, /[$€£]\s?\d|\d+\s?(kr|sek|usd|eur)\b|\d+\s?%|\bfree\b|\bpay(s|ing|ment)?\b(?! details)|\bfees?\b|payout|revenue split|\bsplit\b|profit|commission|royalt/i, route);
  }
});

test('one call-to-action label, and each idea said only once across the site', async () => {
  const pages = {};
  for (const route of ['/', '/examples/', '/enquiry/', '/privacy/', '/missing-page']) {
    const html = await (await worker.fetch(new Request(`https://site.example.test${route}`))).text();
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
  assert.equal(count(/Commercial terms are agreed/g), 1, 'terms wording lives in the FAQ only');
  assert.equal(count(/A demo store, so you can see the finished standard/g), 1);
  assert.equal(count(/in your look/g), 1);
  assert.equal(count(/\bjoke/g), 2, "statement line plus the approved enquiry-step wording");
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
  for (const route of ['/', '/examples/', '/enquiry/', '/privacy/', '/missing-page']) {
    const html = await (await worker.fetch(new Request(`https://site.example.test${route}`))).text();
    assert.match(html, /<script>document\.documentElement\.classList\.add\('js'\)<\/script>/, route);
    const csp = (await worker.fetch(new Request(`https://site.example.test${route}`))).headers.get('content-security-policy');
    const digest = (await import('node:crypto')).createHash('sha256').update("document.documentElement.classList.add('js')").digest('base64');
    assert.ok(csp.includes(`'sha256-${digest}'`), route);
    assert.doesNotMatch(csp, /unsafe-inline/, route);
    // Without the js class, the markup itself does not start hidden.
    assert.doesNotMatch(html, /style="[^"]*opacity:\s*0/, route);
  }
});
