'use strict';
let queueGesture = null, queueDragFrame = 0, queueClickBlock = null;
function queueGestureActive() { return !!queueGesture && sameQueue(queueGesture); }
function moveQueuedTrack(from, to) {
  from = Number(from); to = Number(to);
  if (!Number.isInteger(from) || !Number.isInteger(to) || from <= S.qi || to <= S.qi || from >= S.queue.length || to >= S.queue.length || from === to) return false;
  const boundary = S.qi + S.pn;
  if (from <= boundary && to > boundary) S.pn--;
  else if (from > boundary && to <= boundary) S.pn++;
  const [track] = S.queue.splice(from, 1); S.queue.splice(to, 0, track);
  if (S.orig) S.orig = S.queue.slice();
  saveQueue(); renderQueue(); announceQueue(`Moved ${track.title} to position ${to - S.qi}`);
  return true;
}
function removeQueuedTrack(index) {
  index = Number(index);
  if (!Number.isInteger(index) || index <= S.qi || index >= S.queue.length) return false;
  const [track] = S.queue.splice(index, 1);
  if (index <= S.qi + S.pn && S.pn > 0) S.pn--;
  if (S.orig) S.orig = S.queue.slice();
  saveQueue(); renderQueue(); announceQueue(`Removed ${track.title} from queue`);
  return true;
}
function announceQueue(message) {
  const status = $('#queueAnnounce'); if (status) status.textContent = message;
}
function queueMoveMenu(index) {
  index = Number(index); const track = S.queue[index];
  if (!track || index <= S.qi) return;
  const items = [];
  if (index > S.qi + 1) items.push({ label: 'Move up', fn: () => moveQueuedTrack(index, index - 1) });
  if (index < S.queue.length - 1) items.push({ label: 'Move down', fn: () => moveQueuedTrack(index, index + 1) });
  items.push({ label: 'Remove from queue', danger: true, fn: () => removeQueuedTrack(index) });
  sheet(trackTitleHtml(track), items);
}
function renderQueueContent() {
  const current = curTrack(), count = Math.max(0, S.queue.length - S.qi - 1);
  const upcoming = S.queue.slice(S.qi + 1).map((t, offset) => {
    const i = S.qi + 1 + offset;
    return `<div class="queue-entry" data-queue-index="${i}"><button class="queue-remove" data-act="queue-remove" data-i="${i}" aria-label="Remove ${esc(t.title)} from queue">Remove</button><div class="queue-row">${row('queue', t, i, 'q-play')}<button class="queue-grip icon" data-act="queue-move" data-i="${i}" aria-label="Reorder ${esc(t.title)}. Drag, or use arrow keys.">${icon('grip')}</button></div>${offset === 0 ? '<span class="queue-next">Next</span>' : ''}</div>`;
  }).join('');
  return `<div class="queue-heading"><h2>Playing now</h2><span class="small">${S.shuffle ? 'Shuffle on' : ''}</span></div>${current ? row('queue', current, S.qi, 'q-play') : ''}<div class="queue-heading"><h2>Up next</h2><span class="small">${count} songs</span></div>${count ? `<p class="queue-help small">Drag the handle to reorder. Swipe left to remove.</p><div class="queue-future">${upcoming}</div>` : '<div class="msg">Choose a song’s menu and tap Play next to add it here.</div>'}`;
}
function cancelQueueGesture() {
  if (queueDragFrame) cancelAnimationFrame(queueDragFrame);
  queueDragFrame = 0;
  if (queueGesture) {
    queueGesture.entry.classList.remove('queue-dragging', 'queue-swiping');
    queueGesture.entry.style.transform = ''; queueGesture.row.style.transform = '';
  }
  $$('.queue-drop-target').forEach(el => el.classList.remove('queue-drop-target'));
  document.body.classList.remove('queue-gesturing'); queueGesture = null;
}
function sameQueue(gesture) { return S.qi === gesture.qi && S.queue.length === gesture.snapshot.length && gesture.snapshot.every((t, i) => S.queue[i] === t); }
function updateQueueDrag() {
  const g = queueGesture;
  if (!g || g.kind !== 'drag') return;
  const delta = $('#npQueue').scrollTop - g.scroll;
  g.to = Math.max(S.qi + 1, Math.min(S.queue.length - 1, S.qi + 1 + Math.floor((g.y - g.listTop + delta) / g.height)));
  g.entry.style.transform = `translateY(${g.y - g.startY + delta}px)`;
  $$('.queue-drop-target').forEach(el => el.classList.remove('queue-drop-target'));
  $(`[data-queue-index="${g.to}"]`)?.classList.add('queue-drop-target');
}
function queueAutoScroll() {
  queueDragFrame = 0;
  const g = queueGesture;
  if (!g || g.kind !== 'drag' || !g.moved) return;
  const speed = g.y < g.panelTop + 44 ? -Math.min(12, (g.panelTop + 44 - g.y) / 3)
    : g.y > g.panelBottom - 44 ? Math.min(12, (g.y - g.panelBottom + 44) / 3) : 0;
  if (speed) { $('#npQueue').scrollTop += speed; updateQueueDrag(); }
  queueDragFrame = requestAnimationFrame(queueAutoScroll);
}
document.addEventListener('pointerdown', event => {
  if (!event.isPrimary || event.button !== 0 || queueGesture || !(event.target instanceof Element)) return;
  const entry = event.target.closest('.queue-entry');
  if (!entry || entry.closest('[inert]')) return;
  const grip = event.target.closest('.queue-grip');
  if (!grip && event.target.closest('button')) return;
  $$('.queue-entry.revealed').forEach(el => { if (el !== entry) el.classList.remove('revealed'); });
  const bounds = entry.getBoundingClientRect(), panel = $('#npQueue').getBoundingClientRect();
  queueGesture = { kind: grip ? 'drag' : 'swipe', pointer: event.pointerId, entry, row: entry.querySelector('.queue-row'),
    index: Number(entry.dataset.queueIndex), to: Number(entry.dataset.queueIndex), qi: S.qi, snapshot: S.queue.slice(),
    x: event.clientX, y: event.clientY, startY: event.clientY, scroll: $('#npQueue').scrollTop,
    listTop: $('.queue-future').getBoundingClientRect().top, height: bounds.height,
    panelTop: panel.top, panelBottom: panel.bottom, moved: false, dx: 0 };
  if (grip) grip.setPointerCapture(event.pointerId);
}, { passive: true });
document.addEventListener('pointermove', event => {
  const g = queueGesture; if (!g || g.pointer !== event.pointerId) return;
  if (!sameQueue(g) || !g.entry.isConnected) { cancelQueueGesture(); return; }
  g.y = event.clientY; g.dx = event.clientX - g.x;
  if (g.kind === 'swipe') {
    if (!g.moved && Math.abs(g.y - g.startY) > Math.max(10, Math.abs(g.dx))) { cancelQueueGesture(); return; }
    if (g.dx > 0 && !g.entry.classList.contains('revealed')) return;
    if (Math.abs(g.dx) > 10) {
      g.moved = true; g.entry.classList.add('queue-swiping'); document.body.classList.add('queue-gesturing');
      if (event.cancelable) event.preventDefault();
      const offset = g.entry.classList.contains('revealed') ? -80 : 0;
      g.row.style.transform = `translateX(${Math.min(0, Math.max(-g.entry.clientWidth, g.dx + offset))}px)`;
    }
  } else if (Math.abs(g.y - g.startY) > 5 || g.moved) {
    g.moved = true; g.entry.classList.add('queue-dragging'); document.body.classList.add('queue-gesturing');
    if (event.cancelable) event.preventDefault();
    updateQueueDrag(); if (!queueDragFrame) queueDragFrame = requestAnimationFrame(queueAutoScroll);
  }
}, { passive: false });
document.addEventListener('pointerup', event => {
  const g = queueGesture; if (!g || g.pointer !== event.pointerId) return;
  const valid = sameQueue(g), moved = g.moved, width = g.entry.clientWidth;
  cancelQueueGesture();
  if (!valid || !moved) return;
  queueClickBlock = { x: event.clientX, y: event.clientY, until: performance.now() + 700 };
  if (g.kind === 'drag') moveQueuedTrack(g.index, g.to);
  else if (g.dx < -Math.max(150, width * .65)) removeQueuedTrack(g.index);
  else g.entry.classList.toggle('revealed', g.dx < -45);
}, { passive: true });
document.addEventListener('pointercancel', event => { if (queueGesture?.pointer === event.pointerId) cancelQueueGesture(); }, { passive: true });
document.addEventListener('click', event => {
  if (queueClickBlock && event.isTrusted && event.detail && performance.now() < queueClickBlock.until
    && Math.hypot(event.clientX - queueClickBlock.x, event.clientY - queueClickBlock.y) < 30) {
    queueClickBlock = null; event.preventDefault(); event.stopImmediatePropagation();
  }
}, true);
document.addEventListener('keydown', event => {
  const grip = event.target.closest?.('.queue-grip');
  if (!grip || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
  event.preventDefault(); const from = Number(grip.dataset.i), to = from + (event.key === 'ArrowUp' ? -1 : 1);
  if (moveQueuedTrack(from, to)) $(`.queue-grip[data-i="${to}"]`)?.focus({ preventScroll: true });
});
window.addEventListener('blur', cancelQueueGesture);
window.addEventListener('resize', cancelQueueGesture, { passive: true });
document.addEventListener('visibilitychange', () => { if (document.hidden) cancelQueueGesture(); });
