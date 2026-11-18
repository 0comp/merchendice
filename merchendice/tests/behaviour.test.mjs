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
  // One 'not available' notice, in the bag; no Limited badge, nothing claims embroidery.
  assert.equal((html.match(/not available/g) || []).length, 1);
  assert.match(html, /<div class="bag-foot">[\s\S]*Checkout and purchases are not available/);
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
  assert.match(html, /<p class="footer-contact">Got an idea\? <a href="\/enquiry\/">Start a project<\/a><\/p>/);
  assert.match(html, /<a class="nav-cta" href="\/enquiry\/">Start a project<\/a>/);
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
function element(extra={}) {
  return {
    attrs:{},dataset:{},children:[],textContent:'',
    setAttribute(k,v){this.attrs[k]=String(v);},getAttribute(k){return this.attrs[k] ?? null;},removeAttribute(k){delete this.attrs[k];},
    addEventListener(name,handler){(this.handlers ||= {})[name]=handler;},
    append(...kids){this.children.push(...kids);},focus(){this.focused=true;},
    ...extra,
  };
}
function formHarness(fetch, values=input, {stored=null}={}) {
  const fields={}, errors={};
  for (const name of ['name','email','channels','description']) {
    fields[name]=element({value:values[name] ?? '',maxLength:5000});
    errors[`${name}Error`]=element();
  }
  const label={textContent:'Send message'};
  const button={disabled:false,querySelector:()=>label};
  const status=element({removeAttribute(){delete this.dataset.state;}});
  const store=new Map(stored?[['merchendice-message-draft',JSON.stringify(stored)]]:[]);
  const localStorage={getItem:k=>store.get(k) ?? null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)};
  let submit, input;
  const form={
    elements:{namedItem:name=>fields[name]},querySelector:()=>button,
    addEventListener:(name,handler)=>{if(name==='submit')submit=handler;if(name==='input')input=handler;},
    replaceWith(node){this.replacedWith=node;},
  };
  class FormDataStub { get(name){return fields[name]?.value;} getAll(){return [];} }
  vm.runInNewContext(formScript,{
    document:{
      querySelector:selector=>selector==='#enquiryForm'?form:selector==='#formStatus'?status:null,
      getElementById:id=>errors[id] ?? null,
      createElement:()=>element(),
      addEventListener(){},
    },
    window:{localStorage},location:{pathname:'/enquiry/'},
    FormData:FormDataStub,fetch,AbortController,setTimeout:(fn)=>{fn();return 0;},clearTimeout(){},Error,TypeError,JSON,
  });
  return {form,fields,errors,status,button,label,store,submit:()=>submit({preventDefault(){}}),input:()=>input?.()};
}

test('HTML or incomplete success responses keep the form and its draft, and never claim delivery', async () => {
  for (const response of [new Response('<html>Sign in</html>'),Response.json({}),Response.json(null)]) {
    const h=formHarness(async()=>response);
    h.input();
    await h.submit();
    assert.equal(h.form.replacedWith,undefined);
    assert.equal(h.status.dataset.state,'error');
    assert.equal(h.button.disabled,false);
    assert.equal(h.label.textContent,'Send message');
    assert.ok(h.store.has('merchendice-message-draft'), 'the draft survives a failed send');
  }
});

test('a confirmed send says Sent, clears the draft, and swaps the form for a thank-you panel with the email as text', async () => {
  const email='creator+<b>x</b>@example.test';
  const h=formHarness(async()=>Response.json({ok:true}),{...input,email});
  h.input();
  assert.ok(h.store.has('merchendice-message-draft'));
  await h.submit();
  assert.equal(h.label.textContent,'Sent');
  assert.equal(h.store.has('merchendice-message-draft'),false);
  const panel=h.form.replacedWith;
  assert.ok(panel, 'the form is replaced');
  const [heading,note,link]=panel.children;
  assert.equal(heading.textContent,'Thanks.');
  assert.equal(note.textContent,`We’ve got your note and will reply to ${email}.`);
  assert.equal(note.innerHTML,undefined, 'the email is never inserted as HTML');
  assert.equal(link.href,'/example-store/');
  assert.ok(panel.focused);
});

test('a saved draft is restored on load', async () => {
  const h=formHarness(async()=>{},{name:'',email:'',channels:'',description:''},{stored:{name:'Saved',email:'saved@example.test',channels:'',description:'Idea'}});
  assert.equal(h.fields.name.value,'Saved');
  assert.equal(h.fields.description.value,'Idea');
});

