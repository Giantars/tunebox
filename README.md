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

## Glass navigation

`glass.js` adds a custom WebGL lens to the bottom dock, using Apple's
[Liquid Glass demo](https://developer.apple.com/videos/play/wwdc2025/219/) as a visual reference.
It approximates edge refraction from visible artwork and selected labels; CSS
supplies the rest of the live backdrop. This is not Apple's native material or
a full DOM compositor. Remote artwork requires CORS approval for the optical
texture; other artwork remains visible through the CSS backdrop.

The renderer draws on scroll, layout changes, and touch, then stops while idle.
WebGL failure uses the CSS dock. Reduced motion disables touch animation;
reduced transparency uses an opaque dock. Keep `glass.js` in the service worker's
shell list and update all asset version parameters with each release.
