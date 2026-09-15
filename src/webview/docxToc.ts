/**
 * Post-processing for Word TOC (table of contents) paragraphs.
 *
 * docx-preview's experimental mode already computes real tab stops: each tab
 * span gets `.docx-tab-stop`, and after render the library sets an inline
 * `word-spacing` that pushes the page number to the right stop, drawing a
 * dotted-underline leader. When that computation cannot resolve a stop (the
 * span keeps no inline word-spacing), we fall back to a flexbox layout with a
 * CSS dot leader so TOC lines still read like Word's.
 */

const TOC_STYLE_CLASS = /^docx_toc[-]?\d+$/i;

/** A page number as trailing TOC text: digits or roman numerals. */
export function looksLikePageNumber(text: string): boolean {
  return /^(?:\d+|[ivxlcdm]+)\.?$/i.test(text.trim());
}

export function isTocStyleParagraph(paragraph: HTMLElement): boolean {
  return Array.from(paragraph.classList).some((name) => TOC_STYLE_CLASS.test(name));
}

/**
 * Heuristic for TOC entries without an explicit TOC style: text after the
 * last inline element is just a page number. Only ever combined with a
 * present-but-unresolved tab span, so plain body text is never touched.
 */
export function looksLikeTocEntry(paragraph: HTMLElement): boolean {
  const text = paragraph.textContent ?? '';
  const lastLine = text.split('\n').pop() ?? '';
  const match = lastLine.match(/^(.*?)(\d+|[ivxlcdm]+)\.?$/i);
  if (!match) {
    return false;
  }
  // There must be meaningful title text before the page number.
  return match[1].trim().length > 0;
}

/** Runs after docx-preview's tab-stop pass (scheduled at +500ms). */
export function enhanceDocxTocLayout(container: HTMLElement): void {
  window.setTimeout(() => {
    const paragraphs = container.querySelectorAll<HTMLElement>('p');
    for (const paragraph of paragraphs) {
      // Never touch table cells or list content — TOC entries live directly
      // in the document body.
      if (paragraph.closest('table')) {
        continue;
      }
      const tabs = Array.from(
        paragraph.querySelectorAll<HTMLElement>('.docx-tab-stop')
      );
      if (tabs.length === 0) {
        continue;
      }
      // The library marks resolved stops with an inline word-spacing.
      const unresolved = tabs.filter((tab) => !tab.style.wordSpacing);
      if (unresolved.length === 0) {
        continue;
      }
      const isToc = isTocStyleParagraph(paragraph);
      if (!isToc) {
        const afterTab = textAfterLastTab(paragraph);
        if (!looksLikePageNumber(afterTab) || !looksLikeTocEntry(paragraph)) {
          continue;
        }
      }
      paragraph.classList.add('docx-toc-enhanced');
      for (const tab of unresolved) {
        tab.classList.add('docx-tab-leader');
        tab.textContent = '';
      }
    }
  }, 800);
}

function textAfterLastTab(paragraph: HTMLElement): string {
  const tabs = paragraph.querySelectorAll<HTMLElement>('.docx-tab-stop');
  const last = tabs[tabs.length - 1];
  if (!last) {
    return '';
  }
  let text = '';
  let node: Node | null = last.nextSibling;
  while (node) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent ?? '';
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      text += (node as HTMLElement).textContent ?? '';
    }
    node = node.nextSibling;
  }
  return text;
}
