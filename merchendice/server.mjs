import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import app from './dist/app.mjs';
import { createEmailSender } from './src/mail.mjs';

const MAX_BODY_BYTES = 40000;
const invalidRequest = 'Please check the form and try again.';

function sendJson(response, status, message) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(JSON.stringify(message));
}

function readBody(request) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let bytes = 0;
    let rejected = false;
    request.on('data', (chunk) => {
      if (rejected) return;
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        rejected = true;
        chunks.length = 0;
        reject(Object.assign(new Error('Body too large'), { status: 413 }));
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => { if (!rejected) resolveBody(Buffer.concat(chunks)); });
    request.on('error', reject);
    request.on('aborted', () => reject(Object.assign(new Error('Request interrupted'), { status: 400 })));
  });
}

export function createRateLimiter({ limit = 5, windowMs = 10 * 60 * 1000, maxClients = 10000 } = {}) {
  const clients = new Map();
  return {
    allow(ip) {
      const now = Date.now();
      if (clients.size >= maxClients) {
        for (const [key, value] of clients) if (value.expires <= now) clients.delete(key);
      }
      let bucket = clients.get(ip);
      if (!bucket || bucket.expires <= now) {
        if (!bucket && clients.size >= maxClients) return false;
        bucket = { count: 0, expires: now + windowMs };
        clients.set(ip, bucket);
      }
      if (bucket.count >= limit) return false;
      bucket.count++;
      return true;
    },
  };
}

export function createAppServer({ env = process.env, sendMail, rateLimiter = createRateLimiter() } = {}) {
  const rawOrigin = env.PUBLIC_ORIGIN || (env.NODE_ENV === 'production' ? '' : 'http://localhost:3000');
  let publicOrigin;
  try {
    const parsed = new URL(rawOrigin);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.pathname !== '/'
      || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error();
    publicOrigin = parsed.origin;
  } catch { throw new Error('Set PUBLIC_ORIGIN to your website origin, such as https://merchendice.com.'); }
  const runtimeEnv = { MAIL_TO: env.MAIL_TO || 'merchendices@gmail.com', sendMail };

  const server = createServer({ maxHeaderSize: 8192 }, async (incoming, outgoing) => {
    try {
      const url = new URL(incoming.url, `${publicOrigin}/`);
      if (url.origin !== publicOrigin || !incoming.url.startsWith('/')) {
        incoming.resume();
        return sendJson(outgoing, 400, { message: invalidRequest });
      }
      if (['GET', 'HEAD'].includes(incoming.method) && url.pathname === '/healthz') {
        outgoing.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        outgoing.end(incoming.method === 'HEAD' ? '' : '{"ok":true}');
        return;
      }
      if (incoming.method === 'POST' && url.pathname === '/api/enquiry') {
        if (incoming.headers.origin && incoming.headers.origin !== publicOrigin) {
          incoming.resume();
          return sendJson(outgoing, 403, { message: 'Please submit the form from this website.' });
        }
        const ip = env.TRUST_PROXY === '1'
          ? incoming.headers['x-real-ip'] || incoming.socket.remoteAddress
          : incoming.socket.remoteAddress;
        if (!rateLimiter.allow(String(ip))) {
          incoming.resume();
          return sendJson(outgoing, 429, { message: 'Too many enquiries. Please try again later.' });
        }
        if (Number(incoming.headers['content-length']) > MAX_BODY_BYTES) {
          incoming.resume();
          return sendJson(outgoing, 413, { message: 'Your enquiry is too long. Please shorten it and try again.' });
        }
      }
      const headers = new Headers();
      for (const [key, value] of Object.entries(incoming.headers)) {
        if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
      }
      const body = ['GET', 'HEAD'].includes(incoming.method) ? undefined : await readBody(incoming);
      const request = new Request(url, { method: incoming.method, headers, ...(body ? { body } : {}) });
      const response = await app.fetch(request, runtimeEnv);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      if (outgoing.destroyed) return;
      if (outgoing.headersSent) return outgoing.end();
      sendJson(outgoing, error.status || 500, {
        message: error.status === 413
          ? 'Your enquiry is too long. Please shorten it and try again.'
          : error.status === 400 ? invalidRequest : 'We couldn’t process your enquiry. Please try again later.',
      });
    }
  });
  server.requestTimeout = 20000;
  server.headersTimeout = 15000;
  server.keepAliveTimeout = 5000;
  return server;
}

async function start() {
  const env = { ...process.env, MAIL_TO: process.env.MAIL_TO || 'merchendices@gmail.com' };
  const sendMail = await createEmailSender(env);
  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a valid port number.');
  const server = createAppServer({ env, sendMail });
  server.listen(port, env.HOST || '127.0.0.1', () => {
    console.log(`Merchendice is listening on port ${port}.`);
    if (!sendMail) console.warn('Email delivery needs private settings. Enquiries will show an error until configured.');
  });
  const stop = () => {
    server.close(() => process.exit(0));
    const timer = setTimeout(() => process.exit(0), 10000);
    timer.unref();
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  start().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
