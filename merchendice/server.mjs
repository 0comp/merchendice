import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import app from './dist/app.mjs';
import { createEmailSender } from './src/mail.mjs';

const MAX_BODY_BYTES = 40000;
const HSTS_VALUE = 'max-age=31536000; includeSubDomains';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const SECURITY_HEADERS = {
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'cross-origin-opener-policy': 'same-origin',
};

// The example store moved from /examplepage.com/ to /example-store/. Old links get a permanent redirect.
export function legacyExampleRedirect(pathname) {
  if (pathname === '/examplepage.com') return '/example-store/';
  if (pathname.startsWith('/examplepage.com/')) return `/example-store/${pathname.slice('/examplepage.com/'.length)}`;
  return null;
}

function requestHostname(incoming) {
  const host = String(incoming.headers.host || '').toLowerCase();
  return host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0];
}
const invalidRequest = 'Please check the form and try again.';

function sendJson(response, status, message) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...SECURITY_HEADERS,
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

// Each client IP may send 2 enquiries per hour; the 3rd within the hour gets a 429 and never reaches the mail provider.
export const ENQUIRY_LIMIT = 2;
export const ENQUIRY_WINDOW_MS = 60 * 60 * 1000;

export function createRateLimiter({ limit = ENQUIRY_LIMIT, windowMs = ENQUIRY_WINDOW_MS, maxClients = 10000, now: clock = Date.now } = {}) {
  const clients = new Map();
  return {
    allow(ip) {
      const now = clock();
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

function encodingQuality(header, name) {
  let specific;
  let wildcard;
  for (const part of String(header || '').split(',')) {
    const [rawName, ...params] = part.trim().split(';');
    const token = rawName.trim().toLowerCase();
    if (!token) continue;
    let quality = 1;
    for (const param of params) {
      const match = /^q=((?:0(?:\.\d+)?)|(?:1(?:\.0+)?))$/i.exec(param.trim());
      if (match) quality = Number(match[1]);
    }
    if (token === name) specific = quality;
    else if (token === '*') wildcard = quality;
  }
  if (specific != null) return specific;
  if (wildcard != null) return wildcard;
  return 0;
}

function preferredEncoding(header) {
  const brotli = encodingQuality(header, 'br');
  const gzip = encodingQuality(header, 'gzip');
  if (brotli > 0 && brotli >= gzip) return 'br';
  if (gzip > 0) return 'gzip';
  return '';
}

function headerMap(headers) {
  return Object.fromEntries(headers);
}

const STATIC_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)));
const STATIC_TYPES = { '.webp': 'image/webp', '.woff2': 'font/woff2' };

function resolveStatic(pathname) {
  if (!pathname.startsWith('/images/') && !pathname.startsWith('/fonts/')) return null;
  if (pathname.includes('..') || pathname.includes('\\') || pathname.includes('\0')) return null;
  const target = resolve(STATIC_ROOT, `.${pathname}`);
  const imagesRoot = resolve(STATIC_ROOT, 'images') + sep;
  const fontsRoot = resolve(STATIC_ROOT, 'fonts') + sep;
  if (!target.startsWith(imagesRoot) && !target.startsWith(fontsRoot)) return null;
  return target;
}

function serveStatic(pathname, method, outgoing) {
  const file = resolveStatic(pathname);
  if (!file || !existsSync(file) || !statSync(file).isFile()) return false;
  const type = STATIC_TYPES[extname(file).toLowerCase()];
  if (!type) return false;
  const data = readFileSync(file);
  outgoing.writeHead(200, {
    'content-type': type,
    'content-length': data.length,
    'cache-control': type === 'font/woff2' ? 'public, max-age=31536000, immutable' : 'public, max-age=604800',
    'x-content-type-options': 'nosniff',
    ...SECURITY_HEADERS,
  });
  outgoing.end(method === 'HEAD' ? undefined : data);
  return true;
}

