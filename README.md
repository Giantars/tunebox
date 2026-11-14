# Tunebox

Personal music player PWA for iPhone. Plain HTML/CSS/JS, no build step.

- **Sources:** YouTube through its official video player, Google Drive and your own audio files. Search offers YouTube and Library only.
- **Offline:** your Drive songs are saved to the phone (IndexedDB) automatically; next play is local. The next song in the queue is pre-saved too. YouTube uses its online video player.
- **Stall recovery:** a stream stuck buffering for 12 s, or one that errors, is reconnected at the same position (2 tries), then skipped.
- Lock-screen controls (Media Session), queue, shuffle, repeat, likes, playlists, ID3 tag + cover reading for MP3s.

## Run locally
    python -m http.server 8765      # then open http://localhost:8765

## Put it on the iPhone
Service workers need HTTPS, so host the folder on GitHub Pages (or any static host), open the URL in **Safari**, tap Share, then **Add to Home Screen**.

After changing files, bump `VERSION` in `sw.js` so phones pick up the new version.

`make_icons.py` regenerates `icons/` (pure Python, no dependencies).

## Google Drive connection

The browser's public OAuth client ID is configured in `GOOGLE_CLIENT_ID` in
`app.js`; users only choose their Drive folder and connect their Google account.
An older pasted client ID is replaced on startup. Tokens belonging to that old
client are cleared, while music, playlists, folder settings, and tokens for the
configured client are preserved. No client secret is stored or required.

For a different deployment, configure its own Web application OAuth client and
register the exact origin and redirect address in Google Cloud.

## Appearance

Settings → Appearance switches between Zoro, Sophie, Meteor night, White forest
and the original dark appearance, and remembers the choice locally. Meteor night:
a static illustrated mountain sky, crescent moon and four staggered meteor trails.
Only the trails' transforms and opacity animate; there is no animation loop in
JavaScript or scroll-time image processing. Meteors pause when the app is hidden,
respect Reduce Motion, and can be disabled with Animate background in Settings.
New installs preview Meteor night; saved theme choices remain selected.

White forest uses a locally served photograph, light surfaces and muted pine
accents. Scene assets are included in the offline app shell. All tabs use the
same dock inset (Version 23).
Version 22 adds official, non-generated artwork: Zoro · Asura from Bandai Namco's
ONE PIECE Bounty Rush site (1220×1220), and Sophie · Stars from Studio Ghibli's
Howl's Moving Castle gallery (1920×1038). Zoro has violet sparks; Sophie has
occasional falling stars. The White forest image is replaced with a real winter
photograph from Unsplash (3840×2604). The previous generated forest asset is removed.
Measured image dimensions and source credits appear in Settings. Anime art is
not upscaled or labeled as 4K. `assets/anime-wallpapers-sources.json` records the
page and image URLs. WebP assets retain their source dimensions and work offline.
Only small particles animate; the characters remain still. Motion controls,
hidden-page pause and Reduce Motion apply. Saved theme choices remain selected.

Version 23 keeps the dock at one safe-area inset on all tabs. Menus and the full
player lock background scrolling and make underlying controls inert. Queue
updates preserve scroll position for the current song. Swipe-to-close starts
only on the player header or artwork, not its buttons or seek/queue controls.
`interactions.js` activates deliberate touch taps once, suppresses compatibility
clicks and leaves drag scrolling native. Dialogs support focus containment and
Escape dismissal.

Version 24 puts the page scroller, dock and dialogs inside one visual-viewport
frame. `viewport.js` follows Safari viewport resize/offset changes. All tabs use
the same 8 px dock inset and 4 px gap below the mini player. Player backgrounds
cover the full frame; bottom sheets are flush with its bottom edge, with safe-area
padding inside. Artwork fits the remaining player space without stretching.
Toolbar touches during scrolling activate on the initial press, including a
pointer-event fallback, and do not repeat on release. Resizing no longer changes
dock mode. Navigation replaces the old scroll surface so its deceleration cannot
move a newly opened page. Audius and Jamendo UI, search calls and home requests
are removed. Saved files, playlists and cached audio are preserved.

Version 25 adds:

- **Queue editing:** drag future songs by their handles, use the handle menu or
  arrow keys, and swipe left to reveal Remove (a full swipe removes directly).
  The current song stays protected. Manual edits persist with the Play next count
  and never restart playback. Now playing and the next song are labeled separately.
- **Albums and artists:** Library groups owned music by its metadata, supports
  compilation album artists, and orders tracks by disc/track tags when available.
  Unknown album names are grouped per artist. Back navigation returns to the
  previous collection. Cards keep a track reference so late metadata matches
  cannot break links. MP3 imports now retain album artist, disc and track tags.
