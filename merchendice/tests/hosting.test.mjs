import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppServer, createRateLimiter } from '../server.mjs';
import { createEmailSender, makeGmailMessage } from '../src/mail.mjs';

const input = {name:'A creator',email:'creator@example.test',platforms:['YouTube'],description:'A merch idea'};
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

test('production requires a valid fixed public origin', () => {
  for (const origin of ['', 'https://user:pass@site.example.test', 'https://site.example.test/path']) {
    assert.throws(()=>createAppServer({env:{NODE_ENV:'production',PUBLIC_ORIGIN:origin}}),/PUBLIC_ORIGIN/);
  }
});
