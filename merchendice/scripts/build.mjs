import fs from 'node:fs/promises';

const assetFiles = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/examples/': ['examples/index.html', 'text/html; charset=utf-8'],
  '/examples': ['examples/index.html', 'text/html; charset=utf-8'],
  '/enquiry/': ['enquiry/index.html', 'text/html; charset=utf-8'],
  '/enquiry': ['enquiry/index.html', 'text/html; charset=utf-8'],
  '/examplepage.com/': ['examplepage.com/index.html', 'text/html; charset=utf-8'],
  '/examplepage.com': ['examplepage.com/index.html', 'text/html; charset=utf-8'],
  '/site.css': ['site.css', 'text/css; charset=utf-8'],
  '/site.js': ['site.js', 'text/javascript; charset=utf-8'],
  '/examples.js': ['examples.js', 'text/javascript; charset=utf-8'],
};
const assets = {};
for (const [route, [file, type]] of Object.entries(assetFiles)) {
  assets[route] = { body: await fs.readFile(file, 'utf8'), type };
}
const runtime = await fs.readFile('src/worker-runtime.mjs', 'utf8');
await fs.mkdir('dist', { recursive: true });
await fs.writeFile('dist/app.mjs', `const ASSETS = ${JSON.stringify(assets)};\n${runtime}`);
console.log('Built Merchendice site and enquiry endpoint.');
