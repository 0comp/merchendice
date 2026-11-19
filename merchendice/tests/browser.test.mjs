// Checks that need a real browser: final computed corner radii, and the sent dialog's keyboard and
// mouse behaviour. Runs the real server against a fresh build (helpers.mjs) in headless Chrome.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PAGES } from './helpers.mjs';
import { browserTestOptions, launchBrowser } from './browser.mjs';

const { createAppServer, createRateLimiter } = await import('../server.mjs');

async function startServer(t) {
  let sends = 0;
  const server = createAppServer({
    env: { NODE_ENV: 'test', MAIL_TO: 'inbox@example.test' },
    sendMail: async () => { sends++; return { id: `receipt-${sends}` }; },
    rateLimiter: createRateLimiter({ limit: 100 }),
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  return { base: `http://127.0.0.1:${server.address().port}`, sends: () => sends };
}

async function startBrowser(t) {
  const browser = await launchBrowser();
  t.after(() => browser.close());
  return browser;
}

// Every button-like control: real <button>s, .button links, the header Contact us link and submit inputs.
const CONTROLS = 'button, .button, .nav-cta, input[type="submit"], input[type="button"], [role="button"]';
const RADII = ['border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius'];

test('every button on every page, the 404 page included, has 4px corners in the browser, in every state', browserTestOptions(), async (t) => {
  const { base } = await startServer(t);
  const browser = await startBrowser(t);
  const seen = new Set();
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    const tab = await browser.newPage(viewport);
    await tab.send('DOM.enable');
    await tab.send('CSS.enable');
    for (const route of PAGES) {
      await tab.goto(`${base}${route}`);
      // Open the sent dialog so its Close button is rendered and checked too.
      if (route === '/enquiry/') await tab.evaluate(`document.getElementById('sentDialog').showModal()`);
      const { root } = await tab.send('DOM.getDocument', { depth: -1 });
      const { nodeIds } = await tab.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: CONTROLS });
      assert.ok(nodeIds.length >= 2, `${route} has buttons to check`);
      let drawn = 0;
      // Plain, then forced into hover, focus, focus-visible and active, so no state rule can change the corners.
      for (const states of [[], ['hover'], ['focus', 'focus-visible'], ['active', 'hover']]) {
        for (const nodeId of nodeIds) await tab.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: states });
        const wrong = [];
        for (const nodeId of nodeIds) {
          // Only controls that are actually drawn at this width (the menu toggle is mobile-only).
          const { model } = await tab.send('DOM.getBoxModel', { nodeId }).catch(() => ({}));
          if (!model || !model.width || !model.height) continue;
          const { computedStyle } = await tab.send('CSS.getComputedStyleForNode', { nodeId });
          const style = Object.fromEntries(computedStyle.map(({ name, value }) => [name, value]));
          const { outerHTML } = await tab.send('DOM.getOuterHTML', { nodeId });
          const tag = outerHTML.slice(0, outerHTML.indexOf('>') + 1);
          drawn++;
          seen.add(tag.replace(/ aria-current="page"| href="[^"]*"/g, ''));
          for (const corner of RADII) {
            if (style[corner] !== '4px') wrong.push(`${tag} ${corner}: ${style[corner]}`);
          }
        }
        assert.deepEqual(wrong, [], `${route} at ${viewport.width}px ${states.join('+') || 'at rest'}`);
        assert.ok(drawn >= 1, `${route} at ${viewport.width}px: ${drawn} drawn buttons checked`);
        drawn = 0;
      }
    }
    await tab.close();
  }
  // The checks really reached the controls the audit named.
  for (const expected of ['<a class="nav-cta">', '<button class="nav-toggle"', '<button class="button button-primary button-submit" type="submit">', '<button class="button button-primary" type="button" data-dialog-close="">']) {
    assert.ok([...seen].some((tag) => tag.startsWith(expected)), `checked ${expected}`);
  }
});

test('the sent dialog closes with Esc, the Close button or the backdrop, and focus returns to the submit button', browserTestOptions(), async (t) => {
  const server = await startServer(t);
  const browser = await startBrowser(t);
  const tab = await browser.newPage({ width: 1280, height: 900 });
  await tab.goto(`${server.base}/enquiry/`);
  const state = () => tab.evaluate(`(() => {
    const dialog = document.getElementById('sentDialog');
    const active = document.activeElement;
    return {
      open: dialog.open,
      focus: active === dialog.querySelector('[data-dialog-close]') ? 'close' : active === document.querySelector('#enquiryForm button[type="submit"]') ? 'submit' : active?.tagName,
      name: document.getElementById('name').value,
    };
  })()`);
  // The dialog's close event (which moves focus) fires a moment after it closes, so wait for both.
  await tab.evaluate(`window.__closeEvents = 0; document.getElementById('sentDialog').addEventListener('close', () => { window.__closeEvents++; })`);
  let closes = 0;
  const closedAndSettled = () => `(() => { const d = document.getElementById('sentDialog'); return !d.open && window.__closeEvents === ${++closes}; })()`;
  const send = async () => {
    await tab.evaluate(`(() => {
      for (const [id, value] of [['name', 'A creator'], ['email', 'creator@example.test'], ['description', 'A merch idea']]) document.getElementById(id).value = value;
    })()`);
    await tab.click('#enquiryForm button[type="submit"]');
    await tab.waitFor(`document.getElementById('sentDialog').open`, 'the sent dialog to open')
      .catch(async (error) => { throw new Error(`${error.message}; form status: ${await tab.evaluate(`document.getElementById('formStatus').textContent`)}; sends so far: ${server.sends()}`); });
    assert.deepEqual(await state(), { open: true, focus: 'close', name: '' }, 'open, focused on Close, form cleared');
  };

  await send();
  await tab.press('Escape');
  await tab.waitFor(closedAndSettled(), 'Esc to close the dialog');
  assert.deepEqual(await state(), { open: false, focus: 'submit', name: '' }, 'after Esc');

  await send();
  await tab.click('#sentDialog [data-dialog-close]');
  await tab.waitFor(closedAndSettled(), 'Close to close the dialog');
  assert.deepEqual(await state(), { open: false, focus: 'submit', name: '' }, 'after Close');

  await send();
  await tab.click({ x: 10, y: 10 }); // the backdrop, outside the dialog box
  await tab.waitFor(closedAndSettled(), 'a backdrop click to close the dialog');
  assert.deepEqual(await state(), { open: false, focus: 'submit', name: '' }, 'after a backdrop click');

  // A click inside the dialog (not on Close) keeps it open.
  await send();
  await tab.click('#sentTitle');
  assert.equal((await state()).open, true, 'clicking the dialog text keeps it open');
  assert.equal(server.sends(), 4);
});
