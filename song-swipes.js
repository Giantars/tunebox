'use strict';
let songSwipe = null, songSwipeClick = null;
const songSwipeFeedbackVersions = new WeakMap();
let queuedIdsCache = { queue: null };
function queuedTrackIds() {
  const current = curTrack(), unloaded = !!current && !hasRealSrc() && !(curIsYT() && ytLoaded());
  const cache = queuedIdsCache;
  if (cache.queue !== S.queue || cache.length !== S.queue.length || cache.qi !== S.qi || cache.unloaded !== unloaded) {
    const ids = new Set(S.queue.slice(Math.max(0, S.qi + 1)).map(t => t.id));
    if (unloaded) ids.add(current.id);
    queuedIdsCache = { queue: S.queue, length: S.queue.length, qi: S.qi, unloaded, ids };
  }
  return queuedIdsCache.ids;
}
function syncQueuedRows() {
  const ids = queuedTrackIds();
  document.querySelectorAll('#view .row[data-swipe-queue]').forEach(row => row.classList.toggle('is-queued', ids.has(row.dataset.trackId)));
}
function resetSongSwipe() {
  const gesture = songSwipe; songSwipe = null;
  if (!gesture) return;
  gesture.row.classList.remove('song-swiping', 'song-swipe-ready');
  gesture.row.style.removeProperty('--song-swipe');
  if (gesture.row.hasPointerCapture?.(gesture.pointer)) gesture.row.releasePointerCapture(gesture.pointer);
}
function queueSwipeFeedback(row) {
  const version = (songSwipeFeedbackVersions.get(row) || 0) + 1;
  songSwipeFeedbackVersions.set(row, version);
  row.classList.add('song-swipe-done'); row.style.setProperty('--song-swipe', '82px');
  setTimeout(() => {
    if (songSwipeFeedbackVersions.get(row) !== version || row.classList.contains('song-swiping')) return;
    row.classList.remove('song-swipe-done'); row.classList.add('song-swipe-returning');
    row.style.removeProperty('--song-swipe');
    setTimeout(() => { if (songSwipeFeedbackVersions.get(row) === version) row.classList.remove('song-swipe-returning'); }, 220);
  }, 650);
}
document.addEventListener('pointerdown', event => {
  if (songSwipe && !event.isPrimary) { resetSongSwipe(); return; }
  if (!event.isPrimary || event.button !== 0 || !(event.target instanceof Element)) return;
  const row = event.target.closest('#view .row[data-swipe-queue]');
  if (!row || row.closest('[inert]') || event.target.closest('button, input, a')) return;
  const track = (S.lists[row.dataset.list] || [])[Number(row.dataset.i)];
  if (!track || track.id !== row.dataset.trackId || !canBrowseTrack(track)) return;
  resetSongSwipe();
  songSwipeFeedbackVersions.set(row, (songSwipeFeedbackVersions.get(row) || 0) + 1);
  row.classList.remove('song-swipe-done', 'song-swipe-returning');
  row.style.removeProperty('--song-swipe');
  songSwipe = { row, track, pointer: event.pointerId, x: event.clientX, y: event.clientY,
    dx: 0, locked: false, scroll: pageScroll.scrollTop, threshold: Math.max(64, Math.min(88, row.clientWidth * .25)) };
}, { passive: true });
document.addEventListener('pointermove', event => {
  const gesture = songSwipe; if (!gesture || gesture.pointer !== event.pointerId) return;
  if (!gesture.row.isConnected || gesture.row.dataset.trackId !== gesture.track.id || gesture.row.closest('[inert]')) { resetSongSwipe(); return; }
  const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
  if (!gesture.locked) {
    if (Math.abs(dy) > 8 && Math.abs(dy) >= Math.abs(dx) * .8) { resetSongSwipe(); return; }
    if (dx > 10 || pageScroll.scrollTop !== gesture.scroll) { resetSongSwipe(); return; }
    if (dx < -12 && -dx > Math.abs(dy) * 1.4) {
      gesture.locked = true; gesture.row.classList.add('song-swiping');
      gesture.row.setPointerCapture?.(event.pointerId);
    }
  }
  if (!gesture.locked) return;
  if (event.cancelable) event.preventDefault();
  gesture.dx = dx;
  const distance = Math.min(112, Math.max(0, -dx));
  gesture.row.style.setProperty('--song-swipe', distance + 'px');
  gesture.row.classList.toggle('song-swipe-ready', -dx >= gesture.threshold);
}, { passive: false });
document.addEventListener('pointerup', event => {
  const gesture = songSwipe; if (!gesture || gesture.pointer !== event.pointerId) return;
  const valid = gesture.locked && gesture.row.isConnected && gesture.row.dataset.trackId === gesture.track.id
    && !gesture.row.closest('[inert]') && pageScroll.scrollTop === gesture.scroll && canBrowseTrack(gesture.track);
  if (gesture.locked) songSwipeClick = { x: event.clientX, y: event.clientY, until: performance.now() + 700 };
  resetSongSwipe();
  if (!valid || gesture.dx > -gesture.threshold) return;
  playNext(gesture.track, { startIfEmpty: false });
  syncQueuedRows(); queueSwipeFeedback(gesture.row);
  announceQueue(gesture.track.title + ' added to Play next');
}, { passive: true });
document.addEventListener('pointercancel', event => { if (songSwipe?.pointer === event.pointerId) resetSongSwipe(); }, { passive: true });
document.addEventListener('click', event => {
  const blocked = songSwipeClick;
  if (blocked && event.isTrusted && event.detail && performance.now() < blocked.until
      && Math.hypot(event.clientX - blocked.x, event.clientY - blocked.y) < 35) {
    songSwipeClick = null; event.preventDefault(); event.stopImmediatePropagation();
  }
}, true);
window.addEventListener('blur', resetSongSwipe);
window.addEventListener('resize', resetSongSwipe, { passive: true });
document.addEventListener('visibilitychange', () => { if (document.hidden) resetSongSwipe(); });
