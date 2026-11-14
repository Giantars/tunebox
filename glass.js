'use strict';
/* Toolbar gestures own the initial touch, including during iOS momentum scroll.
   Scroll handling only reads scrollY; it never samples layout or artwork. */
(() => {
  const dock = document.querySelector('.tabs');
  if (!dock) return;
  const roots = [dock, document.querySelector('#mini'), document.querySelector('#compactNav')].filter(Boolean);
  const buttons = [...dock.querySelectorAll('button[data-tab]')];
  const useTouchEvents = 'ontouchstart' in window;
  let gesture = null, suppressClick = false;
  let lastY = Math.max(0, window.scrollY), direction = 0, travel = 0, lockedUntil = 0;
  function preview(x, time) {
    const g = gesture;
    const local = Math.max(4, Math.min(g.bounds.width - 4, x - g.bounds.left));
    const cell = (g.bounds.width - 8) / buttons.length;
    g.index = Math.max(0, Math.min(buttons.length - 1, Math.floor((local - 4) / cell)));
    const offset = Math.max(0, Math.min(g.bounds.width - 8 - cell, local - 4 - cell / 2));
    const speed = Math.abs(x - g.lastX) / Math.max(8, time - g.lastTime);
    const stretch = Math.min(.12, speed * .045);
    dock.style.setProperty('--touch-x', `${local}px`);
    dock.style.setProperty('--lens-x', `${offset}px`);
    dock.style.setProperty('--lens-sx', String(1.06 + stretch));
    dock.style.setProperty('--lens-sy', String(1.06 - stretch * .3));
    g.lastX = x; g.lastTime = time;
    buttons.forEach((b, i) => b.classList.toggle('scrub-target', i === g.index));
  }
  function reset() {
    const previous = gesture;
    gesture = null;
    dock.classList.remove('is-touched', 'is-scrubbing');
    buttons.forEach(b => b.classList.remove('scrub-target'));
    if (previous) {
      previous.target.classList.remove('toolbar-pressed');
      if (previous.kind === 'pointer' && previous.root.hasPointerCapture(previous.id)) previous.root.releasePointerCapture(previous.id);
    }
  }
  function begin(root, target, x, y, id, kind, time) {
    if (gesture || !(target instanceof Element)) return false;
    const control = target.closest('[data-act]');
    if (!control || !root.contains(control)) return false;
    const tabs = root === dock && control.matches('button[data-tab]');
    const bounds = (tabs ? dock : control).getBoundingClientRect();
    // A same-position programmatic scroll stops native deceleration. Owning the
    // touch below avoids relying on Safari's momentum-suppressed click event.
    const position = Math.max(0, window.scrollY);
    window.scrollTo(0, position);
    lastY = position; travel = 0; suppressClick = false;
    gesture = { id, kind, root, target: control, bounds, tabs, startX: x, startY: y, lastX: x, lastTime: time, dragged: false, index: 0, startIndex: buttons.indexOf(control) };
    control.classList.add('toolbar-pressed');
    if (tabs) { preview(x, time); dock.classList.add('is-touched'); }
    return true;
  }
  function move(x, y, time) {
    if (!gesture) return;
    const g = gesture, dx = Math.abs(x - g.startX), dy = Math.abs(y - g.startY);
    if (g.tabs && !g.dragged && dx > 14 && dx > dy * 1.35) {
      g.dragged = true;
      dock.classList.add('is-scrubbing');
    }
    if (g.tabs && g.dragged) preview(x, time);
  }
  function finish(x, y, time) {
    if (!gesture) return;
    const g = gesture;
    if (g.tabs && g.dragged) preview(x, time);
    const inside = x >= g.bounds.left - 16 && x <= g.bounds.right + 16 && y >= g.bounds.top - 16 && y <= g.bounds.bottom + 16;
    const tap = Math.abs(y - g.startY) <= 24 && (g.tabs || Math.abs(x - g.startX) <= 24);
    const target = g.tabs ? buttons[g.dragged ? g.index : g.startIndex] : g.target;
    suppressClick = true;
    reset();
    if (inside && (g.dragged || tap)) target.click();
  }
  for (const root of roots) {
    root.addEventListener('touchstart', e => {
      if (e.touches.length !== 1) { reset(); return; }
      const t = e.changedTouches[0];
      if (!t || !begin(root, e.target, t.clientX, t.clientY, t.identifier, 'touch', e.timeStamp)) return;
      if (e.cancelable) e.preventDefault();
    }, { passive: false });
    root.addEventListener('touchmove', e => {
      if (gesture?.kind !== 'touch') return;
      const t = [...e.changedTouches].find(t => t.identifier === gesture.id);
      if (!t) return;
      if (e.cancelable) e.preventDefault();
      move(t.clientX, t.clientY, e.timeStamp);
    }, { passive: false });
    root.addEventListener('touchend', e => {
      if (gesture?.kind !== 'touch') return;
      const t = [...e.changedTouches].find(t => t.identifier === gesture.id);
      if (!t) return;
      if (e.cancelable) e.preventDefault();
      finish(t.clientX, t.clientY, e.timeStamp);
    }, { passive: false });
    root.addEventListener('touchcancel', () => { if (gesture?.kind === 'touch') reset(); }, { passive: true });
    root.addEventListener('pointerdown', e => {
      if (!e.isPrimary || e.button !== 0 || (e.pointerType === 'touch' && useTouchEvents)) return;
      if (begin(root, e.target, e.clientX, e.clientY, e.pointerId, 'pointer', e.timeStamp)) root.setPointerCapture(e.pointerId);
    }, { passive: true });
    root.addEventListener('pointermove', e => {
      if (gesture?.kind === 'pointer' && e.pointerId === gesture.id) move(e.clientX, e.clientY, e.timeStamp);
    }, { passive: true });
    root.addEventListener('lostpointercapture', e => {
      if (gesture?.kind === 'pointer' && e.target === gesture.root && e.pointerId === gesture.id) reset();
    });
    root.addEventListener('click', e => {
      if (!suppressClick || !e.isTrusted || e.detail === 0) return;
      suppressClick = false;
      e.preventDefault(); e.stopPropagation();
    }, true);
  }
  window.addEventListener('pointerup', e => {
    if (gesture?.kind === 'pointer' && e.pointerId === gesture.id) finish(e.clientX, e.clientY, e.timeStamp);
  }, { passive: true });
  window.addEventListener('pointercancel', e => {
    if (gesture?.kind === 'pointer' && e.pointerId === gesture.id) reset();
  }, { passive: true });
  window.addEventListener('blur', reset);
  document.addEventListener('visibilitychange', () => { if (document.hidden) reset(); });
  document.addEventListener('dock-layout', e => {
    if (e.detail.source !== 'scroll') {
      lockedUntil = performance.now() + 800;
      lastY = Math.max(0, window.scrollY); travel = 0;
    }
  });
  window.addEventListener('scroll', () => {
    const y = Math.max(0, window.scrollY), delta = y - lastY;
    lastY = y;
    if (gesture) { travel = 0; return; }
    if (y < 24) { travel = 0; setDockCompact(false, 'scroll'); return; }
    const focus = document.activeElement;
    if (!curTrack() || performance.now() < lockedUntil || document.querySelector('#np.open')
      || /^(INPUT|TEXTAREA|SELECT)$/.test(focus?.tagName || '')
      || (dock.contains(focus) && focus.matches(':focus-visible'))) { travel = 0; return; }
    if (Math.abs(delta) < 1) return;
    const nextDirection = Math.sign(delta);
    if (nextDirection !== direction) { direction = nextDirection; travel = 0; }
    travel += Math.abs(delta);
    if (direction > 0 && y > 80 && travel >= 40) { setDockCompact(true, 'scroll'); travel = 0; }
    else if (direction < 0 && travel >= 24) { setDockCompact(false, 'scroll'); travel = 0; }
  }, { passive: true });
  document.addEventListener('focusin', e => {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) setDockCompact(false, 'focus');
  });
  window.addEventListener('resize', () => { setDockCompact(false, 'resize'); lastY = Math.max(0, window.scrollY); travel = 0; }, { passive: true });
})();
