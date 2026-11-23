import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
// helpers.mjs rebuilds dist/app.mjs first; server.mjs is loaded only afterwards, so it serves the fresh build.
import { PAGES, worker } from './helpers.mjs';
const { createAppServer, createRateLimiter, ENQUIRY_LIMIT, ENQUIRY_RAW_LIMIT, ENQUIRY_WINDOW_MS } = await import('../server.mjs');
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
    assert.equal((await fetch(fixture.base+path)).status,404,path);
  }
  // fetch() and new URL() collapse '..' before sending, so these go out byte for byte with http.request,
  // exactly as a hostile client would send them.
  for (const path of ['/images/../server.mjs','/fonts/../server.mjs','/images/../src/mail.mjs','/images/../.env','/images/%2e%2e/server.mjs','/images/..%2fserver.mjs','/images/..%5cserver.mjs','/images/....//server.mjs']) {
    const response=await rawGet(fixture.base+path);
    assert.equal(response.requestedPath,path,'the path was not normalised on the way out');
    assert.equal(response.status,404,path);
    assert.doesNotMatch(response.body.toString('utf8'),/createAppServer|COMPOSIO|SMTP_/,path);
  }
  assert.equal((await fetch(`${fixture.base}/healthz`)).status,200);
});

test('oversized enquiries are rejected before email is sent', async t => {
  const fixture=await serverFixture(t);
  assert.equal((await fetch(`${fixture.base}/api/enquiry`,{method:'POST',body:'a'.repeat(50000)})).status,413);
  assert.equal(fixture.sends(),0);
});

test('each visitor can send exactly 2 enquiries per hour; the 3rd gets a friendly 429 and is never emailed', async t => {
  assert.equal(ENQUIRY_LIMIT,2);
  assert.equal(ENQUIRY_WINDOW_MS,60*60*1000);
  // The real server, with its default limiters.
  const fixture=await serverFixture(t);
  const post=()=>fetch(`${fixture.base}/api/enquiry`,{method:'POST',body:JSON.stringify(input)});
  assert.equal((await post()).status,200);
  assert.equal((await post()).status,200);
  const third=await post();
  assert.equal(third.status,429);
  assert.equal((await third.json()).message,'Too many enquiries. Please try again later.');
  assert.equal(fixture.sends(),2);
  // The window is one hour: still blocked at 59 minutes, open again at 60, and other visitors are unaffected.
  let now=0;
  const limiter=createRateLimiter({now:()=>now});
  limiter.record('a');
  limiter.record('a');
  assert.equal(limiter.reserve('a'),null);
  assert.equal(typeof limiter.reserve('b'),'function');
  now=59*60*1000;
  assert.equal(limiter.reserve('a'),null);
  now=60*60*1000;
  assert.equal(typeof limiter.reserve('a'),'function');
  // The 2nd blocked send carries a Retry-After header too.
  assert.ok(Number(third.headers.get('retry-after'))>3500);
});

test('rate-limit counts are dropped after about an hour, as the Privacy notice says', async () => {
  let now=0;
  const limiter=createRateLimiter({now:()=>now});
  for (const ip of ['a','b','c']) limiter.record(ip);
  assert.equal(limiter.size(),3);
  now=ENQUIRY_WINDOW_MS+60*1000;
  limiter.record('d');
  assert.equal(limiter.size(),1,'expired addresses are forgotten');
  const privacy=await (await worker.fetch(new Request('https://site.example.test/privacy/'))).text();
  assert.equal(ENQUIRY_WINDOW_MS,60*60*1000);
  assert.match(privacy,/That count is kept in memory for up to an hour and the site doesn’t save it\./);
  assert.doesNotMatch(privacy,/ten minutes/);
});

test('invalid, oversized, honeypot and undelivered enquiries do not use up the 2-per-hour allowance', async t => {
  let deliver=false;
  const fixture=await serverFixture(t,{sendMail:async()=>deliver?{id:'receipt'}:{}});
  const post=(body,headers={})=>fetch(`${fixture.base}/api/enquiry`,{method:'POST',headers:{'content-type':'application/json',...headers},body});
  const rejected=[
    [JSON.stringify({...input,email:'not-an-email'}),400],
    [JSON.stringify({...input,name:'  '}),400],
    ['{not json',400],
    ['a'.repeat(50000),413],
    [JSON.stringify({...input,description:'a'.repeat(5001)}),400],
    [JSON.stringify({...input,website:'https://spam.example'}),200], // honeypot: looks sent, never emailed
    [JSON.stringify(input),502], // the provider gave no receipt, so nothing went out
  ];
  for (const [body,status] of [...rejected,...rejected]) assert.equal((await post(body)).status,status,body.slice(0,40));
  // 14 rejected POSTs later, both real sends still go through, and only then is the visitor blocked.
  deliver=true;
  assert.equal((await post(JSON.stringify(input))).status,200);
  assert.equal((await post(JSON.stringify(input))).status,200);
  assert.equal((await post(JSON.stringify(input))).status,429);
});

