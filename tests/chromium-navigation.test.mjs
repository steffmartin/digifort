import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const publicDir = path.resolve(fileURLToPath(new URL('../public/', import.meta.url)));
const browserCandidates = [process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean);
const browserPath = browserCandidates.find(candidate => existsSync(candidate));

function createProtocol(process) {
  let id = 0, buffer = Buffer.alloc(0);
  const pending = new Map(), events = new Map();
  process.stdio[4].on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    let end;
    while ((end = buffer.indexOf(0)) >= 0) {
      const message = JSON.parse(buffer.subarray(0, end).toString());
      buffer = buffer.subarray(end + 1);
      const event = events.get(`${message.sessionId}:${message.method}`);
      if (event) { events.delete(`${message.sessionId}:${message.method}`); event(); }
      const request = pending.get(message.id);
      if (!request) continue;
      pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
    }
  });
  const rejectPending = () => {
    for (const request of pending.values()) request.reject(new Error('Chromium encerrou antes de responder.'));
    pending.clear();
  };
  process.once('exit', rejectPending);
  process.once('error', rejectPending);
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const requestId = ++id;
    pending.set(requestId, { resolve, reject });
    process.stdio[3].write(JSON.stringify({ id: requestId, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
  });
  send.waitForEvent = (method, sessionId) => new Promise(resolve => events.set(`${sessionId}:${method}`, resolve));
  return send;
}

test('Chromium navega entre monitor, revisão e controles de presença', { timeout: 45000, skip: browserPath ? false : 'Chromium não encontrado; defina CHROME_PATH.' }, async () => {
  const fixtures = {
    '/api/servers': { servers: [{ id: 'synthetic', name: 'Servidor sintético', ready: true }] },
    '/api/server': { timeZone: 'UTC', initialMosaic: 'auto', initialCameras: {}, maxCams: 0, seekSeconds: 15 },
    '/api/cameras': { cameras: [{ name: 'Câmera sintética', description: 'Teste', active: true }] },
    '/api/camera-status': { statuses: [] },
    '/api/update': { update: null },
    '/api/stream-channel': { error: 'Transmissão sintética indisponível.' }
  };
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    if (pathname === '/api/timeline') {
      response.writeHead(200, { 'content-type': 'multipart/mixed; boundary=fixture' });
      response.end('--fixture--\r\n');
      return;
    }
    if (Object.hasOwn(fixtures, pathname)) {
      response.writeHead(pathname === '/api/stream-channel' ? 503 : 200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(fixtures[pathname]));
      return;
    }
    const target = path.resolve(publicDir, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!target.startsWith(`${publicDir}${path.sep}`) && target !== path.join(publicDir, 'index.html')) {
      response.writeHead(404).end();
      return;
    }
    try {
      const contents = await readFile(target);
      const contentType = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' }[path.extname(target)] || 'application/octet-stream';
      response.writeHead(200, { 'content-type': contentType }).end(contents);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const profile = await mkdtemp(path.join(os.tmpdir(), 'digifort-chromium-test-'));
  const browser = spawn(browserPath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--remote-debugging-pipe', `--user-data-dir=${profile}`, 'about:blank'],
    { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'], windowsHide: true });
  const send = createProtocol(browser);
  try {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    await send('Page.enable', {}, sessionId);
    const loaded = send.waitForEvent('Page.loadEventFired', sessionId);
    await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` }, sessionId);
    await loaded;
    const evaluate = async (expression, userGesture = false) => {
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture }, sessionId);
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
      return result.result.value;
    };
    const result = await evaluate(`(async () => {
      const wait = async predicate => {
        const deadline = Date.now() + 15000;
        while (!predicate()) {
          if (Date.now() > deadline) throw new Error('Estado da interface não apareceu');
          await new Promise(resolve => setTimeout(resolve, 25));
        }
      };
      await wait(() => document.querySelector('.camera-row'));
      document.querySelector('.camera-row').click();
      await wait(() => document.querySelector('.camera-tile'));
      const presence = document.querySelector('#presenceToggle');
      presence.click();
      const focusLabel = presence.getAttribute('aria-label');
      presence.click(); presence.click();
      document.querySelector('#reviewMode').click();
      document.querySelector('#playReview').click();
      await wait(() => document.querySelectorAll('#timelineNames > *').length === 1);
      const toolbar = document.querySelector('#mediaToolbar');
      toolbar.classList.remove('is-visible');
      document.querySelector('#reviewPanel').dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'mouse' }));
      const timelineShowsToolbar = toolbar.classList.contains('is-visible');
      const badge = document.querySelector('.tile-state');
      badge.classList.add('is-recording');
      const badgeNoWrap = getComputedStyle(badge).whiteSpace === 'nowrap';
      return { focusLabel, review: document.querySelector('#reviewMode').getAttribute('aria-pressed'),
        cameras: document.querySelectorAll('.camera-tile').length, tracks: document.querySelectorAll('#timelineNames > *').length, timelineShowsToolbar, badgeNoWrap };
    })()`);
    assert.deepEqual(result, { focusLabel: 'Alarme de presença: câmera em foco', review: 'true', cameras: 1, tracks: 1, timelineShowsToolbar: true, badgeNoWrap: true });
    const surveillance = await evaluate(`(async () => {
      document.querySelector('#liveMode').click();
      document.querySelector('#surveillanceToggle').click();
      let deadline = Date.now() + 5000;
      while (!document.fullscreenElement && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
      const entered = Boolean(document.fullscreenElement);
      const tile = document.querySelector('.camera-tile');
      tile.querySelector('.tile-video').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      const enlarged = tile.classList.contains('is-enlarged');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      const restored = !tile.classList.contains('is-enlarged') && Boolean(document.fullscreenElement);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      deadline = Date.now() + 5000;
      while (document.fullscreenElement && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
      const exited = !document.fullscreenElement;
      if (!exited) await document.exitFullscreen();
      return { entered, enlarged, restored, exited };
    })()`, true);
    assert.deepEqual(surveillance, { entered: true, enlarged: true, restored: true, exited: true });
  } finally {
    try { await send('Browser.close'); } catch {}
    if (browser.exitCode === null) browser.kill();
    await new Promise(resolve => server.close(resolve));
    if (!path.resolve(profile).startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(profile).startsWith('digifort-chromium-test-')) throw new Error('Perfil temporário fora da pasta esperada.');
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
