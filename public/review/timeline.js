import { epochToApi, timelineDayBoundaries } from './time.js';

export function createTimelineReview({ state, elements, query, consumeMultipart, parseApiTimestamp, toast, seekReview, formatClock, setReviewEpoch }) {
const timeline = { timelineStart: null, timelineEnd: null, timelineRequestId: 0, timelineData: new Map(), timelineZoom: 1, timelineControllers: [], timelineDragged: false };

function clearTimeline() {
  timeline.timelineRequestId++;
  for (const controller of timeline.timelineControllers) controller.abort();
  timeline.timelineControllers = [];
  timeline.timelineData.clear();
  timeline.timelineStart = timeline.timelineEnd = null;
  elements.timelineNames.replaceChildren();
  elements.timelineTracks.replaceChildren();
  elements.timelineRuler.replaceChildren();
  elements.timelineDays.replaceChildren();
  elements.timelinePlayhead.hidden = true;
}

function parseTimelinePart(part) {
  const text = new TextDecoder().decode(part.data);
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const split = line.indexOf('=');
    if (split > 0) values[line.slice(0, split).trim().toUpperCase()] = line.slice(split + 1).trim();
  }
  if (!values.TIMELINEDATA_MEDIAKIND) return null;
  return {
    kind: values.TIMELINEDATA_MEDIAKIND.toLowerCase(),
    type: (values.TIMELINEDATA_FRAMETYPE || values.TIMELINEDATA_FRAMEKIND || '').toLowerCase(),
    start: parseApiTimestamp(values.TIMELINEDATA_STARTTIME),
    end: parseApiTimestamp(values.TIMELINEDATA_ENDTIME)
  };
}

async function loadTimeline(camera) {
  const requestId = timeline.timelineRequestId;
  const controller = new AbortController();
  timeline.timelineControllers.push(controller);
  const start = epochToApi(timeline.timelineStart, state.server.timeZone);
  const end = epochToApi(timeline.timelineEnd, state.server.timeZone);
  const data = timeline.timelineData.get(camera);
  try {
    const response = await fetch(`/api/timeline?${query({ server: state.serverId, camera, startDate: start.date, startTime: start.time, endDate: end.date, endTime: end.time })}`, { cache: 'no-store', signal: controller.signal });
    if (!response.ok) throw new Error('Não foi possível carregar a timeline.');
    let scheduled = false;
    await consumeMultipart(response, part => {
      if (requestId !== timeline.timelineRequestId) return;
      const parsed = parseTimelinePart(part);
      if (!parsed || !Number.isFinite(parsed.start) || !Number.isFinite(parsed.end) || parsed.end < parsed.start) return;
      data.push(parsed);
      if (!scheduled) { scheduled = true; requestAnimationFrame(() => { scheduled = false; if (requestId === timeline.timelineRequestId) drawTimeline(); }); }
    });
    if (requestId === timeline.timelineRequestId) { drawTimeline(); elements.timelineStatus.textContent = `Disponibilidade carregada para ${camera}.`; }
  } catch (error) {
    if (requestId === timeline.timelineRequestId && error.name !== 'AbortError') { elements.timelineStatus.textContent = `Não foi possível carregar a timeline de ${camera}.`; toast(elements.timelineStatus.textContent, 'error'); }
  } finally { timeline.timelineControllers = timeline.timelineControllers.filter(item => item !== controller); }
}

