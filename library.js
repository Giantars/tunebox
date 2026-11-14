'use strict';

function isDownloadedTrack(track) { return !!track && track.source !== 'youtube' && S.cached.has(track.id); }
function canBrowseTrack(track) { return !!track && (navigator.onLine || isDownloadedTrack(track)); }
function visibleLibraryTracks() { return [...S.tracks.values()].filter(canBrowseTrack); }
function visiblePlaylistTracks(playlist) { return playlist.ids.map(id => S.tracks.get(id)).filter(canBrowseTrack); }
function visiblePlaylists() { return navigator.onLine ? S.playlists : S.playlists.filter(p => visiblePlaylistTracks(p).length); }

function musicCollections() {
  const albums = new Map(), artists = new Map();
  const key = value => String(value || '').normalize('NFKC').trim().toLocaleLowerCase();
  for (const track of S.tracks.values()) {
    if (!ownMusic(track) || !canBrowseTrack(track)) continue;
    const artist = String(track.artist || '').trim() || 'Unknown artist';
    const albumArtist = String(track.albumArtist || artist).trim() || artist;
    const album = String(track.album || '').trim();
    const artistId = key(artist), albumId = JSON.stringify([key(albumArtist), key(album)]);
    if (!albums.has(albumId)) albums.set(albumId, { id: albumId, title: album || 'Singles & other songs', artist: albumArtist, artistIds: new Set(), tracks: [], liked: 0, recent: 0 });
    if (!artists.has(artistId)) artists.set(artistId, { id: artistId, title: artist, tracks: [], albums: [] });
    const group = albums.get(albumId);
    group.artistIds.add(artistId);
    group.tracks.push(track); group.liked += !!track.liked; group.recent = Math.max(group.recent, track.lastPlayed || track.added || 0);
    artists.get(artistId).tracks.push(track);
  }
  for (const album of albums.values()) {
    album.tracks.sort((a, b) => (parseInt(a.discNumber) || 1) - (parseInt(b.discNumber) || 1)
      || (parseInt(a.trackNumber) || 9999) - (parseInt(b.trackNumber) || 9999)
      || a.title.localeCompare(b.title, undefined, { numeric: true }));
    album.cover = album.tracks.find(hasCover) || album.tracks[0];
    for (const id of album.artistIds) artists.get(id).albums.push(album);
  }
  for (const artist of artists.values()) {
    artist.albums.sort((a, b) => a.title.localeCompare(b.title));
    artist.cover = artist.tracks.find(hasCover) || artist.tracks[0];
  }
  return { albums, artists };
}
function albumCard(album) {
  return `<button class="card collection-card" data-act="open" data-type="album" data-id="${esc(album.id)}" data-reference="${esc(album.cover.id)}">${art(album.cover, 'card-art')}<span class="t">${esc(album.title)}</span><span class="a">${esc(album.artist)}</span></button>`;
}
function resolveMusicCollection(map, sub) {
  const group = map.get(sub.id) || [...map.values()].find(g => g.tracks.some(t => t.id === sub.reference));
  if (group) sub.id = group.id;
  return group;
}
function libraryBackLabel() {
  const parent = S.libraryTrail?.[S.libraryTrail.length - 1];
  return parent?.type === 'albums' ? 'Albums' : parent?.type === 'artists' ? 'Artists' : parent?.type === 'artist' ? 'Artist' : 'Library';
}
function viewCollections() {
  const groups = musicCollections(), sub = S.sub;
  let h = `<button class="backbar" data-act="back">${icon('back')}${libraryBackLabel()}</button>`;
  if (sub.type === 'albums') {
    const albums = [...groups.albums.values()].sort((a, b) => a.title.localeCompare(b.title));
    return h + `<h1>Albums</h1><p class="library-summary">${albums.length} albums</p>`
      + (albums.length ? `<div class="album-grid">${albums.map(albumCard).join('')}</div>` : `<div class="msg">${navigator.onLine ? 'Add music to see your albums here.' : 'No downloaded albums yet.'}</div>`);
  }
  if (sub.type === 'artists') {
    const artists = [...groups.artists.values()].sort((a, b) => a.title.localeCompare(b.title));
    return h + `<h1>Artists</h1><p class="library-summary">${artists.length} artists</p>` + (artists.length ? `<div class="artist-grid">${artists.map(artist => `<button class="artist-card" data-act="open" data-type="artist" data-id="${esc(artist.id)}" data-reference="${esc(artist.cover.id)}">${art(artist.cover, 'artist-art')}<span class="t">${esc(artist.title)}</span><span class="a">${artist.tracks.length} songs</span></button>`).join('')}</div>` : '<div class="msg">Add music to see your artists here.</div>');
  }
  const artist = resolveMusicCollection(groups.artists, sub);
  if (!artist) return h + `<h1>Artist</h1><div class="msg">${navigator.onLine ? 'This artist is no longer in your library.' : 'No songs by this artist are downloaded yet.'}</div>`;
  const list = 'artist:' + sub.id;
  S.lists[list] = artist.tracks;
  return h + `<header class="collection-heading">${art(artist.cover, 'artist-art')}<div><h1>${esc(artist.title)}</h1><p class="small">${artist.albums.length} albums · ${artist.tracks.length} songs</p></div></header>`
    + `<div class="list-head"><button class="btn" data-act="play-all" data-list="${esc(list)}">${icon('play')}Play</button><button class="btn" data-act="shuffle-all" data-list="${esc(list)}">${icon('shuffle')}Shuffle</button></div>`
    + `<h2>Albums</h2><div class="album-grid">${artist.albums.map(albumCard).join('')}</div>`
    + `<h2>Songs</h2>${rows(list, artist.tracks)}`;
}
function renderPersonalHome() {
  const all = visibleLibraryTracks(), mine = all.filter(ownMusic), groups = musicCollections(), playlists = visiblePlaylists();
  const current = canBrowseTrack(curTrack()) ? curTrack() : null, recent = all.filter(t => t.lastPlayed && t.id !== current?.id).sort((a, b) => b.lastPlayed - a.lastPlayed).slice(0, 6);
  const added = mine.slice().sort((a, b) => (b.added || 0) - (a.added || 0)).slice(0, 4);
  const favorites = [...groups.albums.values()].filter(a => a.liked).sort((a, b) => b.liked - a.liked || b.recent - a.recent).slice(0, 6);
  const saved = all.filter(isDownloadedTrack).length, liked = all.filter(t => t.liked).length;
  document.body.classList.toggle('home-populated', !!(mine.length || current || S.playlists.length));
  S.lists.recentH = recent; S.lists.homeMusic = added;
  let h = `<div class="forest-scene" aria-hidden="true"><img src="assets/white-forest-photo.webp" alt="" decoding="async"></div><header class="home-heading"><div><div class="app-label">Tunebox</div><h1>Home<span class="offline-pill">Offline</span></h1></div><button class="profile-button" data-act="tab" data-tab="settings" aria-label="Open settings">${icon('settings')}</button></header>`;
  if (current) h += `<button class="continue-card" data-act="resume-current">${art(canon(current), 'art')}<span class="meta"><small>${engPlaying() ? 'Now playing' : 'Continue listening'}</small><span class="t">${esc(current.title)}</span><span class="a">${esc(current.artist)}${!engPlaying() && (engTime() || S.restorePos) > 0 ? ' · ' + fmt(engTime() || S.restorePos) : ''}</span></span><span class="continue-icon">${icon(engPlaying() ? 'queue' : 'play')}</span></button>`;
  h += `<div class="home-shortcuts"><button data-act="open" data-type="liked"><span class="shortcut-art favorite">${icon('heartOn')}</span><span>Favorites<small>${liked} songs</small></span></button><button data-act="open" data-type="offline"><span class="shortcut-art saved">${icon('download')}</span><span>Downloads<small>${saved} on this device</small></span></button></div>`;
  if (!mine.length) h += navigator.onLine ? `<section class="library-setup"><div class="setup-heading">${icon('cloud')}<h2>Your music library</h2></div><p>Add your songs from Google Drive or this device.</p><div class="setup-actions"><button class="btn primary" data-act="gd-sync">Connect & sync</button><button class="btn" data-act="import">Add files</button></div></section>` : `<section class="library-setup"><h2>No downloaded music yet</h2><p>Go online to download songs or playlists, or add files from this device.</p><button class="btn" data-act="import">Add files</button></section>`;
  if (recent.length) h += `<h2>Recently played<button class="section-link" data-act="open" data-type="recent">See all</button></h2><div class="recent-grid">${recent.map((t, i) => `<button class="recent-tile" data-act="play" data-list="recentH" data-i="${i}">${art(t, 'art')}<span class="t">${esc(t.title)}</span></button>`).join('')}</div>`;
  if (favorites.length) h += `<h2>Albums you love</h2><div class="cards">${favorites.map(albumCard).join('')}</div>`;
  if (playlists.length) h += `<h2>Your playlists<button class="section-link" data-act="new-pl">New playlist</button></h2><div class="cards">${playlists.map(p => { const tracks = visiblePlaylistTracks(p), t = tracks[0]; return `<button class="card playlist-card" data-act="open" data-type="pl" data-id="${esc(p.id)}">${t ? art(t, 'card-art') : `<span class="card-art playlist-placeholder">${icon('list')}</span>`}<span class="t">${esc(p.name)}</span><span class="a">${tracks.length} songs</span></button>`; }).join('')}</div>`;
  if (added.length) h += `<h2>Recently added<button class="section-link" data-act="tab" data-tab="library">See all</button></h2><div class="album-grid">${added.map((t, i) => `<button class="card" data-act="play" data-list="homeMusic" data-i="${i}">${art(t, 'card-art')}<span class="t">${esc(t.title)}</span><span class="a">${esc(t.artist)}</span></button>`).join('')}</div>`;
  if (isIOS() && !isStandalone() && !store.get('hideInstall', false)) h += `<div class="banner"><div>For full-screen listening, use Safari's Share menu and choose <b>Add to Home Screen</b>.</div><button class="icon" data-act="hide-install" aria-label="Dismiss">${icon('x')}</button></div>`;
  return h;
}

