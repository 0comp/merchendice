import crypto from 'node:crypto';
import fs from 'node:fs/promises';

const textFiles = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/examples/': ['examples/index.html', 'text/html; charset=utf-8'],
  '/enquiry/': ['enquiry/index.html', 'text/html; charset=utf-8'],
  '/privacy/': ['privacy/index.html', 'text/html; charset=utf-8'],
  '/examplepage.com/': ['examplepage.com/index.html', 'text/html; charset=utf-8'],
  '/examplepage.com': ['examplepage.com/index.html', 'text/html; charset=utf-8'],
  '/site.css': ['site.css', 'text/css; charset=utf-8'],
  '/site.js': ['site.js', 'text/javascript; charset=utf-8'],
  '/examples.js': ['examples.js', 'text/javascript; charset=utf-8'],
  '/favicon.svg': ['favicon.svg', 'image/svg+xml'],
  '/robots.txt': ['robots.txt', 'text/plain; charset=utf-8'],
  '/sitemap.xml': ['sitemap.xml', 'application/xml; charset=utf-8'],
};
const binaryFiles = {
  '/favicon.ico': ['favicon.ico', 'image/x-icon'],
  '/apple-touch-icon.png': ['apple-touch-icon.png', 'image/png'],
  '/og.png': ['og.png', 'image/png'],
};

function structuredDataAllowance(html) {
  const match = html.match(/<script type="application\/ld\+json">([^<]*)<\/script>/);
  if (!match) return '';
  return ` 'sha256-${crypto.createHash('sha256').update(match[1]).digest('base64')}'`;
}

const assets = {};
for (const [route, [file, type]] of Object.entries(textFiles)) {
  const body = await fs.readFile(file, 'utf8');
  assets[route] = { body, type, scriptSrcExtra: structuredDataAllowance(body) };
}
for (const [route, [file, type]] of Object.entries(binaryFiles)) {
  assets[route] = { body: (await fs.readFile(file)).toString('base64'), type, encoding: 'base64' };
}
const notFoundPage = await fs.readFile('404.html', 'utf8');
const runtime = await fs.readFile('src/worker-runtime.mjs', 'utf8');
await fs.mkdir('dist', { recursive: true });
await fs.writeFile('dist/app.mjs', `const ASSETS = ${JSON.stringify(assets)};\nconst NOT_FOUND_PAGE = ${JSON.stringify(notFoundPage)};\n${runtime}`);
console.log('Built Merchendice site and enquiry endpoint.');