test('submit shows every field error at once, marks the fields invalid, and focuses the first one', async () => {
  let calls=0;
  const h=formHarness(async()=>{calls++;},{name:'',email:'a@host',channels:'',description:''});
  await h.submit();
  assert.equal(calls,0);
  for (const name of ['name','email','description']) {
    assert.equal(h.fields[name].attrs['aria-invalid'],'true',name);
    assert.ok(h.errors[`${name}Error`].textContent,name);
  }
  assert.ok(h.fields.name.focused);
  assert.equal(h.fields.email.focused,undefined);
});

test('blurring a filled field validates it, and fixing it clears the error', async () => {
  const h=formHarness(async()=>{},{...input,email:'a@host'});
  h.fields.email.handlers.blur();
  assert.equal(h.fields.email.attrs['aria-invalid'],'true');
  h.fields.email.value='a@host.test';
  h.fields.email.handlers.input();
  assert.equal(h.fields.email.attrs['aria-invalid'],undefined);
  assert.equal(h.errors.emailError.textContent,'');
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
  const names = [];
  for (const tag of tags) {
    assert.match(tag, /src="\/images\/[a-z-]+-\d+\.webp"/, tag);
    assert.match(tag, /width="\d+" height="\d+"/, tag);
    names.push(tag.match(/src="\/images\/([a-z-]+)-\d+\.webp"/)[1]);
  }
  // Native-size exports of the example-store mockups and store captures, plus three free stock mood photos
  // (packaging and fabric, credited in the README) that carry no products, people, or logos; nothing is upscaled.
  const allowed = ['hero-tee', 'packaging-bag', 'fabric-folds', 'fabric-edge', 'hoodie-black', 'store-phone'];
  // Stock mood photos are decorative: empty alt, so they are never described as Merchendice products or work.
  for (const tag of tags.filter(tag => /packaging-bag|fabric-/.test(tag))) assert.match(tag, /alt=""/, tag);
  for (const name of names) assert.ok(allowed.includes(name), name);
  assert.equal(new Set(names).size, names.length, 'no photo is shown twice on the homepage');
  // The colourful songbird appears once on the homepage: on the crewneck in the example-store capture.
  assert.deepEqual(names.filter(name => ['store-phone'].includes(name)), ['store-phone']);
  assert.doesNotMatch(html, /songbird|goods-flatlay|sticker\.webp|canvas-(black|natural|sand)|store-banner|tote-natural/i);
  // The swallow tee leads the hero and is the only tee on the page.
  assert.equal((html.match(/alt="[^"]*(T-shirt|tee)\b/gi) || []).length, 1);
  const mosaic = html.slice(html.indexOf('class="hero-mosaic'), html.indexOf('</section>'));
  assert.ok(mosaic.indexOf('hero-tee-') < mosaic.indexOf('packaging-bag-'), 'the tee is the first hero photo');
  assert.match(mosaic, /hero-tee-1040\.webp[^>]*fetchpriority="high"/);
  // It's called a sample store once, in the showcase, with no other mockup or made-up-brand caveats.
  assert.equal((html.match(/A sample store, so you can see the finished standard\./g) || []).length, 1);
  assert.doesNotMatch(html, /made-up|[Mm]ockup|goods-note|Pictured:|service-strip|Totes and bags/);
  assert.match(html, /<p class="goods-range">Bags, apparel, and small extras, chosen for your audience\.<\/p>/);
  assert.match(html, /class="hero-mosaic[\s\S]*hero-tee-1040\.webp[\s\S]*<\/div>\s*<\/section>/);
  const hero = html.slice(html.indexOf('<section class="hero"'), html.indexOf('</section>'));
  assert.match(hero, /\/images\/hero-tee-1040\.webp/);
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
  for (const step of ['Idea', 'Designs', 'Samples', 'Your store', 'Launch']) assert.match(html, new RegExp(`<h3>${step}</h3>`));
  assert.match(html, /id="quality"/);
  assert.match(html, /<h2 id="quality-title">We only launch products that pass our sample check\.<\/h2>/);
  assert.match(html, /We point you towards items that print well, and nothing launches until you’ve signed it off\./);
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
  assert.match(css, /body \{[^}]*font-size: 18px;\s*line-height: 1\.6;/);
  // Uppercase tracking is kept for the navigation only; the hero line is sentence case.
  const heroLine = css.slice(css.indexOf('.hero-line {'), css.indexOf('}', css.indexOf('.hero-line {')));
  assert.doesNotMatch(heroLine, /uppercase|letter-spacing/);
  assert.doesNotMatch(css, /\.service-strip|\.goods-note|\.mosaic-col/);
  assert.doesNotMatch(css, /margin-top: -\d+px|margin-block: -\d+px/, 'no tile is pulled up under the header');
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
  const hero = html.slice(html.indexOf('<section class="hero"'), html.indexOf('</section>'));
  const bullets = hero.indexOf('class="hero-points"');
  const actions = hero.indexOf('class="hero-actions');
  const button = hero.indexOf('href="/enquiry/"');
  assert.ok(bullets > 0 && actions > bullets, 'actions follow the bullets');
  assert.ok(button > actions, 'the enquiry button is inside hero-actions');
  assert.match(hero, /<a class="button button-primary" href="\/enquiry\/" data-hero-cta>Start a project<\/a>/);
  assert.equal((hero.match(/Start a project/g) || []).length, 1);
  const css = await (await worker.fetch(new Request('https://site.example.test/site.css'))).text();
  const heroRule = css.slice(css.indexOf('\n.hero {'), css.indexOf('.hero-copy'));
  // The text column starts at the top of the hero with Oscar's 96px of space; the photos stretch to its height.
  assert.match(heroRule, /align-items: stretch/);
  assert.match(heroRule, /min-height: 560px/);
  assert.doesNotMatch(heroRule, /align-items: center|\bheight: clamp/);
  assert.match(css, /\.hero-copy \{ padding-block: 96px/);
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
    // Other marketing pages only use the natural tote (enquiry) or the unedited example-store capture (examples).
    if (route !== '/') for (const [, src] of html.matchAll(/<img\b[^>]*src="([^"]+)"/g)) assert.match(src, /^\/images\/(store-desktop-1440|tote-natural)\.webp$/, route);
    assert.doesNotMatch(html, /class="[^"]*\bkicker\b|hero-illustration|enquiry-mark|We read every note/, route);
  }
});