/* Playlist jobs persist as IDs and states. Song bytes remain in IndexedDB. */
const playlistDownloadJobs = new Map();
function savePlaylistJobs() { store.set('playlistJobs', [...playlistDownloadJobs.values()]); }
function playlistTracks(p) { return [...new Set(p.ids)].map(id => S.tracks.get(id)).filter(Boolean); }
function playlistDownloadState(p) {
  const all = playlistTracks(p), tracks = all.filter(ownMusic), job = playlistDownloadJobs.get(p.id);
  const saved = tracks.filter(t => S.cached.has(t.id)).length;
  const active = tracks.filter(t => !S.cached.has(t.id) && S.downloading.has(t.id)).length;
  const failed = tracks.filter(t => !S.cached.has(t.id) && job?.failures?.[t.id]).length;
  let text = `${saved} of ${tracks.length} saved`;
  if (tracks.length && saved === tracks.length) text = 'Ready offline';
  else if (job?.paused) text += ' · paused';
  else if (job && !navigator.onLine) text += ' · waiting for connection';
  else if (active) text += ` · ${tracks.length - saved} remaining`;
  else if (failed) text += ` · ${failed} need retry`;
  return { job, tracks, total: tracks.length, saved, active, failed, skipped: all.length - tracks.length, text };
}
function playlistProgressHTML(p) {
  const s = playlistDownloadState(p), complete = s.total > 0 && s.saved === s.total;
  const action = s.job?.paused ? 'Resume download' : s.failed && !s.active ? 'Retry missing songs' : complete ? 'Downloaded' : 'Download playlist';
  const errors = s.tracks.filter(t => !S.cached.has(t.id)).map(t => s.job?.failures[t.id] || '');
  const needsAuth = errors.some(message => message === 'DRIVE_AUTH');
  const needsStorage = errors.some(message => /quota|storage/i.test(message));
  return `<div class="playlist-download" data-playlist-progress="${esc(p.id)}"><div class="download-summary"><span>${esc(s.text)}</span>${s.job && !complete && !s.job.paused && s.active ? `<button class="section-link" data-act="pause-pl" data-id="${esc(p.id)}">Pause</button>` : ''}</div><progress max="${s.total || 1}" value="${s.saved}" aria-label="${esc(p.name)} download progress"></progress>${s.skipped ? `<p class="small">${s.skipped} YouTube or online-only songs stay online.</p>` : ''}${needsAuth ? '<p class="small">Connect Google Drive in Settings, then retry.</p>' : ''}${needsStorage ? '<p class="small">Free some space on this device, then retry.</p>' : ''}<button class="btn" data-act="download-pl" data-id="${esc(p.id)}" ${!s.total || complete || (s.active && !s.job?.paused) ? 'disabled' : ''}>${icon(complete ? 'check' : 'download')}${action}</button>${s.job && !complete ? '<p class="small download-note">Keep Tunebox open while songs download.</p>' : ''}</div>`;
}
function refreshPlaylistDownloads() {
  $$('[data-playlist-progress]').forEach(el => {
    const p = S.playlists.find(p => p.id === el.dataset.playlistProgress);
    if (p) el.outerHTML = playlistProgressHTML(p);
  });
  $$('[data-download-jobs]').forEach(el => { el.innerHTML = downloadJobsHTML(); });
}
function downloadJobsHTML() {
  return S.playlists.filter(p => playlistDownloadJobs.has(p.id)).map(p => {
    const s = playlistDownloadState(p);
    if (!s.total || s.saved === s.total) return '';
    return `<button class="download-job" data-act="open" data-type="pl" data-id="${esc(p.id)}"><span class="t">${esc(p.name)}</span><span class="small">${esc(s.text)}</span><progress max="${s.total}" value="${s.saved}" aria-label="Download progress"></progress></button>`;
  }).join('');
}
function queuePlaylistJob(p, retry = false) {
  const job = playlistDownloadJobs.get(p.id);
  if (!job || job.paused) return;
  if (retry) job.failures = {};
  if (navigator.onLine) for (const t of playlistTracks(p).filter(ownMusic)) {
    if (S.cached.has(t.id) || job.failures[t.id] || S.downloading.has(t.id)) continue;
    if (t.source === 'local') job.failures[t.id] = 'File is missing from this device';
    else cacheTrack(t);
  }
  savePlaylistJobs(); refreshPlaylistDownloads();
}
function downloadPlaylist(p) {
  if (!p) return;
  let job = playlistDownloadJobs.get(p.id);
  if (!job) { job = { id: p.id, paused: false, failures: {}, requested: Date.now() }; playlistDownloadJobs.set(p.id, job); }
  job.paused = false; queuePlaylistJob(p, true);
}
function pausePlaylistDownload(id) {
  const job = playlistDownloadJobs.get(id), p = S.playlists.find(p => p.id === id);
  if (!job || !p) return;
  job.paused = true;
  const ids = new Set(p.ids);
  for (let i = dlQueue.length - 1; i >= 0; i--) {
    const t = dlQueue[i];
    const needed = S.playlists.some(other => other.id !== id && !playlistDownloadJobs.get(other.id)?.paused && playlistDownloadJobs.has(other.id) && other.ids.includes(t.id));
    if (ids.has(t.id) && !needed && t.id !== curTrack()?.id) { dlQueue.splice(i, 1); S.downloading.delete(t.id); }
  }
  savePlaylistJobs(); refreshPlaylistDownloads(); refreshRows();
}
function notePlaylistDownload(id, error) {
  for (const p of S.playlists) {
    const job = playlistDownloadJobs.get(p.id);
    if (!job || !p.ids.includes(id)) continue;
    if (error) job.failures[id] = error.message || 'Download failed';
    else delete job.failures[id];
  }
  savePlaylistJobs(); refreshPlaylistDownloads();
}
function restorePlaylistDownloads() {
  for (const job of store.get('playlistJobs', [])) {
    if (!job || !S.playlists.some(p => p.id === job.id)) continue;
    // Navigation can reject an in-flight fetch just before the page closes.
    // Resume transient network failures on reopen; preserve errors needing action.
    const failures = Object.fromEntries(Object.entries(job.failures || {}).filter(([, message]) => /DRIVE_AUTH|quota|storage|missing from this device|HTTP 40[134]/i.test(message)));
    playlistDownloadJobs.set(job.id, { ...job, failures });
  }
  resumePlaylistDownloads();
}
function resumePlaylistDownloads() {
  for (const p of S.playlists) if (playlistDownloadJobs.has(p.id)) queuePlaylistJob(p);
}
function stopPlaylistDownloads() {
  for (const id of playlistDownloadJobs.keys()) pausePlaylistDownload(id);
  playlistDownloadJobs.clear(); savePlaylistJobs();
}
