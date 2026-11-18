import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { createAppServer, createRateLimiter } from '../server.mjs';
import { createEmailSender, headerSafe, makeGmailMessage } from '../src/mail.mjs';

const input = {name:'A creator',email:'creator@example.test',description:'A merch idea'};
const settings = {
  EMAIL_PROVIDER:'composio', MAIL_TO:'inbox@example.test',
  COMPOSIO_API_KEY:'test-secret', COMPOSIO_CONNECTED_ACCOUNT_ID:'test-connected-account',
  COMPOSIO_FROM_EMAIL:'sender@example.test',
};

test('Composio sends UTF-8 mail to the fixed inbox with Reply-To preserved', async () => {
  let posted;
  const send = await createEmailSender(settings, {fetchImpl:async (url,options) => {
    posted={url,options}; return Response.json({status:200,data:{id:'gmail-receipt'}});
  }});
  const message={to:'attacker@example.test',replyTo:input.email,subject:'New Merchendice enquiry',text:'A merch idea: 漢'};
  const result=await send(message);
  assert.equal(result.id,'gmail-receipt');
  assert.equal(posted.url,'https://backend.composio.dev/api/v3.1/tools/execute/proxy');
  assert.equal(posted.options.headers['x-api-key'],settings.COMPOSIO_API_KEY);
  const payload=JSON.parse(posted.options.body);
  assert.equal(payload.connected_account_id,settings.COMPOSIO_CONNECTED_ACCOUNT_ID);
  const mime=Buffer.from(payload.body.raw,'base64url').toString('utf8');
  assert.match(mime,/To: inbox@example.test/);
  assert.match(mime,/Reply-To: creator@example.test/);
  assert.equal(Buffer.from(mime.split('\r\n\r\n')[1].replace(/\s/g,''),'base64').toString('utf8'),message.text);
});

test('Composio errors and missing Gmail receipts never report success', async () => {
  for (const data of [{status:403,data:{id:'invalid'}},{data:{id:'invalid'}},{status:200,data:{}}]) {
    const send=await createEmailSender(settings,{fetchImpl:async()=>Response.json(data)});
    await assert.rejects(send({to:settings.MAIL_TO,replyTo:input.email,text:'A merch idea'}));
  }
});

test('missing secrets disable sending without putting credentials into pages', async () => {
  assert.equal(await createEmailSender({...settings,COMPOSIO_API_KEY:''}),null);
  assert.equal(await createEmailSender({EMAIL_PROVIDER:'smtp',MAIL_TO:settings.MAIL_TO,SMTP_USER:settings.COMPOSIO_FROM_EMAIL}),null);
  assert.throws(()=>makeGmailMessage({to:settings.MAIL_TO,replyTo:'a@example.test\r\nBcc: bad@example.test',text:'hello'},settings.COMPOSIO_FROM_EMAIL));
});

test('SMTP follows the reference account and confirms acceptance by the business inbox', async () => {
  let sent;
  const smtpEnv={EMAIL_PROVIDER:'smtp',MAIL_TO:settings.MAIL_TO,SMTP_USER:'business@example.test',SMTP_APP_PASSWORD:'test-only'};
  const send=await createEmailSender(smtpEnv,{smtpTransport:{sendMail:async message=>{
    sent=message; return {messageId:'smtp-receipt',accepted:[smtpEnv.MAIL_TO]};
  }}});
  assert.equal((await send({to:'other@example.test',replyTo:input.email,text:'hello'})).id,'smtp-receipt');
  assert.equal(sent.to,smtpEnv.MAIL_TO);
  assert.equal(sent.from,'Merchendice <business@example.test>');
  assert.equal(sent.replyTo,input.email);
  const failed=await createEmailSender(smtpEnv,{smtpTransport:{sendMail:async()=>({messageId:'receipt',accepted:[]})}});
  await assert.rejects(failed({replyTo:input.email,text:'hello'}));
});

