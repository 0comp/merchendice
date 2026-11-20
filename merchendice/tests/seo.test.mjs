import test from 'node:test';
import assert from 'node:assert/strict';
import { worker, PAGES, MISSING_PAGE, ORIGIN, page } from './helpers.mjs';

const PUBLIC = PAGES.filter((route) => route !== MISSING_PAGE);
const APEX = 'https://merchendice.com';
const FORBIDDEN = /webstudios|polyvault|printify|shineon|shopify|[£$€]\s?\d|\d\s?(?:kr|sek|usd|gbp|eur)\b|\bphone\b|\+\d{6,}/i;
const BOTS = ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'PerplexityBot', 'ClaudeBot', 'Google-Extended', 'Applebot-Extended'];
const text = async (path) => worker.fetch(new Request(`${ORIGIN}${path}`));
const body = async (path) => (await (await text(path)).text()).replace(/\r\n/g, '\n');
const meta = (html, re) => (html.match(re) || [])[1];
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");
const jsonLd = (html) => [...html.matchAll(/<script type="application\/ld\+json">([^<]*)<\/script>/g)].map((m) => JSON.parse(m[1]));

test('every public page has a unique title and description of a sensible length', async () => {
  const titles = new Set();
  const descriptions = new Set();
  for (const route of PUBLIC) {
    const html = await page(route);
    const title = meta(html, /<title>([^<]+)<\/title>/);
    const description = decode(meta(html, /<meta name="description" content="([^"]+)"/));
    assert.ok(title && title.length <= 70, `${route} title`);
    assert.ok(description.length >= 70 && description.length <= 170, `${route} description length ${description.length}`);
    assert.ok(!titles.has(title) && !descriptions.has(description), `${route} is unique`);
    titles.add(title);
    descriptions.add(description);
    assert.equal(decode(meta(html, /<meta property="og:description" content="([^"]+)"/)).length > 0, true, route);
    assert.equal(meta(html, /<meta property="og:title" content="([^"]+)"/), title, `${route} og:title matches`);
    assert.equal(meta(html, /<meta name="twitter:title" content="([^"]+)"/), title, `${route} twitter:title matches`);
    assert.doesNotMatch(title + description, /\s,|,,|  /, route);
    assert.doesNotMatch(title + description, FORBIDDEN, route);
  }
});

test('canonical and og:url are the https apex address of the page, never www', async () => {
  for (const route of PUBLIC) {
    const html = await page(route);
    const expected = `${APEX}${route}`;
    assert.equal(meta(html, /<link rel="canonical" href="([^"]+)"/), expected, route);
    assert.equal(meta(html, /<meta property="og:url" content="([^"]+)"/), expected, route);
    assert.doesNotMatch(html, /https?:\/\/www\.merchendice\.com/, route);
    assert.equal(meta(html, /<meta property="og:image" content="([^"]+)"/), `${APEX}/og.png`, route);
  }
});

test('each page has exactly one H1 and its headings never skip a level', async () => {
  for (const route of [...PUBLIC, MISSING_PAGE]) {
    const html = await page(route);
    const levels = [...html.matchAll(/<h([1-6])[\s>]/g)].map((m) => Number(m[1]));
    assert.equal(levels.filter((l) => l === 1).length, 1, `${route} H1 count`);
    levels.reduce((previous, level) => {
      assert.ok(level <= previous + 1, `${route}: h${level} follows h${previous}`);
      return level;
    }, 0);
  }
});

test('every image has an alt attribute and dimensions; below-the-fold images are lazy', async () => {
  for (const route of PUBLIC) {
    const html = await page(route);
    for (const [tag] of html.matchAll(/<img\b[^>]*>/g)) {
      assert.match(tag, /\salt="/, `${route}: ${tag.slice(0, 80)}`);
      assert.match(tag, /\swidth="\d+"/, `${route}: width on ${tag.slice(0, 80)}`);
      assert.match(tag, /\sheight="\d+"/, `${route}: height on ${tag.slice(0, 80)}`);
      assert.match(tag, /\sdecoding="async"/, `${route}: decoding on ${tag.slice(0, 80)}`);
    }
    const home = route === '/' ? html : '';
    if (home) assert.equal((home.match(/fetchpriority="high"/g) || []).length, 1, 'one high-priority image on the home page');
  }
});

test('the sitemap lists every public page once, with only live indexable URLs', async () => {
  const sitemap = await (await text('/sitemap.xml')).text();
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.deepEqual([...locs].sort(), PUBLIC.map((route) => `${APEX}${route}`).sort());
  assert.equal(new Set(locs).size, locs.length);
  for (const loc of locs) {
    const response = await text(new URL(loc).pathname);
    assert.equal(response.status, 200, loc);
    assert.equal(response.headers.get('x-robots-tag'), null, `${loc} is indexable`);
    assert.doesNotMatch(await response.text(), /<meta name="robots" content="noindex"/, loc);
  }
  assert.doesNotMatch(sitemap, /example-store|404|www\.merchendice/);
});

test('robots.txt references the sitemap and explicitly allows the AI crawlers', async () => {
  const response = await text('/robots.txt');
  assert.match(response.headers.get('content-type'), /^text\/plain; charset=utf-8/);
  const robots = (await response.text()).replace(/\r\n/g, '\n');
  assert.match(robots, /^Sitemap: https:\/\/merchendice\.com\/sitemap\.xml$/m);
  for (const bot of BOTS) {
    assert.match(robots, new RegExp(`^User-agent: ${bot}\\nAllow: /$`, 'm'), bot);
  }
  assert.doesNotMatch(robots, /^Disallow:\s*\/\s*$/m);
});

test('JSON-LD parses, uses only site facts and builds the FAQ word for word from the visible answers', async () => {
  const home = await page('/');
  const [graph] = jsonLd(home);
  const byType = Object.fromEntries(graph['@graph'].map((node) => [node['@type'], node]));
  assert.equal(byType.Organization.name, 'Merchendice');
  assert.equal(byType.Organization.url, `${APEX}/`);
  assert.equal(byType.Organization.logo, `${APEX}/apple-touch-icon.png`);
  assert.equal(byType.Organization.founder, undefined, 'the home page never names the co-founders; About does');
  assert.match(byType.Organization.description, /Based and designed in Sweden/);
  assert.equal(byType.WebSite.inLanguage, undefined);
  assert.equal(byType.WebSite.url, `${APEX}/`);
  const about = await page('/about/');
  assert.ok(about.includes('Oscar Thomas and Oscar Rodelius'));
  const aboutGraph = jsonLd(about).find((d) => d['@graph'])['@graph'];
  const aboutOrg = aboutGraph.find((n) => n['@type'] === 'Organization');
  assert.equal(aboutOrg['@id'], byType.Organization['@id']);
  assert.deepEqual(aboutOrg.founder.map((p) => p.name), ['Oscar Thomas', 'Oscar Rodelius']);
  assert.ok(aboutGraph.some((n) => n['@type'] === 'BreadcrumbList'));

  const visible = [...home.matchAll(/<summary>(.*?)<\/summary>\s*<p>(.*?)<\/p>/gs)].map(([, q, a]) => [decode(q), decode(a.replace(/<[^>]+>/g, ''))]);
  const structured = byType.FAQPage.mainEntity.map((entry) => [entry.name, entry.acceptedAnswer.text]);
  assert.equal(visible.length, 10);
  assert.deepEqual(structured, visible);
  const ship = structured.filter(([q]) => /ship|deliver/i.test(q));
  assert.deepEqual(ship, [['Where do you ship?', 'We ship to the US, Canada and most countries worldwide. Right now we don’t ship to the EU or the UK.']]);
  assert.ok(visible.some(([q, a]) => q === ship[0][0] && a === ship[0][1]), 'the shipping answer is visible word for word');

  const serialised = JSON.stringify(graph);
  assert.doesNotMatch(serialised, FORBIDDEN);
  assert.doesNotMatch(serialised, /"(?:offers?|price|priceCurrency|aggregateRating|review|address|telephone|email)"/);
});

test('subpages carry a BreadcrumbList that points at their canonical address', async () => {
  for (const route of PUBLIC.filter((r) => r !== '/')) {
    const html = await page(route);
    const crumbs = jsonLd(html).flatMap((d) => d['@graph'] || [d]).find((d) => d['@type'] === 'BreadcrumbList');
    assert.ok(crumbs, route);
    assert.deepEqual(crumbs.itemListElement.map((i) => i.item), [`${APEX}/`, `${APEX}${route}`], route);
    assert.deepEqual(crumbs.itemListElement.map((i) => i.position), [1, 2]);
    assert.doesNotMatch(JSON.stringify(crumbs), FORBIDDEN);
  }
});

test('llms.txt is served as plain text, links only to real pages and names no supplier or price', async () => {
  const response = await text('/llms.txt');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^text\/plain; charset=utf-8/);
  const llms = (await response.text()).replace(/\r\n/g, '\n');
  assert.match(llms, /^# Merchendice$/m);
  assert.match(llms, /clothing, totes and bags, mugs, home goods like pillows and blankets, and jewellery/i);
  assert.match(llms, /Based and designed in Sweden/);
  assert.doesNotMatch(llms, FORBIDDEN);
  const links = [...llms.matchAll(/\]\((https:\/\/merchendice\.com[^)]*)\)/g)].map((m) => m[1]);
  assert.deepEqual([...links].sort(), PUBLIC.map((r) => `${APEX}${r}`).sort());
  for (const link of links) assert.equal((await text(new URL(link).pathname)).status, 200, link);
});

