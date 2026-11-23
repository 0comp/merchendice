// Shared by every test file, and imported before anything that reads dist/app.mjs.
// Loading it rebuilds dist/app.mjs from the source pages, so `node --test tests/*.test.mjs` (or a single
// test file) can never pass against a stale build. The build writes atomically, so parallel files are safe.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const siteDir = fileURLToPath(new URL('..', import.meta.url));
execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: siteDir, stdio: ['ignore', 'ignore', 'inherit'] });

// Imported only after the build above, so this is always the fresh bundle.
export const { default: worker } = await import('../dist/app.mjs');

export const ORIGIN = 'https://site.example.test';
export const MISSING_PAGE = '/missing-page';
// Every marketing page, plus the branded 404 page. The example store is separate and is not edited.
export const CORE_PAGES = ['/', '/examples/', '/enquiry/', '/privacy/', '/about/', MISSING_PAGE];
export const PAGES = ['/', '/examples/', '/enquiry/', '/privacy/', '/about/', '/guides/', '/guides/start-merch-small-youtuber/', MISSING_PAGE];

export const expectedStatus = (route) => (route === MISSING_PAGE ? 404 : 200);

// Fetches a page from the built worker, checks it has the status it should (404 for the missing page,
// 200 for the rest) and returns its HTML.
export async function page(route, init) {
  const response = await worker.fetch(new Request(`${ORIGIN}${route}`, init));
  assert.equal(response.status, expectedStatus(route), `${route} status`);
  return response.text();
}
