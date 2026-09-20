# README image assets

Files referenced by the root README (`docs/images/…`). Drop each file here with
the exact name below; nothing else in this folder ships in the VSIX
(`.vscodeignore` only packs `dist/`, `media/`, `icon.png` — verify before publishing).

| File | Source | Spec |
|------|--------|------|
| `banner.png` | AI-generated (GPT) — brief in the chat that commissioned it | 1600×640 PNG (2.5:1), dark bg `#161820`, **no text in image**, ≤ 1.5 MB |
| `shot-word.png` | Real screenshot — VS Code dark theme, `.docx` open with outline panel + search bar visible, thumbnail pane open | PNG, editor area only, ~1600px wide, ≤ 1 MB |
| `shot-excel.png` | Real screenshot — `.xlsx` with a sorted column indicator + frozen header, several sheet tabs | same |
| `shot-pdf.png` | Real screenshot — `.pdf` with the page thumbnails pane open | same |
| `shot-pptx.png` | Real screenshot — `.pptx` deck, slides flowing down the page | same |

Rules (from the beautify-github-readme spec):

- **Banner** is the only AI-generated image — decorative identity, no text, no fake UI.
- **Screenshots must be real captures** of the actual extension. Never generate fake
  product screenshots with an image model.
- Keep every image under ~1.5 MB and PNG; keep README body text searchable (images
  never replace text content).
- When the test count changes, bump the `tests-99%20passing` badge in the root README.
