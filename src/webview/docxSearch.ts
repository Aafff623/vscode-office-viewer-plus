/**
 * In-document text search for the Word preview.
 *
 * Text is flattened once per query via a TreeWalker (skipping script/style),
 * matches are located in the flattened string and mapped back onto DOM
 * ranges — highlighting uses the CSS Custom Highlight API so the document
 * DOM is never mutated (keeps lazy thumbnails, comment ranges and the TOC
 * enhancement intact). A <mark>-wrapping fallback covers hosts without the
 * Highlight API. Ctrl+F opens the bar; Enter/Shift+Enter step through
 * matches; Esc closes and clears.
 */

const SEARCH_HIGHLIGHT = 'docx-search';
const CURRENT_HIGHLIGHT = 'docx-search-current';
const DEBOUNCE_MS = 250;
const MAX_MATCHES = 2000;

interface TextChunk {
  node: Text;
  start: number;
}

export interface DocxSearchHandle {
  destroy(): void;
}

/** Flattens the container's visible text into one string plus a node map. */
function flattenText(root: HTMLElement): { text: string; chunks: TextChunk[] } {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = (node as Text).parentElement;
      if (!parent || /^(SCRIPT|STYLE)$/.test(parent.tagName)) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let text = '';
  const chunks: TextChunk[] = [];
  let current: Node | null;
  while ((current = walker.nextNode())) {
    const value = (current as Text).data;
    if (value.length === 0) {
      continue;
    }
    chunks.push({ node: current as Text, start: text.length });
    text += value;
  }
  return { text, chunks };
}

/** Maps a flat-string range back onto a DOM range across text nodes. */
function rangeForOffset(
  chunks: TextChunk[],
  start: number,
  end: number
): Range | null {
  let startNode: Text | null = null;
  let startOffset = 0;
  let endNode: Text | null = null;
  let endOffset = 0;
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const chunkEnd = chunk.start + chunk.node.length;
    if (!startNode && start >= chunk.start && start <= chunkEnd) {
      startNode = chunk.node;
      startOffset = start - chunk.start;
    }
    if (end >= chunk.start && end <= chunkEnd) {
      endNode = chunk.node;
      endOffset = end - chunk.start;
      break;
    }
  }
  if (!startNode || !endNode) {
    return null;
  }
  const range = new Range();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  return range;
}

