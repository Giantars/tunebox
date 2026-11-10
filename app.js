'use strict';
/* Tunebox — personal music player PWA.
   Sources: Audius (free API), Jamendo (free API, needs client_id), your own files.
   Every song played is auto-saved to IndexedDB so the next play is offline and stutter-free. */

const APP_NAME = 'tunebox_personal_player';
const AUDIUS = 'https://api.audius.co/v1';
const JAMENDO = 'https://api.jamendo.com/v3.0';
const MAX_SAVE_BYTES = 80 * 1024 * 1024;

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = s => {
  if (!isFinite(s) || s < 0) s = 0;
  s = Math.floor(s);
  const m = Math.floor(s / 60), x = String(s % 60).padStart(2, '0');
  return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${x}` : `${m}:${x}`;
};
const fmtBytes = b => b > 1e9 ? (b / 1e9).toFixed(2) + ' GB' : b > 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.round(b / 1e3) + ' KB';
const hue = id => { let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 360; };
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const shuffleArr = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

const store = {
  get(k, d) { try { const v = localStorage.getItem('tb.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('tb.' + k, JSON.stringify(v)); } catch { /* storage full or blocked */ } },
};

/* ---------------- IndexedDB ---------------- */
const DB = (() => {
  let dbp = null;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open('tunebox', 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        d.createObjectStore('tracks', { keyPath: 'id' });
        d.createObjectStore('blobs');
        d.createObjectStore('playlists', { keyPath: 'id' });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  async function tx(name, mode, fn) {
    const d = await open();
    return new Promise((res, rej) => {
      const t = d.transaction(name, mode);
      const req = fn(t.objectStore(name));
      let out;
      if (req) req.onsuccess = () => { out = req.result; };
      t.oncomplete = () => res(out);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error || new Error('transaction aborted'));
    });
  }
  return {
    get: (n, k) => tx(n, 'readonly', s => s.get(k)),
    put: (n, v, k) => tx(n, 'readwrite', s => (k === undefined ? s.put(v) : s.put(v, k))),
    del: (n, k) => tx(n, 'readwrite', s => s.delete(k)),
    all: n => tx(n, 'readonly', s => s.getAll()),
    keys: n => tx(n, 'readonly', s => s.getAllKeys()),
  };
})();

/* ---------------- State ---------------- */
const S = {
  tracks: new Map(),        // id -> canonical track object (persisted)
  cached: new Set(),        // ids with audio stored on the phone
  downloading: new Set(),
  playlists: [],
  queue: [], orig: null, qi: -1,
  pn: 0,                    // how many "Play next" songs are lined up after the current one
  shuffle: store.get('shuffle', false),
  repeat: store.get('repeat', 'off'),   // off | all | one
  tab: 'home', sub: null,
  source: store.get('source', 'audius'),
  q: '', results: [], searching: false, searchErr: '',
  trending: store.get('trending', []),
  lists: {},
  showQueue: false,
  restorePos: 0,
};
const settings = {
  jamendoId: store.get('jamendoId', ''),
  autoSave: store.get('autoSave', true),
  ytKey: store.get('ytKey', ''),
};

const audio = $('#audio');
const artUrls = new Map();   // id -> object URL for stored artwork

function canon(t) { return S.tracks.get(t.id) || t; }
function curTrack() { return S.queue[S.qi] || null; }
async function saveTrack(t) {
  S.tracks.set(t.id, t);
  try { await DB.put('tracks', t); } catch (e) { console.warn('saveTrack', e); }
}

/* ---------------- Sources ---------------- */
function fromAudius(t) {
  const aw = t.artwork || {};
  return {
    id: 'au:' + t.id, source: 'audius', rid: t.id,
    title: t.title || 'Untitled', artist: (t.user && t.user.name) || 'Unknown artist', album: '',
    duration: t.duration || 0, art: aw['480x480'] || aw['1000x1000'] || aw['150x150'] || '',
  };
}
function fromJamendo(t) {
  return {
    id: 'ja:' + t.id, source: 'jamendo', rid: t.id,
    title: t.name || 'Untitled', artist: t.artist_name || 'Unknown artist', album: t.album_name || '',
    duration: t.duration || 0, art: t.image || t.album_image || '', audio: t.audio,
  };
}
function streamUrl(t) {
  if (t.source === 'audius') return `${AUDIUS}/tracks/${encodeURIComponent(t.rid)}/stream?app_name=${APP_NAME}`;
  if (t.source === 'jamendo') return t.audio;
  return '';
}
async function fetchJSON(url, ms = 15000) {
  const ac = new AbortController();
  const tm = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(url, { signal: ac.signal });
    if (!r.ok) {
      let msg = 'HTTP ' + r.status;
      try {
        const j = await r.json();
        const reason = j.error && j.error.errors && j.error.errors[0] && j.error.errors[0].reason;
        if (reason === 'quotaExceeded') msg = 'Daily YouTube search limit reached. It resets tomorrow; saved songs still play.';
        else if (reason === 'keyInvalid' || /API key not valid/i.test(j.error && j.error.message)) msg = 'YouTube key is not valid. Check it in Settings.';
        else if (j.error && j.error.message) msg = j.error.message.replace(/<[^>]+>/g, '');
      } catch { /* non-JSON error body */ }
      throw new Error(msg);
    }
    return await r.json();
  } catch (e) {
    throw e.name === 'AbortError' ? new Error('timed out') : e;
  } finally { clearTimeout(tm); }
}
async function searchAudius(q) {
  const u = q ? `${AUDIUS}/tracks/search?query=${encodeURIComponent(q)}&limit=40&app_name=${APP_NAME}`
              : `${AUDIUS}/tracks/trending?limit=40&app_name=${APP_NAME}`;
  const j = await fetchJSON(u);
  return (j.data || []).filter(t => t.is_streamable !== false && !t.is_stream_gated && !t.is_delete).map(fromAudius);
}
async function searchJamendo(q) {
  const p = new URLSearchParams({ client_id: settings.jamendoId, format: 'json', limit: '40', audioformat: 'mp32', imagesize: '300' });
  if (q) p.set('search', q); else p.set('order', 'popularity_week');
  const j = await fetchJSON(`${JAMENDO}/tracks/?${p}`);
  if (j.headers && j.headers.status !== 'success') throw new Error(j.headers.error_message || 'Jamendo error');
  return (j.results || []).filter(t => t.audio).map(fromJamendo);
}
/* YouTube: official Data API for search + official IFrame player for playback (video stays visible). */
const YTAPI = 'https://www.googleapis.com/youtube/v3';
function decodeEntities(s) { const d = document.createElement('textarea'); d.innerHTML = s || ''; return d.value; }
function isoDur(s) {
  const m = /P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(s || '');
  return m ? (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0) : 0;
}
function fromYouTube(v) {
  const sn = v.snippet || {};
  let title = decodeEntities(sn.title);
  let artist = decodeEntities(sn.channelTitle).replace(/\s*-\s*Topic$/i, '').replace(/\s*VEVO$/i, '').trim();
  title = title.replace(/\s*[([](official|lyric|lyrics|audio|video|music video|visuali[sz]er|clip officiel|videoclip|4k|hd)[^)\]]*[)\]]/gi, '').trim();
  const parts = title.split(/\s[-–—|]\s/);
  if (parts.length >= 2) { artist = parts[0].trim(); title = parts.slice(1).join(' - ').trim(); }
  const th = sn.thumbnails || {};
  return {
    id: 'yt:' + v.id, source: 'youtube', rid: v.id, title: title || 'Untitled', artist: artist || 'YouTube', album: '',
    duration: isoDur(v.contentDetails && v.contentDetails.duration),
    art: (th.high || th.medium || th.default || {}).url || '',
  };
}
function ytCacheGet(k) {
  const c = store.get('ytc', {});
  const e = c[k];
  return e && e.exp > Date.now() ? e.v : null;
}
function ytCacheSet(k, v, ms) {
  const c = store.get('ytc', {});
  c[k] = { v, exp: Date.now() + ms };
  const keys = Object.keys(c);
  if (keys.length > 60) keys.sort((a, b) => c[a].exp - c[b].exp).slice(0, keys.length - 60).forEach(x => delete c[x]);
  store.set('ytc', c);
}
async function searchYouTube(q) {
  const key = encodeURIComponent(settings.ytKey);
  const ck = (q || '#top').toLowerCase();
  const hit = ytCacheGet(ck);
  if (hit) return hit;
  let items;
  if (q) {
    // search = 100 quota units; results are cached for 7 days so repeat searches are free
    const s = await fetchJSON(`${YTAPI}/search?part=snippet&type=video&videoEmbeddable=true&videoSyndicated=true&videoCategoryId=10&maxResults=25&q=${encodeURIComponent(q)}&key=${key}`);
    const ids = (s.items || []).map(i => i.id && i.id.videoId).filter(Boolean);
    if (!ids.length) return [];
    const v = await fetchJSON(`${YTAPI}/videos?part=snippet,contentDetails,status&id=${ids.join(',')}&key=${key}`);
    const byId = new Map((v.items || []).map(x => [x.id, x]));
    items = ids.map(id => byId.get(id)).filter(Boolean);
  } else {
    const region = ((navigator.language || 'en-US').split('-')[1] || 'US').toUpperCase();
    const v = await fetchJSON(`${YTAPI}/videos?part=snippet,contentDetails,status&chart=mostPopular&videoCategoryId=10&maxResults=30&regionCode=${region}&key=${key}`);
    items = v.items || [];
  }
  const out = items.filter(x => !x.status || x.status.embeddable !== false).map(fromYouTube);
  ytCacheSet(ck, out, q ? 7 * 864e5 : 6 * 36e5);
  return out;
}

let yt = null, ytApiP = null, ytState = -1, ytTimer = null;
function ytApi() {
  if (ytApiP) return ytApiP;
  ytApiP = new Promise((res, rej) => {
    if (window.YT && window.YT.Player) return res();
    window.onYouTubeIframeAPIReady = () => res();
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => { ytApiP = null; rej(new Error('YouTube player failed to load')); };
    document.head.appendChild(s);
  });
  return ytApiP;
}
async function ytLoad(t, tok, seek) {
  try { await ytApi(); } catch (e) { toast(e.message); return; }
  if (tok !== playToken) return;
  const start = Math.floor(seek || 0);
  if (!yt) {
    yt = new YT.Player('ytPlayer', {
      width: '100%', height: '100%', videoId: t.rid,
      playerVars: { playsinline: 1, autoplay: 1, rel: 0, start },
      events: {
        onReady: e => { if (curIsYT()) e.target.playVideo(); },
        onStateChange: onYtState,
        onError: onYtError,
      },
    });
  } else {
    yt.loadVideoById({ videoId: t.rid, startSeconds: start });
  }
}
function onYtState(e) {
  ytState = e.data;
  clearInterval(ytTimer);
  if (e.data === 1) { ytTimer = setInterval(updateProgress, 500); setStatus(''); }
  if (e.data === 3) setStatus('Loading…');
  if (e.data === 0 && curIsYT()) next(true);
  renderPlayState();
}
function onYtError(e) {
  if (!curIsYT()) return;
  const blocked = e.data === 101 || e.data === 150 || e.data === 153;
  const ipHost = /^\d+\.\d+\.\d+\.\d+$/.test(location.hostname);
  if (blocked && ipHost) {
    // YouTube refuses label videos on bare-IP pages; skipping would just burn through the whole queue.
    ytStop();
    toast('YouTube blocks videos on IP addresses. Open Tunebox from its web address instead.');
    return;
  }
  toast(blocked ? `This video can't play outside YouTube (code ${e.data}). Skipped.` : `YouTube error ${e.data}. Skipped.`);
  next(true);
}
function ytStop() { if (yt && yt.pauseVideo) { try { yt.pauseVideo(); } catch { /* ignore */ } } clearInterval(ytTimer); }

