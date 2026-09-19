# Zoom-anchor harness

Browser harness for the zoom-anchoring work in `src/webview/interactive.ts`
(double-click zoom at the pointer, Ctrl+wheel zoom at the middle of the pane,
the second double-click restoring the previous view). It loads the **real
webview bundles and the real `media/viewer.css`** in a plain browser and
measures, per scenario, where the content under the pointer actually ended up.

Related: issue #1, `docs/adr/ADR-0002-zoom-anchoring.md`, `CONTEXT.md`.

## Run it

```bash
npm run compile            # dist/webview-*.js must be current
node tests/harness/serve.mjs   # serves the repo root on http://127.0.0.1:8143
```

Then open (Chromium/Edge — the layout relies on CSS `zoom`):

```
http://127.0.0.1:8143/tests/harness/anchor-repro.html?fmt=docx
http://127.0.0.1:8143/tests/harness/anchor-repro.html?fmt=xlsx
http://127.0.0.1:8143/tests/harness/anchor-repro.html?fmt=pptx
http://127.0.0.1:8143/tests/harness/anchor-repro.html?fmt=pdf
http://127.0.0.1:8143/tests/harness/anchor-timeline.html   # deep-scroll timeline
```

The page drives itself: it renders the sample through the real message
protocol, runs the scenarios, and reports when done in `document.title`
(`anchor-repro:done`). Read the results from the page console:

```js
window.__ANCHOR           // { legs: [...], beacons: [...] }
window.__ANCHOR.legs.map(l => l.name)                       // which legs ran
window.__ANCHOR.legs.map(l => [l.name, l.beacon && l.beacon.residual])  // anchoring
window.__ANCHOR.legs.map(l => [l.name, l.underDelta && l.underDelta.px]) // drift
window.__ANCHOR.legs.map(l => [l.name, l.regionRestore && l.regionRestore.stateEqual])
```

Or in one shot, from the page console after the title says `done`:

```js
copy(JSON.stringify({legs: __ANCHOR.legs.map(l => ({n: l.name, r: l.beacon && l.beacon.residual,
  s: l.beacon && l.beacon.shift, px: l.underDelta && l.underDelta.px,
  region: l.regionRestore && [l.regionRestore.stateEqual, l.regionRestore.probeBackAtOrigin]})), 
  errs: __ANCHOR.errs}, null, 1))
```

## Samples

`docx` and `xlsx` have bundled **synthetic** samples in `samples/`. For
`pptx`/`pdf` — and to test with realistic content — put your own file in
`samples/anchor-sample.<ext>` or pass a path relative to the repo root:

```
...?fmt=pdf&sample=tests/harness/samples/anchor-sample.pdf
...?fmt=docx&sample=/path/inside/repo/big-document.docx
```

Prefer a **long, multi-page** document (so there is scroll range in both
directions) and, for xlsx, a sheet with more rows/columns than fit the pane.

## What the scenarios mean

| Leg | What it exercises |
| --- | --- |
| `S1-plain` | double-click, then double-click again at the same point (the normal flow) |
| `S2-moved-cursor` | the second double-click lands somewhere else — the restore must still return to the original region |
| `S3/S4-fitted-*` | same, starting from the pane-fitted zoom (a real resize triggers the fit) |
| `S5-sticky-header` | the probe point sits in a sticky table header (does not follow the scroll) |
| `S6-wide-zoom` | start well above 150% (ctrl+wheel) so the double-click zooms **out** |
| `S7-edge-clamp` | every scroller already at its end — the pan must clamp, not overshoot |
| `S8-clamped-corner` | zoomed in with every scroller at its origin, then a double-click at the top-left corner |
| `S9-wheel-*` | ctrl+wheel zoom in/out from 100% and from the fitted zoom — the point at the middle of the pane must stay there |
| `S10-right-click` | double-click on the **right side** of centered content — the case that used to drift ~155px toward the middle |

## How to read a result

- `leg.beacon` is the app's own `[ovp:dblclick]` beacon: `pan` (the analytic
  delta), `probe` (`caret`/`box`/null), `residual` (the measured error in px
  **after** correction — this is the number that matters), `shift` (the content
  offset used when the scroll could not express the correction).
- `leg.underDelta` is a **model-independent** check: whether the content under
  the pointer is still the same character (caret probe: `sameNode`,
  `offsetDelta`) or the same element with the same fractional position (box
  probe: `sameEl`, `fractionDelta`), plus the pixel drift `px`. A point `d` px
  away from the pointer legitimately moves `d·(newZoom/oldZoom - 1)`, so judge
  the *same character* + a small `offsetDelta`, not `px` alone.
- `leg.regionRestore.stateEqual` must be `true` (zoom, window scroll and every
  chain scroller identical to before the zoom-in) and
  `probeBackAtOrigin` should be `[0, 0]`.

## Current results (2026-09-18, build `5d88c4d3`)

Residual ≤0.6px (xlsx) / ≤0.8px (docx) / ≤0.3px (pdf) across all zoom-in legs,
`sameNode`/`sameEl` true, wheel-centre drift ≤3.6px, and every restore exact —
**while the same build still misbehaves on a real machine** (issue #1). The
open question is therefore what the real webview does differently; the harness
is the tool for testing a hypothesis, the beacons are the evidence channel.

## Notes

- The harness dispatches synthetic events (`MouseEvent`, `WheelEvent`,
  `KeyboardEvent`) — that is enough to drive this code, but it does not
  reproduce real pointer timing or touchpad pinch streams.
- `docs/probe`-style experiments from earlier rounds live in git history; the
  pages here are the current ones.

## For the REAL preview (issue #1): `webview-probe.js`

Real VS Code testing is the gate; this harness is the fast regression tool. To
measure inside the actual preview, paste `tests/harness/webview-probe.js` into
the **webview's** DevTools console (Command Palette -> `Developer: Open Webview
Developer Tools`), then double-click and Ctrl+wheel as usual. It is passive and
prints, per gesture, how far the content point that was under the pointer ended
from where the anchor says it must be (`error` ~ 0 = anchored), labelled
`dblclick` / `dblclick-restore` / `wheel` (on a restore leg the pointer's
content point is expected to change — judge the returned view, not that number).
Call `__ovpProbe.report()` for a table plus a JSON block on the clipboard; it
also captures the app's own `[ovp:...]` beacons, so the zoom-in legs can be
cross-checked against `residual` (they matched to 0.1px when this was written).