test('no marketing page shows the email address or section numbering', async () => {
  for (const route of ['/', '/examples/', '/enquiry/', '/privacy/', '/missing-page']) {
    const html = await (await worker.fetch(new Request(`https://site.example.test${route}`))).text();
    assert.doesNotMatch(html, /merchendices@gmail\.com|mailto:/, route);
    assert.doesNotMatch(html, /Step 0\d|service-num|quality-num|process-num/, route);
    // Every page offers a way to the message form, and none uses the old header label.
    assert.match(html, /href="(\/enquiry\/|#enquiryForm)"/, route);
    assert.match(html, /<a class="nav-cta" href="[^"]+"( aria-current="page")?>Start a project<\/a>/, route);
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
  assert.match(notes, /controller/);
  assert.match(notes, /access logs/);
  assert.equal((await worker.fetch(new Request('https://site.example.test/TODO.md'))).status, 404);
  for (const field of ['Your name', 'Your email address', 'Your idea', 'How long it’s kept', 'deleted', 'Updated November 18, 2026', '<h1 class="hero-rise">Privacy Policy</h1>', '<title>Privacy Policy \\| Merchendice</title>']) assert.match(html, new RegExp(field));
  assert.match(html, /<a href="\/enquiry\/">Send us a message<\/a>/);
  assert.doesNotMatch(html, /network address|enquir(y|ies)\b(?![\/"])/i);
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
  assert.ok((withoutCostFaq.match(/[Ss]amples?\b(?! shop)/g) || []).length <= 4, 'samples is mentioned in the hero list, the strip, the Samples step and its text only');
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

test('one call-to-action label, and each idea said only once across the site', async () => {
  const pages = {};
  for (const route of ['/', '/examples/', '/enquiry/', '/privacy/', '/missing-page']) {
    const html = await (await worker.fetch(new Request(`https://site.example.test${route}`))).text();
    pages[route] = html.slice(html.indexOf('<body'), html.indexOf('</body>')).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  }
  // Buttons and links that lead to the message form say "Start a project"; the form's own submit button is the exception.
  for (const [route, html] of Object.entries(pages)) {
    assert.doesNotMatch(html, /Tell us your idea|Send us a note|Send an enquiry|Start your enquiry|Ask what would suit/, route);
  }
  const home = await (await worker.fetch(new Request('https://site.example.test/'))).text();
  for (const label of [...home.matchAll(/<a class="button[^"]*" href="\/enquiry\/"[^>]*>([^<]+)<\/a>/g)].map(m => m[1])) assert.equal(label, 'Start a project');
  const enquiry = await (await worker.fetch(new Request('https://site.example.test/enquiry/'))).text();
  assert.match(enquiry, /<button class="button button-primary button-submit" type="submit"><span>Send message<\/span><\/button>/);
  assert.match(enquiry, /<p class="form-smallprint">Fields marked \* are required\. See how we use your details in our <a href="\/privacy\/">Privacy Policy<\/a>\.<\/p>/);
  assert.doesNotMatch(enquiry, /class="footer-contact"/, 'no footer contact line on the form page');
  const all = Object.values(pages).join(' ');
  const count = (re) => (all.match(re) || []).length;
  assert.equal(count(/Commercial terms are agreed/g), 1, 'terms wording lives in the FAQ only');
  assert.equal(count(/A sample store, so you can see the finished standard/g), 1);
  assert.equal(count(/made-up/g), 0);
  assert.equal(count(/in your look/g), 1);
  assert.equal(count(/[Pp]hysical samples/g), 1);
  assert.equal(count(/a few directions/g), 1);
  assert.equal(count(/\bjoke/g), 3, 'statement line, the Idea step, and the Your idea hint');
  // After the FAQ comes one closing call to action, and the footer carries the contact line.
  assert.match(home, /<\/details>\s*<\/div>\s*<\/section>\s*<section class="closing-cta[^"]*"[^>]*>\s*<h2 id="closing-title">[^<]+<\/h2>\s*<a class="button button-primary" href="\/enquiry\/" data-closing-cta>Start a project<\/a>\s*<\/section>\s*<\/main>/);
  assert.match(home, /<p class="footer-contact">Got an idea\? <a href="\/enquiry\/">Start a project<\/a><\/p>/);
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

test('every marketing image declares its true pixel size, and srcset widths match the files, so nothing is upscaled by mistake', async () => {
  const { readFileSync } = await import('node:fs');
  const webpSize = (file) => {
    const b = readFileSync(new URL(`..${file}`, import.meta.url));
    const kind = b.toString('ascii', 12, 16);
    if (kind === 'VP8X') return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)];
    if (kind === 'VP8L') { const v = b.readUInt32LE(21); return [(v & 0x3fff) + 1, ((v >> 14) & 0x3fff) + 1]; }
    return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
  };
  for (const route of ['/', '/examples/']) {
    const html = await (await worker.fetch(new Request(`https://site.example.test${route}`))).text();
    for (const [tag] of html.matchAll(/<img\b[^>]*>/g)) {
      const src = tag.match(/src="([^"]+)"/)[1];
      const [w, h] = webpSize(src);
      assert.equal(+tag.match(/width="(\d+)"/)[1], w, `${route} ${src} width`);
      assert.equal(+tag.match(/height="(\d+)"/)[1], h, `${route} ${src} height`);
      const srcset = tag.match(/srcset="([^"]+)"/);
      if (srcset) for (const [, file, declared] of srcset[1].matchAll(/(\S+) (\d+)w/g)) assert.equal(webpSize(file)[0], +declared, file);
    }
  }
});

test('buttons press instead of grow, and the menu, FAQ, sticky bar and page transitions animate with reduced-motion fallbacks', async () => {
  const css = await (await worker.fetch(new Request('https://site.example.test/site.css'))).text();
  const js = await (await worker.fetch(new Request('https://site.example.test/site.js'))).text();
  assert.doesNotMatch(css, /\.(button|nav-cta):hover \{[^}]*scale/);
  assert.match(css, /\.button:active \{ transform: scale\(\.97\);[^}]*transition-duration: 80ms/);
  assert.match(css, /-webkit-tap-highlight-color: transparent/);
  assert.match(css, /transition: background-color 150ms var\(--press\)[^;]*transform 100ms/);
  assert.match(js, /addEventListener\('touchstart', \(\) => \{\}, \{ passive: true \}\)/);
  // Mobile menu: faded and lifted while closed, not focusable or clickable, scroll contained.
  assert.match(css, /\.main-nav \{[^}]*opacity: 0;[^}]*translateY\(-8px\);[^}]*visibility: hidden;[^}]*pointer-events: none;/);
  assert.match(css, /overscroll-behavior: contain/);
  assert.match(css, /cubic-bezier\(\.05, \.7, \.1, 1\)/);
  // FAQ answers ease open only where supported.
  assert.match(css, /@supports selector\(::details-content\)[\s\S]*interpolate-size: allow-keywords[\s\S]*block-size 250ms/);
  // Page transitions only when motion is allowed.
  assert.match(css, /@media \(prefers-reduced-motion: no-preference\) \{\s*@view-transition \{ navigation: auto; \}/);
  const reduce = css.slice(css.lastIndexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(reduce, /details-content \{ transition: none; \}/);
  assert.match(reduce, /\.main-nav, \.mobile-cta \{ transition: none; \}/);
  // Sticky bar: phones only, hidden and inert until the hero button has gone, absent from the form page.
  assert.match(css, /\.mobile-cta \{ display: none; \}/);
  assert.match(css, /transform: translateY\(110%\);[\s\S]*transition: transform 300ms cubic-bezier\(\.2, 0, 0, 1\)/);
  assert.match(css, /padding: 12px 16px calc\(12px \+ env\(safe-area-inset-bottom\)\)/);
  const home = await (await worker.fetch(new Request('https://site.example.test/'))).text();
  assert.match(home, /<div class="mobile-cta" data-mobile-cta inert>\s*<a class="button button-primary" href="\/enquiry\/">Start a project<\/a>/);
  assert.match(js, /IntersectionObserver[\s\S]*data-hero-cta[\s\S]*mobileCta\.inert = !show/);
  const enquiry = await (await worker.fetch(new Request('https://site.example.test/enquiry/'))).text();
  assert.doesNotMatch(enquiry, /mobile-cta/);
  // Hero photos load straight away; footer links are full-size touch targets.
  const hero = home.slice(home.indexOf('<section class="hero"'), home.indexOf('</section>'));
  assert.doesNotMatch(hero, /loading="lazy"/);
  assert.match(css, /\.footer-contact a \{ display: inline-flex; align-items: center; min-height: 44px;/);
  assert.match(css, /\.footer-nav a \{ display: inline-flex; align-items: center; min-height: 44px;/);
  // Form errors are tied to their fields.
  for (const name of ['name', 'email', 'description']) {
    assert.match(enquiry, new RegExp(`id="${name}"[^>]*aria-describedby="[^"]*${name}Error`));
    assert.match(enquiry, new RegExp(`<p class="field-error" id="${name}Error"></p>`));
  }
  assert.match(css, /\[aria-invalid="true"\] \{ border-color: #8a2e1f; \}/);
});

test('visible copy uses US spelling, Oxford commas and message rather than enquiry', async () => {
  for (const route of ['/', '/examples/', '/enquiry/', '/privacy/', '/missing-page', '/example-store/']) {
    const html = await (await worker.fetch(new Request(`https://site.example.test${route}`))).text();
    const text = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/(href|src|srcset|id|class|for|aria-controls|aria-labelledby)="[^"]*"/g, '').replace(/[a-z:-]+="https?:[^"]*"/g, '');
    assert.doesNotMatch(text, /colour|recognis|favourite|\bgrey\b/i, route);
    assert.doesNotMatch(text, /Instagram and YouTube/, route);
    assert.doesNotMatch(text, /\benquir(y|ies)\b/i, route);
  }
  const store = await (await worker.fetch(new Request('https://site.example.test/example-store/'))).text();
  const scriptSrc = store.match(/<script[^>]*\bsrc="([^"]+)"/)[1];
  const storeJs = await (await worker.fetch(new Request(`https://site.example.test${scriptSrc}`))).text();
  assert.doesNotMatch(storeJs, /Limited|embroider|>Colour|aria-label="Colour|colours"/);
  assert.match(storeJs, /Sport Grey/);
  assert.doesNotMatch(store, /drawer/);
  assert.match(store, /Made for everyday wear\./);
  const examples = await (await worker.fetch(new Request('https://site.example.test/examples/'))).text();
  assert.match(examples, /<title>Example store \| Merchendice<\/title>/);
  assert.match(examples, /<h2>Want a store like this for your audience\?<\/h2>/);
});

test('favicons share the serif M on espresso, and the share image is 1200 by 630', async () => {
  const svg = await fs.readFile(new URL('../favicon.svg', import.meta.url), 'utf8');
  assert.match(svg, /<rect[^>]*fill="#2e211d"/);
  assert.match(svg, /<path fill="#f6eee2"[^>]* d="M/);
  assert.doesNotMatch(svg, /<text|font-family/, 'outlined glyph, no font dependency');
  const ico = await fs.readFile(new URL('../favicon.ico', import.meta.url));
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4), 3, '16, 32, and 48 pixel sizes');
  const og = await fs.readFile(new URL('../og.png', import.meta.url));
  assert.equal(og.readUInt32BE(16), 1200);
  assert.equal(og.readUInt32BE(20), 630);
  const privacy = await (await worker.fetch(new Request('https://site.example.test/privacy/'))).text();
  assert.match(privacy, /keeps a draft of it in local storage on your own device/);
});

test('About names the co-founders without invented claims, and the footer says where we are based', async () => {
  const home = await (await worker.fetch(new Request('https://site.example.test/'))).text();
  const about = home.slice(home.indexOf('<section class="about'), home.indexOf('</section>', home.indexOf('<section class="about')));
  assert.match(about, /<h2 id="about-title">Who we are<\/h2>/);
  assert.match(about, /<p class="about-lead">Merchendice is run by <span class="nowrap">co-founders<\/span> Oscar Thomas and Oscar Rodhelius\.<\/p>/);
  assert.match(about, /<p>They draw the designs and build and run each store together with the creator\.<\/p>/);
  assert.equal((about.match(/<p\b/g) || []).length, 2, 'two lines only, no backstory');
  assert.doesNotMatch(about, /<img|placeholder|founded in|years|since \d/i, 'no photos yet and no invented claims');
  assert.ok(home.indexOf('id="about"') < home.indexOf('id="faq"'), 'About comes before the FAQ');
  for (const route of ['/', '/examples/', '/enquiry/', '/privacy/', '/missing-page']) {
    const html = await (await worker.fetch(new Request(`https://site.example.test${route}`))).text();
    assert.match(html, /<p class="footer-base"><span>© 2026 Merchendice<\/span> <span>Based and designed in Sweden<\/span><\/p>/, route);
    assert.match(html, /<nav class="main-nav"[\s\S]*?<a href="\/?#about">About<\/a>[\s\S]*?<\/nav>/, route);
    // Form only: no email address or social profile links anywhere.
    assert.doesNotMatch(html, /mailto:|[\w.-]+@[\w-]+\.[a-z]{2,}|instagram\.com|tiktok\.com|youtube\.com|facebook\.com|linkedin\.com|x\.com\//i, route);
  }
});

test('the FAQ has one Who is this for? item covering size and topic', async () => {
  const home = await (await worker.fetch(new Request('https://site.example.test/'))).text();
  assert.equal((home.match(/<summary>Who is this for\?<\/summary>/g) || []).length, 1);
  assert.doesNotMatch(home, /What kind of creators do you work with\?/);
  assert.match(home, /<summary>Who is this for\?<\/summary>\s*<p>Creators of every size, on any topic\. What matters is an audience that knows your style\.<\/p>/);
  assert.equal((home.match(/<details class="faq-item"/g) || []).length, 4);
});

test('the Privacy Policy names the controller and a 30-day log period, and the repo rotates logs to match', async () => {
  const privacy = await (await worker.fetch(new Request('https://site.example.test/privacy/'))).text();
  assert.match(privacy, /Oscar Thomas, co-founder of Merchendice, is the data controller/);
  assert.match(privacy, /These logs are deleted after 30 days\./);
  assert.doesNotMatch(privacy, /may keep standard access logs/);
  const read = (file) => fs.readFile(new URL(`../${file}`, import.meta.url), 'utf8');
  assert.match(await read('Caddyfile'), /roll_keep_for 720h/);
  assert.match(await read('deploy/logrotate-merchendice'), /rotate 30[\s\S]*maxage 30/);
  assert.match(await read('compose.yaml'), /logging:\s*\n\s*driver: json-file/);
  const todo = await read('TODO.md');
  assert.doesNotMatch(todo, /Privacy notice, controller|Privacy notice, access logs/);
  assert.match(todo, /Nginx Proxy Manager/);
});