/* engine helpers: route controls to <audio> or the YouTube player */
function curIsYT() { const t = curTrack(); return !!t && t.source === 'youtube'; }
function ytLoaded() { return !!(yt && yt.getVideoData && yt.getVideoData() && yt.getVideoData().video_id === (curTrack() || {}).rid); }
function engPlaying() { return curIsYT() ? ytState === 1 || ytState === 3 : hasRealSrc() && !audio.paused; }
function engPause() { if (curIsYT()) ytStop(); else audio.pause(); }
function engTime() { return curIsYT() ? (yt && yt.getCurrentTime ? yt.getCurrentTime() || 0 : 0) : audio.currentTime; }
function engSeek(s) { if (curIsYT()) { if (yt && yt.seekTo) yt.seekTo(s, true); } else audio.currentTime = s; }

async function loadTrending() {
  if (!navigator.onLine) return;
  try {
    const r = await searchAudius('');
    S.trending = r.slice(0, 25);
    store.set('trending', S.trending);
    if (S.tab === 'home') render();
  } catch (e) { console.warn('trending', e); }
}

/* ---------------- Offline cache ---------------- */
const dlQueue = [];
let dlBusy = false;
function cacheTrack(t, front = false) {
  if (!t || t.source === 'local' || t.source === 'youtube' || S.cached.has(t.id) || S.downloading.has(t.id) || !navigator.onLine) return;
  S.downloading.add(t.id);
  front ? dlQueue.unshift(t) : dlQueue.push(t);
  refreshRows();
  pumpDl();
}
async function pumpDl() {
  if (dlBusy) return;
  dlBusy = true;
  while (dlQueue.length) {
    const t = dlQueue.shift();
    try { await doCache(t); }
    catch (e) {
      console.warn('save failed', t.title, e);
      if (e && e.name === 'QuotaExceededError') toast('Phone storage full — remove some downloads');
    }
    S.downloading.delete(t.id);
    refreshRows();
    renderPlayer();
  }
  dlBusy = false;
}
async function doCache(t) {
  const ac = new AbortController();
  const tm = setTimeout(() => ac.abort(), 180000);
  let buf, type;
  try {
    const r = await fetch(streamUrl(t), { signal: ac.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const len = +r.headers.get('content-length') || 0;
    if (len > MAX_SAVE_BYTES) throw new Error('too big');
    type = r.headers.get('content-type') || 'audio/mpeg';
    buf = await r.arrayBuffer();
  } finally { clearTimeout(tm); }
  if (buf.byteLength < 20000) throw new Error('response too small');
  if (buf.byteLength > MAX_SAVE_BYTES) throw new Error('too big');
  await DB.put('blobs', { buf, type, size: buf.byteLength }, t.id);
  if (t.art) {
    try {
      const ar = await fetch(t.art);
      if (ar.ok) {
        await DB.put('blobs', { buf: await ar.arrayBuffer(), type: ar.headers.get('content-type') || 'image/jpeg' }, t.id + '#art');
        t.hasArt = true;
      }
    } catch { /* artwork optional */ }
  }
  const c = canon(t);
  Object.assign(c, { saved: Date.now(), size: buf.byteLength, hasArt: t.hasArt || c.hasArt });
  await saveTrack(c);
  S.cached.add(t.id);
  requestPersist();
}
async function getBlob(id) {
  const r = await DB.get('blobs', id);
  return r ? new Blob([r.buf], { type: r.type }) : null;
}
async function removeDownload(t) {
  await DB.del('blobs', t.id);
  await DB.del('blobs', t.id + '#art');
  S.cached.delete(t.id);
  if (artUrls.has(t.id)) { URL.revokeObjectURL(artUrls.get(t.id)); artUrls.delete(t.id); }
  const c = canon(t);
  c.saved = 0; c.size = 0; c.hasArt = false;
  await saveTrack(c);
}
let persistAsked = false;
function requestPersist() {
  if (persistAsked) return;
  persistAsked = true;
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch { /* not supported */ }
}

/* ---------------- Artwork ---------------- */
function artSrc(t) {
  if (artUrls.has(t.id)) return artUrls.get(t.id);
  if (t.source === 'local' || !navigator.onLine) { if (t.hasArt) loadArt(t.id); return ''; }
  return t.art || '';
}
const artLoading = new Set();
async function loadArt(id) {
  if (artLoading.has(id) || artUrls.has(id)) return;
  artLoading.add(id);
  try {
    const b = await getBlob(id + '#art');
    if (b) {
      const u = URL.createObjectURL(b);
      artUrls.set(id, u);
      $$(`[data-tid="${CSS.escape(id)}"]`).forEach(el => swapArt(el, u));
      const c = curTrack();
      if (c && c.id === id) updateMediaSession(c);
    }
  } catch { /* ignore */ }
  artLoading.delete(id);
}
function swapArt(el, url) {
  if (el.tagName === 'IMG') { el.src = url; return; }
  const img = document.createElement('img');
  img.className = el.className.replace(/\bph\b/, '').trim();
  img.dataset.tid = el.dataset.tid;
  img.alt = '';
  img.src = url;
  el.replaceWith(img);
}
function art(t, cls) {
  const src = artSrc(t);
  if (src) return `<img class="${cls}" src="${esc(src)}" data-tid="${esc(t.id)}" alt="" loading="lazy" decoding="async">`;
  return `<div class="${cls} ph" data-tid="${esc(t.id)}" style="--h:${hue(t.id)}">${esc((t.title || '?').trim().charAt(0).toUpperCase() || '♪')}</div>`;
}
// Remote artwork failed (offline etc.) -> try the stored copy, else a placeholder.
document.addEventListener('error', e => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || !img.dataset.tid || img.dataset.fb) return;
  img.dataset.fb = '1';
  const id = img.dataset.tid;
  const t = S.tracks.get(id);
  if (t && t.hasArt) {
    getBlob(id + '#art').then(b => {
      if (b) { const u = URL.createObjectURL(b); artUrls.set(id, u); img.src = u; }
      else img.replaceWith(phEl(img, t));
    }).catch(() => img.replaceWith(phEl(img, t)));
  } else img.replaceWith(phEl(img, t || { id, title: '?' }));
}, true);
function phEl(img, t) {
  const d = document.createElement('div');
  d.className = img.className + ' ph';
  d.dataset.tid = t.id;
  d.style.setProperty('--h', hue(t.id));
  d.textContent = (t.title || '?').charAt(0).toUpperCase();
  return d;
}

