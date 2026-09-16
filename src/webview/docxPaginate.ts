/**
 * Content-based page splitting for the Word preview.
 *
 * docx-preview only starts a new page at explicit page breaks (verified in
 * its source: `breakPages` is consulted once, when scanning paragraph
 * children for break elements). A chapter without explicit breaks therefore
 * renders as one very tall white page — pages look "continuous" instead of
 * separated like in Word. After the render has settled (including the
 * library's +500ms tab-stop pass and our +800ms TOC fallback, both of which
 * change line heights), any section taller than its own page box is re-packed
 * here: the article's top-level blocks are measured and greedily distributed
 * into page-sized sections cloned from the original, so page styling, page
 * headers and footers are preserved.
 *
 * A block taller than one page keeps a page of its own (Word would split a
 * long table by rows; that is not implemented yet). Moving existing nodes —
 * rather than cloning content — keeps anchors, comment highlight ranges and
 * the TOC enhancement applied earlier fully intact.
 */

const PAGE_TOLERANCE_PX = 4;

/**
 * Greedy page packing: distributes block heights into pages, each at most
 * `capacity` (plus tolerance). A block taller than the capacity gets a page
 * of its own. Returns arrays of block indexes, in order.
 */
export function packBlocks(heights: number[], capacity: number): number[][] {
  const pages: number[][] = [];
  let current: number[] = [];
  let used = 0;
  for (let index = 0; index < heights.length; index++) {
    const height = heights[index];
    if (current.length > 0 && used + height > capacity + PAGE_TOLERANCE_PX) {
      pages.push(current);
      current = [];
      used = 0;
    }
    current.push(index);
    used += height;
  }
  if (current.length > 0) {
    pages.push(current);
  }
  return pages;
}

interface MeasuredBlock {
  element: HTMLElement;
  height: number;
}

/** Page box height minus its vertical padding = how much content fits. */
function pageContentCapacity(section: HTMLElement): number {
  const style = getComputedStyle(section);
  const boxHeight = Number.isFinite(parseFloat(style.minHeight))
    ? parseFloat(style.minHeight)
    : section.clientHeight;
  const paddingTop = parseFloat(style.paddingTop) || 0;
  const paddingBottom = parseFloat(style.paddingBottom) || 0;
  return boxHeight - paddingTop - paddingBottom;
}

function splitOverflowingSection(wrapper: Element, section: HTMLElement): void {
  const article = section.querySelector<HTMLElement>(':scope > article');
  if (!article) {
    return;
  }
  const capacity = pageContentCapacity(section);
  if (!(capacity > 0)) {
    return;
  }

  // Measure every top-level block in one read pass (no writes in between, so
  // the browser does not have to re-layout per element).
  const blocks: MeasuredBlock[] = [];
  for (const child of Array.from(article.children)) {
    if (!(child instanceof HTMLElement)) {
      continue;
    }
    const style = getComputedStyle(child);
    blocks.push({
      element: child,
      height:
        child.getBoundingClientRect().height +
        (parseFloat(style.marginTop) || 0) +
        (parseFloat(style.marginBottom) || 0),
    });
  }
  if (blocks.length === 0) {
    return;
  }
  const contentHeight = blocks.reduce((sum, block) => sum + block.height, 0);
  if (contentHeight <= capacity + PAGE_TOLERANCE_PX) {
    return;
  }

  const pages = packBlocks(
    blocks.map((block) => block.height),
    capacity
  );
  if (pages.length <= 1) {
    return;
  }

  // Reuse the original section for the first page; clone it (page box style
  // and class) for the rest, repeating the page header and footer.
  const header = section.querySelector(':scope > header');
  const footer = section.querySelector(':scope > footer');
  let cursor: HTMLElement = section;
  const pageArticles: HTMLElement[] = [article];
  for (let index = 1; index < pages.length; index++) {
    const clone = section.cloneNode(false) as HTMLElement;
    if (header) {
      clone.appendChild(header.cloneNode(true));
    }
    const cloneArticle = article.cloneNode(false) as HTMLElement;
    clone.appendChild(cloneArticle);
    if (footer) {
      clone.appendChild(footer.cloneNode(true));
    }
    cursor.insertAdjacentElement('afterend', clone);
    cursor = clone;
    pageArticles.push(cloneArticle);
  }
  pages.forEach((pageIndexes, pageIndex) => {
    const target = pageArticles[pageIndex];
    // Move the original nodes (never remove them from the document tree
    // permanently) so references held elsewhere stay valid.
    target.replaceChildren(...pageIndexes.map((blockIndex) => blocks[blockIndex].element));
  });
}

/**
 * Splits every `.docx-wrapper > section.docx` whose content exceeds its page
 * box into multiple page-sized sections. Safe to call once per render, after
 * layout has settled.
 */
export function paginateDocxPages(container: HTMLElement): void {
  const wrapper = container.querySelector('.docx-wrapper');
  if (!wrapper) {
    return;
  }
  const sections = Array.from(wrapper.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement && child.tagName === 'SECTION'
  );
  for (const section of sections) {
    splitOverflowingSection(wrapper, section);
  }
}
