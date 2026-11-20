import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { worker, PAGES } from './helpers.mjs';

const pngSize = (buf) => [buf.readUInt32BE(16), buf.readUInt32BE(20)];

test('the favicon is the cream M on a charcoal tile, with no terracotta tile', async () => {
  const svg = await fs.readFile(new URL('../favicon.svg', import.meta.url), 'utf8');
  assert.match(svg, /<rect[^>]*fill="#2B2A28"/i);
  assert.match(svg, /stroke="#f6eee2"/i);
  assert.match(svg, /<path d="M9 29V11h1\.6L20 24\.5 29\.4 11H31v18"/);
  assert.doesNotMatch(svg, /#B03A26/i);
});

test('apple-touch-icon is a 180 px PNG and favicon.ico holds 16, 32 and 48 px PNG frames', async () => {
  const apple = await fs.readFile(new URL('../apple-touch-icon.png', import.meta.url));
  assert.deepEqual(pngSize(apple), [180, 180]);
  const ico = await fs.readFile(new URL('../favicon.ico', import.meta.url));
  assert.equal(ico.readUInt16LE(2), 1);
  const count = ico.readUInt16LE(4);
  const sizes = [];
  for (let i = 0; i < count; i++) {
    const e = 6 + i * 16;
    sizes.push(ico[e] || 256);
    const frame = ico.subarray(ico.readUInt32LE(e + 12), ico.readUInt32LE(e + 12) + ico.readUInt32LE(e + 8));
    assert.deepEqual(pngSize(frame), [ico[e] || 256, ico[e + 1] || 256]);
  }
  assert.deepEqual(sizes.sort((a, b) => a - b), [16, 32, 48]);
});

test('every page links the three icons with sizes and a version, and each linked file is served', async () => {
  for (const route of PAGES) {
    const html = await (await worker.fetch(new Request(`https://site.example.test${route}`))).text();
    assert.match(html, /<link rel="icon" href="\/favicon\.ico\?v=3" sizes="48x48">/, route);
    assert.match(html, /<link rel="icon" type="image\/svg\+xml" sizes="any" href="\/favicon\.svg\?v=3">/, route);
    assert.match(html, /<link rel="apple-touch-icon" sizes="180x180" href="\/apple-touch-icon\.png\?v=3">/, route);
  }
  for (const [url, type] of [['/favicon.svg?v=3', /svg/], ['/favicon.ico?v=3', /icon/], ['/apple-touch-icon.png?v=3', /png/]]) {
    const res = await worker.fetch(new Request(`https://site.example.test${url}`));
    assert.equal(res.status, 200, url);
    assert.match(res.headers.get('content-type'), type, url);
  }
});
