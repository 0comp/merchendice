import { Buffer } from 'node:buffer';

const validAddress = (value) => typeof value === 'string'
  && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

// Header values never contain CR, LF or other control characters, and are capped in length,
// so nothing can add or split an email header.
export function headerSafe(value, max = 200) {
  return String(value ?? '').replace(/[\u0000-\u001F\u007F]+/g, ' ').replace(/ {2,}/g, ' ').trim().slice(0, max);
}

function requireAddress(value, label) {
  if (!validAddress(value)) throw new Error(`${label} must be a valid email address.`);
  return value;
}

export function makeGmailMessage(message, from) {
  const to = requireAddress(message.to, 'MAIL_TO');
  const replyTo = requireAddress(message.replyTo, 'Reply address');
  requireAddress(from, 'COMPOSIO_FROM_EMAIL');
  // Addresses and the subject are controlled by the server. The reply address comes from the form,
  // but it is validated (no whitespace) and passed through headerSafe as a second guard.
  const subject = headerSafe(message.subject || 'New Merchendice enquiry', 150);
  const content = Buffer.from(message.text, 'utf8').toString('base64').match(/.{1,76}/g).join('\r\n');
  return Buffer.from([
    `From: Merchendice <${headerSafe(from, 254)}>`,
    `To: ${headerSafe(to, 254)}`,
    `Reply-To: ${headerSafe(replyTo, 254)}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    content,
    '',
  ].join('\r\n'), 'utf8').toString('base64url');
}

export async function createEmailSender(env, { fetchImpl = (...args) => fetch(...args), smtpTransport } = {}) {
  const provider = env.EMAIL_PROVIDER || 'composio';
  if (!['composio', 'smtp'].includes(provider)) throw new Error('EMAIL_PROVIDER must be composio or smtp.');
  requireAddress(env.MAIL_TO, 'MAIL_TO');

  if (provider === 'composio') {
    if (!env.COMPOSIO_API_KEY || !env.COMPOSIO_CONNECTED_ACCOUNT_ID) return null;
    const from = requireAddress(env.COMPOSIO_FROM_EMAIL, 'COMPOSIO_FROM_EMAIL');
    return async (message, { signal } = {}) => {
      const response = await fetchImpl('https://backend.composio.dev/api/v3.1/tools/execute/proxy', {
        method: 'POST',
        headers: { 'x-api-key': env.COMPOSIO_API_KEY, 'content-type': 'application/json' },
        signal,
        body: JSON.stringify({
          connected_account_id: env.COMPOSIO_CONNECTED_ACCOUNT_ID,
          endpoint: '/gmail/v1/users/me/messages/send',
          method: 'POST',
          body: { raw: makeGmailMessage({ ...message, to: env.MAIL_TO }, from) },
          parameters: [{ name: 'Content-Type', value: 'application/json', in: 'header' }],
        }),
      });
      const receipt = await response.json().catch(() => null);
      if (!response.ok || !receipt || !Number.isInteger(receipt.status) || receipt.status < 200 || receipt.status >= 300
        || typeof receipt.data?.id !== 'string' || !receipt.data.id) {
        throw new Error('Email provider did not confirm delivery.');
      }
      return { id: receipt.data.id };
    };
  }

  if (!env.SMTP_USER || !env.SMTP_APP_PASSWORD) return null;
  const from = requireAddress(env.SMTP_USER, 'SMTP_USER');
  const transport = smtpTransport || (await import('nodemailer')).default.createTransport({
    service: 'gmail',
    auth: { user: from, pass: env.SMTP_APP_PASSWORD.replace(/\s/g, '') },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
  return async (message, { signal } = {}) => {
    signal?.throwIfAborted();
    const receipt = await transport.sendMail({
      text: String(message.text ?? ''),
      subject: headerSafe(message.subject || 'New Merchendice enquiry', 150),
      replyTo: headerSafe(requireAddress(message.replyTo, 'Reply address'), 254),
      from: `Merchendice <${from}>`,
      to: env.MAIL_TO,
    });
    if (!receipt?.messageId || !receipt.accepted?.includes(env.MAIL_TO)) {
      throw new Error('Email provider did not accept the enquiry.');
    }
    return { id: receipt.messageId };
  };
}
