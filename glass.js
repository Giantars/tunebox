'use strict';
/* One browser-composited backdrop. Only the navigation lens moves during touch;
   page scrolling never triggers snapshots, canvas draws, or layout reads. */
(() => {
  const dock = document.querySelector('.tabs');
  if (!dock) return;
  const buttons = [...dock.querySelectorAll('button[data-tab]')];
  let gesture = null, suppressClick = false;
  function preview(e) {
    const g = gesture;
    const x = Math.max(4, Math.min(g.bounds.width - 4, e.clientX - g.bounds.left));
    const cell = (g.bounds.width - 8) / buttons.length;
    g.index = Math.max(0, Math.min(buttons.length - 1, Math.floor((x - 4) / cell)));
    const offset = Math.max(0, Math.min(g.bounds.width - 8 - cell, x - 4 - cell / 2));
    dock.style.setProperty('--touch-x', `${x}px`);
    dock.style.setProperty('--lens-x', `${offset}px`);
    buttons.forEach((b, i) => b.classList.toggle('scrub-target', i === g.index));
  }
  function reset() {
    const previous = gesture;
    gesture = null;
    dock.classList.remove('is-touched', 'is-scrubbing');
    buttons.forEach(b => b.classList.remove('scrub-target'));
    if (previous && dock.hasPointerCapture(previous.id)) dock.releasePointerCapture(previous.id);
  }
  dock.addEventListener('pointerdown', e => {
    const target = e.target.closest('button[data-tab]');
    if (!e.isPrimary || e.button !== 0 || !target) return;
    suppressClick = false;
    gesture = { id: e.pointerId, startX: e.clientX, startY: e.clientY, bounds: dock.getBoundingClientRect(), dragged: false, index: 0, startIndex: buttons.indexOf(target) };
    preview(e);
    dock.classList.add('is-touched');
    // Own the full gesture, including taps that drift between an icon and label.
    dock.setPointerCapture(e.pointerId);
  }, { passive: true });
  dock.addEventListener('pointermove', e => {
    if (!gesture || e.pointerId !== gesture.id) return;
    const dx = Math.abs(e.clientX - gesture.startX);
    const dy = Math.abs(e.clientY - gesture.startY);
    if (!gesture.dragged && dx > 14 && dx > dy * 1.35) {
      gesture.dragged = true;
      dock.classList.add('is-scrubbing');
    }
    if (gesture.dragged) preview(e);
  }, { passive: true });
  window.addEventListener('pointerup', e => {
    if (!gesture || e.pointerId !== gesture.id) return;
    const g = gesture;
    if (g.dragged) preview(e);
    const inside = e.clientY >= g.bounds.top - 16 && e.clientY <= g.bounds.bottom + 16
      && e.clientX >= g.bounds.left - 16 && e.clientX <= g.bounds.right + 16;
    const tap = Math.abs(e.clientY - g.startY) <= 24;
    const target = buttons[g.dragged ? g.index : g.startIndex];
    // Every pointer gesture uses the same activation path. Suppress the later
    // browser compatibility click, while preserving keyboard and AT clicks.
    suppressClick = true;
    reset();
    if (inside && (g.dragged || tap)) target.click();
  }, { passive: true });
  dock.addEventListener('click', e => {
    if (!suppressClick || !e.isTrusted || e.detail === 0) return;
    suppressClick = false;
    e.preventDefault();
    e.stopPropagation();
  }, true);
  window.addEventListener('pointercancel', reset, { passive: true });
  dock.addEventListener('lostpointercapture', e => {
    // Touch starts with implicit capture on the original icon. Its capture-loss
    // event bubbles when the dock takes over; only reset if the dock loses it.
    if (e.target === dock && gesture && e.pointerId === gesture.id) reset();
  });
  window.addEventListener('blur', reset);
  document.addEventListener('visibilitychange', () => { if (document.hidden) reset(); });
})();