/* ---------------- Playback ---------------- */
let unlocked = false, SILENT = null;
function silentWav() {
  const n = 800, b = new Uint8Array(44 + n * 2), v = new DataView(b.buffer);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) b[o + i] = s.charCodeAt(i); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true); v.setUint32(28, 16000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, n * 2, true);
  return URL.createObjectURL(new Blob([b], { type: 'audio/wav' }));
}
// iOS only lets an <audio> element play after a direct tap. Prime it synchronously on the first tap
// so later async plays (after reading IndexedDB) are allowed.
function unlock() {
  if (unlocked) return;
  unlocked = true;
  if (!audio.src || audio.src === location.href) {
    SILENT = silentWav();
    audio.src = SILENT;
    const p = audio.play();
    if (p) p.catch(() => {});
  }
}
const isSilent = () => SILENT && audio.src === SILENT;
// true when the <audio> element holds the current (non-YouTube) song
const hasRealSrc = () => !curIsYT() && !!audio.src && audio.src !== location.href && !isSilent();

let playToken = 0, curObjUrl = null, retries = 0;
function playList(arr, i) {
  if (!arr || !arr.length) return;
  let q = arr.map(canon);
  S.orig = null;
  if (S.shuffle) {
    const first = q[i];
    S.orig = q.slice();
    q = [first, ...shuffleArr(q.filter((_, k) => k !== i))];
    i = 0;
  }
  S.queue = q;
  S.qi = -1;
  S.pn = 0;
  playIndex(i);
}
async function playIndex(i, opts = {}) {
  const dir = opts.dir || 1, tries = opts.tries || 0;
  if (!S.queue.length) return;
  i = ((i % S.queue.length) + S.queue.length) % S.queue.length;
  const t = S.queue[i];
  const tok = ++playToken;
  const isCached = S.cached.has(t.id);
  // YouTube can't play with the screen locked / app in background: skip those songs then.
  if (!isCached && (t.source === 'local' || !navigator.onLine || (t.source === 'youtube' && document.hidden))) {
    if (tries + 1 < S.queue.length) return playIndex(i + dir, { dir, tries: tries + 1 });
    toast(navigator.onLine ? 'Nothing playable in this list' : 'Offline — none of these songs are saved yet');
    return;
  }
  S.pn = (i === S.qi + 1 && S.pn > 0) ? S.pn - 1 : 0;
  S.qi = i;
  retries = 0;
  if (t.source === 'youtube') {
    audio.pause();
    ytLoad(t, tok, opts.seek);
    openNP();
    afterStart(t, i, true);
    return;
  }
  ytStop();
  let blob = null;
  if (isCached) { try { blob = await getBlob(t.id); } catch (e) { console.warn(e); } }
  if (tok !== playToken) return;
  if (curObjUrl) { URL.revokeObjectURL(curObjUrl); curObjUrl = null; }
  if (blob) { curObjUrl = URL.createObjectURL(blob); audio.src = curObjUrl; }
  else if (t.source !== 'local' && navigator.onLine) { S.cached.delete(t.id); audio.src = streamUrl(t); }
  else { toast("Can't play " + t.title); return; }
  if (opts.seek) audio.addEventListener('loadedmetadata', () => { try { audio.currentTime = opts.seek; } catch { /* ignore */ } }, { once: true });
  if (opts.autoplay !== false) { const p = audio.play(); if (p) p.catch(e => { if (e.name !== 'AbortError') console.warn('play', e); }); }
  afterStart(t, i, !!blob);
}
function afterStart(t, i, noSave) {
  S.restorePos = 0;
  t.lastPlayed = Date.now();
  t.plays = (t.plays || 0) + 1;
  saveTrack(t);
  updateMediaSession(t);
  saveQueue();
  renderPlayer();
  refreshRows();
  if (settings.autoSave && !noSave) cacheTrack(t, true);
  if (settings.autoSave && S.queue.length > 1) cacheTrack(S.queue[(i + 1) % S.queue.length]);
}
function togglePlay() {
  if (curIsYT()) {
    if (!ytLoaded()) { if (S.qi >= 0) playIndex(S.qi, { seek: S.restorePos }); return; }
    if (engPlaying()) ytStop(); else { openNP(); yt.playVideo(); }
    return;
  }
  if (!hasRealSrc()) { if (S.qi >= 0) playIndex(S.qi, { seek: S.restorePos }); return; }
  if (audio.paused) { const p = audio.play(); if (p) p.catch(() => {}); } else audio.pause();
}
function next(auto = false) {
  if (!S.queue.length) return;
  if (auto && S.repeat === 'one') {
    if (curIsYT()) { if (yt) { yt.seekTo(0, true); yt.playVideo(); } }
    else { audio.currentTime = 0; audio.play().catch(() => {}); }
    return;
  }
  let i = S.qi + 1;
  if (i >= S.queue.length) {
    if (auto && S.repeat !== 'all') { engPause(); if (!curIsYT()) audio.currentTime = 0; renderPlayer(); return; }
    i = 0;
  }
  playIndex(i);
}
function prev() {
  if (!S.queue.length) return;
  if (engTime() > 3) { engSeek(0); return; }
  playIndex(Math.max(0, S.qi - 1), { dir: -1 });
}
function toggleShuffle() {
  S.shuffle = !S.shuffle;
  store.set('shuffle', S.shuffle);
  S.pn = 0;
  const cur = curTrack();
  if (cur) {
    if (S.shuffle) {
      S.orig = S.queue.slice();
      S.queue = [cur, ...shuffleArr(S.queue.filter((_, k) => k !== S.qi))];
      S.qi = 0;
    } else if (S.orig) {
      S.queue = S.orig;
      S.orig = null;
      S.qi = Math.max(0, S.queue.findIndex(t => t.id === cur.id));
    }
    saveQueue();
  }
  toast(S.shuffle ? 'Shuffle on' : 'Shuffle off');
  renderPlayer();
}
function cycleRepeat() {
  S.repeat = S.repeat === 'off' ? 'all' : S.repeat === 'all' ? 'one' : 'off';
  store.set('repeat', S.repeat);
  toast({ off: 'Repeat off', all: 'Repeat all', one: 'Repeat this song' }[S.repeat]);
  renderPlayer();
}
// "Play next" songs line up in the order you add them (first added plays first).
function playNext(t) {
  t = canon(t);
  if (!S.queue.length) return playList([t], 0);
  S.queue.splice(S.qi + 1 + S.pn, 0, t);
  S.pn++;
  if (S.orig) S.orig.push(t);
  saveQueue(); renderQueue();
  toast(S.pn === 1 ? 'Playing next' : `Playing next · ${S.pn} lined up`);
  if (settings.autoSave && S.pn === 1) cacheTrack(t);
}
function addToQueue(t) {
  t = canon(t);
  if (!S.queue.length) return playList([t], 0);
  S.queue.push(t);
  if (S.orig) S.orig.push(t);
  saveQueue(); renderQueue(); toast('Added to queue');
}
function saveQueue() {
  const slim = t => ({ id: t.id, source: t.source, rid: t.rid, title: t.title, artist: t.artist, album: t.album, duration: t.duration, art: t.art, audio: t.audio });
  store.set('queue', { q: S.queue.map(slim), qi: S.qi, pos: audio.currentTime || 0 });
}
function restoreQueue() {
  const s = store.get('queue', null);
  if (!s || !s.q || !s.q.length) return;
  S.queue = s.q.map(t => S.tracks.get(t.id) || t);
  S.qi = Math.min(s.qi, S.queue.length - 1);
  S.restorePos = s.pos || 0;
}