export function setupDocxSearch(container: HTMLElement): DocxSearchHandle {
  const bar = document.createElement('div');
  bar.className = 'docx-searchbar';
  bar.style.display = 'none';
  bar.innerHTML = `
    <input type="text" class="docx-searchbar-input" placeholder="在文档中搜索…" spellcheck="false" />
    <span class="docx-searchbar-count">0/0</span>
    <button type="button" class="docx-searchbar-btn" data-dir="prev" title="上一个 (Shift+Enter)">↑</button>
    <button type="button" class="docx-searchbar-btn" data-dir="next" title="下一个 (Enter)">↓</button>
    <button type="button" class="docx-searchbar-btn" data-action="close" title="关闭 (Esc)">×</button>
  `;
  document.body.appendChild(bar);

  const input = bar.querySelector<HTMLInputElement>('.docx-searchbar-input')!;
  const countLabel = bar.querySelector('.docx-searchbar-count')!;
  let ranges: Range[] = [];
  let current = -1;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const usesHighlightApi = typeof (CSS as { highlights?: unknown }).highlights !== 'undefined';

  function clearHighlights(): void {
    if (usesHighlightApi) {
      (CSS as unknown as { highlights: Map<string, unknown> }).highlights.delete(SEARCH_HIGHLIGHT);
      (CSS as unknown as { highlights: Map<string, unknown> }).highlights.delete(CURRENT_HIGHLIGHT);
    } else {
      container.querySelectorAll('mark.docx-search-mark').forEach((mark) => {
        const parent = mark.parentNode;
        if (parent) {
          parent.replaceChild(document.createTextNode(mark.textContent ?? ''), mark);
          parent.normalize();
        }
      });
    }
  }

  function paintMatches(): void {
    clearHighlights();
    if (ranges.length === 0) {
      return;
    }
    if (usesHighlightApi) {
      const all = new Highlight(...ranges);
      const currentHighlight = new Highlight(ranges[Math.max(0, current)]);
      (CSS as unknown as { highlights: Map<string, unknown> }).highlights.set(SEARCH_HIGHLIGHT, all);
      (CSS as unknown as { highlights: Map<string, unknown> }).highlights.set(CURRENT_HIGHLIGHT, currentHighlight);
    } else {
      // Fallback: wrap matches in <mark>; the current one gets a class.
      ranges.forEach((range, index) => {
        try {
          const mark = document.createElement('mark');
          mark.className = index === current ? 'docx-search-mark docx-search-mark-current' : 'docx-search-mark';
          range.surroundContents(mark);
        } catch {
          // Range crosses element boundaries oddly — skip rather than corrupt.
        }
      });
    }
  }

  function scrollToCurrent(): void {
    const range = ranges[current];
    if (!range) {
      return;
    }
    const rect = range.getBoundingClientRect();
    const target = rect.top + window.scrollY - window.innerHeight * 0.35;
    const start = window.scrollY;
    const delta = target - start;
    if (Math.abs(delta) < 2) {
      return;
    }
    const duration = 300;
    const startTime = performance.now();
    const step = (now: number) => {
      const progress = Math.min(1, (now - startTime) / duration);
      window.scrollTo(0, start + delta * (0.5 - Math.cos(Math.PI * progress) / 2));
      if (progress < 1) {
        requestAnimationFrame(step);
      }
    };
    requestAnimationFrame(step);
  }

  function updateCount(): void {
    countLabel.textContent = ranges.length === 0 ? '0/0' : `${current + 1}/${ranges.length}`;
  }

  function step(direction: 1 | -1): void {
    if (ranges.length === 0) {
      return;
    }
    current = (current + direction + ranges.length) % ranges.length;
    paintMatches();
    updateCount();
    scrollToCurrent();
  }

  function runSearch(query: string): void {
    clearHighlights();
    ranges = [];
    current = -1;
    if (query.length === 0) {
      updateCount();
      return;
    }
    const { text, chunks } = flattenText(container);
    const haystack = text.toLowerCase();
    const needle = query.toLowerCase();
    let from = 0;
    while (ranges.length < MAX_MATCHES) {
      const index = haystack.indexOf(needle, from);
      if (index === -1) {
        break;
      }
      const range = rangeForOffset(chunks, index, index + needle.length);
      if (range) {
        ranges.push(range);
      }
      from = index + Math.max(1, needle.length);
    }
    if (ranges.length > 0) {
      current = 0;
    }
    paintMatches();
    updateCount();
    if (ranges.length > 0) {
      scrollToCurrent();
    }
  }

  input.addEventListener('input', () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    const query = input.value;
    debounceTimer = setTimeout(() => runSearch(query), DEBOUNCE_MS);
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      step(event.shiftKey ? -1 : 1);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  });
  bar.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest('button');
    if (!button) {
      return;
    }
    if (button.dataset.action === 'close') {
      close();
    } else {
      step(button.dataset.dir === 'prev' ? -1 : 1);
    }
  });

  function open(): void {
    bar.style.display = '';
    input.focus();
    input.select();
  }
  function close(): void {
    bar.style.display = 'none';
    clearHighlights();
    ranges = [];
    current = -1;
    input.blur();
  }

  const onKeydown = (event: KeyboardEvent) => {
    if (event.ctrlKey && (event.key === 'f' || event.key === 'F')) {
      event.preventDefault();
      event.stopPropagation();
      open();
    } else if (event.key === 'Escape' && bar.style.display !== 'none') {
      close();
    }
  };
  window.addEventListener('keydown', onKeydown, { capture: true });

  return {
    destroy() {
      window.removeEventListener('keydown', onKeydown, { capture: true });
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      clearHighlights();
      bar.remove();
    },
  };
}
