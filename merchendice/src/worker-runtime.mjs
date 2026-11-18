const PLATFORM_OPTIONS = new Set(['YouTube', 'Instagram', 'TikTok', 'Other platforms']);
const OPTIONAL_LINES = [
  ['youtube', 'YouTube'],
  ['instagram', 'Instagram'],
  ['tiktok', 'TikTok'],
  ['otherPlatforms', 'Other platforms'],
];
const SLASH_REDIRECTS = new Set(['/enquiry', '/examples', '/privacy', '/example-store']);
const MAX_ENQUIRY_BYTES = 40000;

async function readEnquiry(request) {
  if (Number(request.headers.get('content-length')) > MAX_ENQUIRY_BYTES) throw new RangeError();
  const reader = request.body?.getReader();
  if (!reader) throw new SyntaxError();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_ENQUIRY_BYTES) {
        await reader.cancel();
        throw new RangeError();
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function decodeAsset(asset) {
  if (asset.encoding !== 'base64') return asset.body;
  const binary = atob(asset.body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function textResponse(body, contentType, status = 200, { creatorExample = false, scriptSrcExtra = '', cacheControl = 'no-cache' } = {}) {
  const contentSecurityPolicy = creatorExample
    ? "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://images-api.printify.com; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'"
    : `default-src 'self'; script-src 'self'${scriptSrcExtra}; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'`;
  return new Response(body, {
    status,
    headers: {
      'content-type': contentType,
      'cache-control': cacheControl,
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'strict-origin-when-cross-origin',
      'x-frame-options': 'DENY',
      'content-security-policy': contentSecurityPolicy,
    },
  });
}

function redirect(location) {
  return new Response(null, {
    status: 301,
    headers: {
      location,
      'cache-control': 'no-cache',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'strict-origin-when-cross-origin',
    },
  });
}

function validEmail(value) {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function honeypotTripped(input) {
  if (!input || typeof input !== 'object') return false;
  const value = input.website;
  if (typeof value === 'string') return value.trim() !== '';
  return value != null;
}

function optionalLine(value) {
  if (value == null || value === '') return '';
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed.length > 500) return undefined;
  return trimmed.replace(/[\u0000-\u001F\u007F]+/g, ' ').replace(/ {2,}/g, ' ').trim();
}

export default {
  async fetch(request, env = {}) {
    const url = new URL(request.url);
    if (['GET', 'HEAD'].includes(request.method) && SLASH_REDIRECTS.has(url.pathname)) {
      return redirect(`${url.pathname}/${url.search}`);
    }
    const isCreatorExample = url.pathname.startsWith('/example-store/');
    if (['GET', 'HEAD'].includes(request.method) && (ASSETS[url.pathname] || isCreatorExample)) {
      const asset = ASSETS[url.pathname] || ASSETS['/example-store/'];
      return textResponse(request.method === 'HEAD' ? null : decodeAsset(asset), asset.type, 200, {
        creatorExample: isCreatorExample,
        scriptSrcExtra: asset.scriptSrcExtra || '',
      });
    }
    if (request.method !== 'POST' || url.pathname !== '/api/enquiry') {
      if (['GET', 'HEAD'].includes(request.method) && !url.pathname.startsWith('/api/')) {
        return textResponse(request.method === 'HEAD' ? null : NOT_FOUND_PAGE, 'text/html; charset=utf-8', 404, { cacheControl: 'no-store' });
      }
      return new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store', 'content-type': 'text/plain; charset=utf-8' } });
    }

    const origin = request.headers.get('origin');
    if (origin && origin !== url.origin) return json({ message: 'Please submit the form from this website.' }, 403);
    let input;
    try { input = await readEnquiry(request); }
    catch (error) {
      return error instanceof RangeError
        ? json({ message: 'Your enquiry is too long. Please shorten it and try again.' }, 413)
        : json({ message: 'Please check the form and try again.' }, 400);
    }

    if (honeypotTripped(input)) return json({ ok: true });

    const name = typeof input?.name === 'string' ? input.name.trim() : '';
    const email = typeof input?.email === 'string' ? input.email.trim() : '';
    const description = typeof input?.description === 'string' ? input.description.trim() : '';
    const platforms = Array.isArray(input?.platforms)
      ? [...new Set(input.platforms.filter((value) => PLATFORM_OPTIONS.has(value)))].slice(0, 4)
      : [];
    if (!name || name.length > 160 || !validEmail(email) || !description || description.length > 5000) {
      return json({ message: 'Please check your name, email and project description, then try again.' }, 400);
    }
    const handles = {};
    for (const [key] of OPTIONAL_LINES) {
      const line = optionalLine(input?.[key]);
      if (line === undefined) return json({ message: 'Please check the channel links or handles and try again.' }, 400);
      handles[key] = line;
    }

    if (typeof env.sendMail !== 'function' || !env.MAIL_TO) {
      return json({ message: 'Enquiries are not available right now. Please try again later.' }, 503);
    }

    const body = [
      'New creator merch enquiry',
      '',
      `Name: ${name}`,
      `Email: ${email}`,
      `Where to find them: ${platforms.length ? platforms.join(', ') : 'Not provided'}`,
      ...OPTIONAL_LINES.map(([key, label]) => `${label}: ${handles[key] || 'Not provided'}`),
      '',
      'Project description:',
      description,
    ].join('\n');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);
    try {
      const pendingSend = env.sendMail({
        to: env.MAIL_TO,
        replyTo: email,
        subject: 'New Merchendice enquiry',
        text: body,
      }, { signal: controller.signal });
      const receipt = await Promise.race([
        pendingSend,
        new Promise((_, reject) => controller.signal.addEventListener('abort', () => {
          reject(new DOMException('Email confirmation timed out', 'AbortError'));
        }, { once: true })),
      ]);
      if (!receipt || typeof receipt.id !== 'string' || !receipt.id) return json({ message: 'We couldn’t confirm that your enquiry was sent. Please try again later.' }, 502);
      return json({ ok: true });
    } catch (error) {
      return error.name === 'AbortError'
        ? json({ message: 'We couldn’t confirm whether your enquiry was sent. Please try again later.' }, 504)
        : json({ message: 'We couldn’t connect to our email service. Please try again later.' }, 502);
    } finally { clearTimeout(timeout); }
  },
};
