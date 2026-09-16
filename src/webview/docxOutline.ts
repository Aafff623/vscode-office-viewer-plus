/**
 * Outline navigation panel for the Word preview.
 *
 * Headings are read from the classes docx-preview emits for paragraphs whose
 * style id is Heading1-6 (`docx_heading1` … `docx_heading6`, lowercased by
 * the library's style-name mapping) — no guessing from English text, so it
 * works for documents in any language. Clicking an item smooth-scrolls to
 * the heading; the item of the heading crossing the viewport is highlighted
 * while scrolling (rAF-throttled spy, mirroring the thumbnail pane). The
 * panel's open/closed state is remembered via vscode setState.
 */

import { smoothScrollTo, type PaneHost } from './thumbs';

const SPY_LINE = 0.35;
const HEADING_CLASS = /docx_heading([1-6])\b/;

export interface OutlineHandle {
  destroy(): void;
}

interface OutlineEntry {
  element: HTMLElement;
  level: number;
  text: string;
}

function collectHeadings(container: HTMLElement): OutlineEntry[] {
  const entries: OutlineEntry[] = [];
  for (const element of Array.from(container.querySelectorAll<HTMLElement>('[class*="docx_heading"]'))) {
    const match = HEADING_CLASS.exec(element.className);
    const text = element.textContent?.trim() ?? '';
    if (!match || text.length === 0) {
      continue;
    }
    entries.push({ element, level: Number(match[1]), text });
  }
  return entries;
}

export function setupDocxOutline(container: HTMLElement, host?: PaneHost): OutlineHandle | null {
  const entries = collectHeadings(container);
  if (entries.length === 0) {
    return null;
  }

  const saved = (() => {
    try {
      const state = host?.getState() as { outlineOpen?: unknown } | undefined;
      return typeof state?.outlineOpen === 'boolean' ? state.outlineOpen : null;
    } catch {
      return null;
    }
  })();
  const initialOpen = saved ?? entries.length > 0;

  const panel = document.createElement('nav');
  panel.className = 'docx-outline';
  const list = document.createElement('div');
  list.className = 'docx-outline-list';
  panel.appendChild(list);

  const items: HTMLElement[] = [];
  const tops: HTMLElement[] = [];
  entries.forEach((entry, index) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = `docx-outline-item docx-outline-level${entry.level}`;
    item.textContent = entry.text;
    item.title = entry.text;
    item.addEventListener('click', () => {
      const target = entry.element.getBoundingClientRect().top + window.scrollY - 8;
      smoothScrollTo(Math.max(0, target));
    });
    list.appendChild(item);
    items.push(item);
    tops.push(entry.element);
  });

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'docx-outline-toggle';
  toggle.title = '切换大纲面板';
  toggle.setAttribute('aria-label', toggle.title);
  toggle.textContent = '☰';
  document.body.append(panel, toggle);

  let raf = 0;
  const onScroll = () => {
    if (raf) {
      return;
    }
    raf = requestAnimationFrame(() => {
      raf = 0;
      const headingTops = tops.map((el) => el.getBoundingClientRect().top);
      let active = 0;
      const line = window.innerHeight * SPY_LINE;
      for (let i = 0; i < headingTops.length; i++) {
        if (headingTops[i] <= line) {
          active = i;
        } else {
          break;
        }
      }
      items.forEach((item, index) => item.classList.toggle('active', index === active));
      const item = items[active];
      if (!item || !panel.classList.contains('open')) {
        return;
      }
      const panelRect = list.getBoundingClientRect();
      const itemRect = item.getBoundingClientRect();
      if (itemRect.top < panelRect.top || itemRect.bottom > panelRect.bottom) {
        list.scrollTop += itemRect.top - panelRect.top - 12;
      }
    });
  };
  window.addEventListener('scroll', onScroll, { passive: true });

  function apply(open: boolean): void {
    panel.classList.toggle('open', open);
    panel.style.display = open ? '' : 'none';
    try {
      host?.setState?.({ outlineOpen: open });
    } catch {
      // Host API unavailable (test harness) — only the memory is lost.
    }
  }

  toggle.addEventListener('click', () => apply(!panel.classList.contains('open')));
  apply(initialOpen);
  onScroll();

  return {
    destroy() {
      window.removeEventListener('scroll', onScroll);
      if (raf) {
        cancelAnimationFrame(raf);
      }
      panel.remove();
      toggle.remove();
    },
  };
}
