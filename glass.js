'use strict';
/* The browser composites one live backdrop. Never copy, repaint, or sample
   scrolling content in JS: those snapshots lag behind iOS momentum scrolling.
   This helper adds only a touch highlight; controls remain ordinary buttons. */
(() => {
  const dock = document.querySelector('.tabs');
  if (!dock || matchMedia('(prefers-reduced-transparency: reduce)').matches) return;
  dock.addEventListener('pointerdown', e => {
    if (!e.target.closest('button')) return;
    const bounds = dock.getBoundingClientRect();
    dock.style.setProperty('--touch-x', `${e.clientX - bounds.left}px`);
    dock.classList.add('is-touched');
  }, { passive: true });
  const release = () => dock.classList.remove('is-touched');
  window.addEventListener('pointerup', release, { passive: true });
  window.addEventListener('pointercancel', release, { passive: true });
  window.addEventListener('blur', release);
  document.addEventListener('visibilitychange', () => { if (document.hidden) release(); });
})();