/* stall / error recovery: the fix for "song stops" and "stuck repeating sound" */
let waitTimer = null;
function recover(why) {
  const t = curTrack();
  clearTimeout(waitTimer);
  if (!t || !hasRealSrc()) return;
  if (audio.src.startsWith('blob:')) {
    if (why === 'error') { toast("Can't play this file — skipped"); next(true); }
    return;
  }
  if (!navigator.onLine) { setStatus('Offline — waiting'); return; }
  if (retries < 2) {
    retries++;
    const pos = audio.currentTime;
    const u = streamUrl(t);
    setStatus('Reconnecting…');
    audio.src = u + (u.includes('?') ? '&' : '?') + 'r=' + Date.now();
    audio.addEventListener('loadedmetadata', () => { try { audio.currentTime = pos; } catch { /* ignore */ } }, { once: true });
    audio.play().catch(() => {});
  } else { toast('Stream failed — skipped'); next(true); }
}
function setStatus(s) { $('#npStatus').textContent = s; }

audio.addEventListener('waiting', () => {
  if (!hasRealSrc()) return;
  setStatus('Loading…');
  clearTimeout(waitTimer);
  waitTimer = setTimeout(() => recover('stall'), 12000);
});
audio.addEventListener('playing', () => { clearTimeout(waitTimer); setStatus(''); renderPlayState(); });
audio.addEventListener('pause', () => { renderPlayState(); saveQueue(); });
audio.addEventListener('error', () => { if (hasRealSrc()) recover('error'); });
audio.addEventListener('ended', () => { if (hasRealSrc()) next(true); });
audio.addEventListener('loadedmetadata', () => {
  const t = curTrack();
  if (t && isFinite(audio.duration) && audio.duration > 0 && Math.abs((t.duration || 0) - audio.duration) > 2) {
    t.duration = audio.duration;
    if (S.tracks.has(t.id)) saveTrack(t);
  }
});
let lastPosSave = 0, lastMsPos = 0, seeking = false;
audio.addEventListener('timeupdate', () => { if (hasRealSrc()) updateProgress(); });
function updateProgress() {
  const d = dur(), c = engTime();
  const p = d ? Math.min(100, (c / d) * 100) : 0;
  $('#miniBar').style.width = p + '%';
  if (!seeking) {
    const sk = $('#seek');
    sk.value = d ? Math.round((c / d) * 1000) : 0;
    sk.style.setProperty('--p', p + '%');
    $('#tCur').textContent = fmt(c);
    $('#tDur').textContent = '-' + fmt(Math.max(0, d - c));
  }
  const now = Date.now();
  if (now - lastPosSave > 5000) { lastPosSave = now; saveQueue(); }
  if (now - lastMsPos > 1000) { lastMsPos = now; setPositionState(); }
}
function dur() {
  const t = curTrack();
  if (curIsYT()) { const d = yt && yt.getDuration ? yt.getDuration() : 0; return d > 0 ? d : (t && t.duration) || 0; }
  return isFinite(audio.duration) && audio.duration > 0 ? audio.duration : (t && t.duration) || 0;
}
window.addEventListener('online', () => {
  document.body.classList.remove('offline');
  if (hasRealSrc() && !audio.src.startsWith('blob:') && audio.paused === false && audio.readyState < 3) recover('stall');
  if (!S.trending.length) loadTrending();
  if (S.tab === 'home') render();
});
window.addEventListener('offline', () => { document.body.classList.add('offline'); if (S.tab === 'home') render(); });

/* lock screen + control center */
function updateMediaSession(t) {
  if (!('mediaSession' in navigator) || !t) return;
  const a = artUrls.get(t.id) || (navigator.onLine ? t.art : '');
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: t.title, artist: t.artist, album: t.album || '',
      artwork: a ? [{ src: a, sizes: '480x480', type: 'image/jpeg' }] : [{ src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }],
    });
  } catch { /* ignore */ }
  if (!a && t.hasArt) loadArt(t.id);
}
function setPositionState() {
  if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
  const d = dur();
  if (!d) return;
  try { navigator.mediaSession.setPositionState({ duration: d, position: Math.min(engTime(), d), playbackRate: 1 }); } catch { /* ignore */ }
}
// iOS shows +/-10 s buttons unless the seek actions are explicitly cleared; it can also drop
// handlers when the audio source changes, so they are re-registered on every 'playing'.
function setupMediaActions() {
  if (!('mediaSession' in navigator)) return;
  const h = (a, f) => { try { navigator.mediaSession.setActionHandler(a, f); } catch { /* unsupported */ } };
  h('seekbackward', null);
  h('seekforward', null);
  h('play', () => togglePlay());
  h('pause', () => engPause());
  h('nexttrack', () => next());
  h('previoustrack', () => prev());
  h('seekto', d => { if (d.seekTime != null) engSeek(d.seekTime); setPositionState(); });
}
setupMediaActions();
audio.addEventListener('playing', setupMediaActions);

