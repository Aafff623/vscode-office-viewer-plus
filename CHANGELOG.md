# Changelog


## 1.2.0 (2026-09-16)
### Added
- Word: automatic pagination — chapters without explicit page breaks are split into real page-sized pages (matching the page box, repeating page headers/footers), instead of one continuous white sheet
- Word: outline navigation panel — heading levels come from the document's real styles (works for any language), click a heading to jump, the current section stays highlighted while scrolling
- Word: in-document search — `Ctrl+F` opens a search bar with a match counter and `Enter` / `Shift+Enter` navigation; matches are highlighted without touching the document DOM
- Word: comments and tracked changes are now shown (highlighted ranges with hover popovers)
- Excel: click a column header to sort (ascending/descending, numbers compared numerically, mixed text via natural collation); the header row stays frozen while scrolling
- Excel: legacy `.xls` workbooks (Excel 97-2003, BIFF8) open in the same preview with tabs, sorting and the frozen header
- PowerPoint: EMF/WMF vector images embedded in slides are now rasterized and displayed instead of breaking

### Changed
- Word/PDF: the outline and thumbnail toggles are redesigned as slim fold handles stuck to the screen edges (bright blue, half-rounded grips with a direction chevron); both panels always start folded — nothing pops open on its own, opening either one is the user's call
- PDF engine upgraded to pdf.js 6.2.108 with on-demand assets: WASM decoders for scanned-document images (JBIG2/JPX), CJK CMap tables and standard font data — documents that previously showed missing text or images now render
- Word rendering engine upgraded to docx-preview 0.3.7
- Page thumbnails render at the display's pixel density (up to 2x) — sharp on HiDPI screens instead of blurry upscales

### Fixed
- Word: the outline panel and thumbnail pane now reserve layout space, so the page is re-fitted between them instead of sliding underneath; resizing the editor re-fits (or restores to 100%) the same way, and a zoom you set yourself is never overridden
- Word: a thumbnail page that fails to rasterize is retried instead of staying a placeholder forever; thumbnail captures no longer clone the whole document per page

## 1.1.0 (2026-09-16)
### Added
- Canvas interactions for all previews: Space + drag / middle-button pan, Ctrl/Cmd + wheel zoom (30%–350%) with a HUD badge, and `Ctrl+0` reset
- Double-click zoom toggle (jump to 150%, double-click again to restore) for Word, Excel, PowerPoint and PDF previews
- Word TOC rendering: real tab stops now resolve via docx-preview's experimental mode, restoring dot leaders and right-aligned page numbers; a flexbox dot-leader fallback covers lines the library cannot resolve
- Markdown: relative image paths resolve from the file directory; relative links open the target file via the editor
- Page thumbnails pane (document minimap) for PDF and Word previews: per-page cards in a collapsible left sidebar showing the real page content scaled down (rasterized live for Word via html2canvas-pro), click-to-jump navigation, current-page highlighting, and a remembered open/closed state; opening it re-fits the document to the remaining width

### Changed
- Word thumbnails rasterize lazily — only cards scrolled into view are rendered (one at a time, with a hang timeout), so large documents no longer rasterize every page up front
- Word thumbnail captures clone only the target page instead of the whole document (O(page) instead of O(document) per thumbnail), with identical output
- A failed or timed-out thumbnail rasterization is retried (up to 3 attempts) instead of leaving a permanent placeholder; the page currently in view is rasterized first
- The thumbnails pane no longer rasterizes pages in the background while it is collapsed
- Double-click zoom ignores double-clicks on interactive elements (links, buttons, sheet tabs, thumbnail cards)
- Closing the thumbnails pane no longer resets a zoom level the user set manually
- PDF initial scale now adapts to the editor width (clamped to 0.4×–1.4×) instead of a fixed 1.5×
- English UI strings replace the leftover Japanese ones
- Markdown: mermaid blocks inside indented lists and `~~~` fences now render as diagrams; rendered HTML is sanitized with DOMPurify
- Minimum VS Code version raised to 1.128.0 (extension API typings kept current)

### Fixed
- Relative links in previews can no longer escape the document's folder (`..` traversal) and now open inside the editor instead of via the OS default handler
- Release workflow: Marketplace/Open VSX publish steps now respect configured PATs, and CI runs typecheck + tests before packaging
- CSV/TSV: UTF-16 files (with BOM) decode correctly; files that fall back to Shift_JIS decoding now show a warning banner
- Excel: sheets render lazily on tab activation so large workbooks no longer freeze the preview; SheetJS updated to 0.20.3 (fixes CVE-2023-30533, CVE-2024-22363)
- Marp: the preview keeps its own zoom/keyboard handling (no more double zoom from Ctrl+wheel); holding Space no longer skips through slides; global listeners are cleaned up on re-render
- Panning now keeps working when the cursor leaves the webview, and drags no longer swallow the next click
- HTML preview sandbox tightened to match the actual (static) behavior: page scripts stay disabled by CSP, no same-origin access

## 0.5.0 (2026-08-31)

### Added
- TSV (`.tsv`) table preview with UTF-8 and Shift_JIS decoding

## 0.4.6 (2026-08-24)

### Fixed
- Resolve relative Marp image paths from the Markdown file directory
- Rewrite relative `url(...)` references in generated and inline CSS for background images
- Add the document directory to the webview local resource roots
- Allow HTTPS images in the webview content security policy


## 0.4.5 (2026-08-24)

### Changed
- Make the Marp navigation controls a compact, content-width floating toolbar
- Reduce control height, padding, gaps, and label widths
- Render **Fit** mode at 90% of the available area for comfortable margins around the slide
- Keep **Width** mode available for users who want the slide to fill the editor width


## 0.4.4 (2026-08-24)

### Added
- Marp preview zoom controls from 25% to 300%
- **Fit** mode to keep the entire slide visible in the available viewport
- **Width** mode to fill the editor width with vertical scrolling when needed
- Keyboard shortcuts: `+` / `-` to zoom, `0` to fit, and `W` to fit width
- Ctrl/Cmd + mouse wheel zoom
- Automatic rescaling when the editor panel size changes


## 0.4.3 (2026-08-23)

### Fixed
- Preserve Marp Core's required `div.marpit > svg > foreignObject > section` DOM hierarchy so built-in and inline theme CSS applies correctly
- Scale the active SVG to the available viewport while preserving its 16:9 `viewBox`
- Keep the required `div.marpit` wrapper in overview mode as well
- Make the Marp preview use the full webview area below the navigation bar

## 0.4.0 (2026-08-22)

### Added
- **Marp slides preview**: Files with `.marp.md` extension are automatically rendered as slide presentations using [@marp-team/marp-core](https://github.com/marp-team/marp-core)
  - Slide-by-slide navigation with keyboard (← → Space) and buttons
  - All-slides overview mode
  - Dark/light theme follows VS Code
  - HTML rendering enabled for rich content
- Marp detection in regular `.md` files: shows a notice with instructions to switch to Marp preview
- New `officeViewer.marp` custom editor view type

### Changed
- Updated description and keywords to include Marp/slides/presentation

## 0.3.2

- Previous release (docx, xlsx, csv, pdf, pptx, mermaid, html, markdown support)
