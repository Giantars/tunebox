'use strict';

function isDownloadedTrack(track) { return !!track && track.source !== 'youtube' && S.cached.has(track.id); }
function canBrowseTrack(track) { return !!track && (navigator.onLine || isDownloadedTrack(track)); }
function visibleLibraryTracks() { return [...S.tracks.values()].filter(canBrowseTrack); }
function visiblePlaylistTracks(playlist) { return playlist.ids.map(id => S.tracks.get(id)).filter(canBrowseTrack); }
function visiblePlaylists() { return navigator.onLine ? S.playlists : S.playlists.filter(p => visiblePlaylistTracks(p).length); }

// Credit separators describe collaborations, not new artist identities.
function collectionKey(value) {
  return String(value || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[\u2018\u2019]/g, "'").replace(/\s+/g, ' ').trim();
}
function realArtistName(value) {
  return !!value && !/^(?:unknown(?: artist)?|various(?: artists)?|va|music|songs|tunebox|n\/a)$/i.test(value.trim());
}
function splitArtistCredit(value, protectedNames = []) {
  let text = String(value || '').trim();
  if (!text) return [];
  // Catalog credits can explicitly identify a band whose name contains punctuation.
  const held = [];
  for (const name of [...new Set(['AC/DC', 'Earth, Wind & Fire', 'Tyler, The Creator', 'Florence + The Machine', 'Bigflo & Oli', 'Young T & Bugsey', ...protectedNames])].sort((a, b) => b.length - a.length)) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(new RegExp('(?<![\\p{L}\\p{N}])' + escaped + '(?![\\p{L}\\p{N}])', 'giu'), match => {
      held.push(match); return '\uE000' + (held.length - 1) + '\uE001';
    });
  }
  return text.replace(/\b(?:featuring|feat|ft)\.?\s+/gi, ';').split(/\s*(?:[;,/\\&+]|\s+(?:and|x|with)\s+)\s*/i)
    .map(name => name.replace(/\uE000(\d+)\uE001/g, (_, i) => held[+i]).replace(/^[\s([]+|[\s)\]]+$/g, '').trim())
    .filter(realArtistName);
}
function trackArtistNames(track, protectedNames = [], split = value => splitArtistCredit(value, protectedNames)) {
  const structured = Array.isArray(track.artistCredits) ? track.artistCredits.map(a => typeof a === 'string' ? a : a?.name).filter(realArtistName) : [];
  const names = structured.length ? structured : [...split(track.artist)];
  // Featured guests are often only written in the title's credits.
  for (const match of String(track.title || '').matchAll(/\b(?:featuring|feat|ft)\.?\s+([^)\]\r\n]+)/gi)) names.push(...split(match[1]));
  return [...new Map(names.map(name => [collectionKey(name), name])).values()];
}
function albumArtworkKey(track) {
  if (track.coverKey) return 'image:' + track.coverKey;
  if (!track.art || !/^https?:\/\//i.test(track.art)) return '';
  try {
    const url = new URL(track.art);
    if (/(?:^|[/_.-])(?:placeholder|default|no[-_]?cover|unknown)(?:[_.-]|$)/i.test(url.pathname)) return '';
    // The same catalog cover is served from several CDN hosts and at different sizes.
    if (/(?:^|\.)mzstatic\.com$/i.test(url.hostname)) return 'apple-art:' + url.pathname.replace(/\/\d+x\d+[^/]*$/, '');
    for (const parameter of ['w', 'h', 'width', 'height', 'size']) url.searchParams.delete(parameter);
    return 'art:' + url.host.toLowerCase() + url.pathname + (url.searchParams.size ? '?' + url.searchParams.toString() : '');
  } catch { return ''; }
}
function musicCollections() {
  const albums = new Map(), artists = new Map();
  const tracks = [...S.tracks.values()].filter(t => ownMusic(t) && canBrowseTrack(t));
  const protectedNames = [...new Set(tracks.flatMap(t => Array.isArray(t.artistCredits) ? t.artistCredits.map(a => typeof a === 'string' ? a : a?.name).filter(Boolean) : []))]
    .filter(name => /[;,/\\&+]|\s(?:and|x|with)\s/i.test(name));
  const creditCache = new Map();
  const split = value => { if (!creditCache.has(value)) creditCache.set(value, splitArtistCredit(value, protectedNames)); return creditCache.get(value); };
  const entries = tracks.map(track => {
    const names = trackArtistNames(track, protectedNames, split);
    const albumArtist = /^(?:various(?: artists)?|va)$/i.test(String(track.albumArtist || '').trim()) ? 'Various Artists'
      : split(track.albumArtist)[0] || names[0] || 'Unknown artist';
    const title = String(track.album || '').replace(/\s+-\s+(?:Single|EP)$/i, '').trim();
    const keys = [albumArtworkKey(track), track.catalogAlbumId ? 'release:' + track.catalogAlbumId : '',
      'metadata:' + JSON.stringify([collectionKey(albumArtist), collectionKey(title)])].filter(Boolean);
    return { track, names, albumArtist, title, keys };
  });
  const parent = entries.map((_, i) => i), aliases = new Map();
  const root = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  entries.forEach((entry, i) => entry.keys.forEach(key => {
    // Missing album names must not bridge two distinct real covers/releases.
    if (!entry.title && key.startsWith('metadata:') && entry.keys.length > 1) return;
    if (aliases.has(key)) parent[root(i)] = root(aliases.get(key)); else aliases.set(key, i);
  }));
  const grouped = new Map();
  entries.forEach((entry, i) => { const id = root(i); if (!grouped.has(id)) grouped.set(id, []); grouped.get(id).push(entry); });
  const mostCommon = values => {
    const votes = new Map();
    for (const value of values.filter(Boolean)) { const id = collectionKey(value), vote = votes.get(id) || { value, count: 0 }; vote.count++; votes.set(id, vote); }
    return [...votes.values()].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))[0]?.value;
  };
  for (const members of grouped.values()) {
    const keys = [...new Set(members.flatMap(e => e.keys))];
    const id = keys.filter(k => !k.startsWith('metadata:')).sort()[0] || keys.sort()[0];
    const group = { id, title: mostCommon(members.map(e => e.title)) || 'Singles & other songs',
      artist: mostCommon(members.map(e => e.track.albumArtist || e.albumArtist)) || 'Unknown artist',
      artistIds: new Set(), tracks: members.map(e => e.track), liked: 0, recent: 0 };
    albums.set(id, group);
    for (const { track, names } of members) {
      group.liked += !!track.liked; group.recent = Math.max(group.recent, track.lastPlayed || track.added || 0);
      for (const name of names) {
        const artistId = collectionKey(name);
        if (!artists.has(artistId)) artists.set(artistId, { id: artistId, title: name, tracks: [], albums: [] });
        const artist = artists.get(artistId);
        if (artist.title === artist.title.toUpperCase() && name !== name.toUpperCase()) artist.title = name;
        artist.tracks.push(track); group.artistIds.add(artistId);
      }
    }
    group.tracks.sort((a, b) => (parseInt(a.discNumber) || 1) - (parseInt(b.discNumber) || 1)
      || (parseInt(a.trackNumber) || 9999) - (parseInt(b.trackNumber) || 9999)
      || a.title.localeCompare(b.title, undefined, { numeric: true }));
    group.cover = group.tracks.find(hasCover) || group.tracks[0];
    for (const artistId of group.artistIds) artists.get(artistId).albums.push(group);
  }
  for (const artist of artists.values()) {
    artist.albums.sort((a, b) => a.title.localeCompare(b.title));
    artist.cover = artist.tracks.find(hasCover) || artist.tracks[0];
  }
  return { albums, artists };
}
async function coverFingerprint(bytes) {
  if (!crypto.subtle) return '';
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('');
}
async function backfillCoverKeys() {
  let changed = false;
  for (const track of S.tracks.values()) {
    if (!ownMusic(track) || !track.hasArt || track.art || track.coverKey) continue;
    try {
      const blob = await getBlob(track.id + '#art');
      if (!blob) continue;
      const key = await coverFingerprint(await blob.arrayBuffer());
      if (key && !track.coverKey && !track.art && S.tracks.get(track.id) === track) { track.coverKey = key; await saveTrack(track); changed = true; }
    } catch { /* Older covers can still group by album metadata. */ }
  }
  if (changed && S.tab === 'library' && !document.body.classList.contains('overlay-open')) {
    const top = pageScroll.scrollTop, compact = document.body.classList.contains('dock-compact');
    render({ background: true }); scrollPageTo(0, top); if (compact) setDockCompact(true, 'collections');
  }
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
  if (recent.length) h += `<h2>Recently played<button class="section-link" data-act="open" data-type="recent">See all</button></h2><div class="recent-grid" data-section="recently-played">${recent.map((t, i) => `<button class="recent-tile" data-track-id="${esc(t.id)}" data-act="play" data-list="recentH" data-i="${i}">${art(t, 'art')}<span class="t">${esc(t.title)}</span></button>`).join('')}</div>`;
  if (favorites.length) h += `<h2>Albums you love</h2><div class="cards" data-section="favorite-albums">${favorites.map(albumCard).join('')}</div>`;
  if (playlists.length) h += `<h2>Your playlists<button class="section-link" data-act="new-pl">New playlist</button></h2><div class="cards" data-section="home-playlists">${playlists.map(p => { const tracks = visiblePlaylistTracks(p), t = tracks[0]; return `<button class="card playlist-card" data-act="open" data-type="pl" data-id="${esc(p.id)}">${t ? art(t, 'card-art') : `<span class="card-art playlist-placeholder">${icon('list')}</span>`}<span class="t">${esc(p.name)}</span><span class="a">${tracks.length} songs</span></button>`; }).join('')}</div>`;
  if (added.length) h += `<h2>Recently added<button class="section-link" data-act="tab" data-tab="library">See all</button></h2><div class="album-grid" data-section="recently-added">${added.map((t, i) => `<button class="card" data-track-id="${esc(t.id)}" data-act="play" data-list="homeMusic" data-i="${i}">${art(t, 'card-art')}<span class="t">${esc(t.title)}</span><span class="a">${esc(t.artist)}</span></button>`).join('')}</div>`;
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
  refreshLibraryDownload();
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
    const needed = libraryDownloadJob().enabled || S.playlists.some(other => other.id !== id && !playlistDownloadJobs.get(other.id)?.paused && playlistDownloadJobs.has(other.id) && other.ids.includes(t.id));
    if (ids.has(t.id) && !needed && t.id !== curTrack()?.id) { dlQueue.splice(i, 1); S.downloading.delete(t.id); }
  }
  savePlaylistJobs(); refreshPlaylistDownloads(); refreshRows();
}
function notePlaylistDownload(id, error) {
  noteLibraryDownload(id, error);
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
  resumeLibraryDownload();
  for (const p of S.playlists) if (playlistDownloadJobs.has(p.id)) queuePlaylistJob(p);
}
function stopPlaylistDownloads() {
  pauseLibraryDownload();
  for (const id of playlistDownloadJobs.keys()) pausePlaylistDownload(id);
  playlistDownloadJobs.clear(); savePlaylistJobs();
}