export function createAppServer({ env = process.env, sendMail, rateLimiter = createRateLimiter() } = {}) {
  const production = env.NODE_ENV === 'production';
  // Outside production the origin defaults to the address the server listens on, so the form works
  // on http://127.0.0.1:PORT and http://localhost:PORT alike (see localAlias below).
  const devHost = !env.HOST || ['0.0.0.0', '::', '127.0.0.1'].includes(env.HOST) ? '127.0.0.1' : env.HOST;
  const rawOrigin = env.PUBLIC_ORIGIN || (production ? '' : `http://${devHost.includes(':') ? `[${devHost}]` : devHost}:${env.PORT || 3000}`);
  let publicOrigin;
  try {
    const parsed = new URL(rawOrigin);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.pathname !== '/'
      || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error();
    publicOrigin = parsed.origin;
  } catch { throw new Error('Set PUBLIC_ORIGIN to your website origin, such as https://merchendice.com.'); }
  const runtimeEnv = { MAIL_TO: env.MAIL_TO || 'merchendices@gmail.com', sendMail };
  // TLS ends at the reverse proxy (Nginx Proxy Manager), so HTTPS handling is only on in production
  // with an https PUBLIC_ORIGIN, and never for localhost requests.
  const httpsOrigin = publicOrigin.startsWith('https:');
  const useHsts = production && httpsOrigin && env.HSTS !== '0';
  // Redirect only when a trusted proxy explicitly says the client used plain HTTP.
  // Requests without the header (direct health checks) are never redirected, so there is no loop.
  const forceHttps = production && httpsOrigin && env.TRUST_PROXY === '1' && env.FORCE_HTTPS !== '0';

  const server = createServer({ maxHeaderSize: 8192 }, async (incoming, outgoing) => {
    try {
      // In development, a request to localhost, 127.0.0.1 or [::1] is treated as coming from that
      // address, so the enquiry form's same-origin check passes whichever one the browser used.
      const hostHeader = String(incoming.headers.host || '');
      const localAlias = !production && !env.PUBLIC_ORIGIN && LOCAL_HOSTS.has(requestHostname(incoming)) && /^[\w.\[\]:-]+$/.test(hostHeader);
      const requestOrigin = localAlias ? `http://${hostHeader}` : publicOrigin;
      let url = null;
      try { url = new URL(incoming.url, `${requestOrigin}/`); } catch { url = null; }
      if (!url || url.origin !== new URL(requestOrigin).origin || !incoming.url.startsWith('/')) {
        incoming.resume();
        return sendJson(outgoing, 400, { message: invalidRequest });
      }
      const local = LOCAL_HOSTS.has(requestHostname(incoming));
      if (forceHttps && !local && String(incoming.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase() === 'http') {
        incoming.resume();
        outgoing.writeHead(301, { location: `${publicOrigin}${url.pathname}${url.search}`, 'cache-control': 'no-cache' });
        return outgoing.end();
      }
      if (useHsts && !local) outgoing.setHeader('strict-transport-security', HSTS_VALUE);
      const legacy = ['GET', 'HEAD'].includes(incoming.method) && legacyExampleRedirect(url.pathname);
      if (legacy) {
        outgoing.writeHead(301, { location: `${legacy}${url.search}`, 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff', ...SECURITY_HEADERS });
        return outgoing.end();
      }
      if (['GET', 'HEAD'].includes(incoming.method) && serveStatic(url.pathname, incoming.method, outgoing)) return;
      if (['GET', 'HEAD'].includes(incoming.method) && url.pathname === '/healthz') {
        outgoing.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        outgoing.end(incoming.method === 'HEAD' ? '' : '{"ok":true}');
        return;
      }
      if (incoming.method === 'POST' && url.pathname === '/api/enquiry') {
        if (incoming.headers.origin && incoming.headers.origin !== url.origin) {
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
      const responseHeaders = headerMap(response.headers);
      let responseBody = Buffer.from(await response.arrayBuffer());
      const type = String(responseHeaders['content-type'] || '');
      const compressible = incoming.method === 'GET' && responseBody.length > 256
        && /(text\/css|javascript)/i.test(type) && !responseHeaders['content-encoding'];
      if (compressible) {
        const encoding = preferredEncoding(incoming.headers['accept-encoding']);
        if (encoding === 'br') responseBody = brotliCompressSync(responseBody);
        else if (encoding === 'gzip') responseBody = gzipSync(responseBody);
        if (encoding) responseHeaders['content-encoding'] = encoding;
        responseHeaders.vary = responseHeaders.vary && !/accept-encoding/i.test(responseHeaders.vary)
          ? `${responseHeaders.vary}, Accept-Encoding`
          : (responseHeaders.vary || 'Accept-Encoding');
        delete responseHeaders['content-length'];
      }
      outgoing.writeHead(response.status, responseHeaders);
      outgoing.end(responseBody);
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
