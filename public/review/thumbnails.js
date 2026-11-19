export function createThumbnailReview({ state, elements, leaveFullscreen, updateOverlayState, requestStopRecordingSession, setDisplayVisibility, updateViewHeader, seekReview, closeContextMenu, epochToApi, query, formatClock }) {
const thumb = { thumbnailPage: 0, thumbnailSize: 'large', thumbnailInterval: 300, thumbnailCamera: '', thumbnailAnchor: null, thumbnailActive: false, thumbnailWasStopped: false, thumbnails: [], thumbnailCache: new Map(), thumbnailRequestId: 0, thumbnailControllers: new Set() };
const THUMBNAIL_SIZES = { small: [75, 51], medium: [150, 102], large: [300, 205] };

function cancelThumbnailPage() {
  thumb.thumbnailRequestId += 1;
  for (const controller of thumb.thumbnailControllers) controller.abort();
  thumb.thumbnailControllers.clear();
  thumb.thumbnails = [];
  elements.thumbnailGrid.replaceChildren();
}

function clearThumbnails() {
  cancelThumbnailPage();
  for (const url of thumb.thumbnailCache.values()) URL.revokeObjectURL(url);
  thumb.thumbnailCache.clear();
  thumb.thumbnailAnchor = null;
  thumb.thumbnailPage = 0;
}

const THUMBNAIL_INTERVALS = [
  [5, '5 segundos'], [10, '10 segundos'], [30, '30 segundos'], [60, '1 minuto'], [300, '5 minutos'],
  [600, '10 minutos'], [1800, '30 minutos'], [3600, '1 hora'], [10800, '3 horas'], [18000, '5 horas']
];

function createThumbnailMenu(camera) {
  const menu = document.createElement('div'); menu.className = 'context-submenu'; menu.setAttribute('role', 'menu');
  for (const [size, label] of [['small', 'Pequeno'], ['medium', 'Médio'], ['large', 'Grande']]) {
    const item = document.createElement('button'); item.type = 'button'; item.className = 'context-item thumbnail-size-item'; item.setAttribute('role', 'menuitemradio'); item.setAttribute('aria-checked', String(thumb.thumbnailSize === size)); item.textContent = label;
    item.addEventListener('click', () => { if (thumb.thumbnailSize !== size) clearThumbnails(); thumb.thumbnailSize = size; for (const other of menu.querySelectorAll('[role="menuitemradio"]')) other.setAttribute('aria-checked', String(other === item)); }); menu.append(item);
  }
  const separator = document.createElement('div'); separator.className = 'context-separator'; separator.setAttribute('role', 'separator'); menu.append(separator);
  for (const [index, [seconds, label]] of THUMBNAIL_INTERVALS.entries()) {
    const item = document.createElement('button'); item.type = 'button'; item.className = 'context-item'; item.setAttribute('role', 'menuitem'); item.textContent = label;
    if (camera === state.focused) {
      const hint = document.createElement('span'); hint.className = 'context-shortcut'; hint.textContent = `Ctrl+Shift+Alt+${(index + 1) % 10}`; item.append(hint);
    }
    item.disabled = !state.reviewStart;
    item.addEventListener('click', () => { closeContextMenu(); void openThumbnailView(camera, seconds); }); menu.append(item);
  }
  return menu;
}
async function openThumbnailView(camera, interval) {
  if (!state.reviewStart || !state.tiles.has(camera)) return;
  await leaveFullscreen();
  if (thumb.thumbnailCamera !== camera || thumb.thumbnailInterval !== interval) clearThumbnails();
  thumb.thumbnailCamera = camera; thumb.thumbnailInterval = interval;
  if (thumb.thumbnailAnchor === null) thumb.thumbnailAnchor = Math.max(state.reviewStart, Math.min(state.reviewLimitEnd ?? state.reviewEnd ?? state.timelineEnd ?? Date.now(), state.reviewEpoch ?? state.reviewStart));
  if (!thumb.thumbnailActive) { thumb.thumbnailWasStopped = state.allStopped; thumb.thumbnailTimelineVisible = state.timelineVisible; }
  thumb.thumbnailActive = true; elements.stopAll.disabled = true;
  updateOverlayState();
  await Promise.all(requestStopRecordingSession());
  if (!thumb.thumbnailActive) return;
  for (const player of state.tiles.values()) player.stop(false);
  elements.viewerGrid.classList.add('showing-thumbnails'); elements.thumbnailPanel.hidden = false;
  void renderThumbnailPage(thumb.thumbnailPage);
}
function closeThumbnailView(resume = true) {
  if (!thumb.thumbnailActive) return;
  thumb.thumbnailActive = false; clearThumbnails(); elements.thumbnailPanel.hidden = true; elements.viewerGrid.classList.remove('showing-thumbnails');
  setDisplayVisibility({ timeline: thumb.thumbnailTimelineVisible }); updateViewHeader();
  if (resume && !thumb.thumbnailWasStopped && state.mode === 'playback') for (const player of state.tiles.values()) void player.start();
}
async function renderThumbnailPage(page) {
  if (!thumb.thumbnailActive || !state.server || !state.reviewStart || !state.tiles.has(thumb.thumbnailCamera)) return;
  const camera = thumb.thumbnailCamera;
  const [width, height] = THUMBNAIL_SIZES[thumb.thumbnailSize] || THUMBNAIL_SIZES.large;
  const rect = elements.viewerGrid.getBoundingClientRect();
  const columns = Math.max(1, Math.floor((rect.width + 4) / (width + 4)));
  const rows = Math.max(1, Math.floor((rect.height + 4) / (height + 28)));
  const count = Math.max(1, columns * rows);
  elements.thumbnailGrid.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
  elements.thumbnailGrid.style.gridTemplateRows = `repeat(${rows}, minmax(0, 1fr))`;
  const interval = thumb.thumbnailInterval * 1000, end = state.reviewLimitEnd ?? state.reviewEnd ?? state.timelineEnd ?? Date.now();
  const first = thumb.thumbnailAnchor + page * count * interval;
  thumb.thumbnailPage = page;
  const pageItems = Array.from({length: count}, (_, i) => first + i * interval).filter(epoch => epoch >= state.reviewStart && epoch <= end);
  cancelThumbnailPage(); const requestId = thumb.thumbnailRequestId; thumb.thumbnails = pageItems;
  elements.thumbnailPrev.disabled = !pageItems.length || pageItems[0] - interval < state.reviewStart;
  elements.thumbnailNext.disabled = !pageItems.length || pageItems[pageItems.length - 1] + interval > end;
  elements.thumbnailStatus.textContent = `Carregando ${pageItems.length} miniaturas de ${camera}.`;
  const cards = pageItems.map((epoch, index) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'thumbnail-card';
    card.style.gridColumn = String(index % columns + 1);
    card.style.gridRow = String(Math.floor(index / columns) + 1);
    card.dataset.loadState = 'loading';
    card.setAttribute('aria-busy', 'true');
    card.setAttribute('aria-label', `Revisar ${camera} a partir de ${formatClock(epoch)}`);
    const media = document.createElement('span');
    media.className = 'thumbnail-media';
    media.setAttribute('aria-hidden', 'true');
    const spinner = document.createElement('span');
    spinner.className = 'thumbnail-spinner';
    spinner.setAttribute('aria-hidden', 'true');
    const image = document.createElement('img');
    image.alt = '';
    image.hidden = true;
    const placeholder = document.createElement('span');
    placeholder.className = 'thumbnail-placeholder';
    placeholder.textContent = 'Miniatura indisponível';
    placeholder.hidden = true;
    media.append(spinner, image, placeholder);
    const label = document.createElement('span');
    label.textContent = formatClock(epoch);
    card.append(media, label);
    card.addEventListener('click', () => { closeThumbnailView(false); state.allStopped = false; seekReview(epoch); updateViewHeader(); });
    elements.thumbnailGrid.append(card);
    return { epoch, card, image, spinner, placeholder };
  });
  // The transparent hit area overlays only the space between consecutive cards.
  pageItems.slice(0, -1).forEach((epoch, index) => {
    const vertical = columns === 1;
    if (!vertical && index % columns === columns - 1) return;
    const midpoint = epoch + (pageItems[index + 1] - epoch) / 2;
    const sneakWidth = Math.round(width / 2), sneakHeight = Math.round(height / 2);
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = `thumbnail-sneak${vertical ? ' is-vertical' : ''}`;
    trigger.style.gridColumn = String(index % columns + 1);
    trigger.style.gridRow = String(Math.floor(index / columns) + 1);
    trigger.style.setProperty('--sneak-width', `${Math.max(1, (rect.width - (columns - 1) * 4) / columns / 2)}px`);
    trigger.dataset.loadState = 'idle';
    trigger.setAttribute('aria-label', `Revisar ${camera} a partir de ${formatClock(midpoint)}`);
    const preview = document.createElement('span'); preview.className = 'thumbnail-sneak-preview';
    const media = document.createElement('span'); media.className = 'thumbnail-sneak-media';
    const spinner = document.createElement('span'); spinner.className = 'thumbnail-spinner';
    const image = document.createElement('img'); image.alt = ''; image.hidden = true;
    const placeholder = document.createElement('span'); placeholder.className = 'thumbnail-placeholder'; placeholder.textContent = 'Miniatura indisponível'; placeholder.hidden = true;
    const label = document.createElement('span'); label.className = 'thumbnail-sneak-time'; label.textContent = formatClock(midpoint);
    media.append(spinner, image, placeholder); preview.append(media, label); trigger.append(preview);
    const load = async () => {
      if (trigger.dataset.loadState !== 'idle' || requestId !== thumb.thumbnailRequestId) return;
      trigger.dataset.loadState = 'loading'; trigger.setAttribute('aria-busy', 'true');
      const finish = success => {
        if (requestId !== thumb.thumbnailRequestId) return;
        trigger.dataset.loadState = success ? 'loaded' : 'error';
        trigger.setAttribute('aria-busy', 'false'); spinner.hidden = true; image.hidden = !success; placeholder.hidden = success;
      };
      const key = `sneak:${midpoint}:${sneakWidth}x${sneakHeight}`;
      const cached = thumb.thumbnailCache.get(key);
      if (cached) { image.src = cached; finish(true); return; }
      const controller = new AbortController(); thumb.thumbnailControllers.add(controller);
      try {
        const api = epochToApi(midpoint, state.server.timeZone);
        const response = await fetch(`/api/snapshot?${query({ server: state.serverId, camera, date: api.date, time: api.time, width: sneakWidth, height: sneakHeight })}`, { cache: 'no-store', signal: controller.signal });
        if (requestId !== thumb.thumbnailRequestId) return;
        if (!response.ok) { finish(false); return; }
        const blob = await response.blob();
        if (requestId !== thumb.thumbnailRequestId) return;
        if (!blob.size || (blob.type && !blob.type.startsWith('image/'))) { finish(false); return; }
        const objectUrl = URL.createObjectURL(blob);
        await new Promise(resolve => {
          let settled = false;
          const done = success => {
            if (settled) return; settled = true;
            controller.signal.removeEventListener('abort', cancelled);
            if (success && requestId === thumb.thumbnailRequestId) thumb.thumbnailCache.set(key, objectUrl);
            else URL.revokeObjectURL(objectUrl);
            finish(success); resolve();
          };
          const cancelled = () => done(false);
          controller.signal.addEventListener('abort', cancelled, { once: true });
          image.addEventListener('load', () => done(true), { once: true });
          image.addEventListener('error', () => done(false), { once: true });
          if (controller.signal.aborted) cancelled(); else image.src = objectUrl;
        });
      } catch (error) {
        if (error.name !== 'AbortError') finish(false);
      } finally { thumb.thumbnailControllers.delete(controller); }
    };
    trigger.addEventListener('pointerenter', load);
    trigger.addEventListener('focus', load);
    trigger.addEventListener('click', () => { closeThumbnailView(false); state.allStopped = false; seekReview(midpoint); updateViewHeader(); });
    elements.thumbnailGrid.append(trigger);
  });
  let cursor = 0;
  const finishCard = (item, success) => {
    if (requestId !== thumb.thumbnailRequestId) return;
    item.card.dataset.loadState = success ? 'loaded' : 'error';
    item.card.setAttribute('aria-busy', 'false');
    item.spinner.hidden = true;
    item.image.hidden = !success;
    item.placeholder.hidden = success;
    if (!success) {
      item.card.disabled = true;
      item.card.setAttribute('aria-label', `Miniatura indisponível para ${camera} às ${formatClock(item.epoch)}`);
    }
  };
  const workers = Array.from({ length: Math.min(4, cards.length) }, async () => {
    while (requestId === thumb.thumbnailRequestId && cursor < cards.length) {
      const item = cards[cursor++];
      const cached = thumb.thumbnailCache.get(item.epoch);
      if (cached) {
        item.image.src = cached;
        finishCard(item, true);
        continue;
      }
      const controller = new AbortController();
      thumb.thumbnailControllers.add(controller);
      const api = epochToApi(item.epoch, state.server.timeZone);
      try {
        const [width, height] = THUMBNAIL_SIZES[thumb.thumbnailSize] || THUMBNAIL_SIZES.large;
        const response = await fetch(`/api/snapshot?${query({ server: state.serverId, camera, date: api.date, time: api.time, width, height })}`, { cache: 'no-store', signal: controller.signal });
        if (requestId !== thumb.thumbnailRequestId) continue;
        if (!response.ok) { finishCard(item, false); continue; }
        const blob = await response.blob();
        if (requestId !== thumb.thumbnailRequestId) continue;
        if (!blob.size || (blob.type && !blob.type.startsWith('image/'))) { finishCard(item, false); continue; }
        const objectUrl = URL.createObjectURL(blob);
        if (requestId !== thumb.thumbnailRequestId) { URL.revokeObjectURL(objectUrl); continue; }
        await new Promise(resolve => {
          const finish = success => {
            controller.signal.removeEventListener('abort', cancelled);
            if (success && requestId === thumb.thumbnailRequestId) thumb.thumbnailCache.set(item.epoch, objectUrl);
            else URL.revokeObjectURL(objectUrl);
            finishCard(item, success); resolve();
          };
          const cancelled = () => { URL.revokeObjectURL(objectUrl); resolve(); };
          controller.signal.addEventListener('abort', cancelled, { once: true });
          item.image.addEventListener('load', () => finish(true), { once: true });
          item.image.addEventListener('error', () => finish(false), { once: true });
          if (controller.signal.aborted) cancelled(); else item.image.src = objectUrl;
        });
      } catch (error) {
        if (requestId === thumb.thumbnailRequestId && error.name !== 'AbortError') finishCard(item, false);
      } finally {
        thumb.thumbnailControllers.delete(controller);
      }
    }
  });
  await Promise.all(workers);
  if (requestId !== thumb.thumbnailRequestId) return;
  const loaded = cards.filter(card => card.card.dataset.loadState === 'loaded').length;
  const failed = cards.length - loaded;
  elements.thumbnailStatus.textContent = loaded
    ? `${loaded} miniaturas carregadas${failed ? ` · ${failed} indisponíveis` : ''} · clique em uma miniatura para revisar daquele instante.`
    : 'Nenhuma miniatura encontrada nesta página.';
}


function resize() {
  if (!thumb.thumbnailActive) return;
  thumb.thumbnailAnchor = thumb.thumbnails[0] ?? thumb.thumbnailAnchor;
  void renderThumbnailPage(0);
}
return { clearThumbnails, createThumbnailMenu, openThumbnailView, closeThumbnailView, THUMBNAIL_INTERVALS,
  get active() { return thumb.thumbnailActive; }, resize,
  previous() { return renderThumbnailPage(thumb.thumbnailPage - 1); },
  next() { return renderThumbnailPage(thumb.thumbnailPage + 1); } };

}