test('parallel sends from one visitor cannot get past 2 an hour', async t => {
  let sends=0;
  const fixture=await serverFixture(t,{sendMail:async()=>{sends++;await new Promise(r=>setTimeout(r,30));return {id:'receipt'};}});
  const statuses=(await Promise.all(Array.from({length:6},()=>fetch(`${fixture.base}/api/enquiry`,{method:'POST',body:JSON.stringify(input)})))).map(r=>r.status).sort();
  assert.deepEqual(statuses,[200,200,429,429,429,429]);
  assert.equal(sends,2);
});

test(`a separate raw cap of ${ENQUIRY_RAW_LIMIT} POSTs an hour per visitor stops the form being hammered`, async t => {
  assert.equal(ENQUIRY_RAW_LIMIT,20);
  const fixture=await serverFixture(t);
  const bad=()=>fetch(`${fixture.base}/api/enquiry`,{method:'POST',body:JSON.stringify({...input,email:'bad'})});
  for (let i=0;i<ENQUIRY_RAW_LIMIT;i++) assert.equal((await bad()).status,400,`POST ${i+1}`);
  // The 21st POST is refused before its body is read, and so is a valid one: nothing is emailed.
  const blocked=await bad();
  assert.equal(blocked.status,429);
  assert.equal((await blocked.json()).message,'Too many enquiries. Please try again later.');
  const retry=Number(blocked.headers.get('retry-after'));
  assert.ok(retry>3500 && retry<=3600,`Retry-After is about an hour (${retry}s)`);
  assert.equal((await fetch(`${fixture.base}/api/enquiry`,{method:'POST',body:JSON.stringify(input)})).status,429);
  assert.equal(fixture.sends(),0);
  // Cross-site POSTs are refused with a 403 but still count toward the raw cap.
  const other=await serverFixture(t);
  const crossSite=()=>fetch(`${other.base}/api/enquiry`,{method:'POST',headers:{origin:'https://another.example.test'},body:JSON.stringify(input)});
  for (let i=0;i<ENQUIRY_RAW_LIMIT;i++) assert.equal((await crossSite()).status,403,`cross-site POST ${i+1}`);
  assert.equal((await crossSite()).status,429);
  assert.equal((await fetch(`${other.base}/api/enquiry`,{method:'POST',body:JSON.stringify(input)})).status,429);
  assert.equal(other.sends(),0);
  let now=0;
  const raw=createRateLimiter({limit:ENQUIRY_RAW_LIMIT,now:()=>now});
  for (let i=0;i<ENQUIRY_RAW_LIMIT;i++) assert.equal(raw.allow('a'),true);
  assert.equal(raw.allow('a'),false);
  assert.equal(raw.allow('b'),true);
  now=ENQUIRY_WINDOW_MS;
  assert.equal(raw.allow('a'),true);
});