async function serverFixture(t, options={}) {
  let sends=0;
  const server=createAppServer({
    env:{NODE_ENV:'production',PUBLIC_ORIGIN:'https://merchendice.example.test',MAIL_TO:settings.MAIL_TO},
    sendMail:async()=>{sends++;return {id:'test-receipt'};},
    ...options,
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  return {base:`http://127.0.0.1:${server.address().port}`,sends:()=>sends};
}

test('HTTPS public origins work behind an HTTP domain proxy', async t => {
  const fixture=await serverFixture(t);
  const response=await fetch(`${fixture.base}/api/enquiry`,{
    method:'POST',headers:{origin:'https://merchendice.example.test','content-type':'application/json'},body:JSON.stringify(input),
  });
  assert.equal(response.status,200);
  assert.equal(fixture.sends(),1);
  const blocked=await fetch(`${fixture.base}/api/enquiry`,{
    method:'POST',headers:{origin:'https://another.example.test'},body:JSON.stringify(input),
  });
  assert.equal(blocked.status,403);
  assert.equal(fixture.sends(),1);
});

test('credentials and server source cannot be downloaded', async t => {
  const fixture=await serverFixture(t);
  for (const path of ['/.env','/.openai/hosting.json','/src/mail.mjs','/server.mjs']) {
    assert.equal((await fetch(fixture.base+path)).status,404);
  }
  assert.equal((await fetch(`${fixture.base}/healthz`)).status,200);
});

test('oversized enquiries and excess submissions are rejected before email is sent', async t => {
  const fixture=await serverFixture(t,{rateLimiter:createRateLimiter({limit:2})});
  assert.equal((await fetch(`${fixture.base}/api/enquiry`,{method:'POST',body:'a'.repeat(50000)})).status,413);
  assert.equal((await fetch(`${fixture.base}/api/enquiry`,{method:'POST',body:JSON.stringify(input)})).status,200);
  assert.equal((await fetch(`${fixture.base}/api/enquiry`,{method:'POST',body:JSON.stringify(input)})).status,429);
  assert.equal(fixture.sends(),1);
});

function rawGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, { headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('css and javascript are gzip or brotli compressed when the client allows it', async t => {
  const fixture = await serverFixture(t);
  const plain = await rawGet(`${fixture.base}/site.css`);
  const gzipped = await rawGet(`${fixture.base}/site.css`, { 'accept-encoding': 'gzip' });
  assert.equal(gzipped.headers['content-encoding'], 'gzip');
  assert.match(gzipped.headers.vary, /Accept-Encoding/);
  assert.equal(gunzipSync(gzipped.body).toString('utf8'), plain.body.toString('utf8'));
  const brotli = await rawGet(`${fixture.base}/site.js`, { 'accept-encoding': 'br, gzip' });
  assert.equal(brotli.headers['content-encoding'], 'br');
  assert.equal(brotliDecompressSync(brotli.body).toString('utf8'), (await rawGet(`${fixture.base}/site.js`)).body.toString('utf8'));
  const gzipOnly = await rawGet(`${fixture.base}/example-store/store.js`, { 'accept-encoding': 'br;q=0, gzip' });
  assert.equal(gzipOnly.headers['content-encoding'], 'gzip');
  const page = await rawGet(`${fixture.base}/`, { 'accept-encoding': 'gzip, br' });
  assert.equal(page.headers['content-encoding'], undefined);
});

test('mail left unset returns the usual unavailable message', async t => {
  const fixture = await serverFixture(t, { sendMail: null });
  const response = await fetch(`${fixture.base}/api/enquiry`, {
    method: 'POST',
    headers: { origin: 'https://merchendice.example.test', 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { message: 'Enquiries are not available right now. Please try again later.' });
  assert.equal(fixture.sends(), 0);
});

test('a filled website field is ignored before email is sent', async t => {
  const fixture = await serverFixture(t);
  const response = await fetch(`${fixture.base}/api/enquiry`, {
    method: 'POST',
    headers: { origin: 'https://merchendice.example.test', 'content-type': 'application/json' },
    body: JSON.stringify({ ...input, website: 'https://spam.example' }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(fixture.sends(), 0);
});

test('the fonts are served from the site, and removed product mockups are not', async t => {
  const fixture = await serverFixture(t);
  assert.equal((await fetch(`${fixture.base}/images/tee.webp`)).status, 404);
  assert.equal((await fetch(`${fixture.base}/images/shop-preview-1.webp`)).status, 404);
  assert.equal((await fetch(`${fixture.base}/images/example-store-accessories.webp`)).status, 404);
  assert.equal((await fetch(`${fixture.base}/fonts/fraunces.woff2`)).status, 404);
  assert.equal((await fetch(`${fixture.base}/fonts/instrument-serif-regular.woff2`)).status, 404);
  for (const old of ['archivo', 'source-serif-4']) assert.equal((await fetch(`${fixture.base}/fonts/${old}.woff2`)).status, 404, old);
  for (const gone of ['tote-black-detail', 'tote-black', 'sticker-camel', 'example-store-accessories', 'jersey-sand', 'canvas-black', 'canvas-natural', 'canvas-sand', 'goods-flatlay', 'store-banner']) {
    assert.equal((await fetch(`${fixture.base}/images/${gone}.webp`)).status, 404, gone);
  }
  for (const image of ['hero-tee', 'tote-natural', 'sticker', 'photo-jewellery-720', 'photo-jewellery-360', 'photo-tote-720', 'photo-tote-360', 'photo-crewneck-720', 'photo-crewneck-360', 'hoodie-black-496', 'store-phone-780', 'store-phone-520', 'store-desktop-1440', 'store-desktop-960']) {
    const response = await fetch(`${fixture.base}/images/${image}.webp`);
    assert.equal(response.status, 200, image);
    assert.match(response.headers.get('content-type'), /image\/webp/);
  }
  for (const name of ['cormorant-garamond', 'dm-sans']) {
    const font = await fetch(`${fixture.base}/fonts/${name}.woff2`);
    assert.equal(font.status, 200, name);
    assert.match(font.headers.get('content-type'), /font\/woff2/);
  }
  assert.equal((await fetch(`${fixture.base}/images/../server.mjs`)).status, 404);
  assert.equal((await fetch(`${fixture.base}/fonts/OFL.txt`)).status, 404);
});

test('production requires a valid fixed public origin', () => {
  for (const origin of ['', 'https://user:pass@site.example.test', 'https://site.example.test/path']) {
    assert.throws(()=>createAppServer({env:{NODE_ENV:'production',PUBLIC_ORIGIN:origin}}),/PUBLIC_ORIGIN/);
  }
});

function proxyGet(base, path, headers={}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(`${base}${path}`, { headers }, res => { res.resume(); res.on('end', () => resolve(res)); });
    req.on('error', reject); req.end();
  });
}

test('HSTS is sent in production for the public host and never on localhost', async t => {
  const fixture = await serverFixture(t);
  const publicHost = await proxyGet(fixture.base, '/', { host: 'merchendice.example.test', 'x-forwarded-proto': 'https' });
  assert.equal(publicHost.statusCode, 200);
  assert.equal(publicHost.headers['strict-transport-security'], 'max-age=31536000; includeSubDomains');
  const local = await proxyGet(fixture.base, '/', { host: '127.0.0.1' });
  assert.equal(local.headers['strict-transport-security'], undefined);
  const localName = await proxyGet(fixture.base, '/', { host: 'localhost:3000' });
  assert.equal(localName.headers['strict-transport-security'], undefined);
});

test('HSTS and HTTPS redirects stay off outside production', async t => {
  const fixture = await serverFixture(t, { env: { PUBLIC_ORIGIN: 'http://localhost:3000', MAIL_TO: settings.MAIL_TO, TRUST_PROXY: '1' } });
  const response = await proxyGet(fixture.base, '/', { host: 'merchendice.example.test', 'x-forwarded-proto': 'http' });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['strict-transport-security'], undefined);
});

test('plain HTTP from the trusted proxy redirects to HTTPS once, without a loop', async t => {
  const fixture = await serverFixture(t, { env: { NODE_ENV: 'production', PUBLIC_ORIGIN: 'https://merchendice.example.test', MAIL_TO: settings.MAIL_TO, TRUST_PROXY: '1' } });
  const http = await proxyGet(fixture.base, '/enquiry/?a=1', { host: 'merchendice.example.test', 'x-forwarded-proto': 'http' });
  assert.equal(http.statusCode, 301);
  assert.equal(http.headers.location, 'https://merchendice.example.test/enquiry/?a=1');
  const https = await proxyGet(fixture.base, '/enquiry/', { host: 'merchendice.example.test', 'x-forwarded-proto': 'https' });
  assert.equal(https.statusCode, 200);
  const noHeader = await proxyGet(fixture.base, '/healthz', { host: 'merchendice.example.test' });
  assert.equal(noHeader.statusCode, 200);
  const localHttp = await proxyGet(fixture.base, '/', { host: 'localhost', 'x-forwarded-proto': 'http' });
  assert.equal(localHttp.statusCode, 200);
});

test('old /examplepage.com links redirect permanently to /example-store/', async t => {
  const fixture = await serverFixture(t);
  const doubleSlash = await fetch(`${fixture.base}//`, { redirect: 'manual' });
  assert.equal(doubleSlash.status, 400, 'an unparseable path is a bad request, not a server error');
  for (const [from, to] of [['/examplepage.com', '/example-store/'], ['/examplepage.com/', '/example-store/'], ['/examplepage.com/products/x?y=1', '/example-store/products/x?y=1']]) {
    const response = await fetch(`${fixture.base}${from}`, { redirect: 'manual' });
    assert.equal(response.status, 301, from);
    assert.equal(response.headers.get('location'), to);
  }
  const page = await fetch(`${fixture.base}/example-store/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /CREATOR \| Storefront example/);
});

test('email headers strip CR/LF and are length-capped', async () => {
  assert.equal(headerSafe('Hi\r\nBcc: evil@example.test'), 'Hi Bcc: evil@example.test');
  assert.equal(headerSafe('x'.repeat(500), 150).length, 150);
  assert.doesNotMatch(headerSafe('a\u0000b\u007fc\nd'), /[\u0000-\u001f\u007f]/);
  const raw = makeGmailMessage({ to: 'inbox@example.test', replyTo: 'creator@example.test', subject: 'Hello\r\nBcc: evil@example.test', text: 'Body' }, 'sender@example.test');
  const headers = Buffer.from(raw, 'base64url').toString('utf8').split('\r\n\r\n')[0];
  assert.doesNotMatch(headers, /^Bcc:/m);
  assert.match(headers, /^Subject: Hello Bcc: evil@example\.test$/m);
  assert.throws(() => makeGmailMessage({ to: 'inbox@example.test', replyTo: 'creator@example.test\r\nBcc: evil@example.test', text: 'Body' }, 'sender@example.test'), /Reply address/);
});

test('SMTP passes only sanitised header values to the transport', async () => {
  let sent;
  const send = await createEmailSender({ EMAIL_PROVIDER: 'smtp', MAIL_TO: 'inbox@example.test', SMTP_USER: 'sender@example.test', SMTP_APP_PASSWORD: 'x' }, {
    smtpTransport: { sendMail: async message => { sent = message; return { messageId: 'id', accepted: ['inbox@example.test'] }; } },
  });
  await send({ to: 'attacker@example.test', replyTo: 'creator@example.test', subject: 'Hi\r\nBcc: evil@example.test', text: 'Body', bcc: 'evil@example.test' });
  assert.equal(sent.to, 'inbox@example.test');
  assert.equal(sent.subject, 'Hi Bcc: evil@example.test');
  assert.equal(sent.bcc, undefined);
  await assert.rejects(send({ replyTo: 'a@b.test\nBcc: evil@example.test', subject: 'x', text: 'y' }), /Reply address/);
});

test('outside production the form works from localhost and 127.0.0.1 on any port', async t => {
  const fixture = await serverFixture(t, { env: { MAIL_TO: settings.MAIL_TO } });
  const port = new URL(fixture.base).port;
  const { request: httpRequest } = await import('node:http');
  for (const host of [`localhost:${port}`, `127.0.0.1:${port}`]) {
    const status = await new Promise((resolve, reject) => {
      const req = httpRequest(`${fixture.base}/api/enquiry`, { method: 'POST', headers: { host, origin: `http://${host}`, 'content-type': 'application/json' } }, res => { res.resume(); resolve(res.statusCode); });
      req.on('error', reject);
      req.end(JSON.stringify(input));
    });
    assert.equal(status, 200, host);
  }
  const foreign = await fetch(`${fixture.base}/api/enquiry`, {
    method: 'POST',
    headers: { origin: 'http://evil.example.test', 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  assert.equal(foreign.status, 403);
});

test('every response carries the permissions and opener policies, and hashed assets cache for a year', async t => {
  const fixture = await serverFixture(t);
  const home = await fetch(`${fixture.base}/`);
  const html = await home.text();
  for (const response of [home, await fetch(`${fixture.base}/images/hoodie-black-496.webp`), await fetch(`${fixture.base}/missing`)]) {
    assert.equal(response.headers.get('permissions-policy'), 'camera=(), microphone=(), geolocation=()');
    assert.equal(response.headers.get('cross-origin-opener-policy'), 'same-origin');
  }
  const css = html.match(/href="(\/site\.[0-9a-f]{10}\.css)"/)[1];
  const js = html.match(/src="(\/site\.[0-9a-f]{10}\.js)"/)[1];
  for (const asset of [css, js]) {
    const response = await fetch(`${fixture.base}${asset}`);
    assert.equal(response.status, 200, asset);
    assert.equal(response.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  }
  assert.equal((await fetch(`${fixture.base}/site.css`)).headers.get('cache-control'), 'no-cache');
});

test('every referenced local asset exists', async t => {
  const fixture = await serverFixture(t);
  const startRoutes = ['/', '/examples/', '/enquiry/', '/privacy/', '/example-store/', '/missing-page'];
  const seen = new Set(startRoutes);
  const queue = startRoutes.map((path) => ({ path, referrer: 'start' }));
  const missing = [];

  const enqueue = (ref, referrer) => {
    if (!ref) return;
    const token = String(ref).trim();
    if (!token || token.startsWith('data:') || token.startsWith('mailto:') || token.startsWith('#')) return;
    let url;
    try {
      url = new URL(token, 'https://merchendice.com' + (referrer.endsWith('/') ? referrer : referrer + '/'));
    } catch {
      return;
    }
    if (url.protocol === 'https:' && url.host !== 'merchendice.com') return;
    if (url.protocol === 'http:') return;
    if (!url.pathname.startsWith('/') || url.pathname.startsWith('/api/')) return;
    const path = url.pathname;
    if (seen.has(path)) return;
    seen.add(path);
    queue.push({ path, referrer });
  };

  while (queue.length) {
    const { path, referrer } = queue.shift();
    const response = await fetch(`${fixture.base}${path}`);
    if (response.status >= 400 && path !== '/missing-page') missing.push(`${path} (${response.status}) from ${referrer}`);
    const type = response.headers.get('content-type') || '';
    if (!/html|css|javascript|xml|svg|text\//.test(type)) continue;
    const body = await response.text();
    for (const match of body.matchAll(/\b(?:href|src|poster)=["']([^"']+)/g)) enqueue(match[1], path);
    for (const match of body.matchAll(/srcset=["']([^"']+)/g)) {
      for (const part of match[1].split(',')) enqueue(part.trim().split(/\s+/)[0], path);
    }
    for (const match of body.matchAll(/url\((['"]?)([^"'()]+)\1\)/g)) enqueue(match[2], path);
  }

  assert.deepEqual(missing, [], missing.join('; '));
});
