'use strict';
/* A tap activates once even when Safari consumes the native click to stop scrolling.
   Movement stays native, and toolbar gestures remain owned by glass.js. */
(() => {
  let tap = null, compatibilityClick = null;
  const toolbar = '#mainTabs, #mini, #compactNav';
  document.addEventListener('touchstart', event => {
    document.body.classList.add('touch-input');
    tap = null;
    if (event.touches.length !== 1 || !(event.target instanceof Element) || event.target.closest(toolbar)) return;
    const control = event.target.closest('[data-act]');
    if (!control || control.matches(':disabled') || control.closest('[inert]')) return;
    const touch = event.changedTouches[0];
    tap = { control, id: touch.identifier, x: touch.clientX, y: touch.clientY, moved: false };
  }, { capture: true, passive: true });
  document.addEventListener('touchmove', event => {
    if (!tap) return;
    const touch = [...event.changedTouches].find(t => t.identifier === tap.id);
    if (!touch || event.touches.length !== 1) { tap = null; return; }
    if (Math.hypot(touch.clientX - tap.x, touch.clientY - tap.y) > 10) tap.moved = true;
  }, { capture: true, passive: true });
  document.addEventListener('touchend', event => {
    const pending = tap; tap = null;
    if (!pending || pending.moved || !pending.control.isConnected || pending.control.closest('[inert]')) return;
    const touch = [...event.changedTouches].find(t => t.identifier === pending.id);
    if (!touch || Math.hypot(touch.clientX - pending.x, touch.clientY - pending.y) > 10) return;
    if (event.cancelable) event.preventDefault();
    compatibilityClick = { x: touch.clientX, y: touch.clientY, until: performance.now() + 700 };
    pending.control.click();
  }, { capture: true, passive: false });
  document.addEventListener('touchcancel', () => { tap = null; }, { capture: true, passive: true });
  document.addEventListener('click', event => {
    const ghost = compatibilityClick;
    if (!ghost || !event.isTrusted || !event.detail || performance.now() > ghost.until) return;
    if (Math.hypot(event.clientX - ghost.x, event.clientY - ghost.y) < 30) {
      compatibilityClick = null;
      event.preventDefault(); event.stopImmediatePropagation();
    }
  }, true);
  document.addEventListener('keydown', event => {
    document.body.classList.remove('touch-input');
    const sheet = document.querySelector('#sheet:not(.hidden) .sheet-card');
    const player = document.querySelector('#np.open');
    const dialog = sheet || player;
    if (!dialog) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      if (sheet) document.querySelector('.sheet-btn.cancel').click();
      else document.querySelector('[data-act="close-np"]').click();
    } else if (event.key === 'Tab') {
      const controls = [...dialog.querySelectorAll('button:not(:disabled), input:not(:disabled), a[href], [tabindex="0"]')]
        .filter(el => !el.closest('[inert]') && el.getClientRects().length);
      const first = controls[0], last = controls[controls.length - 1];
      if (!first) return;
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    }
  });
  document.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse') document.body.classList.remove('touch-input');
  }, { capture: true, passive: true });
})();
