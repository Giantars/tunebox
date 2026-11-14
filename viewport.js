'use strict';
/* One frame for page content, dock and dialogs, including Safari viewport changes. */
(() => {
  const root = document.documentElement;
  let frame = 0, previous = '';
  function update() {
    frame = 0;
    const viewport = window.visualViewport;
    if (viewport && Math.abs(viewport.scale - 1) > .01) return;
    const size = [viewport?.width || innerWidth, viewport?.height || innerHeight, viewport?.offsetLeft || 0, viewport?.offsetTop || 0];
    const key = size.join('|');
    if (key === previous) return;
    previous = key;
    ['width', 'height', 'left', 'top'].forEach((name, i) => root.style.setProperty(`--viewport-${name}`, `${size[i]}px`));
  }
  function schedule() { if (!frame) frame = requestAnimationFrame(update); }
  window.addEventListener('resize', schedule, { passive: true });
  window.visualViewport?.addEventListener('resize', schedule, { passive: true });
  window.visualViewport?.addEventListener('scroll', schedule, { passive: true });
  update();
})();
