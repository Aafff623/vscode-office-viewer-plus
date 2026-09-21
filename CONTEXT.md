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
- Zoom anchoring (`anchorZoom`) is shared by double-click (at the pointer)
  and Ctrl+wheel (at the middle of the pane): `computeZoomAnchorPan` scales
  the cursor-to-origin gap by `new/old - 1` and `planPan` distributes it over
  the scroll chain, converting viewport px into each scroller's own units
  (`scaleOf` = product of the CSS zooms on it and its ancestors — a scroller
  inside a zoomed subtree reports its offsets and ranges in local px). A probe
  (`probeAnchor`: a caret, or a fractional point in a box when there is no
  text) then measures the real result and corrects what is left; the residual
  it reports is the beacon's own verdict.
- Content offset (`shiftLocalX/Y`, applied as a margin on `#container`): a
  scroll can only move what has scroll range, but a page that fits the pane
  re-centers as the zoom changes (its margins are laid out against a container
  that keeps the viewport's width), so a click near an edge would otherwise
  drift toward the middle. A margin moves the content instead, and because a
  block with auto width keeps its right edge at the body's edge it adds no
  horizontal scroll range of its own (a transform or relative offset does:
  measured +149px of document width, which then let the next scroll clamp the
  window back and eat the offset). How far the content moves per local px of
  margin depends on the content (half for a centered page, all of it for
  flush-left content), so the response is measured before the exact margin is
  applied. Reset by Ctrl+0 and by `refitForOverlays`.
- **VS Code's CSS-zoom coordinates are non-standard** (found on-machine while
  fixing issue #1): VS Code disables Blink's `StandardizedBrowserZoom`, so
  `getBoundingClientRect()` and Range client rects are *divided by the
  element's effective CSS zoom* while pointer coordinates and window scrolling
  stay viewport CSS pixels. Everything rect-based is therefore off by a zoom
  factor in the real webview — invisible to a plain Chromium harness, which
  enabled the standard behavior. `clientRectScale()`/`screenRect()` detect the
  actual behavior once with a marker element (`rectsIncludeZoom`) and normalize
  caret, box-probe and container rects to viewport px; the detection also
  covers a future VS Code that enables the standardized behavior. The harness
  can reproduce the real semantics with `?legacyZoom=1`, which installs a
  legacy-rectangle shim before the bundle loads and reports
  `anchor-repro:invalid-geometry` when it cannot (`tests/harness/README.md`).
- In the same circumstances Blink truncates `MouseEvent` coordinates (integer
  CSS px) while `PointerEvent` keeps the physical pointer's fractional
  position, so a double-click anchored on `dblclick.clientX/Y` is off by up to
  half a pixel at non-integer window zoom. A trusted, primary, left-button
  mouse release is reused as the anchor (guards: same target, same button,
  elapsed <= 100ms, `floor(clientX)` equality, same physical point; cleared on
  pointerdown/keydown/blur), while synthetic and non-mouse input keeps its own
  coordinates.
- The second double-click is a view restore, not an anchored zoom-out:
  `ViewSnapshot` captures zoom, window/chain scroll offsets and the content
  offset before the zoom-in, and `restoreViewSnapshot` puts them back —
  content offset first (it is the layout change), then the scrolls, each
  verified once by read-back because a layout pass landing in the same frame
  can let the browser's scroll anchoring adjust a scroller right after the
  write.
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

## Publishing (verified 2026-09-21)

- 1.2.0 went live on the VS Code Marketplace by uploading the packaged VSIX
  through the publisher's manage page — that path needs no PAT. Open VSX is
  still unpublished.
- `release.yml` gates both publish steps on secrets: with `VSCE_PAT` /
  `OVSX_PAT` empty they are skipped silently while typecheck, tests and
  packaging still run. Adding the secrets, then `gh workflow run Release`,
  publishes from CI (the steps are not conditioned on the event type).
- The `release: published` event did **not** start a run for a release created
  with `gh release create` (verified: Actions enabled, workflow active, no
  `event=release` run appeared). Use `gh workflow run Release` instead — but
  the "Upload to GitHub Release" step is conditioned on
  `github.event_name == 'release'`, so a dispatch run skips it and the VSIX
  must be attached with `gh release upload v1.2.0 <file>.vsix`.
- `vsce package` rewrites the README's relative image paths to absolute
  `https://github.com/<repo>/raw/HEAD/docs/images/...` URLs (verified in the
  packaged `extension/readme.md`), so keeping `docs/**` out of the VSIX costs
  the Marketplace listing nothing and saves ~5 MB.
- Packaged VSIX: 210 files, 5.72 MB.
