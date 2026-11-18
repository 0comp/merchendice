import crypto from 'node:crypto';
import fs from 'node:fs/promises';

const pages = {
  '/': 'index.html',
  '/examples/': 'examples/index.html',
  '/enquiry/': 'enquiry/index.html',
  '/privacy/': 'privacy/index.html',
  '/example-store/': 'example-store/index.html',
};
// Stylesheets and scripts get a content hash in their URL, so browsers can cache them for a year.
// The plain names stay available (revalidated on every request) for anything that links to them directly.
const hashed = {
  '/site.css': ['site.css', 'text/css; charset=utf-8'],
  '/site.js': ['site.js', 'text/javascript; charset=utf-8'],
  '/example-store/store.css': ['example-store/store.css', 'text/css; charset=utf-8'],
  '/example-store/store.js': ['example-store/store.js', 'text/javascript; charset=utf-8'],
};
const textFiles = {
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
const fingerprinted = {};
for (const [route, [file, type]] of Object.entries(hashed)) {
  const body = await fs.readFile(file, 'utf8');
  const hash = crypto.createHash('sha256').update(body).digest('hex').slice(0, 10);
  const dot = route.lastIndexOf('.');
  const hashedRoute = `${route.slice(0, dot)}.${hash}${route.slice(dot)}`;
  fingerprinted[route] = hashedRoute;
  assets[route] = { body, type };
  assets[hashedRoute] = { body, type, immutable: true };
}

// Point every page at the hashed URLs, whatever relative form the source uses.
function linkHashed(html) {
  return html.replace(/(href|src)="((?:\.\.\/|\/)?)(site\.css|site\.js|store\.css|store\.js)"/g, (all, attr, prefix, name) => {
    const route = name.startsWith('store.') ? `/example-store/${name}` : `/${name}`;
    return `${attr}="${fingerprinted[route]}"`;
  });
}

for (const [route, file] of Object.entries(pages)) {
  const body = linkHashed(await fs.readFile(file, 'utf8')).replace(/\n?[ \t]*<!--[\s\S]*?-->/g, '');
  assets[route] = { body, type: 'text/html; charset=utf-8', scriptSrcExtra: structuredDataAllowance(body) };
}
for (const [route, [file, type]] of Object.entries(textFiles)) {
  assets[route] = { body: await fs.readFile(file, 'utf8'), type };
}
for (const [route, [file, type]] of Object.entries(binaryFiles)) {
  assets[route] = { body: (await fs.readFile(file)).toString('base64'), type, encoding: 'base64' };
}
const notFoundPage = linkHashed(await fs.readFile('404.html', 'utf8')).replace(/\n?[ \t]*<!--[\s\S]*?-->/g, '');
const runtime = await fs.readFile('src/worker-runtime.mjs', 'utf8');
await fs.mkdir('dist', { recursive: true });
await fs.writeFile('dist/app.mjs', `const ASSETS = ${JSON.stringify(assets)};\nconst NOT_FOUND_PAGE = ${JSON.stringify(notFoundPage)};\n${runtime}`);
console.log('Built Merchendice site and enquiry endpoint.');
