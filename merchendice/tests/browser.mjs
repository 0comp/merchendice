// A small headless Chrome driver over the DevTools protocol, with no extra dependencies
// (Node 24 has a built-in WebSocket). Used for computed styles and real keyboard and mouse input.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const candidates = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
];
export const chromePath = candidates.find((candidate) => candidate && existsSync(candidate));

// Browser tests must not pass by being skipped. Without Chrome they fail, unless SKIP_BROWSER_TESTS=1
// is set on purpose (then they are reported as skipped, never as passed).
export function browserTestOptions() {
  if (chromePath) return {};
  if (process.env.SKIP_BROWSER_TESTS === '1') return { skip: 'SKIP_BROWSER_TESTS=1 and no Chrome found' };
  return {};
}

function connect(url) {
  const socket = new WebSocket(url);
  let nextId = 0;
  const pending = new Map();
  const listeners = new Set();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id !== undefined && pending.has(message.id)) {
      const { resolve, reject, method } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(`${method}: ${message.error.message}`));
      else resolve(message.result);
    } else if (message.method) {
      for (const listener of listeners) listener(message);
    }
  });
  socket.addEventListener('close', () => {
    for (const { reject, method } of pending.values()) reject(new Error(`${method}: DevTools connection closed`));
    pending.clear();
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject, method });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  return new Promise((resolve, reject) => {
    socket.addEventListener('open', () => resolve({ send, listeners, close: () => socket.close() }), { once: true });
    socket.addEventListener('error', () => reject(new Error(`Could not connect to Chrome at ${url}`)), { once: true });
  });
}

export async function launchBrowser() {
  if (!chromePath) throw new Error('These checks need Chrome. Install it, set CHROME_PATH, or set SKIP_BROWSER_TESTS=1 to skip them.');
  const profile = mkdtempSync(path.join(os.tmpdir(), 'merch-chrome-'));
  const chrome = spawn(chromePath, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  const exited = new Promise((resolve) => chrome.once('exit', resolve));
  let cdp;
  try {
    const url = await new Promise((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error(`Chrome did not start in time: ${output}`)), 30000);
      chrome.stderr.on('data', (chunk) => {
        output += chunk;
        const match = output.match(/DevTools listening on (ws:\/\/\S+)/);
        if (match) { clearTimeout(timer); resolve(match[1]); }
      });
      chrome.once('error', (error) => { clearTimeout(timer); reject(error); });
      chrome.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Chrome exited (${code}): ${output}`)); });
    });
    cdp = await connect(url);
  } catch (error) {
    chrome.kill();
    await exited;
    rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
    throw error;
  }

  async function newPage({ width = 1280, height = 900 } = {}) {
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const send = (method, params) => cdp.send(method, params, sessionId);
    const waitForEvent = (name, timeout = 15000) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => { cdp.listeners.delete(listener); reject(new Error(`Timed out waiting for ${name}`)); }, timeout);
      const listener = (message) => {
        if (message.sessionId !== sessionId || message.method !== name) return;
        clearTimeout(timer);
        cdp.listeners.delete(listener);
        resolve(message.params);
      };
      cdp.listeners.add(listener);
    });
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });

    async function evaluate(expression) {
      const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (exceptionDetails) throw new Error(`In the page: ${exceptionDetails.exception?.description || exceptionDetails.text}`);
      return result.value;
    }
    async function waitFor(expression, label = expression, timeout = 10000) {
      const until = Date.now() + timeout;
      while (Date.now() < until) {
        if (await evaluate(expression)) return;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error(`Timed out waiting for ${label}`);
    }
    return {
      send,
      evaluate,
      waitFor,
      async goto(url) {
        const loaded = waitForEvent('Page.loadEventFired');
        const { errorText } = await send('Page.navigate', { url });
        if (errorText) throw new Error(`Could not open ${url}: ${errorText}`);
        await loaded;
      },
      // Real mouse input at a point, or at the centre of the first element matching a selector.
      async click(target) {
        // Let any scroll, close or top-layer change reach the screen first, so the click hits what the page shows now.
        await evaluate('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
        const point = typeof target === 'string'
          ? await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(target)}); if (!el) throw new Error('No element ' + ${JSON.stringify(target)}); el.scrollIntoView({ block: 'center' }); return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => { const r = el.getBoundingClientRect(); resolve({ x: r.left + r.width / 2, y: r.top + r.height / 2 }); }))); })()`)
          : target;
        for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
          await send('Input.dispatchMouseEvent', { type, x: point.x, y: point.y, button: 'left', clickCount: type === 'mouseMoved' ? 0 : 1 });
        }
      },
      async press(key) {
        const codes = { Escape: 27, Enter: 13, Tab: 9 };
        for (const type of ['keyDown', 'keyUp']) {
          await send('Input.dispatchKeyEvent', { type, key, code: key, windowsVirtualKeyCode: codes[key], nativeVirtualKeyCode: codes[key] });
        }
      },
      close: () => cdp.send('Target.closeTarget', { targetId }),
    };
  }

  return {
    newPage,
    async close() {
      await cdp.send('Browser.close').catch(() => {});
      cdp.close();
      const timer = setTimeout(() => chrome.kill('SIGKILL'), 5000);
      await exited;
      clearTimeout(timer);
      rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    },
  };
}
