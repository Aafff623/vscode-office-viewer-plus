# ADR-0002: Zoom anchoring — where the view lands, and what may move it

Status: accepted (2026-09-18)

## Context

CSS `zoom` on `#container` scales the content out of the container's top-left
corner, so every zoom operation has to put the view back where the user
expects. Users reported two things across several rounds of fixes: Ctrl+wheel
zoomed from the top-left ("it concentrates on the left half" instead of the
middle), and double-click near the left or right edge of a page drifted the
view toward the middle regardless of where the click landed ("always biased
left"). The first harness-verified implementation scrolled the chain by the
analytic gap — correct for the page as a whole (Word/PDF/PPTX after the pptx
fix scroll on the window, Excel on its own sheet scroller) — but it could not
express two classes of movement, and the failures were only visible once the
harness reproduced the real geometry:

- **Units.** A scroller inside a CSS-zoomed subtree reports its scroll offsets
  and ranges in that subtree's local px while rendering them scaled, so a
  visual-px delta written there overshoots by the zoom factor (measured:
  parent `zoom: 2`, `scrollTop = 50`, content moves 100 visual px). Excel's
  `.xlsx-sheet` is exactly this case; the anchor missed by ~114px.
- **Range.** A page that fits the pane is centered inside a container that
  keeps the viewport's width, so as the zoom grows its local width shrinks and
  the centering margins re-balance: the content's rendered position is
  `(V - W·z)/2`, which no scroll can express when the document has no
  horizontal overflow. Clicking the right half then lands ~155px off, always
  toward the middle.

## Decisions

1. **Ctrl/Cmd + wheel anchors at the middle of the pane; double-click anchors
   at the pointer.** Both go through one `anchorZoom(newZoom, x, y, target):
   analytic pan over the scroll chain, then measurement, then correction.
2. **The compensation is verified, not assumed.** A probe (a text caret, or a
   fractional point inside an element when there is no text, e.g. a PDF
   canvas) is captured before the zoom; afterwards the probe's on-screen
   position is compared against where the pointer anchor says it must be
   (`pointer + (probe - pointer) · ratio` — a point `d` px away moves `d·ratio`,
   it does not stay put) and the difference is corrected. The beacon logs the
   final residual, so the console carries the verdict on any machine.
3. **Corrections scroll first, then move the content.** Scrolling is the
   normal mechanism and stays the only one for the drag/pan path. What a
   scroller cannot take — pinned content, exhausted range, or the re-centering
   above — is carried by a content offset (`shiftLocalX/Y`), applied as a
   *margin* on `#container` in local px, composed with the pane margin from the
   stylesheet. A transform or a relative offset was measured to inflate the
   document's scrollable area by the offset itself (+149px), after which the
   next scroll clamped the window back and silently ate the offset; a block
   with `width: auto` keeps its right edge at the body's edge, so a margin adds
   no scroll range at all. How far the content moves per local px of margin
   depends on the content (half for a centered page, all of it for flush-left
   content), so the response is measured with a 12px test margin before the
   exact value is applied; at most two calibrated passes per axis, capped.
4. **The second double-click restores a view, not a zoom level.**
   `ViewSnapshot` captures zoom, window and chain scroll offsets, and the
   content offset; the restore applies the content offset first (it is the
   layout change), then the scrolls, each read back once and rewritten if it
   did not stick — a layout pass landing in the same frame can otherwise let
   the browser's scroll anchoring adjust a scroller right after the write
   (measured: a restore that landed 300px away).
5. **Ctrl+0 and the pane fit reset the content offset**, so the natural,
   stylesheet-defined layout always has a way back.

## Consequences

- Anchoring is exact in the harness for every format and start state measured
  (≤0.6px at 1–1.5×, ≤0.3px including a 2.5×→1.5× zoom-out, both edges, a
  scrolled sheet, a sticky header, and deep scroll positions), and the
  self-measuring probe means a machine that behaves differently reports its own
  residual instead of silently misbehaving. On-machine reports of remaining
  drift are tracked in the issue tracker; the beacon fields (`pan`, `probe`,
  `residual`, `shift`, and `[ovp:wheel] anchor` when a wheel tick cannot be
  honoured) are the evidence to ask for.
- The content offset is view state: anything that re-lays out the view (the
  pane fit, `Ctrl+0`) clears it, and a re-render of the container keeps the
  current offset until then.
- Known limits, unchanged and documented in the CHANGELOG: an axis with no
  scroll range clamps, and zooming out at the very top of a document cannot
  move content down beyond what the layout allows — same as native browser
  zoom.

## Addendum (2026-09-19): why the browser harness was exact while the real webview was not

The anchoring work above was measured in a plain Chromium harness and still
misbehaved in VS Code. The missing fact, found on-machine during the
investigation tracked in issue #1 and adopted here (commit `37b1578`):

- VS Code disables Blink's `StandardizedBrowserZoom`. In its webview,
  `getBoundingClientRect()` and Range client rects are divided by the
  element's effective CSS zoom, while pointer coordinates and window scrolling
  remain viewport CSS pixels. Every rect-based term in the anchoring math —
  the container origin, the probe position, the box probe — was therefore
  scaled by 1/zoom, which produced a constant large error (~300-420px) that no
  amount of scroll-range reasoning could explain. `clientRectScale()` detects
  the behavior with a marker element and `screenRect()` normalizes to viewport
  pixels; a host with the standardized behavior is left alone.
- The harness now reproduces this: `?legacyZoom=1` installs a legacy-rectangle
  shim before the bundles load, so the real semantics can be tested in a plain
  browser (with validity metadata, since a shim that cannot reproduce the
  behavior must not be trusted).
- Related and only visible on-machine: `MouseEvent` coordinates are truncated
  while `PointerEvent` keeps the physical pointer's fractional CSS px, so the
  anchor now reuses a trusted mouse release; and an anchored cell hidden under
  a sticky header row is exposed by transferring only the scroll this zoom
  added to the outer scrollers.
- What this teaches about verification: a harness that runs the real bundles
  still has to run them under the *host's* platform semantics. "Works in the
  harness" only covers the semantics the harness reproduces.

## Alternatives considered

- **`transform: translate` / `position: relative` offsets** — rejected after
  measurement: both extend the document's scrollable width, and the resulting
  clamp cancels the offset (see Decision 3).
- **Pinning the container's local width and re-centering it manually** —
  rejected: it trades the re-centering asymmetry for a fit-time one (a fitted
  zoom below 1 would leave the content hugging the left edge), and it fights
  the stylesheet's pane margins.
- **Anchoring the wheel at the pointer** (browser-style) — user preference was
  the middle of the pane; the shared `anchorZoom` keeps the two policies one
  parameter apart.
