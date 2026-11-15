'use strict';
const HOME_MIXES = {
  vibing: { title: 'Vibing', subtitle: 'Slow down. Settle in.', tone: 'calm', description: 'A gentler pace, with songs you choose and slower tempo matches.' },
  party: { title: 'Party', subtitle: 'Turn the energy up.', tone: 'bright', description: 'Faster tempo matches and your own party picks, ready to keep going.' },
};
function matchesHomeMix(track, id) {
  if (!HOME_MIXES[id] || !ownMusic(track)) return false;
  if (typeof track.moodOverrides?.[id] === 'boolean') return track.moodOverrides[id];
  const bpm = Number(track.bpm), confidence = Number(track.tempoConfidence);
  if (!(bpm >= 40 && bpm <= 220 && confidence >= .2)) return false;
  return id === 'party' ? bpm >= 115 : bpm <= 105;
}
function homeMixTracks(id) {
  const date = new Date().toISOString().slice(0, 10);
  const tracks = visibleLibraryTracks().filter(t => matchesHomeMix(t, id));
  const score = t => (t.liked ? 2 : 0) + (t.moodOverrides?.[id] ? 3 : 0) + hue(date + t.id) / 360;
  const ranked = tracks.map(t => ({ t, score: score(t) })).sort((a, b) => b.score - a.score).map(x => x.t);
  // Spread repeated main artists through the mix instead of collecting them in a block.
  const selected = [];
  while (ranked.length && selected.length < 40) {
    const last = selected.slice(-2).map(t => trackArtistNames(t)[0]);
    const index = ranked.findIndex(t => !last.includes(trackArtistNames(t)[0]));
    selected.push(ranked.splice(Math.max(0, index), 1)[0]);
  }
  return selected;
}
function renderHomeMixes() {
  return `<h2>Find your mood</h2><div class="mood-grid" data-section="home-mixes">${Object.entries(HOME_MIXES).map(([id, mix]) => {
    const tracks = homeMixTracks(id), seen = new Set();
    const covers = tracks.filter(t => { const key = albumArtworkKey(t) || t.id; if (!hasCover(t) || seen.has(key)) return false; seen.add(key); return true; }).slice(0, 4);
    return `<button class="mood-card mood-${mix.tone}" data-act="open" data-type="mix" data-id="${id}"><span class="mood-art" aria-hidden="true">${covers.map(t => art(t, 'mood-cover')).join('')}</span><span class="mood-copy"><small>${esc(mix.subtitle)}</small><strong>${mix.title}</strong><span>${tracks.length ? tracks.length + ' songs' : 'Make it yours'} ${icon('play')}</span></span></button>`;
  }).join('')}</div>`;
}
function homePins() { return store.get('homePins', []).filter(p => ['album', 'pl'].includes(p.type)); }
function homePinIndex(pins, type, reference) {
  if (type !== 'album') return pins.findIndex(p => p.type === type && p.id === reference);
  const groups = musicCollections().albums;
  const target = [...groups.values()].find(group => group.tracks.some(track => track.id === reference));
  return pins.findIndex(pin => pin.type === type && (pin.reference === reference || (target && target.tracks.some(t => t.id === pin.reference))));
}
function pinnedHomeItem(type, reference) { return homePinIndex(homePins(), type, reference) >= 0; }
function toggleHomePin(type, id, reference) {
  const pins = homePins().filter(pin => pin.type === 'album' ? S.tracks.has(pin.reference) : S.playlists.some(p => p.id === pin.id));
  const index = homePinIndex(pins, type, type === 'album' ? reference : id);
  if (index >= 0) pins.splice(index, 1);
  else {
    if (pins.length >= 6) { toast('You can pin up to six favorites. Unpin one to make room.'); return; }
    pins.push({ type, id, reference });
  }
  store.set('homePins', pins); toast(index >= 0 ? 'Unpinned from Home' : 'Pinned to Home');
  render({ background: true });
}
function homePinButton(type, id, reference) {
  const active = pinnedHomeItem(type, type === 'album' ? reference : id);
  return `<button class="btn home-pin ${active ? 'on' : ''}" data-act="home-pin" data-type="${type}" data-id="${esc(id)}" data-reference="${esc(reference || '')}">${icon('pin')}${active ? 'Unpin from Home' : 'Pin to Home'}</button>`;
}
function renderHomePins(groups, playlists) {
  const entries = homePins().map(pin => {
    if (pin.type === 'album') {
      const album = resolveMusicCollection(groups.albums, { ...pin });
      return album ? albumCard(album) : '';
    }
    const playlist = playlists.find(p => p.id === pin.id);
    if (!playlist) return '';
    const track = visiblePlaylistTracks(playlist)[0];
    return `<button class="card playlist-card" data-act="open" data-type="pl" data-id="${esc(playlist.id)}">${track ? art(track, 'card-art') : `<span class="card-art playlist-placeholder">${icon('list')}</span>`}<span class="t">${esc(playlist.name)}</span><span class="a">Playlist</span></button>`;
  }).filter(Boolean);
  return entries.length ? `<h2>Pinned for you</h2><div class="cards" data-section="home-pins">${entries.join('')}</div>` : '';
}
function renderHomeRediscovery(tracks) {
  const cutoff = Date.now() - 14 * 864e5;
  const picks = tracks.filter(t => ownMusic(t) && t.lastPlayed && t.lastPlayed < cutoff && t.id !== curTrack()?.id)
    .sort((a, b) => Number(!!b.liked) - Number(!!a.liked) || a.lastPlayed - b.lastPlayed).slice(0, 4);
  S.lists.rediscover = picks;
  return picks.length ? `<h2>Out of rotation<span class="section-note">Worth another listen</span></h2><div class="recent-grid" data-section="home-rediscover">${picks.map((t, i) => `<button class="recent-tile" data-track-id="${esc(t.id)}" data-act="play" data-list="rediscover" data-i="${i}">${art(t, 'art')}<span class="t">${esc(t.title)}</span></button>`).join('')}</div>` : '';
}
function renderReleaseHighlights(tracks) {
  const cutoff = Date.now() - 30 * 864e5;
  const releases = tracks.filter(t => ownMusic(t) && t.releaseDiscoveredAt > cutoff && t.releaseArtist)
    .sort((a, b) => b.releaseDiscoveredAt - a.releaseDiscoveredAt);
  const seen = new Set(), picks = releases.filter(t => { const key = t.catalogAlbumId || t.id; if (seen.has(key)) return false; seen.add(key); return true; }).slice(0, 4);
  return picks.length ? `<h2>Fresh from your artists</h2><div class="release-highlights" data-section="new-releases">${picks.map(t => `<button class="release-highlight" data-act="release-play" data-id="${esc(t.id)}">${art(t, 'art')}<span class="meta"><small>New from ${esc(t.releaseArtist)}</small><strong>${esc(t.album || t.title)}</strong><span>Play now ${icon('play')}</span></span></button>`).join('')}</div>` : '';
}
function playRelease(id) {
  const track = S.tracks.get(id); if (!track || !canBrowseTrack(track)) return;
  const tracks = visibleLibraryTracks().filter(t => t.id === id || (track.catalogAlbumId && t.catalogAlbumId === track.catalogAlbumId))
    .sort((a, b) => (parseInt(a.discNumber) || 1) - (parseInt(b.discNumber) || 1) || (parseInt(a.trackNumber) || 0) - (parseInt(b.trackNumber) || 0));
  playList(tracks, 0);
}
function mixDetailHTML(id) {
  const mix = HOME_MIXES[id], tracks = homeMixTracks(id);
  return `<section class="mix-intro mood-${mix.tone}"><small>Made from your library</small><p>${mix.description}</p><p class="small">${tracks.length} songs · Tempo matching uses estimates. Your picks always take priority.</p><button class="btn" data-act="mix-edit" data-id="${id}">${icon('plus')}Choose songs</button>${tracks.length ? `<button class="btn" data-act="save-mix" data-id="${id}">Save as playlist</button>` : ''}</section>`;
}
async function setTrackMood(track, id, included) {
  if (!track || !HOME_MIXES[id]) return;
  track.moodOverrides = { ...track.moodOverrides, [id]: included };
  await saveTrack(track);
}
function moodMenu(track) {
  sheet(trackTitleHtml(track), Object.entries(HOME_MIXES).map(([id, mix]) => ({ label: (matchesHomeMix(track, id) ? 'Remove from ' : 'Add to ') + mix.title,
    fn: async () => { const included = !matchesHomeMix(track, id); await setTrackMood(track, id, included); toast(included ? 'Added to ' + mix.title : 'Removed from ' + mix.title); } })));
}
let mixQuery = '';
function viewMixEditor(id) {
  if (!HOME_MIXES[id]) return '<h1>Mix unavailable</h1>';
  return `<button class="backbar" data-act="back">${icon('back')}${HOME_MIXES[id].title}</button><h1>Make it yours</h1><p class="small">Pick songs for ${HOME_MIXES[id].title}. You can change these anytime.</p><input class="field" id="mixQuery" type="search" placeholder="Find a song or artist" value="${esc(mixQuery)}"><div id="mixCandidates"></div>`;
}
function renderMixCandidates() {
  const host = $('#mixCandidates'), id = S.sub?.id; if (!host || !HOME_MIXES[id]) return;
  const query = searchText(mixQuery);
  const tracks = visibleLibraryTracks().filter(t => ownMusic(t) && searchText(t.title + ' ' + t.artist).includes(query)).slice(0, 60);
  patchContent(host, tracks.length ? `<p class="small">${homeMixTracks(id).length} in this mix${tracks.length === 60 ? ' · Search to find more songs' : ''}</p>${tracks.map(t => {
    const included = matchesHomeMix(t, id);
    return `<div class="mix-pick" data-track-id="${esc(t.id)}">${art(t, 'art')}<span class="meta"><strong>${esc(t.title)}</strong><small>${esc(t.artist)}</small></span><button class="icon ${included ? 'on' : ''}" data-act="mix-pick" data-id="${esc(t.id)}" data-mix="${id}" aria-label="${included ? 'Remove' : 'Add'} ${esc(t.title)}" aria-pressed="${included}">${icon(included ? 'check' : 'plus')}</button></div>`;
  }).join('')}` : '<p class="msg">No matching songs in your library.</p>');
}
async function saveHomeMix(id) {
  const tracks = homeMixTracks(id); if (!tracks.length) return;
  const playlist = { id: uid(), name: HOME_MIXES[id].title, ids: tracks.map(t => t.id), created: Date.now() };
  await DB.put('playlists', playlist); S.playlists.push(playlist); toast('Saved ' + playlist.name + ' as a playlist');
}
function mixForList(list) { return String(list || '').startsWith('mix:') ? list.slice(4) : null; }
function releaseWatchHTML() {
  const watch = store.get('releaseWatch', null);
  if (!watch?.enabled || !Array.isArray(watch.artists)) return '';
  const checked = watch.lastCheckedAt ? 'Last checked ' + new Date(watch.lastCheckedAt).toLocaleString() : 'Setting up the first release check';
  return `<div class="group"><div class="set-head">Following new releases</div><p class="small">${watch.artists.filter(n => typeof n === 'string').map(esc).join(', ')}</p><p class="small">${esc(checked)}. Your laptop checks every six hours while awake. Uploaded releases appear on Home.</p></div>`;
}
