'use strict';
const DRIVE_CATALOG_NAME = '_tunebox_library.json';
let driveCatalogRefresh = null, lastDriveCatalogCheck = 0;

function catalogEntry(entry) {
  if (!entry || typeof entry.driveId !== 'string' || typeof entry.title !== 'string' || !entry.title.trim()) return null;
  const clean = value => typeof value === 'string' ? value.slice(0, 1000).trim() : '';
  const names = Array.isArray(entry.artistCredits) ? [...new Set(entry.artistCredits.filter(n => typeof n === 'string').map(clean).filter(Boolean))].slice(0, 50) : [];
  return { driveId: entry.driveId, title: clean(entry.title), artist: clean(entry.artist) || names.join(' / '),
    artistCredits: names, album: clean(entry.album), albumArtist: clean(entry.albumArtist),
    catalogAlbumId: clean(entry.catalogAlbumId), art: /^https:\/\//i.test(entry.art || '') ? clean(entry.art) : '',
    duration: Number.isFinite(+entry.duration) && +entry.duration > 0 && +entry.duration < 86400 ? +entry.duration : 0,
    trackNumber: clean(String(entry.trackNumber || '')), discNumber: clean(String(entry.discNumber || '')) };
}
async function applyDriveCatalog(document) {
  if (document?.schema !== 1 || document.source !== 'tunebox-uploader' || !Array.isArray(document.tracks) || document.tracks.length > 100000) return 0;
  const byDriveId = new Map([...S.tracks.values()].filter(t => t.source === 'drive').map(t => [t.rid, t]));
  const changed = [];
  for (const raw of document.tracks) {
    const entry = catalogEntry(raw), track = entry && byDriveId.get(entry.driveId);
    if (!track) continue;
    const before = JSON.stringify(track);
    // These credits are from the exact recording uploaded, not a name search.
    for (const key of ['title', 'artist', 'album', 'albumArtist', 'catalogAlbumId', 'trackNumber', 'discNumber']) if (entry[key]) track[key] = entry[key];
    if (entry.artistCredits.length) track.artistCredits = entry.artistCredits;
    if (entry.duration && !track.duration) track.duration = entry.duration;
    if (!track.hasArt && entry.art) { track.art = entry.art; track.artFailed = false; }
    track.metadataSource = 'drive-catalog'; track.named = 'drive-catalog';
    if (entry.art || track.hasArt) {
      track.looked = 1; track.lookupStatus = 'matched'; track.lookupVersion = LOOKUP_VERSION; track.lookupRetryAt = 0;
      // Remove searches that were queued before the private catalog arrived.
      for (let i = lookupQ.length - 1; i >= 0; i--) if (lookupQ[i].id === track.id) lookupQ.splice(i, 1);
    }
    if (JSON.stringify(track) !== before) changed.push(track);
  }
  if (changed.length) await DB.putMany('tracks', changed);
  for (const track of changed) { queueArtworkSave(track); refreshLookupTrack(track); }
  return changed.length;
}
async function fetchDriveCatalog(id) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await gdFetch(`${GDAPI}/files/${encodeURIComponent(id)}?alt=media`, { signal: controller.signal });
    if (!response.ok) throw new Error('Cover catalog HTTP ' + response.status);
    const data = await response.text();
    if (data.length > 10 * 1024 * 1024) throw new Error('Cover catalog is too large');
    return applyDriveCatalog(JSON.parse(data));
  } finally { clearTimeout(timer); }
}
async function refreshDriveCatalog(ids = null, force = false) {
  if (driveCatalogRefresh) return driveCatalogRefresh;
  if (!navigator.onLine || !gdToken() || (!force && Date.now() - lastDriveCatalogCheck < 300000)) return 0;
  if (!ids && ![...S.tracks.values()].some(t => t.source === 'drive')) return 0;
  const task = (async () => {
    try {
      if (!ids) {
        const q = encodeURIComponent(`name='${DRIVE_CATALOG_NAME}' and mimeType='application/json' and trashed=false`);
        const response = await gdJSON(`${GDAPI}/files?q=${q}&fields=files(id)&pageSize=100`);
        ids = (response.files || []).map(f => f.id);
      }
      let count = 0;
      for (const id of [...new Set(ids)].slice(0, 20)) count += await fetchDriveCatalog(id);
      lastDriveCatalogCheck = Date.now();
      if (count) {
        const top = pageScroll.scrollTop, compact = document.body.classList.contains('dock-compact');
        if (S.tab === 'library' && !document.body.classList.contains('overlay-open')) {
          render({ background: true }); scrollPageTo(0, top); if (compact) setDockCompact(true, 'covers');
        }
        renderPlayer(); updateLookupStatus();
      }
      return count;
    } catch (error) { console.warn('Drive cover catalog', error.message); return 0; }
  })();
  driveCatalogRefresh = task;
  try { return await task; }
  finally { if (driveCatalogRefresh === task) driveCatalogRefresh = null; }
}
function queueRemainingCoverLookups() {
  [...S.tracks.values()].forEach(t => enqueueLookup(t));
}