/* ---------------- Local files ---------------- */
function syncsafe(b, o) { return ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f); }
function be32(b, o) { return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0; }
function decodeText(enc, data) {
  const lbl = ['iso-8859-1', 'utf-16', 'utf-16be', 'utf-8'][enc] || 'utf-8';
  try { return new TextDecoder(lbl).decode(data).replace(/\0/g, '').trim(); } catch { return ''; }
}
function findTerm(b, start, enc) {
  if (enc === 1 || enc === 2) { for (let i = start; i + 1 < b.length; i += 2) if (b[i] === 0 && b[i + 1] === 0) return [i, i + 2]; }
  else { for (let i = start; i < b.length; i++) if (b[i] === 0) return [i, i + 1]; }
  return [b.length, b.length];
}
function parsePic(b, v22) {
  const enc = b[0];
  let p = 1, mime;
  if (v22) { const f = String.fromCharCode(b[1], b[2], b[3]).toLowerCase(); mime = f === 'png' ? 'image/png' : 'image/jpeg'; p = 4; }
  else { const [e, n] = findTerm(b, 1, 0); mime = decodeText(0, b.subarray(1, e)) || 'image/jpeg'; p = n; }
  p += 1; // picture type
  const [, after] = findTerm(b, p, enc);
  const data = b.slice(after);
  if (!mime.includes('/')) mime = 'image/' + (mime.toLowerCase() === 'png' ? 'png' : 'jpeg');
  return data.length > 100 ? { mime, data } : null;
}
async function readTags(file) {
  const out = {};
  try {
    const head = new Uint8Array(await file.slice(0, 10).arrayBuffer());
    if (head[0] !== 0x49 || head[1] !== 0x44 || head[2] !== 0x33) return out; // "ID3"
    const ver = head[3], flags = head[5], size = syncsafe(head, 6);
    const b = new Uint8Array(await file.slice(10, 10 + size).arrayBuffer());
    const unsync = !!(flags & 0x80);
    let p = 0;
    if (ver >= 3 && (flags & 0x40)) p = ver === 4 ? syncsafe(b, 0) : be32(b, 0) + 4;
    const v22 = ver === 2, hl = v22 ? 6 : 10, il = v22 ? 3 : 4;
    const map = v22 ? { TT2: 'title', TP1: 'artist', TAL: 'album' } : { TIT2: 'title', TPE1: 'artist', TALB: 'album' };
    while (p + hl <= b.length) {
      const id = String.fromCharCode(...b.subarray(p, p + il));
      if (!/^[A-Z0-9]+$/.test(id)) break;
      const fs = v22 ? (b[p + 3] << 16) | (b[p + 4] << 8) | b[p + 5] : ver === 4 ? syncsafe(b, p + 4) : be32(b, p + 4);
      if (fs <= 0 || p + hl + fs > b.length) break;
      const data = b.subarray(p + hl, p + hl + fs);
      if (map[id]) out[map[id]] = decodeText(data[0], data.subarray(1));
      else if ((id === 'APIC' || id === 'PIC') && !out.pic && !unsync) out.pic = parsePic(data, v22);
      p += hl + fs;
    }
  } catch (e) { console.warn('tags', e); }
  return out;
}
function guessType(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  return { mp3: 'audio/mpeg', m4a: 'audio/mp4', mp4: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', flac: 'audio/flac', ogg: 'audio/ogg' }[ext] || 'audio/mpeg';
}
function probeDuration(file) {
  return new Promise(res => {
    const a = new Audio(), u = URL.createObjectURL(file);
    const done = d => { URL.revokeObjectURL(u); res(isFinite(d) ? d : 0); };
    const tm = setTimeout(() => done(0), 6000);
    a.preload = 'metadata';
    a.onloadedmetadata = () => { clearTimeout(tm); done(a.duration); };
    a.onerror = () => { clearTimeout(tm); done(0); };
    a.src = u;
  });
}
async function importFiles(files) {
  files = [...files];
  if (!files.length) return;
  toast(`Adding ${files.length} song${files.length === 1 ? '' : 's'}…`);
  const existing = new Set([...S.tracks.values()].filter(t => t.source === 'local').map(t => t.fname + '|' + t.size));
  let n = 0, skipped = 0;
  for (const f of files) {
    if (existing.has(f.name + '|' + f.size)) { skipped++; continue; }
    try {
      const tags = await readTags(f);
      const id = 'lo:' + uid();
      const buf = await f.arrayBuffer();
      await DB.put('blobs', { buf, type: f.type || guessType(f.name), size: buf.byteLength }, id);
      let hasArt = false;
      if (tags.pic) {
        try { await DB.put('blobs', { buf: tags.pic.data.buffer.slice(tags.pic.data.byteOffset, tags.pic.data.byteOffset + tags.pic.data.byteLength), type: tags.pic.mime }, id + '#art'); hasArt = true; } catch { /* ignore */ }
      }
      const base = f.name.replace(/\.[^.]+$/, '').replace(/_/g, ' ');
      let title = tags.title, artist = tags.artist;
      if (!title) {
        const parts = base.split(' - ');
        if (parts.length >= 2) { artist = artist || parts[0].trim(); title = parts.slice(1).join(' - ').trim(); }
        else title = base;
      }
      const t = {
        id, source: 'local', title, artist: artist || 'Unknown artist', album: tags.album || '',
        duration: await probeDuration(f), hasArt, added: Date.now(), saved: Date.now(), size: buf.byteLength, fname: f.name,
      };
      await saveTrack(t);
      S.cached.add(id);
      n++;
    } catch (e) {
      console.warn('import', f.name, e);
      if (e && e.name === 'QuotaExceededError') { toast('Phone storage full'); break; }
    }
  }
  requestPersist();
  toast(`Added ${n} song${n === 1 ? '' : 's'}${skipped ? ` (${skipped} already in library)` : ''}`);
  render();
}
async function deleteLocal(t) {
  await DB.del('blobs', t.id);
  await DB.del('blobs', t.id + '#art');
  await DB.del('tracks', t.id);
  S.cached.delete(t.id);
  S.tracks.delete(t.id);
  for (const p of S.playlists) if (p.ids.includes(t.id)) { p.ids = p.ids.filter(x => x !== t.id); await DB.put('playlists', p); }
}

/* ---------------- Playlists / likes ---------------- */
async function toggleLike(t) {
  const c = canon(t);
  c.liked = c.liked ? 0 : Date.now();
  await saveTrack(c);
  toast(c.liked ? 'Added to Liked songs' : 'Removed from Liked songs');
  if (c.liked && settings.autoSave) cacheTrack(c);
  renderPlayer();
  if (S.tab === 'library') render();
}
async function newPlaylist(firstTrack) {
  const name = (prompt('Playlist name') || '').trim();
  if (!name) return;
  const p = { id: uid(), name, ids: [], created: Date.now() };
  if (firstTrack) { const c = canon(firstTrack); await saveTrack(c); p.ids.push(c.id); }
  await DB.put('playlists', p);
  S.playlists.push(p);
  toast(firstTrack ? `Added to ${name}` : `Created ${name}`);
  render();
}
async function addToPlaylist(p, t) {
  const c = canon(t);
  if (p.ids.includes(c.id)) { toast('Already in ' + p.name); return; }
  await saveTrack(c);
  p.ids.push(c.id);
  await DB.put('playlists', p);
  toast('Added to ' + p.name);
}

/* ---------------- UI: icons ---------------- */
const ICONS = {
  home: ['f', '<path d="M12 3 3 10.2V21h6.5v-6h5v6H21V10.2z"/>'],
  search: ['s', '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/>'],
  library: ['f', '<path d="M4 4h3.2v16H4zM9.6 4h3.2v16H9.6zM15 5.1l3.1-.8 3.9 15-3.1.8z"/>'],
  settings: ['s', '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>'],
  play: ['f', '<path d="M8 4.8v14.4L19.5 12z"/>'],
  pause: ['f', '<path d="M6.5 4.5h4v15h-4zM13.5 4.5h4v15h-4z"/>'],
  next: ['f', '<path d="M5 5.5v13l9-6.5zM15.5 5.5h3v13h-3z"/>'],
  prev: ['f', '<path d="M19 5.5v13l-9-6.5zM5.5 5.5h3v13h-3z"/>'],
  shuffle: ['s', '<path d="M16 4h4v4M4 19 20 4M20 16v4h-4M14.5 14.5 20 20M4 5l5 5"/>'],
  repeat: ['s', '<path d="m17 2 4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15"/><path d="m7 22-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>'],
  heart: ['s', '<path d="M12 20.5s-7.6-4.6-9.4-9.3C1.3 7.7 3.6 4.5 7 4.5c2 0 3.6 1.1 5 2.9 1.4-1.8 3-2.9 5-2.9 3.4 0 5.7 3.2 4.4 6.7-1.8 4.7-9.4 9.3-9.4 9.3z"/>'],
  heartOn: ['f', '<path d="M12 20.5s-7.6-4.6-9.4-9.3C1.3 7.7 3.6 4.5 7 4.5c2 0 3.6 1.1 5 2.9 1.4-1.8 3-2.9 5-2.9 3.4 0 5.7 3.2 4.4 6.7-1.8 4.7-9.4 9.3-9.4 9.3z"/>'],
  more: ['f', '<circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/>'],
  down: ['s', '<path d="m6 9 6 6 6-6"/>'],
  back: ['s', '<path d="m15 18-6-6 6-6"/>'],
  queue: ['s', '<path d="M3 6h13M3 12h13M3 18h8"/><path d="M16 15v6l5-3z" fill="currentColor"/>'],
  download: ['s', '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>'],
  clock: ['s', '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'],
  folder: ['s', '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'],
  list: ['s', '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1" fill="currentColor"/><circle cx="4.5" cy="12" r="1" fill="currentColor"/><circle cx="4.5" cy="18" r="1" fill="currentColor"/>'],
  plus: ['s', '<path d="M12 5v14M5 12h14"/>'],
  x: ['s', '<path d="M6 6l12 12M18 6 6 18"/>'],
};
function icon(n) { const [k, p] = ICONS[n] || ICONS.more; return `<svg class="ic ${k}" viewBox="0 0 24 24" aria-hidden="true">${p}</svg>`; }
function fillIcons(root) { $$('[data-icon]', root).forEach(el => { el.innerHTML = icon(el.dataset.icon); }); }

/* ---------------- UI: views ---------------- */
function row(list, t, i, act = 'play') {
  const c = curTrack();
  const st = S.cached.has(t.id) ? '<span class="dot saved"></span>' : S.downloading.has(t.id) ? '<span class="dot dl"></span>' : '';
  return `<div class="row${c && c.id === t.id ? ' cur' : ''}" data-act="${act}" data-list="${esc(list)}" data-i="${i}">
    ${art(t, 'art')}
    <div class="meta"><div class="t">${esc(t.title)}</div><div class="a">${st}<span class="x">${esc(t.artist)}${t.duration ? ' · ' + fmt(t.duration) : ''}</span></div></div>
    <button class="icon more" data-act="more" data-list="${esc(list)}" data-i="${i}" aria-label="More">${icon('more')}</button></div>`;
}
function rows(list, arr, act) {
  S.lists[list] = arr;
  return `<div class="list">${arr.map((t, i) => row(list, t, i, act)).join('')}</div>`;
}
function isIOS() { return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }
function isStandalone() { return navigator.standalone === true || matchMedia('(display-mode: standalone)').matches; }

function viewHome() {
  const hr = new Date().getHours();
  const greet = hr < 5 ? 'Late night' : hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
  const all = [...S.tracks.values()];
  const recent = all.filter(t => t.lastPlayed).sort((a, b) => b.lastPlayed - a.lastPlayed).slice(0, 15);
  S.lists.recentH = recent;
  const nOff = all.filter(t => S.cached.has(t.id)).length;
  let h = `<h1>${greet}<span class="offline-pill">Offline</span></h1>`;
  if (isIOS() && !isStandalone() && !store.get('hideInstall', false)) {
    h += `<div class="banner"><div><b>Install Tunebox:</b> tap the Share button in Safari, then <b>Add to Home Screen</b>. It then opens full-screen like a normal app and keeps your saved songs.</div><button class="icon" data-act="hide-install" aria-label="Dismiss">${icon('x')}</button></div>`;
  }
  h += `<div class="quick">
    <button data-act="open" data-type="liked">${icon('heartOn')}Liked</button>
    <button data-act="open" data-type="offline">${icon('download')}Downloaded <span class="small">${nOff}</span></button>
    <button data-act="open" data-type="local">${icon('folder')}My files</button>
    <button data-act="tab" data-tab="search">${icon('search')}Find music</button></div>`;
  if (recent.length) {
    h += `<h2>Recently played</h2><div class="cards">${recent.map((t, i) => `<div class="card" data-act="play" data-list="recentH" data-i="${i}">${art(t, 'card-art')}<div class="t">${esc(t.title)}</div><div class="a">${esc(t.artist)}</div></div>`).join('')}</div>`;
  }
  h += `<h2>Trending on Audius</h2>`;
  if (S.trending.length) h += rows('trending', S.trending.map(canon));
  else h += `<div class="msg">${navigator.onLine ? 'Loading…' : 'Connect to the internet to see trending songs.'}</div>`;
  return h;
}

function viewSearch() {
  return `<h1>Search<span class="offline-pill">Offline</span></h1>
    <div class="seg">
      <button data-act="src" data-src="audius" class="${S.source === 'audius' ? 'on' : ''}">Audius</button>
      <button data-act="src" data-src="youtube" class="${S.source === 'youtube' ? 'on' : ''}">YouTube</button>
      <button data-act="src" data-src="jamendo" class="${S.source === 'jamendo' ? 'on' : ''}">Jamendo</button>
      <button data-act="src" data-src="mine" class="${S.source === 'mine' ? 'on' : ''}">Library</button>
    </div>
    <form id="searchForm" autocomplete="off"><input id="q" class="searchbox" type="search" enterkeyhint="search" placeholder="${S.source === 'mine' ? 'Search your saved songs' : 'Songs, artists'}" value="${esc(S.q)}"></form>
    <div id="results"></div>`;
}
function renderResults() {
  const el = $('#results');
  if (!el) return;
  let h = '';
  if (S.source === 'jamendo' && !settings.jamendoId) {
    h = `<div class="msg"><b>Jamendo needs a free key</b><br><br>1. Go to <a href="https://devportal.jamendo.com" target="_blank" rel="noopener">devportal.jamendo.com</a> and sign up<br>2. Create an app (any name)<br>3. Copy the <b>Client ID</b> into Settings</div>`;
  } else if (S.source === 'youtube' && !settings.ytKey) {
    h = `<div class="msg"><b>YouTube needs a free key</b><br><br>1. Open <a href="https://console.cloud.google.com" target="_blank" rel="noopener">console.cloud.google.com</a><br>2. New project, then enable <b>YouTube Data API v3</b><br>3. Credentials, then <b>Create credentials</b>, then <b>API key</b><br>4. Paste it in Settings</div>`;
  } else if (S.searching && !S.results.length) h = '<div class="msg">Searching…</div>';
  else if (S.searchErr) h = `<div class="msg">${esc(S.searchErr)}</div>`;
  else if (!S.results.length) h = `<div class="msg">${S.q ? 'No results' : S.source === 'mine' ? 'Songs you play, like or add show up here.' : ''}</div>`;
  else {
    const label = S.q ? '' : { audius: '<h2>Trending now</h2>', jamendo: '<h2>Popular this week</h2>', youtube: '<h2>Top music videos</h2>' }[S.source] || '';
    const note = S.source === 'youtube' ? '<div class="small" style="margin:4px 0 8px">YouTube songs play with the player open and the screen on. They are skipped when the phone is locked.</div>' : '';
    h = label + note + rows('search', S.results.map(canon));
  }
  el.innerHTML = h;
}
let sTok = 0, sTimer = null;
async function doSearch() {
  const q = S.q.trim(), tok = ++sTok;
  S.searchErr = '';
  if (S.source === 'mine') {
    const ql = q.toLowerCase();
    S.results = [...S.tracks.values()]
      .filter(t => !ql || (t.title + ' ' + t.artist + ' ' + (t.album || '')).toLowerCase().includes(ql))
      .sort((a, b) => (b.lastPlayed || b.added || 0) - (a.lastPlayed || a.added || 0)).slice(0, 200);
    renderResults();
    return;
  }
  if ((S.source === 'jamendo' && !settings.jamendoId) || (S.source === 'youtube' && !settings.ytKey)) { S.results = []; renderResults(); return; }
  if (!navigator.onLine) { S.results = []; S.searchErr = "You're offline. Switch to Library to play saved songs."; renderResults(); return; }
  S.searching = true;
  S.results = [];
  renderResults();
  try {
    const r = S.source === 'audius' ? await searchAudius(q) : S.source === 'youtube' ? await searchYouTube(q) : await searchJamendo(q);
    if (tok !== sTok) return;
    S.results = r;
  } catch (e) {
    if (tok !== sTok) return;
    S.results = [];
    S.searchErr = 'Search failed: ' + e.message;
  }
  S.searching = false;
  renderResults();
}

function listFor(sub) {
  const all = [...S.tracks.values()];
  switch (sub.type) {
    case 'liked': return { title: 'Liked songs', arr: all.filter(t => t.liked).sort((a, b) => b.liked - a.liked), empty: 'Tap the heart on any song to add it here.' };
    case 'offline': return { title: 'Downloaded', arr: all.filter(t => S.cached.has(t.id) && t.source !== 'local').sort((a, b) => (b.saved || 0) - (a.saved || 0)), empty: 'Songs save here automatically after you play them.' };
    case 'recent': return { title: 'Recently played', arr: all.filter(t => t.lastPlayed).sort((a, b) => b.lastPlayed - a.lastPlayed).slice(0, 150), empty: 'Nothing played yet.' };
    case 'local': return { title: 'My files', arr: all.filter(t => t.source === 'local').sort((a, b) => a.title.localeCompare(b.title)), empty: 'Add MP3/M4A files from the Files app.' };
    case 'pl': {
      const p = S.playlists.find(x => x.id === sub.id);
      if (!p) return null;
      return { title: p.name, arr: p.ids.map(id => S.tracks.get(id)).filter(Boolean), pl: p, empty: 'Add songs with the ••• button on any song.' };
    }
  }
  return null;
}
function viewLibrary() {
  const all = [...S.tracks.values()];
  const c = {
    liked: all.filter(t => t.liked).length,
    offline: all.filter(t => S.cached.has(t.id) && t.source !== 'local').length,
    recent: all.filter(t => t.lastPlayed).length,
    local: all.filter(t => t.source === 'local').length,
  };
  const item = (type, ic, label) => `<button class="lib-item" data-act="open" data-type="${type}">${icon(ic)}${label}<span class="n">${c[type]}</span></button>`;
  let h = `<h1>Library<span class="offline-pill">Offline</span></h1>`
    + item('liked', 'heartOn', 'Liked songs') + item('offline', 'download', 'Downloaded')
    + item('recent', 'clock', 'Recently played') + item('local', 'folder', 'My files');
  h += `<h2>Playlists <button class="addpl" data-act="new-pl">+ New</button></h2>`;
  if (!S.playlists.length) h += '<div class="small">No playlists yet.</div>';
  for (const p of S.playlists) h += `<button class="lib-item" data-act="open" data-type="pl" data-id="${esc(p.id)}">${icon('list')}${esc(p.name)}<span class="n">${p.ids.length}</span></button>`;
  return h;
}
function viewList() {
  const L = listFor(S.sub);
  if (!L) { S.sub = null; return viewLibrary(); }
  const key = S.sub.type === 'pl' ? 'pl:' + S.sub.id : S.sub.type;
  let h = `<button class="backbar" data-act="back">${icon('back')}Library</button>
    <div class="titlebar"><h1>${esc(L.title)}</h1>${L.pl ? `<button class="icon more" data-act="pl-menu" data-id="${esc(L.pl.id)}">${icon('more')}</button>` : ''}</div>`;
  if (S.sub.type === 'local') h += `<div class="list-head"><button class="btn primary" data-act="import">${icon('plus')}Add music files</button></div>`;
  if (L.arr.length) {
    h += `<div class="list-head"><button class="btn" data-act="play-all" data-list="${esc(key)}">${icon('play')}Play</button><button class="btn" data-act="shuffle-all" data-list="${esc(key)}">${icon('shuffle')}Shuffle</button></div>`;
    h += rows(key, L.arr);
  } else h += `<div class="msg">${esc(L.empty)}</div>`;
  return h;
}
function viewSettings() {
  return `<h1>Settings</h1>
  <div class="group"><label class="set-row"><span>Save songs for offline automatically<small>Every song you play is kept on this phone, so the next play is instant and works without internet.</small></span><input type="checkbox" class="switch" id="autoSave" ${settings.autoSave ? 'checked' : ''}></label></div>
  <div class="group"><div class="set-head">YouTube key</div>
    <div class="small">Free, no card needed. At <a href="https://console.cloud.google.com" target="_blank" rel="noopener">console.cloud.google.com</a>: create a project, enable <b>YouTube Data API v3</b>, then Credentials, Create credentials, API key. About 100 new searches a day; repeat searches are remembered and cost nothing.</div>
    <input id="ytKey" class="field" placeholder="AIza…" value="${esc(settings.ytKey)}" autocapitalize="off" autocorrect="off" spellcheck="false">
    <button class="btn inline" data-act="save-yt">Save key</button></div>
  <div class="group"><div class="set-head">Jamendo key</div>
    <div class="small">Free. Sign up at <a href="https://devportal.jamendo.com" target="_blank" rel="noopener">devportal.jamendo.com</a>, create an app, paste its Client ID here.</div>
    <input id="jamId" class="field" placeholder="Client ID" value="${esc(settings.jamendoId)}" autocapitalize="off" autocorrect="off" spellcheck="false">
    <button class="btn inline" data-act="save-jam">Save key</button></div>
  <div class="group"><div class="set-head">Storage</div><div id="storageInfo" class="small">Calculating…</div>
    <div class="list-head" style="margin-top:12px"><button class="btn danger" data-act="clear-dl">Remove all downloads</button></div>
    <div class="small">Your own files and playlists are kept.</div></div>
  <div class="group small">Tunebox plays free, artist-uploaded music from <b>Audius</b> and <b>Jamendo</b>, plus music files you own. Lock-screen controls and background play work once it's added to your Home Screen.</div>`;
}
async function updateStorageInfo() {
  const el = $('#storageInfo');
  if (!el) return;
  const all = [...S.tracks.values()];
  const off = all.filter(t => S.cached.has(t.id) && t.source !== 'local');
  const loc = all.filter(t => t.source === 'local');
  const sum = a => a.reduce((s, t) => s + (t.size || 0), 0);
  let h = `<div class="stat"><span>Downloaded songs</span><span>${off.length} · ${fmtBytes(sum(off))}</span></div>
           <div class="stat"><span>My files</span><span>${loc.length} · ${fmtBytes(sum(loc))}</span></div>`;
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const e = await navigator.storage.estimate();
      h += `<div class="stat"><span>Space available to app</span><span>${fmtBytes(Math.max(0, (e.quota || 0) - (e.usage || 0)))}</span></div>`;
    }
    if (navigator.storage && navigator.storage.persisted) {
      const p = await navigator.storage.persisted();
      h += `<div class="stat"><span>Protected from auto-cleanup</span><span>${p ? 'Yes' : 'Not yet'}</span></div>`;
    }
  } catch { /* ignore */ }
  el.innerHTML = h;
}