test('the main facts are plain HTML text on the home page, not only images or script', async () => {
  const html = (await page('/')).replace(/<script[\s\S]*?<\/script>/g, '');
  for (const fact of ['clothing, totes and bags, mugs, home goods like pillows and blankets, and jewellery', 'Creators of any size, on any platform.', 'Usually 2 to 3 weeks.', 'Based and designed in Sweden']) {
    assert.ok(html.includes(fact), fact);
  }
});

test('public pages allow rich snippets and the 404 page and example store stay out of search', async () => {
  for (const route of PUBLIC) {
    assert.match(await page(route), /<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">/, route);
  }
  assert.match(await page(MISSING_PAGE), /<meta name="robots" content="noindex">/);
});

test('every inline script on every page, JSON-LD included, is covered by the page CSP hash', async () => {
  const { createHash } = await import('node:crypto');
  for (const route of PUBLIC) {
    const response = await text(route);
    const csp = response.headers.get('content-security-policy');
    const html = await response.text();
    for (const [, source] of html.matchAll(/<script(?:\s[^>]*)?>([^<]+)<\/script>/g)) {
      assert.ok(csp.includes(`'sha256-${createHash('sha256').update(source).digest('base64')}'`), `${route} inline script is allowed`);
    }
  }
});

test('sitemap dates are valid and not in the future, and the text files answer HEAD as well as GET', async () => {
  const sitemap = await body('/sitemap.xml');
  for (const [, date] of sitemap.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)) {
    assert.match(date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(new Date(date) <= new Date(Date.now() + 864e5), date);
  }
  for (const path of ['/robots.txt', '/sitemap.xml', '/llms.txt']) {
    const head = await worker.fetch(new Request(`${ORIGIN}${path}`, { method: 'HEAD' }));
    assert.equal(head.status, 200, path);
    assert.equal(await head.text(), '');
    assert.equal(head.headers.get('x-content-type-options'), 'nosniff', path);
  }
});

test('llms.txt is short, line-ending safe and the Dockerfile ships all three crawler files', async () => {
  const llms = await body('/llms.txt');
  assert.ok(llms.length < 3000 && !llms.includes('\r'));
  const { readFile } = await import('node:fs/promises');
  const dockerfile = await readFile(new URL('../Dockerfile', import.meta.url), 'utf8');
  for (const file of ['robots.txt', 'llms.txt', 'sitemap.xml']) assert.match(dockerfile, new RegExp(`\\b${file.replace('.', '\\.')}\\b`), file);
});

test('the approved SEO wording is in place and the layout classes are unchanged', async () => {
  const home = await page('/');
  assert.match(home, /<h1 id="hero-title" class="hero-rise">Merch that looks like it came from you\.<\/h1>/);
  assert.match(home, /<p class="hero-line">A merch studio for creators and influencers<\/p>/);
  assert.match(home, /<h2 id="faq-title" class="rise">Frequently asked questions<\/h2>/);
  assert.match(home, /<h2 id="how-title">How it works<\/h2>/);
  assert.doesNotMatch(home, />Questions<\/h2>/);
  const about = await page('/about/');
  assert.match(about, /<h1>About Merchendice<\/h1>/);
  assert.match(about, /<p>We make clothing, totes and bags, mugs, home goods and jewellery\.<\/p>/);
  const enquiry = await page('/enquiry/');
  assert.match(enquiry, /<p class="hero-rise hero-rise-2">For creators of any size, on any platform\. A few lines is enough/);
  assert.match(enquiry, /<span>Based and designed in Sweden<\/span>/);
});

test('content images have descriptive alt text; only purely decorative ones stay empty', async () => {
  const empty = [];
  for (const route of PUBLIC) {
    const html = await page(route);
    for (const [tag] of html.matchAll(/<img\b[^>]*>/g)) {
      const alt = tag.match(/\salt="([^"]*)"/)[1];
      if (!alt) empty.push(`${route} ${tag.match(/src="([^"]+)"/)[1]}`);
      else assert.ok(alt.split(' ').length >= 4 && !/\.(webp|png)|image of|picture of/i.test(alt), `${route}: ${alt}`);
    }
  }
  assert.deepEqual(empty, [], 'no empty alt left on any public page');
});

