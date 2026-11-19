export function createPlaybackReview({ state, elements, epochToInput, inputToEpoch, toast, closeThumbnailView, clearThumbnails, timelineReview, updateTimelinePlayhead, updateViewHeader }) {
const period = { reviewStart: null, reviewEnd: null, reviewLimitEnd: null, reviewEpoch: null };
function setDefaultReviewTimes() {
  if (!state.server) return;
  const now = Date.now() - 5 * 60 * 1000;
  elements.startDateTime.value = epochToInput(now, state.server.timeZone);
  elements.endDateTime.value = '';
}

function startReview() {
  if (state.thumbnailActive) closeThumbnailView(false);
  if (!state.tiles.size) return toast('Abra pelo menos uma câmera antes de carregar gravações.', 'error');
  if (!elements.startDateTime.value) return toast('Informe data e hora de início.', 'error');
  try {
    period.reviewStart = inputToEpoch(elements.startDateTime.value, state.server.timeZone);
    period.reviewEnd = elements.endDateTime.value ? inputToEpoch(elements.endDateTime.value, state.server.timeZone) : null;
    if (period.reviewEnd && period.reviewEnd <= period.reviewStart) throw new Error('O fim precisa ser posterior ao início.');
    period.reviewLimitEnd = period.reviewEnd ?? Date.now();
    period.reviewEpoch = period.reviewStart;
    clearThumbnails();
    state.allStopped = false;
  } catch (error) {
    return toast(error.message || 'Confira o período selecionado.', 'error');
  }
  for (const player of state.tiles.values()) player.restart();
  loadFocusedTimeline();
  updateViewHeader();
}

function loadFocusedTimeline() {
  if (state.mode !== 'playback' || !period.reviewStart || !state.timelineVisible) return;
  timelineReview.openTimeline(period.reviewStart, period.reviewLimitEnd, [...state.tiles.keys()]);
}

function seekReview(epoch) {
  if (state.thumbnailActive) closeThumbnailView(false);
  if (state.mode !== 'playback' || !Number.isFinite(epoch) || !Number.isFinite(period.reviewStart)) return;
  const end = period.reviewLimitEnd ?? period.reviewEnd ?? state.timelineEnd ?? Date.now();
  clearThumbnails();
  period.reviewEpoch = Math.max(period.reviewStart, Math.min(end, epoch));
  updateTimelinePlayhead(period.reviewEpoch);
  for (const player of state.tiles.values()) player.restart();
}

function skipReview(direction) {
  if (state.mode !== 'playback' || !Number.isFinite(period.reviewStart) || !state.tiles.size) return;
  const seconds = state.server?.seekSeconds ?? 15;
  seekReview((period.reviewEpoch ?? period.reviewStart) + direction * seconds * 1000);
}


function reset() {
  period.reviewStart = period.reviewEnd = period.reviewLimitEnd = period.reviewEpoch = null;
}
function setEpoch(epoch) { period.reviewEpoch = epoch; }
return { setDefaultReviewTimes, startReview, loadFocusedTimeline, seekReview, skipReview, reset, setEpoch,
  get start() { return period.reviewStart; }, get end() { return period.reviewEnd; },
  get limitEnd() { return period.reviewLimitEnd; }, get epoch() { return period.reviewEpoch; } };
}
