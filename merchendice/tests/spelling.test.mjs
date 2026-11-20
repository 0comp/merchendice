import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// helpers.mjs rebuilds dist/app.mjs first, so the dist/ scan below always reads a fresh build.
import { PAGES, worker } from './helpers.mjs';

// Built from two halves so this file never contains the misspelling itself.
const misspelling = new RegExp('Rod' + 'helius', 'i');
const site = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(site, '..');
const textFile = /\.(html?|m?js|json|jsonld|md|txt|xml|css|svg|webmanifest|ya?ml|conf)$|^(Caddyfile|Dockerfile)$/;

async function* walk(dir) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (['node_modules', '.git'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (textFile.test(entry.name)) yield full;
  }
}

test('the co-founder is always spelled Rodelius, never Rod' + 'helius', async () => {
  // Every served page, including the 404 page and the example store, plus the text assets they load.
  const routes = [...PAGES, '/example-store/', '/robots.txt', '/sitemap.xml', '/site.js', '/site.css'];
  const missing = await worker.fetch(new Request('https://site.example.test/missing-page'));
  assert.equal(missing.status, 404, 'the 404 page is actually served');
  for (const route of routes) {
    const body = await (await worker.fetch(new Request(`https://site.example.test${route}`))).text();
    assert.ok(body.length > 0, `${route} returned a body`);
    assert.doesNotMatch(body, misspelling, route);
  }
  // The built output and every source text file: HTML, JS, JSON-LD and meta inside the HTML, READMEs, docs, config.
  const files = [];
  for await (const file of walk(site)) files.push(file);
  files.push(path.join(repo, 'README.md'));
  assert.ok(files.some(file => file.startsWith(path.join(site, 'dist'))), 'dist/ is scanned');
  assert.ok(files.includes(path.join(site, '404.html')), '404.html is scanned');
  for (const file of files) {
    assert.doesNotMatch(await fs.readFile(file, 'utf8'), misspelling, path.relative(repo, file));
  }
  // The correct name must still be on the About page, so it can't silently disappear.
  const about = await (await worker.fetch(new Request('https://site.example.test/about/'))).text();
  assert.match(about, /Oscar Rodelius/);
});