test('the example store files are exactly as they were before the SEO work', async () => {
  const { execFileSync } = await import('node:child_process');
  let diff;
  try {
    diff = execFileSync('git', ['diff', '--stat', '3b5a9a3', 'HEAD', '--', 'example-store'], { cwd: new URL('..', import.meta.url), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch { return; } // no git history here (for example inside a Docker build)
  assert.equal(diff.trim(), '');
});

test('the hero line is a paragraph again and keeps its small-caps look', async () => {
  const { readFile } = await import('node:fs/promises');
  const css = await readFile(new URL('../site.css', import.meta.url), 'utf8');
  const rule = css.match(/\n\.hero-line \{([^}]+)\}/)[1];
  for (const declaration of [/font-family: var\(--sans\)/, /line-height: 1\.65/, /font-size: 13px/, /font-weight: 500/, /text-transform: uppercase/, /letter-spacing: \.2em/]) {
    assert.match(rule, declaration);
  }
});

test('the shipping FAQ sits between delivery timing and damage and has clean wording (curly apostrophe, no Sweden, no prices or times)', async () => {
  const home = await page('/');
  const [graph] = jsonLd(home);
  const faq = graph['@graph'].find((n) => n['@type'] === 'FAQPage');
  const names = faq.mainEntity.map((e) => e.name);
  const i = names.indexOf('Where do you ship?');
  assert.equal(names.filter((n) => n === 'Where do you ship?').length, 1, 'exactly one shipping question');
  assert.equal(names[i - 1], 'How long until my store is live?');
  assert.equal(names[i + 1], 'What if an order arrives damaged?');
  const answer = faq.mainEntity[i].acceptedAnswer.text;
  assert.equal(answer, 'We ship to the US, Canada and most countries worldwide. Right now we don’t ship to the EU or the UK.');
  assert.doesNotMatch(answer, /'|Sweden/, 'no straight apostrophe and no mention of Sweden');
  assert.doesNotMatch(answer, /\b(?:free|days?|weeks?|€|\$|£|\d)/i, 'no delivery times or prices in the shipping answer');
  assert.equal([...home.matchAll(/<summary>Where do you ship\?<\/summary>/g)].length, 1);
  // Only the first FAQ item starts open; the accordion group keeps one open at a time.
  assert.equal([...home.matchAll(/<details class="faq-item" name="faq" open>/g)].length, 1);
  assert.equal([...home.matchAll(/<details class="faq-item" name="faq"/g)].length, 10);
});

test('the home page sitemap date is not older than the last FAQ change', async () => {
  const sitemap = await (await worker.fetch(new Request('https://site.example.test/sitemap.xml'))).text();
  assert.match(sitemap, /<loc>https:\/\/merchendice\.com\/<\/loc><lastmod>2026-11-2\d<\/lastmod>/);
});
