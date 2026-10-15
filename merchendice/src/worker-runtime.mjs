const PLATFORM_OPTIONS = new Set(['YouTube', 'Instagram', 'TikTok', 'Other platforms']);
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

function textResponse(body, contentType, status = 200, { creatorExample = false } = {}) {
  const contentSecurityPolicy = creatorExample
    ? "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://images-api.printify.com; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'"
    : "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'";
  return new Response(body, {
    status,
    headers: {
      'content-type': contentType,
      'cache-control': 'no-cache',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'strict-origin-when-cross-origin',
      'x-frame-options': 'DENY',
      'content-security-policy': contentSecurityPolicy,
    },
  });
}

function validEmail(value) {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export default {
  async fetch(request, env = {}) {
    const url = new URL(request.url);
    const isCreatorExample = url.pathname === '/examplepage.com'
      || url.pathname.startsWith('/examplepage.com/');
    if (['GET', 'HEAD'].includes(request.method) && (ASSETS[url.pathname] || isCreatorExample)) {
      const asset = ASSETS[url.pathname] || ASSETS['/examplepage.com/'];
      return textResponse(request.method === 'HEAD' ? null : asset.body, asset.type, 200, { creatorExample: isCreatorExample });
    }
    if (request.method !== 'POST' || url.pathname !== '/api/enquiry') {
      return new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });
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

    const name = typeof input?.name === 'string' ? input.name.trim() : '';
    const email = typeof input?.email === 'string' ? input.email.trim() : '';
    const description = typeof input?.description === 'string' ? input.description.trim() : '';
    const platforms = Array.isArray(input?.platforms)
      ? [...new Set(input.platforms.filter((value) => PLATFORM_OPTIONS.has(value)))].slice(0, 4)
      : [];
    if (!name || name.length > 160 || !validEmail(email) || !description || description.length > 5000) {
      return json({ message: 'Please check your name, email and project description, then try again.' }, 400);
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