function render() {
  $$('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === S.tab));
  S.lists = { queue: S.queue, recentH: S.lists.recentH || [] };
  const v = $('#view');
  let h;
  if (S.tab === 'home') h = viewHome();
  else if (S.tab === 'search') h = viewSearch();
  else if (S.tab === 'library') h = S.sub ? viewList() : viewLibrary();
  else h = viewSettings();
  v.innerHTML = h;
  if (S.tab === 'search') renderResults();
  if (S.tab === 'settings') updateStorageInfo();
}
let rrTimer = null;
function refreshRows() {
  clearTimeout(rrTimer);
  rrTimer = setTimeout(() => {
    const c = curTrack();
    $$('.row').forEach(r => {
      const t = (S.lists[r.dataset.list] || [])[+r.dataset.i];
      if (!t) return;
      r.classList.toggle('cur', !!c && c.id === t.id);
      const a = $('.a', r);
      if (!a) return;
      const want = S.cached.has(t.id) ? 'saved' : S.downloading.has(t.id) ? 'dl' : '';
      const dot = $('.dot', a);
      const have = dot ? (dot.classList.contains('saved') ? 'saved' : 'dl') : '';
      if (want === have) return;
      if (dot) dot.remove();
      if (want) a.insertAdjacentHTML('afterbegin', `<span class="dot ${want}"></span>`);
    });
  }, 60);
}

/* ---------------- Player UI ---------------- */
function renderPlayState() {
  const playing = engPlaying();
  $('#miniPlay').innerHTML = icon(playing ? 'pause' : 'play');
  $('#npPlay').innerHTML = icon(playing ? 'pause' : 'play');
  $('#np').classList.toggle('paused', !playing);
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
}
let lastArtId = null;
function renderPlayer() {
  const t = curTrack();
  $('#mini').classList.toggle('hidden', !t);
  if (!t) return;
  if (lastArtId !== t.id || !$('#npArt img, #npArt .ph')) {
    lastArtId = t.id;
    $('#miniArt').innerHTML = art(t, 'art');
    $('#npArt').innerHTML = art(t, 'np-art');
    $('#np').style.setProperty('--npc', `hsl(${hue(t.id)} 35% 22%)`);
    const isYT = t.source === 'youtube';
    $('#npArt').classList.toggle('hidden', isYT);
    $('#ytBox').classList.toggle('hidden', !isYT);
    if (!isYT) ytStop();
    if (!hasRealSrc() && !isYT) {
      $('#tCur').textContent = fmt(S.restorePos);
      $('#tDur').textContent = '-' + fmt(Math.max(0, (t.duration || 0) - S.restorePos));
      const p = t.duration ? (S.restorePos / t.duration) * 100 : 0;
      $('#seek').value = Math.round(p * 10);
      $('#seek').style.setProperty('--p', p + '%');
    }
  }
  $('#miniTitle').textContent = t.title;
  $('#miniArtist').textContent = t.artist;
  $('#npTitle').textContent = t.title;
  $('#npArtist').textContent = t.artist;
  const src = { local: 'My files', audius: 'Audius', jamendo: 'Jamendo', youtube: 'YouTube' }[t.source] || '';
  $('#npSrc').textContent = src + (S.cached.has(t.id) && t.source !== 'local' ? ' · saved' : S.downloading.has(t.id) ? ' · saving…' : '');
  const liked = !!canon(t).liked;
  const lk = $('#npLike');
  lk.innerHTML = icon(liked ? 'heartOn' : 'heart');
  lk.classList.toggle('on', liked);
  $('#btnShuffle').classList.toggle('on', S.shuffle);
  const rp = $('#btnRepeat');
  rp.classList.toggle('on', S.repeat !== 'off');
  rp.classList.toggle('one', S.repeat === 'one');
  renderPlayState();
  renderQueue();
}
function renderQueue() {
  const q = $('#npQueue');
  $('#btnQueue').classList.toggle('on', S.showQueue);
  // the YouTube video must stay visible, so it remains above the queue
  $('#npArtWrap').classList.toggle('hidden', S.showQueue && !curIsYT());
  $('#npArtWrap').classList.toggle('compact', S.showQueue && curIsYT());
  q.classList.toggle('hidden', !S.showQueue);
  if (!S.showQueue) return;
  S.lists.queue = S.queue;
  const up = S.queue.length - S.qi - 1;
  q.innerHTML = `<div class="small" style="margin:2px 0 6px">Up next · ${up} song${up === 1 ? '' : 's'}${S.shuffle ? ' · shuffled' : ''}</div>`
    + `<div class="list">${S.queue.map((t, i) => (i >= S.qi ? row('queue', t, i, 'q-play') : '')).join('')}</div>`;
}
function openNP() { $('#np').classList.add('open'); }
function closeNP() {
  $('#np').classList.remove('open');
  if (curIsYT() && engPlaying()) { ytStop(); toast('YouTube songs play while the player is open'); }
}

// swipe down to close now-playing
(() => {
  const np = $('#np');
  let y0 = null, dy = 0;
  np.addEventListener('touchstart', e => {
    if (e.target.closest('#seek, #npQueue')) { y0 = null; return; }
    y0 = e.touches[0].clientY; dy = 0;
  }, { passive: true });
  np.addEventListener('touchmove', e => {
    if (y0 == null) return;
    dy = Math.max(0, e.touches[0].clientY - y0);
    if (dy > 8) { np.classList.add('drag'); np.style.transform = `translateY(${dy}px)`; }
  }, { passive: true });
  np.addEventListener('touchend', () => {
    if (y0 == null) return;
    np.classList.remove('drag');
    np.style.transform = '';
    if (dy > 110) closeNP();
    y0 = null;
  });
})();

/* ---------------- Sheets / toast ---------------- */
let sheetFns = [];
function sheet(titleHtml, items) {
  sheetFns = items.map(x => x.fn);
  const el = $('#sheet');
  el.innerHTML = `<div class="sheet-bg" data-act="sheet-close"></div><div class="sheet-card">
    ${titleHtml ? `<div class="sheet-title">${titleHtml}</div>` : ''}
    ${items.map((x, i) => `<button class="sheet-btn${x.danger ? ' danger' : ''}" data-act="sheet" data-k="${i}">${esc(x.label)}</button>`).join('')}
    <button class="sheet-btn cancel" data-act="sheet-close">Cancel</button></div>`;
  el.classList.remove('hidden');
}
function closeSheet() { $('#sheet').classList.add('hidden'); $('#sheet').innerHTML = ''; }
let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}
function trackTitleHtml(t) {
  return `${art(t, 'art')}<div class="meta"><div class="t">${esc(t.title)}</div><div class="a">${esc(t.artist)}</div></div>`;
}
function trackMenu(t, ctx = {}) {
  if (!t) return;
  t = canon(t);
  const items = [
    { label: 'Play next', fn: () => playNext(t) },
    { label: 'Add to queue', fn: () => addToQueue(t) },
    { label: t.liked ? 'Remove from Liked' : 'Like', fn: () => toggleLike(t) },
    { label: 'Add to playlist…', fn: () => playlistPicker(t) },
  ];
  if (t.source !== 'local' && t.source !== 'youtube') {
    if (S.cached.has(t.id)) items.push({ label: 'Remove download', fn: async () => { await removeDownload(t); toast('Download removed'); render(); renderPlayer(); } });
    else if (!S.downloading.has(t.id)) items.push({ label: 'Save for offline', fn: () => { cacheTrack(canon(t), true); toast('Saving…'); } });
  }
  if (ctx.list && ctx.list.startsWith('pl:')) {
    const p = S.playlists.find(x => 'pl:' + x.id === ctx.list);
    if (p) items.push({ label: 'Remove from this playlist', danger: true, fn: async () => { p.ids.splice(ctx.i, 1); await DB.put('playlists', p); render(); } });
  }
  if (ctx.list === 'queue' && ctx.i !== S.qi) {
    items.push({ label: 'Remove from queue', danger: true, fn: () => {
      S.queue.splice(ctx.i, 1);
      if (ctx.i < S.qi) S.qi--;
      else if (ctx.i <= S.qi + S.pn && S.pn > 0) S.pn--;
      if (S.orig) { const k = S.orig.findIndex(x => x.id === t.id); if (k >= 0) S.orig.splice(k, 1); }
      saveQueue(); renderQueue();
    } });
  }
  if (t.source === 'local') {
    items.push({ label: 'Delete from phone', danger: true, fn: async () => {
      if (!confirm(`Delete "${t.title}" from this phone?`)) return;
      const c = curTrack();
      if (c && c.id === t.id) { audio.pause(); audio.removeAttribute('src'); audio.load(); }
      S.queue = S.queue.filter(x => x.id !== t.id);
      S.qi = Math.min(S.qi, S.queue.length - 1);
      await deleteLocal(t);
      saveQueue(); render(); renderPlayer();
    } });
  }
  sheet(trackTitleHtml(t), items);
}
function playlistPicker(t) {
  const items = [{ label: '+ New playlist', fn: () => newPlaylist(t) }]
    .concat(S.playlists.map(p => ({ label: p.name, fn: () => addToPlaylist(p, t) })));
  sheet('<div class="t">Add to playlist</div>', items);
}
function playlistMenu(p) {
  sheet(`<div class="t">${esc(p.name)}</div>`, [
    { label: 'Rename', fn: async () => { const n = (prompt('New name', p.name) || '').trim(); if (n) { p.name = n; await DB.put('playlists', p); render(); } } },
    { label: 'Save all for offline', fn: () => { p.ids.map(id => S.tracks.get(id)).filter(Boolean).forEach(t => cacheTrack(t)); toast('Saving playlist…'); } },
    { label: 'Delete playlist', danger: true, fn: async () => {
      if (!confirm(`Delete playlist "${p.name}"? Songs stay in your library.`)) return;
      await DB.del('playlists', p.id);
      S.playlists = S.playlists.filter(x => x !== p);
      S.sub = null; render();
    } },
  ]);
}

