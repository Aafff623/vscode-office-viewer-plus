# ADR-0001: Rendering stack, thumbnail pipeline, and dependency posture

Status: accepted (2026-09-15)

## Context

This extension is a read-only previewer assembled from mature web libraries.
During the v1.0.0 rework we had to decide how previews render, how the page
thumbnail pane gets real content for Word documents, and which dependency
channels to trust.

## Decisions

1. **JS-library assembly, not a custom engine.** docx-preview, SheetJS,
   pdf.js, pptx-preview, marp-core, mermaid — each behind its own webview
   bundle. We do not adopt the WASM/Canvas custom-engine route (silurus) nor
   a LibreOffice conversion backend; both were benchmarked in
   `temp/refs/DEEP_ANALYSIS.md` and rejected for maintenance cost and
   environment fragility (remote/web/Cursor).
2. **DOCX thumbnails rasterize the live DOM (html2canvas-pro).** No
   competitor does this — they render from a document model. html2canvas is
   the only way to get true page bitmaps without a second rendering engine.
   Cost controls, all verified by pixel-measurement: lazy (viewport-driven)
   generation, serial queue with 10s timeout, ≤3 attempts per page with
   automatic rescans, current page first, and an `onclone` pass deleting
   sibling pages (safe because html2canvas measures crop bounds on the
   *cloned* element — `renderElement` → `parseBounds(context, clonedElement)`),
   which makes each capture O(page) instead of O(document).
   Consequence: `domRaster.ts` must clear the inline `width/height`
   html2canvas writes onto its canvas, or cards render at source size and
   destroy the pane layout.
3. **PDF thumbnails reuse the main canvases** (downsampling) as long as PDF
   rendering stays "all pages up front". When PDF moves to lazy rendering
   (pdf.js 6 upgrade), thumbnails must switch to an independent low-res
   render per page (template: vscode-pdf-next `main.mjs` thumbnail system,
   incl. an LRU cap and job cancellation).
4. **Dependencies:** SheetJS comes from the official CDN tarball (0.20.3,
   fixes CVE-2023-30533 / CVE-2024-22363) — the npm `xlsx` package is
   frozen at the vulnerable 0.18.5. `engines.vscode` stays `^1.128.0`
   (Cursor compatibility) even when reference projects require newer
   engines.
5. **Read-only contract:** previews never write files; relative links are
   opened inside the editor after a path-containment check (no `..`
   traversal, no OS handler).

## Consequences

- Adding a format means one renderer module + one `entry-*.ts` + provider
  routing; no shared runtime cost across formats.
- The thumbnail pipeline is DOCX-specific (`domRaster.ts` is only imported
  by the docx entry, keeping html2canvas out of the other nine bundles).
- The pdf.js major upgrade (planned P0) carries a mandatory thumbnail
  refactor with it; see `temp/refs/analysis/thumbnail-pane-unified.md`.
