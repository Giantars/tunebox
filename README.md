# Tunebox

Personal music player PWA for iPhone. Plain HTML/CSS/JS, no build step.

- **Sources:** Audius (free API, no key), Jamendo (free Client ID from devportal.jamendo.com, entered in Settings), your own audio files.
- **Offline:** every song you play is saved to the phone (IndexedDB) automatically; next play is local. The next song in the queue is pre-saved too.
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

## Glass navigation

The bottom dock uses one live CSS backdrop with a light blur. `glass.js` adds a
touch highlight and direct horizontal tab scrubbing. Pointer gestures activate
once on release, tolerate small finger movements, and cancel when released outside
the dock. Keyboard and assistive-technology clicks use the standard button.
There is no canvas snapshot, texture upload, or JavaScript
scroll handler: content stays in the browser's compositor during scrolling.
This approximates a glass finish; it does not implement Apple's native Liquid
Glass refraction. Reduced transparency uses an opaque dock; reduced motion
removes transitions. Keep `glass.js` in the service worker shell list and update
all asset version parameters with each release.
