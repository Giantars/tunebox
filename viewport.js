'use strict';
/* One frame for page content, dock and dialogs, including Safari viewport changes. */
(() => {
  const root = document.documentElement;
  let frame = 0, previous = '';
  let restingHeight = window.visualViewport?.height || innerHeight;
  let searchSession = false, referenceHeight = restingHeight, referenceWidth = innerWidth;
  let opening = false, openingTimer = null;
  function syncKeyboard(size) {
    const focused = document.activeElement?.id === 'q';
    const touchScreen = matchMedia('(pointer:coarse)').matches || /iPhone|iPad|iPod/i.test(navigator.userAgent);
    if (focused && !searchSession) {
      searchSession = true;
      referenceHeight = Math.max(restingHeight, innerHeight, size[1]); referenceWidth = size[0];
      opening = touchScreen;
      if (opening && window.visualViewport) openingTimer = setTimeout(() => { opening = false; schedule(); }, 650);
    }
    if (searchSession && Math.abs(size[0] - referenceWidth) > 40) {
      referenceWidth = size[0]; referenceHeight = Math.max(innerHeight, size[1]);
    }
    const keyboardVisible = searchSession && touchScreen && Math.abs((window.visualViewport?.scale || 1) - 1) < .01 && referenceHeight - size[1] > 120;
    if (keyboardVisible) opening = false;
    const hide = searchSession && (keyboardVisible || (focused && opening) || (focused && !window.visualViewport && touchScreen));
    document.body.classList.toggle('search-keyboard', !!hide);
    if (!focused && !keyboardVisible) {
      searchSession = false; opening = false;
      clearTimeout(openingTimer); openingTimer = null; restingHeight = size[1];
    } else if (!searchSession) restingHeight = size[1];
  }
  function update() {
    frame = 0;
    const viewport = window.visualViewport;
    const size = [viewport?.width || innerWidth, viewport?.height || innerHeight, viewport?.offsetLeft || 0, viewport?.offsetTop || 0];
    syncKeyboard(size);
    if (viewport && Math.abs(viewport.scale - 1) > .01) return;
    const key = size.join('|');
    if (key === previous) return;
    previous = key;
    ['width', 'height', 'left', 'top'].forEach((name, i) => root.style.setProperty(`--viewport-${name}`, `${size[i]}px`));
  }
  function schedule() { if (!frame) frame = requestAnimationFrame(update); }
  window.addEventListener('resize', schedule, { passive: true });
  window.visualViewport?.addEventListener('resize', () => { opening = false; schedule(); }, { passive: true });
  window.visualViewport?.addEventListener('scroll', schedule, { passive: true });
  document.addEventListener('focusin', () => { update(); });
  document.addEventListener('focusout', schedule);
  new MutationObserver(schedule).observe(document.querySelector('#view'), { childList: true });
  update();
})();
