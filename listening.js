'use strict';

// Keep the user's queue intact; recommendations are only appended near its end.
function fillAutoplay() {
  const current = curTrack();
  if (!settings.autoplay || S.repeat !== 'off' || !current || current.source === 'youtube'
      || S.queue.length - S.qi - 1 > 3) return false;
  const future = new Set(S.queue.slice(S.qi).map(t => t.id));
  const library = [...S.tracks.values()].filter(t => ['drive', 'local'].includes(t.source)
    && (!S.activeMix || matchesHomeMix(t, S.activeMix))
    && canBrowseTrack(t) && (isDownloadedTrack(t) || (t.source === 'drive' && !!gdToken())));
  const recent = new Set(S.queue.slice(Math.max(0, S.qi - Math.min(15, library.length - 2)), S.qi).map(t => t.id));
  let candidates = library.filter(t => !future.has(t.id) && !recent.has(t.id));
  if (!candidates.length) candidates = library.filter(t => !future.has(t.id));
  // A one-song library can still continue, without repeating it early in a larger queue.
  if (!candidates.length && S.qi === S.queue.length - 1 && library.length === 1) candidates = library;
  const normalize = value => String(value || '').trim().toLocaleLowerCase();
  const artists = new Set(S.queue.slice(Math.max(0, S.qi - 4), S.qi + 1).map(t => normalize(t.artist)));
  const score = t => (artists.has(normalize(t.artist)) ? 4 : 0) + (t.liked ? 3 : 0)
    + (t.album && t.album === current.album ? 2 : 0) + 2 / (1 + (t.plays || 0))
    + Math.min(3, (Date.now() - (t.lastPlayed || 0)) / 864e5) + Math.random() * 3;
  const picks = candidates.map(t => ({ t, score: score(t) })).sort((a, b) => b.score - a.score).slice(0, 8).map(x => x.t);
  if (!picks.length) return false;
  S.queue.push(...picks);
  if (S.orig) S.orig.push(...picks);
  return true;
}

// Blob URLs are prepared while audio is still playing. The ended handler can
// change src and call play on the SAME element without awaiting storage/network.
const preparedAudio = new Map(), preparingAudio = new Map(), prepareFailures = new Map();
let preparationScheduled = false, wantedAudio = new Set();
function playableAhead(t) {
  return !!t && t.source !== 'youtube' && canBrowseTrack(t)
    && (isDownloadedTrack(t) || (t.source === 'drive' && navigator.onLine && !!gdToken()));
}
function schedulePreparation() {
  if (preparationScheduled) return;
  preparationScheduled = true;
  queueMicrotask(() => { preparationScheduled = false; prepareUpcoming(); });
}
function prepareUpcoming() {
  if (S.qi < 0 || !curTrack() || curIsYT()) {
    wantedAudio.clear();
    for (const url of preparedAudio.values()) URL.revokeObjectURL(url);
    preparedAudio.clear();
    return;
  }
  const upcoming = S.queue.slice(S.qi + 1);
  if (S.repeat === 'all') upcoming.push(...S.queue.slice(0, S.qi + 1));
  const tracks = [...new Map(upcoming.filter(playableAhead).map(t => [t.id, t])).values()].slice(0, 3);
  wantedAudio = new Set(tracks.map(t => t.id));
  for (const [id, url] of preparedAudio) if (!wantedAudio.has(id)) { URL.revokeObjectURL(url); preparedAudio.delete(id); }
  for (const t of tracks) {
    if (preparedAudio.has(t.id) || preparingAudio.has(t.id) || Date.now() - (prepareFailures.get(t.id) || 0) < 30000) continue;
    const task = (async () => {
      try {
        let blob = isDownloadedTrack(t) ? await getBlob(t.id) : null;
        if (!blob && t.source === 'drive' && navigator.onLine && gdToken()) blob = await doCache(t, { store: settings.autoSave });
        if (blob && wantedAudio.has(t.id)) preparedAudio.set(t.id, URL.createObjectURL(blob));
      } catch { prepareFailures.set(t.id, Date.now()); /* Normal playback/download UI handles errors. */ }
      finally { preparingAudio.delete(t.id); }
    })();
    preparingAudio.set(t.id, task);
  }
}
function takePreparedAudio(t) {
  const url = preparedAudio.get(t.id);
  if (url && playableAhead(t)) { preparedAudio.delete(t.id); return url; }
  return null;
}

// A resumable download of the user's Drive library, independent of playlists.
let libraryDownload = null;
function libraryDownloadJob() {
  if (!libraryDownload) libraryDownload = store.get('libraryDownload', { enabled: true, failures: {} });
  return libraryDownload;
}
function saveLibraryDownload() { store.set('libraryDownload', libraryDownloadJob()); }
function noteLibraryDownload(id, error) {
  const job = libraryDownloadJob();
  if (error) job.failures[id] = error.message || 'Download failed'; else delete job.failures[id];
  saveLibraryDownload();
}
function resumeLibraryDownload(retry = false) {
  const job = libraryDownloadJob();
  if (retry) { job.enabled = true; job.failures = {}; }
  else for (const [id, message] of Object.entries(job.failures)) {
    if (!/DRIVE_AUTH|quota|storage|HTTP 40[134]|missing/i.test(message)) delete job.failures[id];
  }
  if (job.enabled && navigator.onLine && gdToken()) {
    for (const t of S.tracks.values()) if (t.source === 'drive' && !job.failures[t.id]) cacheTrack(t);
  }
  saveLibraryDownload(); refreshLibraryDownload();
}
function pauseLibraryDownload() {
  libraryDownloadJob().enabled = false;
  for (let i = dlQueue.length - 1; i >= 0; i--) {
    const t = dlQueue[i];
    const needed = S.playlists.some(p => playlistDownloadJobs.has(p.id) && !playlistDownloadJobs.get(p.id).paused && p.ids.includes(t.id));
    if (!needed && t.id !== curTrack()?.id) { dlQueue.splice(i, 1); S.downloading.delete(t.id); }
  }
  saveLibraryDownload(); refreshLibraryDownload(); refreshRows();
}
function libraryDownloadHTML() {
  const tracks = [...S.tracks.values()].filter(t => t.source === 'drive');
  if (!tracks.length) return '';
  const job = libraryDownloadJob(), saved = tracks.filter(isDownloadedTrack).length;
  const failed = tracks.filter(t => !isDownloadedTrack(t) && job.failures[t.id]).length;
  const active = tracks.some(t => S.downloading.has(t.id)), complete = saved === tracks.length;
  const state = complete ? 'Ready offline' : !navigator.onLine ? 'Waiting for connection' : !gdToken() ? 'Connect Google Drive to continue'
    : !job.enabled ? 'Paused' : active ? 'Downloading' : failed ? 'Some songs need retry' : 'Ready to continue';
  return `<div class="group library-download" data-library-download><div class="set-head">Your music, offline</div><p class="small" role="status">${saved} of ${tracks.length} songs saved · ${state}</p><progress value="${saved}" max="${tracks.length}" aria-label="Library download progress"></progress>${!complete ? `<div class="list-head"><button class="btn" data-act="${active && job.enabled ? 'pause-library' : 'download-library'}">${active && job.enabled ? 'Pause' : 'Resume downloads'}</button>${!gdToken() && navigator.onLine ? '<button class="btn" data-act="gd-sync">Connect Drive</button>' : ''}</div><p class="small">Keep Tunebox open while downloading. Saved songs stay on this device.</p>` : ''}</div>`;
}
function refreshLibraryDownload() {
  $$('[data-library-download]').forEach(el => { el.outerHTML = libraryDownloadHTML(); });
}
