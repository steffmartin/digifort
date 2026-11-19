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
    const toolbarBehavior = await evaluate(`(() => {
      const bar = document.querySelector('#mediaToolbar');
      const handle = document.querySelector('#mediaToolbarHandle');
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', bubbles: true }));
      const before = bar.getBoundingClientRect().left;
      handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
      const after = bar.getBoundingClientRect().left;
      const focused = document.activeElement === handle && bar.classList.contains('is-visible');
      document.querySelector('#captureAllSwitch').click();
      const all = bar.dataset.captureAll;
      document.querySelector('#captureAllSwitch').click();
      return { focused, moved: after < before, all, restored: bar.dataset.captureAll };
    })()`);
    assert.deepEqual(toolbarBehavior, { focused: true, moved: true, all: 'true', restored: 'false' });
    const dragStart = await evaluate(`(() => {
      const handle = document.querySelector('#mediaToolbarHandle').getBoundingClientRect();
      const bar = document.querySelector('#mediaToolbar').getBoundingClientRect();
      return { x: handle.left + handle.width / 2, y: handle.top + handle.height / 2, left: bar.left, top: bar.top };
    })()`);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: dragStart.x, y: dragStart.y }, sessionId);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: dragStart.x, y: dragStart.y, button: 'left', buttons: 1, clickCount: 1 }, sessionId);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: dragStart.x - 60, y: dragStart.y - 40, button: 'left', buttons: 1 }, sessionId);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: dragStart.x - 60, y: dragStart.y - 40, button: 'left', buttons: 0, clickCount: 1 }, sessionId);
    const dragged = await evaluate(`(() => { const bar = document.querySelector('#mediaToolbar').getBoundingClientRect(); return { left: bar.left, top: bar.top }; })()`);
    assert.ok(dragged.left < dragStart.left && dragged.top < dragStart.top, 'o ponteiro deve mover a barra nos dois eixos');
    const dragTo = async (x, y) => {
      const start = await evaluate(`(() => { const r = document.querySelector('#mediaToolbarHandle').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start.x, y: start.y }, sessionId);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: start.x, y: start.y, button: 'left', buttons: 1, clickCount: 1 }, sessionId);
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1 }, sessionId);
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 }, sessionId);
      return evaluate(`(() => { const r = document.querySelector('#mediaToolbar').getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: innerWidth, height: innerHeight }; })()`);
    };
    const topLeft = await dragTo(0, 0);
    assert.ok(topLeft.left >= 8 && topLeft.left <= 9 && topLeft.top >= 8 && topLeft.top <= 9, 'arraste alcança o canto superior sem sair da janela');
    const bottomRight = await dragTo(topLeft.width + 100, topLeft.height + 100);
    assert.ok(Math.abs(bottomRight.right - (bottomRight.width - 8)) < 1 && Math.abs(bottomRight.bottom - (bottomRight.height - 8)) < 1, 'arraste alcança o canto inferior sem sair da janela');
    const contextAlignment = await evaluate(`(() => {
      const openCameraMenu = () => {
        document.querySelector('.tile-video').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 300, clientY: 200 }));
        document.querySelector('#contextMenu > .context-branch > button').click();
      };
      const alignment = item => ({ justify: getComputedStyle(item).justifyContent, gap: getComputedStyle(item).columnGap });
      const toolbar = document.querySelector('#mediaToolbar');
      const originalPosition = { left: toolbar.style.left, top: toolbar.style.top };
      document.querySelector('#liveMode').click();
      openCameraMenu();
      const profile = alignment(document.querySelector('.context-scope-menu:not([hidden]) .thumbnail-size-item'));
      document.body.click();
      document.querySelector('#reviewMode').click();
      openCameraMenu();
      const thumbnailBranch = [...document.querySelectorAll('.context-scope-menu:not([hidden]) .context-branch-trigger')]
        .find(item => item.textContent.includes('Miniaturas'));
      thumbnailBranch.click();
      const thumbnail = alignment([...document.querySelectorAll('.context-submenu:not([hidden]) .thumbnail-size-item')]
        .find(item => item.textContent === 'Pequeno'));
      document.body.click();
      return { profile, thumbnail, positionPreserved: toolbar.style.left === originalPosition.left && toolbar.style.top === originalPosition.top };
    })()`);
    assert.deepEqual(contextAlignment, { profile: { justify: 'flex-start', gap: '8px' }, thumbnail: { justify: 'flex-start', gap: '8px' }, positionPreserved: true });
    const dialogs = await evaluate(`(async () => {
      const wait = async predicate => {
        const deadline = Date.now() + 5000;
        while (!predicate()) {
          if (Date.now() > deadline) throw new Error('Diálogo não mudou de estado');
          await new Promise(resolve => setTimeout(resolve, 25));
        }
      };
      const shortcuts = document.querySelector('#shortcutDialog');
      document.querySelector('#openShortcuts').click();
      const shortcutsOpen = shortcuts.open && shortcuts.contains(document.activeElement);
      shortcuts.querySelector('.app-dialog-actions button').click();
      await wait(() => !shortcuts.open);
      document.querySelector('#manageConfigs').click();
      const config = document.querySelector('#configDialog');
      await wait(() => config.open);
      const configOpen = config.getAttribute('aria-labelledby') === 'configDialogTitle' && config.contains(document.activeElement);
      document.querySelector('#closeConfigApp').click();
      await wait(() => !config.open);
      return { shortcutsOpen, configOpen, closed: !shortcuts.open && !config.open };
    })()`);
    assert.deepEqual(dialogs, { shortcutsOpen: true, configOpen: true, closed: true });
    const deletionCheck = await evaluate(`(() => {
      const sheet = [...document.styleSheets].find(item => item.href && item.href.endsWith('/styles.css'));
      const selectors = ['.app-dialog', '.media-toolbar'];
      const removed = [];
      const read = () => ({
        updateShadow: getComputedStyle(document.querySelector('#updateDialog')).boxShadow,
        shortcutsShadow: getComputedStyle(document.querySelector('#shortcutDialog')).boxShadow,
        toolbarPosition: getComputedStyle(document.querySelector('#mediaToolbar')).position,
        topbarHeight: getComputedStyle(document.querySelector('.topbar')).height
      });
      const before = read();
      try {
        for (const selector of selectors) {
          const index = [...sheet.cssRules].findIndex(rule => rule.selectorText === selector);
          if (index < 0) throw new Error('Regra ausente: ' + selector);
          removed.push({ index, text: sheet.cssRules[index].cssText });
          sheet.deleteRule(index);
        }
        const without = read();
        return { dialogShared: before.updateShadow !== without.updateShadow && before.shortcutsShadow !== without.shortcutsShadow,
          toolbarShared: before.toolbarPosition === 'fixed' && without.toolbarPosition !== 'fixed',
          unrelatedUnchanged: before.topbarHeight === without.topbarHeight };
      } finally {
        for (const rule of removed.reverse()) sheet.insertRule(rule.text, rule.index);
      }
    })()`);
    assert.deepEqual(deletionCheck, { dialogShared: true, toolbarShared: true, unrelatedUnchanged: true });
    const captureSwitch = await evaluate(`(async () => {
      const { createMediaCapture } = await import('/media/capture.js');
      const originalRecorder = window.MediaRecorder, originalFetch = window.fetch, originalCapture = HTMLCanvasElement.prototype.captureStream;
      let recordedCanvas, recorderCount = 0;
      try {
        HTMLCanvasElement.prototype.captureStream = function () {
          recordedCanvas = this;
          return { tracks: [{ stop() {} }], addTrack(track) { this.tracks.push(track); }, getTracks() { return this.tracks; } };
        };
        window.MediaRecorder = class {
          static isTypeSupported() { return true; }
          constructor() { recorderCount++; this.handlers = {}; this.state = 'inactive'; }
          addEventListener(name, callback) { this.handlers[name] = callback; }
          start() { this.state = 'recording'; }
          stop() { this.state = 'inactive'; this.handlers.dataavailable({ data: new Blob(['synthetic']) }); this.handlers.stop(); }
        };
        window.fetch = async () => ({ ok: true, json: async () => ({}) });
        const player = (name, width, height, color) => {
          const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
          const ctx = canvas.getContext('2d'); ctx.fillStyle = color; ctx.fillRect(0, 0, width, height);
          const badge = document.createElement('span');
          return { name, canvas, tile: { classList: { toggle() {} }, querySelector: () => badge }, setState() {} };
        };
        const a = player('A', 160, 90, 'red'), b = player('B', 120, 90, 'blue');
        const audioContext = { createMediaStreamDestination: () => ({ stream: { getAudioTracks: () => [{ stop() {} }] }, disconnect() {} }),
          createConstantSource: () => ({ offset: {}, connect() {}, start() {}, stop() {}, disconnect() {} }) };
        const state = { mode: 'live', serverId: 'synthetic', server: { videoFolderConfigured: true, timeZone: 'UTC' }, tiles: new Map([['A', a], ['B', b]]), audioContext };
        const capture = createMediaCapture({ state, epochToInput: () => '2026-01-01T00:00:00', query: p => new URLSearchParams(p), toast() {},
          scopedCameraNames: s => [s.camera], recordingScopeKey: s => 'camera:' + s.camera, stopPresenceWorker() {}, updateMediaControls() {} });
        await capture.changeRecordingState({ camera: 'A' }, 'start');
        const before = [...recordedCanvas.getContext('2d').getImageData(80, 45, 1, 1).data];
        const recording = capture.recordings.get('A');
        capture.focusChanged('B');
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const after = [...recordedCanvas.getContext('2d').getImageData(80, 45, 1, 1).data];
        const border = [...recordedCanvas.getContext('2d').getImageData(0, 45, 1, 1).data];
        await capture.changeRecordingState({ camera: 'B' }, 'stop');
        await recording.finished;
        return { before, after, border, recorderCount, width: recordedCanvas.width, height: recordedCanvas.height };
      } finally { window.MediaRecorder = originalRecorder; window.fetch = originalFetch; HTMLCanvasElement.prototype.captureStream = originalCapture; }
    })()`);
    assert.deepEqual(captureSwitch, { before: [255, 0, 0, 255], after: [0, 0, 255, 255], border: [0, 0, 0, 255], recorderCount: 1, width: 160, height: 90 });
    const surveillance = await evaluate(`(async () => {
      document.querySelector('#liveMode').click();
      document.querySelector('#surveillanceToggle').click();
      let deadline = Date.now() + 5000;
      while (!document.fullscreenElement && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
      const entered = Boolean(document.fullscreenElement);
      const tile = document.querySelector('.camera-tile');
      const bar = document.querySelector('#mediaToolbar');
      const initialPosition = { left: bar.style.left, top: bar.style.top };
      tile.querySelector('.tile-video').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      const enlarged = tile.classList.contains('is-enlarged');
      const toolbarInTile = bar.parentElement === tile;
      const positionInTile = bar.style.left === initialPosition.left && bar.style.top === initialPosition.top;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      const restored = !tile.classList.contains('is-enlarged') && Boolean(document.fullscreenElement);
      const toolbarRestored = bar.parentElement === document.querySelector('#viewerGrid') && bar.style.left === initialPosition.left && bar.style.top === initialPosition.top;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      deadline = Date.now() + 5000;
      while (document.fullscreenElement && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
      const exited = !document.fullscreenElement;
      if (!exited) await document.exitFullscreen();
      return { entered, enlarged, restored, exited, toolbarInTile, positionInTile, toolbarRestored };
    })()`, true);
    assert.deepEqual(surveillance, { entered: true, enlarged: true, restored: true, exited: true, toolbarInTile: true, positionInTile: true, toolbarRestored: true });
    const accessibility = await send('Accessibility.getFullAXTree', {}, sessionId);
    const accessibleNames = accessibility.nodes.filter(node => !node.ignored).map(node => node.name?.value).filter(Boolean);
    assert.ok(accessibleNames.includes('Câmeras'));
    assert.ok(accessibleNames.includes('Grade de câmeras'));
    assert.ok(accessibleNames.includes('Atalhos de teclado'));
    await evaluate(`document.querySelector('#openShortcuts').focus(); document.querySelector('#openShortcuts').click()`);
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }, sessionId);
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }, sessionId);
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }, sessionId);
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }, sessionId);
    assert.equal(await evaluate(`document.querySelector('#shortcutDialog').contains(document.activeElement)`), true);
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, sessionId);
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, sessionId);
    assert.equal(await evaluate(`document.querySelector('#shortcutDialog').open`), false);
  } finally {
    try { await send('Browser.close'); } catch {}
    if (browser.exitCode === null) browser.kill();
    await new Promise(resolve => server.close(resolve));
    if (!path.resolve(profile).startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(profile).startsWith('digifort-chromium-test-')) throw new Error('Perfil temporário fora da pasta esperada.');
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
