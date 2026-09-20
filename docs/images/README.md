# README image assets

Files referenced by the root README (`docs/images/…`). Drop each file here with
the exact name below; nothing else in this folder ships in the VSIX
(`.vscodeignore` only packs `dist/`, `media/`, `icon.png` — verify before publishing).

| File | Source | Spec |
|------|--------|------|
| `banner.png` | AI-generated (GPT) — chosen variant carries the title text (spelling verified) | 1983×793 PNG (2.5:1), dark bg `#161820`, 1.72 MB |
| `shot-word.png` | **Captured** — `.docx` with search bar (match counter) and dot-leader TOC | 1547×1426 PNG, 465 KB |
| `shot-excel.png` | **Captured** — sample workbook (generated via the project's SheetJS), sheet tabs + sortable table | 1550×1176 PNG, 625 KB |
| `shot-pdf.png` | **Captured** — `.pdf` with the page thumbnails pane open | 1537×1384 PNG, 607 KB |
| `shot-pptx.png` | **Captured** — `.pptx` deck, slides flowing down the page | 1529×1423 PNG, 1.29 MB |

Rules (from the beautify-github-readme spec):

- **Banner** is the only AI-generated image — decorative identity, no fake UI.
- **Screenshots must be real captures** of the actual extension. Never generate fake
  product screenshots with an image model.
- Keep every image under ~1.5 MB and PNG; keep README body text searchable (images
  never replace text content).
- When the test count changes, bump the `tests-99%20passing` badge in the root README.