function drawTimeline() {
  const start = timeline.timelineStart, end = timeline.timelineEnd;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;
  const span = end - start;
  elements.timelineNames.replaceChildren();
  for (const camera of timeline.timelineData.keys()) {
    const name = document.createElement('div'); name.className = 'timeline-camera-name'; name.textContent = camera; name.title = camera; elements.timelineNames.append(name);
  }
  elements.timelineContent.style.width = `${timeline.timelineZoom * 100}%`;
  elements.timelineRuler.replaceChildren();
  const ticks = Math.max(1, Math.floor(elements.timelineContent.clientWidth / 90));
  for (let tick = 0; tick <= ticks; tick++) {
    const mark = document.createElement('span'); mark.className = 'ruler-tick';
    if (!tick) mark.dataset.edge = 'start'; if (tick === ticks) mark.dataset.edge = 'end';
    mark.style.left = `${tick / ticks * 100}%`;
    mark.textContent = formatClock(start + span * tick / ticks);
    elements.timelineRuler.append(mark);
  }
  elements.timelineDays.replaceChildren();
  for (const epoch of timelineDayBoundaries(start, end, state.server.timeZone)) {
    const marker = document.createElement('span'); marker.className = 'timeline-day';
    marker.style.left = `${(epoch - start) / span * 100}%`;
    const label = document.createElement('span'); label.textContent = new Intl.DateTimeFormat('pt-BR', { timeZone: state.server.timeZone, day: '2-digit', month: '2-digit', year: 'numeric' }).format(epoch);
    marker.title = `Início de ${label.textContent}`; marker.append(label); elements.timelineDays.append(marker);
  }
  const dayRects = [...elements.timelineDays.querySelectorAll('.timeline-day > span')].map(label => label.getBoundingClientRect());
  for (const tick of elements.timelineRuler.children) {
    const rect = tick.getBoundingClientRect();
    if (dayRects.some(day => rect.left < day.right + 4 && rect.right > day.left - 4)) tick.style.visibility = 'hidden';
  }
  elements.timelineTracks.replaceChildren();
  for (const [camera, data] of timeline.timelineData) {
    const row = document.createElement('div'); row.className = 'timeline-camera-tracks';
    const video = document.createElement('div'), audio = document.createElement('div');
    video.className = 'track-lane'; audio.className = 'track-lane audio-lane';
    video.title = `Vídeo: ${camera}`; audio.title = `Áudio: ${camera}`;
    for (const item of data) {
      const lane = item.kind === 'video' ? video : item.kind === 'audio' ? audio : null;
      if (!lane || item.end < start || item.start > end) continue;
      const segment = document.createElement('span'); segment.className = `track-segment${item.kind === 'audio' ? ' audio' : ''}`;
      const left = Math.max(0, (item.start - start) / span * 100), right = Math.min(100, (item.end - start) / span * 100);
      segment.style.left = `${left}%`; segment.style.width = `${Math.max(0, right - left)}%`;
      segment.title = `${item.kind === 'audio' ? 'Áudio' : 'Vídeo'}: ${formatClock(item.start)}–${formatClock(item.end)}`;
      lane.append(segment);
    }
    for (const lane of [video, audio]) lane.addEventListener('click', event => { if (!timeline.timelineDragged) seekFromTimeline(event, lane); });
    row.append(video, audio); elements.timelineTracks.append(row);
  }
  updateTimelinePlayhead();
}
function seekFromTimeline(event, lane) {
  const rect = lane.getBoundingClientRect();
  seekReview(timeline.timelineStart + (timeline.timelineEnd - timeline.timelineStart) * Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)));
}
function updateTimelinePlayhead(epoch = state.reviewEpoch) {
  if (Number.isFinite(epoch) && Number.isFinite(state.reviewStart)) setReviewEpoch(Math.max(state.reviewStart, Math.min(state.reviewLimitEnd ?? state.reviewEnd ?? timeline.timelineEnd ?? Date.now(), epoch)));
  if (!Number.isFinite(epoch) || !Number.isFinite(timeline.timelineStart) || !Number.isFinite(timeline.timelineEnd) || timeline.timelineEnd <= timeline.timelineStart) { elements.timelinePlayhead.hidden = true; return; }
  setReviewEpoch(Math.max(timeline.timelineStart, Math.min(timeline.timelineEnd, epoch)));
  const fraction = (state.reviewEpoch - timeline.timelineStart) / (timeline.timelineEnd - timeline.timelineStart);
  elements.timelinePlayhead.style.left = `${fraction * 100}%`;
  elements.timelinePlayhead.title = `Gravação em ${formatClock(epoch)}`; elements.timelinePlayhead.hidden = false;
}
function setTimelineZoom(zoom, clientX) {
  const scroll = elements.timelineScroll;
  const pointerX = Math.max(0, Math.min(scroll.clientWidth, clientX - scroll.getBoundingClientRect().left));
  const fraction = (scroll.scrollLeft + pointerX) / scroll.scrollWidth;
  timeline.timelineZoom = Math.max(1, Math.min(32, zoom));
  scroll.classList.toggle('is-zoomed', timeline.timelineZoom > 1);
  drawTimeline();
  scroll.scrollLeft = timeline.timelineZoom === 1 ? 0 : fraction * scroll.scrollWidth - pointerX;
}
elements.timelineScroll.addEventListener('wheel', event => {
  if (!Number.isFinite(timeline.timelineStart) || !event.deltaY) return;
  event.preventDefault();
  setTimelineZoom(timeline.timelineZoom * (event.deltaY < 0 ? 1.25 : 1 / 1.25), event.clientX);
}, { passive: false });
let timelineDrag = null;
elements.timelineScroll.addEventListener('pointerdown', event => {
  if (event.button !== 0 || !event.isPrimary) return;
  timelineDrag = { x: event.clientX, y: event.clientY, left: elements.timelineScroll.scrollLeft, pointerId: event.pointerId };
  timeline.timelineDragged = false;
  elements.timelineScroll.classList.add('is-pressed');
  timelineDrag.holdTimer = setTimeout(() => elements.timelineScroll.classList.add('is-holding'), 350);
});
window.addEventListener('pointermove', event => {
  if (!timelineDrag || event.pointerId !== timelineDrag.pointerId) return;
  const delta = event.clientX - timelineDrag.x;
  if (timeline.timelineZoom > 1 && !timeline.timelineDragged && Math.hypot(delta, event.clientY - timelineDrag.y) > 3) {
    timeline.timelineDragged = true;
    clearTimeout(timelineDrag.holdTimer);
    elements.timelineScroll.classList.add('is-dragging');
    elements.timelineScroll.setPointerCapture(event.pointerId);
  }
  if (timeline.timelineDragged) elements.timelineScroll.scrollLeft = timelineDrag.left - delta;
});
function endTimelineDrag(event) {
  if (!timelineDrag || event.pointerId !== timelineDrag.pointerId) return;
  clearTimeout(timelineDrag.holdTimer);
  timelineDrag = null;
  elements.timelineScroll.classList.remove('is-pressed', 'is-holding', 'is-dragging');
  setTimeout(() => { timeline.timelineDragged = false; }, 0);
}
window.addEventListener('pointerup', endTimelineDrag);
window.addEventListener('pointercancel', endTimelineDrag);

function openTimeline(start, end, cameras) {
  clearTimeline();
  timeline.timelineStart = start;
  timeline.timelineEnd = end;
  for (const camera of cameras) { timeline.timelineData.set(camera, []); void loadTimeline(camera); }
  drawTimeline();
}
function reorder(cameras) {
  timeline.timelineData = new Map(cameras.filter(camera => timeline.timelineData.has(camera)).map(camera => [camera, timeline.timelineData.get(camera)]));
  if (state.mode === 'playback' && state.timelineVisible && timeline.timelineStart) drawTimeline();
}
return { clearTimeline, drawTimeline, updateTimelinePlayhead, openTimeline, reorder,
  get end() { return timeline.timelineEnd; } };
}