/* ---------------- Events ---------------- */
const PLAY_ACTS = new Set(['play', 'toggle-play', 'play-all', 'shuffle-all', 'q-play', 'next', 'prev']);
const actions = {
  tab: el => {
    S.tab = el.dataset.tab; S.sub = null; render(); window.scrollTo(0, 0);
    if (S.tab === 'search' && !S.results.length && !S.searching) doSearch();
  },
  play: el => playList(S.lists[el.dataset.list], +el.dataset.i),
  'q-play': el => playIndex(+el.dataset.i),
  more: el => trackMenu((S.lists[el.dataset.list] || [])[+el.dataset.i], { list: el.dataset.list, i: +el.dataset.i }),
  'open-np': () => openNP(),
  'close-np': () => closeNP(),
  'toggle-play': () => togglePlay(),
  next: () => next(),
  prev: () => prev(),
  shuffle: () => toggleShuffle(),
  repeat: () => cycleRepeat(),
  'like-cur': () => toggleLike(curTrack()),
  'np-more': () => trackMenu(curTrack(), {}),
  'toggle-queue': () => { S.showQueue = !S.showQueue; renderQueue(); },
  src: el => { S.source = el.dataset.src; store.set('source', S.source); S.results = []; render(); doSearch(); },
  open: el => { S.tab = 'library'; S.sub = { type: el.dataset.type, id: el.dataset.id }; render(); window.scrollTo(0, 0); },
  back: () => { S.sub = null; render(); },
  'play-all': el => { const a = S.lists[el.dataset.list]; if (a && a.length) { if (S.shuffle) toggleShuffle(); playList(a, 0); } },
  'shuffle-all': el => {
    const a = S.lists[el.dataset.list];
    if (!a || !a.length) return;
    if (!S.shuffle) { S.shuffle = true; store.set('shuffle', true); }
    playList(a, Math.floor(Math.random() * a.length));
  },
  'new-pl': () => newPlaylist(null),
  'pl-menu': el => { const p = S.playlists.find(x => x.id === el.dataset.id); if (p) playlistMenu(p); },
  import: () => $('#filepick').click(),
  sheet: el => { const f = sheetFns[+el.dataset.k]; closeSheet(); if (f) f(); },
  'sheet-close': () => closeSheet(),
  'hide-install': () => { store.set('hideInstall', true); render(); },
  'save-jam': () => {
    settings.jamendoId = ($('#jamId').value || '').trim();
    store.set('jamendoId', settings.jamendoId);
    toast(settings.jamendoId ? 'Jamendo key saved' : 'Jamendo key cleared');
  },
  'save-yt': () => {
    settings.ytKey = ($('#ytKey').value || '').trim();
    store.set('ytKey', settings.ytKey);
    toast(settings.ytKey ? 'YouTube key saved' : 'YouTube key cleared');
  },
  'clear-dl': async () => {
    const off = [...S.tracks.values()].filter(t => S.cached.has(t.id) && t.source !== 'local');
    if (!off.length) { toast('No downloads to remove'); return; }
    if (!confirm(`Remove ${off.length} downloaded songs from this phone? Likes and playlists are kept.`)) return;
    const c = curTrack();
    for (const t of off) { if (!(c && c.id === t.id && !audio.paused)) await removeDownload(t); }
    toast('Downloads removed');
    render();
  },
};
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const a = el.dataset.act;
  if (PLAY_ACTS.has(a)) unlock();
  const f = actions[a];
  if (f) { e.preventDefault(); f(el, e); }
});
document.addEventListener('input', e => {
  if (e.target.id === 'q') {
    S.q = e.target.value;
    clearTimeout(sTimer);
    sTimer = setTimeout(doSearch, S.source === 'mine' ? 120 : 450);
  }
});
document.addEventListener('submit', e => {
  if (e.target.id === 'searchForm') { e.preventDefault(); clearTimeout(sTimer); doSearch(); $('#q').blur(); }
});
document.addEventListener('change', e => {
  if (e.target.id === 'autoSave') { settings.autoSave = e.target.checked; store.set('autoSave', settings.autoSave); }
  if (e.target.id === 'filepick') { importFiles(e.target.files).finally(() => { e.target.value = ''; }); }
});
const seekEl = $('#seek');
seekEl.addEventListener('input', () => {
  seeking = true;
  const d = dur(), v = seekEl.value / 1000;
  seekEl.style.setProperty('--p', v * 100 + '%');
  $('#tCur').textContent = fmt(v * d);
  $('#tDur').textContent = '-' + fmt(Math.max(0, d - v * d));
});
seekEl.addEventListener('change', () => {
  const d = dur(), v = seekEl.value / 1000;
  if ((hasRealSrc() || (curIsYT() && ytLoaded())) && d) engSeek(v * d);
  else if (S.qi >= 0) S.restorePos = v * (curTrack().duration || 0);
  seeking = false;
  setPositionState();
});
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveQueue(); });

/* ---------------- Boot ---------------- */
async function init() {
  fillIcons(document);
  if (!navigator.onLine) document.body.classList.add('offline');
  try {
    const [tr, keys, pls] = await Promise.all([DB.all('tracks'), DB.keys('blobs'), DB.all('playlists')]);
    tr.forEach(t => S.tracks.set(t.id, t));
    keys.forEach(k => { if (!String(k).endsWith('#art')) S.cached.add(k); });
    S.playlists = pls.sort((a, b) => a.created - b.created);
  } catch (e) { toast('Storage unavailable: ' + e.message); }
  restoreQueue();
  render();
  renderPlayer();
  if (S.tab === 'search') doSearch();
  loadTrending();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(e => console.warn('sw', e));
}
init();
