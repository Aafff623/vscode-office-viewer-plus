# CONTEXT

Verified facts, constraints, and vocabulary for working on this extension.
Everything here was confirmed against the code or by running it — update it
when reality changes; do not add unverified claims.

## Product positioning

- Read-only preview only. Files are never modified, and the extension must
  not steal default editors from VS Code's built-in ones (binary formats get
  custom editors; `csv`/`html`/`md` opt in via *Reopen Editor With*).
- Enhancement line over upstream [takashi-uchida/vscode-office-viewer](https://github.com/takashi-uchida/vscode-office-viewer) (MIT): canvas gestures, smooth zoom, page thumbnails, localized UI.

## Hard constraints

- `engines.vscode` must stay `^1.128.0`: the maintainer's Cursor build
  (3.19.x, internal baseline 1.128) has to load the extension. Verified by
  installing the VSIX into both editors.
- Tests must run as `node --test tests/*.test.mjs` — this Node build rejects
  a directory argument with a misleading "Cannot find module" error.
- Webview CSP is strict (`default-src 'none'` + nonce + controlled sources,
  see `officeViewerProvider.ts`). Anything that needs `frame-src`, `blob:`,
  or `data:` must fit those entries.
- `temp/` and `.codegraph/` are local-only (git-ignored): research clones,
  harnesses, reports, and secrets live there and never ship in the VSIX.

## Architecture (verified)

- Three layers: `officeViewerProvider` (reads bytes → base64 → postMessage,
  one provider class registered under 10 view types) → `bootstrap.ts`
  (handshake + decode + `MountOptions.afterRender` hook) → per-format
  entries (`entry-*.ts` → `dist/webview-*.js`, one bundle per format so e.g.
  CSV never loads marp-core).
- `interactive.ts` adds the gesture layer (Space/middle pan, Ctrl+wheel
  30–350% via CSS `zoom` on `#container`, Ctrl+0, double-click 150%
  anchored at the cursor). Marp manages its own zoom/keyboard and is exempt.
- Double-click zoom anchoring: CSS `zoom` scales content out of the
  container's top-left, so after a zoom change the cursor-to-origin gap
  must be scrolled back: read `#container`'s `getBoundingClientRect()`
  BEFORE `setZoom`, then scroll by `(clientX - rect.left) * (new/old - 1)`
  (`computeZoomAnchorPan`, distributed over the scroll chain). When the
  content has no overflow in an axis the scroll clamps and the pointer
  drifts there — same as native browser zoom, not a bug. Ctrl+wheel stays
  top-left anchored by design.
- Thumbnails (`thumbs.ts` + `domRaster.ts`): left pane with one card per
  page. PDF cards downsample the already-rendered canvases; DOCX cards are
  rasterized from the live DOM by html2canvas-pro — lazily, serially, with
  a 10s timeout, ≤3 attempts per page, current page first, and an
  `onclone` pass that deletes sibling pages so each capture is O(page).
  html2canvas-pro sets an inline `width/height` (source element size) on
  the returned canvas; `domRaster.ts` must clear it or the cards blow up
  the pane layout (found by pixel-measuring the rendered cards).
- pdf.js worker: module workers cannot load cross-origin in the webview, so
  the worker source is fetched and re-served from a same-origin `blob:` URL
  (`pdf.ts`, `window.__PDF_WORKER_SRC__`).

## Verification workflow (verified)

- `npm run typecheck` → `node --test tests/*.test.mjs` → `npm run compile`
  → `npm run package`; install the VSIX into both editors and diff the
  installed `dist/webview-docx.js` hash against the local build to prove
  which build is live.
- Browser-level DOM verification: `temp/docx-harness/harness.html` (stubs
  `acquireVsCodeApi`, fetches `sample.docx`, dispatches the render message)
  served from the repo root (`python -m http.server`), then pixel-stat the
  thumbnail canvases via evaluate. Resource URLs carry `?v=` — bump it
  after every rebuild (http-server caches for 1h).
- Embedded-browser quirk: when the host pane is backgrounded, rAF stops,
  IntersectionObserver never fires, window scrolling freezes, and scroll
  events are not dispatched — timers still run. Frame-driven logic must use
  timers; synthetic events drive scans in tests.

## Known accepted trade-offs (do not "fix" silently)

- Whole-file base64 transfer (~4–5× peak memory for big files) — changing
  it costs hidden-tab restore speed.
- PDF pages render fully up front at the initial fit resolution; zooming
  past that is blurry until the pdf.js 6 + lazy-render upgrade.
- CSS `zoom` is a geometric transform: PDF canvases do not re-rasterize.

## Roadmap input

`temp/refs/` holds 13 shallow-cloned competitor repos and
`temp/refs/DEEP_ANALYSIS.md` (gap table + P0–P2 plan). Biggest known gaps:
pdf.js 4.4 → 6.x (template: vscode-pdf-next), docx-preview 0.3.3 → 0.3.7,
Excel interaction layer. Decisions pending with the maintainer before
starting: VSIX size (+5.2MB for pdf.js 6), vendoring aurochs legacy-format
parsers, LM/Agent bridge timing.