- **Home:** Continue Listening, recent songs, albums containing favorites,
  playlists and a shorter recently-added section, with reduced header spacing
  once music exists in the library.
- **Offline playlists:** download eligible Drive songs, count local/saved files,
  and show real saved counts, pause/resume and retry controls. YouTube stays
  online. Jobs persist and resume on reopening or reconnection; transient network
  errors retry on reopening, while sign-in/storage issues remain visible.
  Shared songs download once. New playlist additions join an existing requested
  download. Manually removing a download pauses its playlist job; clearing all
  downloads stops playlist jobs. Current shared audio downloads finish safely
  when a playlist is paused.
- **Appearance previews:** theme selection opens a temporary live preview. Apply
  saves the theme, brightness and animation preference; Cancel restores saved
  settings. Brightness affects wallpaper layers only. Official artwork credits
  remain available. All new modules are cached for offline use.

Version 26 hides navigation, the mini-player and dock shading while the Search
keyboard is open. It follows visual viewport changes, restores the dock when the
keyboard is dismissed even if Search remains focused, and keeps desktop search
navigation visible when no software keyboard appears.

## Covers and song names

Automatic catalog lookup resumes for existing Drive songs as well as new imports.
It also resumes when the app returns to the foreground. Visible songs and the
currently selected song move ahead of the background queue. Temporary connection
errors retry automatically after a delay while the app is open and online.
Settings and the file library show progress, connection errors, and unmatched
songs. Use **Retry missing covers** to retry a past miss. Legacy lookup flags are
rechecked by the current matcher. Common filename extras such as track numbers
and official-video labels are removed from searches. Existing embedded tags and
covers are preserved; ambiguous artist/title matches are left unchanged.

iTunes requests are spaced at least 3.2 seconds apart, including fallback
searches. A queue containing several songs by one artist can fetch that artist's
catalog once, then reuse exact artist/title matches for the remaining tracks.
Common titles without an artist hint still need a full search to check ambiguity.
Verified saved matches seed this cache when the app reopens.

Large libraries need time with Tunebox open. Matched artwork appears immediately;
two separate workers save it for offline use without blocking the next lookup or
audio playback. Shared album artwork reuses a download. The temporary artwork
memory cache is limited to 4 MiB and 16 images. Optional offline saving may fail
when the artwork server does not permit it; the online cover can still display.
If iTunes has no usable match, a title plus an artist or featured-artist hint is
checked against [MusicBrainz](https://musicbrainz.org/). High-confidence, exact-title
recordings use front artwork from the [Cover Art Archive](https://coverartarchive.org/).
Featured-only filenames try this provider first, avoiding unrelated searches.
Featured artists can identify files that omit the main artist. Folder names are
treated as weaker hints in that case. Ambiguous or low-confidence results are not
applied. Successful matches keep their source URL in the track record. MusicBrainz
requests are spaced at least 1.1 seconds apart, and optional artwork caching has
a timeout. Files absent from both catalogs or without enough identifying
information may remain unmatched.

## Glass navigation

The bottom dock uses one live CSS backdrop with a light blur. `glass.js` adds a
touch highlight and direct horizontal tab scrubbing. Pointer gestures activate
once on release when idle, tolerate small finger movements, and cancel when
released outside the dock. During scrolling, touch presses activate immediately.
Keyboard and assistive-technology clicks use the standard button.
Touch controls cancel native momentum scrolling and handle release directly,
including when the browser suppresses its normal click. This applies to the
compact player and side buttons as well as the full tab bar. The tab lens
stretches with finger velocity and settles on release; folding contracts the bar
toward the compact controls. All animation is disabled with reduced motion.
While a track is selected, scrolling down folds the player and navigation into
one row, with an expand-navigation button and Search on either side. Scrolling
up or pressing the expand button restores the tabs. The same player and playback
controls are reused. Hidden navigation controls are inert and excluded from the
accessibility tree. A passive scroll handler reads scroll position and changes
dock state at direction thresholds; it performs no layout reads or artwork draws.
This approximates a glass finish; it does not implement Apple's native Liquid
Glass refraction. Reduced transparency uses an opaque dock; reduced motion
removes transitions. Keep `glass.js` in the service worker shell list and update
all asset version parameters with each release.

The full-screen player crossfades blurred copies of the current cover behind its
controls. It uses the actual artwork, including asynchronously loaded offline
covers, with a dark overlay for text contrast. Missing or failed artwork uses a
neutral background. This requires no cross-origin canvas reads. Reduced motion
removes the crossfade; reduced transparency keeps the neutral background.
