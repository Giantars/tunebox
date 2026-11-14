'use strict';
const THEME_LABELS = { zoro: 'Zoro · Asura', sophie: 'Sophie · Stars', meteor: 'Meteor night', forest: 'White forest', dark: 'Original' };
const THEME_DETAILS = { zoro: 'Official character art', sophie: "Howl's Moving Castle", meteor: 'A little after dark', forest: 'Light & quiet', dark: 'Classic dark' };
let themePreview = null;
function themeHasMotion(theme) { return ['zoro', 'sophie', 'meteor'].includes(theme); }
function appearanceSettingsHTML() {
  return `<section class="group appearance-group" aria-labelledby="appearance-heading"><h2 id="appearance-heading" class="set-head">Appearance</h2><p class="small">Tap a look to preview it.</p><div class="appearance-options">${['zoro', 'sophie', 'meteor', 'forest', 'dark'].map(theme => `<button class="appearance-option ${theme === 'meteor' ? 'meteor-option' : ''}" data-act="appearance" data-theme="${theme}" aria-label="Preview ${esc(THEME_LABELS[theme])}" aria-pressed="${settings.appearance === theme}"><span class="appearance-swatch ${theme}-swatch" aria-hidden="true"></span><span>${esc(THEME_LABELS[theme])}<small>${esc(THEME_DETAILS[theme])}</small></span><span class="appearance-check" aria-hidden="true">${icon('check')}</span></button>`).join('')}</div>
    <label class="brightness-setting" for="wallpaperBrightness"><span>Wallpaper brightness <output id="brightnessValue">${settings.wallpaperBrightness}%</output></span><input type="range" id="wallpaperBrightness" min="35" max="120" step="1" value="${settings.wallpaperBrightness}"></label>
    ${themeHasMotion(settings.appearance) ? `<label class="set-row sky-motion-setting"><span>Animate background<small>${settings.appearance === 'zoro' ? 'Violet sparks drift past the artwork.' : 'A few falling stars across the night sky.'}</small></span><input type="checkbox" class="switch" id="skyMotion" ${settings.skyMotion ? 'checked' : ''}></label>` : ''}
    ${appearanceCredit(settings.appearance)}</section>`;
}
function appearanceCredit(theme) {
  const credits = {
    zoro: ['https://opbr-en.bn-ent.net/character/detail/0002.html', 'Bandai Namco · 1220 × 1220'],
    sophie: ['https://www.ghibli.jp/works/howl/', 'Studio Ghibli · 1920 × 1038'],
    forest: ['https://unsplash.com/photos/photo-of-snow-coated-birch-trees-9erhhb8WwqI', 'Unsplash · 3840 × 2604'],
  };
  const source = credits[theme];
  return source ? `<p class="small wallpaper-credit">${theme === 'forest' ? 'Photo' : 'Artwork'}: <a href="${source[0]}" target="_blank" rel="noopener">${source[1]}</a></p>` : '';
}
function openThemePreview(theme) {
  if (!APPEARANCES.includes(theme)) return;
  themePreview = { theme, brightness: settings.wallpaperBrightness, motion: settings.skyMotion };
  applyAppearance(theme, themePreview.brightness, themePreview.motion);
  const el = document.createElement('section'); el.id = 'themePreview'; el.className = 'theme-preview';
  el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', `${THEME_LABELS[theme]} preview`);
  const t = curTrack() || [...S.tracks.values()][0];
  el.innerHTML = `${theme === 'forest' ? '<img class="preview-forest" src="assets/white-forest-photo.webp" alt="">' : ''}<header class="preview-header"><div><span class="app-label">Preview</span><h1>${esc(THEME_LABELS[theme])}</h1></div><button class="icon" data-act="theme-cancel" aria-label="Close preview">${icon('x')}</button></header><div class="preview-space" aria-hidden="true"></div><div class="preview-example" aria-hidden="true">${t ? art(t, 'art') : `<span class="art ph">${icon('music')}</span>`}<span class="meta"><span class="t">${t ? esc(t.title) : 'Your music'}</span><span class="a">${t ? esc(t.artist) : 'A look for your library'}</span></span>${icon('play')}</div><section class="preview-controls"><label class="brightness-setting" for="previewBrightness"><span>Wallpaper brightness <output id="previewBrightnessValue">${themePreview.brightness}%</output></span><input type="range" id="previewBrightness" min="35" max="120" step="1" value="${themePreview.brightness}"></label><label class="set-row"><span>Animation<small>${themeHasMotion(theme) ? 'Respects Reduce Motion on your device.' : 'This wallpaper is still.'}</small></span><input type="checkbox" class="switch" id="previewMotion" ${themePreview.motion ? 'checked' : ''} ${themeHasMotion(theme) ? '' : 'disabled'}></label>${appearanceCredit(theme)}<div class="preview-actions"><button class="btn" data-act="theme-cancel">Cancel</button><button class="btn primary" data-act="theme-apply">Apply look</button></div></section>`;
  $('#appViewport').appendChild(el); document.body.classList.add('theme-preview-open');
  syncOverlayState(); el.querySelector('[data-act="theme-cancel"]').focus({ preventScroll: true });
}
function closeThemePreview(apply = false) {
  if (!themePreview) return;
  const theme = themePreview.theme;
  if (apply) {
    settings.appearance = theme; settings.wallpaperBrightness = themePreview.brightness; settings.skyMotion = themePreview.motion;
    store.set('appearance', theme); store.set('wallpaperBrightness', settings.wallpaperBrightness); store.set('skyMotion', settings.skyMotion);
  }
  themePreview = null; $('#themePreview')?.remove(); document.body.classList.remove('theme-preview-open');
  applyAppearance(); syncOverlayState(); render();
  $(`[data-act="appearance"][data-theme="${theme}"]`)?.focus({ preventScroll: true });
}
function updateWallpaperBrightness(value, preview = false) {
  const brightness = Math.max(35, Math.min(120, Number(value) || 100));
  if (preview && themePreview) {
    themePreview.brightness = brightness; applyAppearance(themePreview.theme, brightness, themePreview.motion);
    $('#previewBrightnessValue').textContent = brightness + '%';
  } else {
    settings.wallpaperBrightness = brightness; store.set('wallpaperBrightness', brightness); applyAppearance();
    if ($('#brightnessValue')) $('#brightnessValue').textContent = brightness + '%';
  }
}