// A GET whose path goes on the wire exactly as written: host and port come from the base URL, but the
// path is passed through untouched (no URL parsing, so '..' and percent-escapes are not normalised).
function rawGet(url, headers = {}) {
  const { hostname, port } = new URL(url);
  const path = url.slice(url.indexOf('/', url.indexOf('//') + 2));
  return new Promise((resolve, reject) => {
    const req = httpRequest({ hostname, port, path, method: 'GET', headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks), requestedPath: req.path }));
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
  for (const gone of ['sticker', 'tote-black-detail', 'tote-black', 'sticker-camel', 'example-store-accessories', 'jersey-sand', 'canvas-black', 'canvas-natural', 'canvas-sand', 'goods-flatlay', 'store-banner']) {
    assert.equal((await fetch(`${fixture.base}/images/${gone}.webp`)).status, 404, gone);
  }
  for (const image of ['hero-tee', 'tote-natural', 'knit-stack', 'about-knit-1900', 'about-knit-1200', 'about-knit-800', 'photo-jewellery-720', 'photo-jewellery-360', 'photo-tote-720', 'photo-tote-360', 'photo-crewneck-720', 'photo-crewneck-360', 'hoodie-black-496', 'store-phone-780', 'store-phone-520', 'store-desktop-1440', 'store-desktop-960']) {
    const response = await fetch(`${fixture.base}/images/${image}.webp`);
    assert.equal(response.status, 200, image);
    assert.match(response.headers.get('content-type'), /image\/webp/);
  }
  for (const name of ['cormorant-garamond', 'dm-sans']) {
    const font = await fetch(`${fixture.base}/fonts/${name}.woff2`);
    assert.equal(font.status, 200, name);
    assert.match(font.headers.get('content-type'), /font\/woff2/);
  }
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

test('www hosts in production 301 to the HTTPS apex and keep the path and query', async t => {
  const fixture = await serverFixture(t, { env: { NODE_ENV: 'production', PUBLIC_ORIGIN: 'https://merchendice.example.test', MAIL_TO: settings.MAIL_TO, TRUST_PROXY: '1' } });
  const httpsWww = await proxyGet(fixture.base, '/guides/start-merch-small-youtuber/?ref=1', { host: 'www.merchendice.example.test', 'x-forwarded-proto': 'https' });
  assert.equal(httpsWww.statusCode, 301);
  assert.equal(httpsWww.headers.location, 'https://merchendice.example.test/guides/start-merch-small-youtuber/?ref=1');
  const httpWww = await proxyGet(fixture.base, '/enquiry/?a=1', { host: 'www.merchendice.example.test', 'x-forwarded-proto': 'http' });
  assert.equal(httpWww.statusCode, 301);
  assert.equal(httpWww.headers.location, 'https://merchendice.example.test/enquiry/?a=1');
  const postWww = await new Promise((resolve, reject) => {
    const req = httpRequest(`${fixture.base}/enquiry/`, { method: 'POST', headers: { host: 'www.merchendice.example.test', 'x-forwarded-proto': 'https', 'content-length': 0 } }, res => { res.resume(); res.on('end', () => resolve(res)); });
    req.on('error', reject); req.end();
  });
  assert.equal(postWww.statusCode, 301);
  assert.equal(postWww.headers.location, 'https://merchendice.example.test/enquiry/');
  const apex = await proxyGet(fixture.base, '/', { host: 'merchendice.example.test', 'x-forwarded-proto': 'https' });
  assert.equal(apex.statusCode, 200);
  const localWww = await proxyGet(fixture.base, '/', { host: 'localhost', 'x-forwarded-proto': 'https' });
  assert.equal(localWww.statusCode, 200);
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
  const startRoutes = [...PAGES, '/example-store/'];
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

test('rate limits count IPv4 addresses singly and IPv6 addresses by their /64', async () => {
  const { rateLimitKey } = await import('../server.mjs');
  assert.equal(rateLimitKey('203.0.113.7'), '203.0.113.7');
  assert.equal(rateLimitKey('::ffff:203.0.113.7'), '203.0.113.7');
  assert.equal(rateLimitKey('2001:db8:1:2:aaaa::1'), '2001:db8:1:2::/64');
  assert.equal(rateLimitKey('2001:DB8:1:2:ffff:ffff:ffff:ffff'), '2001:db8:1:2::/64');
  assert.equal(rateLimitKey('[2001:db8::5]'), '2001:db8:0:0::/64');
  assert.equal(rateLimitKey('fe80::1%eth0'), 'fe80:0:0:0::/64');
  assert.equal(rateLimitKey('::1'), '0:0:0:0::/64');
  assert.equal(rateLimitKey('64:ff9b::192.0.2.1'), '64:ff9b:0:0::/64');
  assert.equal(rateLimitKey(''), 'unknown');
});

test('addresses in one IPv6 /64 share the 2 confirmed sends an hour', async () => {
  const sent = [];
  const server = createAppServer({ env: { NODE_ENV: 'test', TRUST_PROXY: '1', PUBLIC_ORIGIN: 'http://127.0.0.1' }, sendMail: async (m) => { sent.push(m); return { id: `id-${sent.length}` }; } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  const post = (ip) => new Promise((resolve, reject) => {
    const body = JSON.stringify({ name: 'Ada', email: 'ada@example.com', description: 'Tote bags' });
    const req = httpRequest({ host: '127.0.0.1', port, path: '/api/enquiry', method: 'POST', headers: { host: '127.0.0.1', 'content-type': 'application/json', 'x-real-ip': ip, 'content-length': Buffer.byteLength(body) } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject); req.end(body);
  });
  try {
    assert.equal(await post('2001:db8:1:2::1'), 200);
    assert.equal(await post('2001:db8:1:2::2'), 200);
    assert.equal(await post('2001:db8:1:2:dead:beef::3'), 429);
    assert.equal(await post('2001:db8:1:3::1'), 200);
    assert.equal(sent.length, 3);
  } finally { server.close(); }
});

test('a line break in the name cannot add a line to the enquiry email', async () => {
  const sent = [];
  const response = await worker.fetch(new Request('https://site.example.test/api/enquiry', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Ada\r\nEmail: other@example.com', email: 'ada@example.com', description: 'Tote bags' }),
  }), { MAIL_TO: 'inbox@example.com', sendMail: async (m) => { sent.push(m); return { id: 'x' }; } });
  assert.equal(response.status, 200);
  assert.match(sent[0].text, /^Name: Ada Email: other@example\.com$/m);
  assert.equal(sent[0].text.match(/^Email:/gm).length, 1);
});
