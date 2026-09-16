/**
 * Word-style page thumbnail pane — a "document minimap" for paginated
 * previews (PDF, DOCX).
 *
 * A fixed strip on the left lists one small card per page, stacked top to
 * bottom. PDF pages are downscaled from their rendered canvases; DOCX pages
 * are rasterized from the live DOM with html2canvas-pro so the thumbnails
 * show the real page content (text, tables, images), generated lazily for
 * the cards actually in view — while that runs, a quick minimap-style block
 * sketch serves as the placeholder. Minimap-inspired behavior: click a card
 * to jump to that page, the card of the page currently in view is
 * highlighted and kept visible, and the whole strip can be collapsed to
 * give the preview the full width. Open/closed is remembered per webview
 * via vscode setState.
 */

const PANE_WIDTH = 188;
const CARD_WIDTH = 140;

/**
 * Thumbnail bitmaps are rendered at `devicePixelRatio` times the CSS card
 * width so they stay sharp on HiDPI screens (a 140px bitmap upscaled 2x by
 * the compositor is the blur users notice). Capped at 2x: beyond that the
 * pixel cost grows quadratically with little visible gain.
 */
const MAX_THUMB_PIXEL_RATIO = 2;

/** Clamps a device pixel ratio into the supported thumbnail render range. */
export function thumbPixelRatio(dpr: number): number {
  if (!Number.isFinite(dpr) || dpr <= 1) {
    return 1;
  }
  return Math.min(dpr, MAX_THUMB_PIXEL_RATIO);
}

function currentThumbPixelRatio(): number {
  return thumbPixelRatio(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
}

export interface PagePaneHandle {
  destroy(): void;
}

/** Subset of the vscode webview API used for remembering the pane state. */
export interface PaneHost {
  setState(state: unknown): void;
  getState(): unknown;
}

export interface DetectedPages {
  elements: HTMLElement[];
  mode: 'canvas' | 'dom';
}

/** Rasterizes a live DOM page into a real thumbnail bitmap (domRaster.ts). */
export type DomRasterizer = (page: HTMLElement) => Promise<HTMLCanvasElement>;

export interface PagePaneOptions {
  /**
   * Required for DOM-mode documents to get real-content thumbnails; the
   * html2canvas-based implementation lives in domRaster.ts so formats
   * without DOM pages don't bundle it.
   */
  rasterizeDomPage?: DomRasterizer;
}

/** Index of the page whose content crosses the `lineY` viewport line. */
export function pickActivePage(tops: number[], lineY: number): number {
  let active = 0;
  for (let i = 0; i < tops.length; i++) {
    if (tops[i] <= lineY) {
      active = i;
    } else {
      break;
    }
  }
  return active;
}

export function detectPageElements(container: HTMLElement): DetectedPages | null {
  const canvases = Array.from(
    container.querySelectorAll<HTMLElement>('canvas.pdf-page')
  );
  if (canvases.length > 0) {
    return { elements: canvases, mode: 'canvas' };
  }
  const sections = Array.from(
    container.querySelectorAll<HTMLElement>('.docx-wrapper > section.docx')
  );
  if (sections.length > 0) {
    return { elements: sections, mode: 'dom' };
  }
  return null;
}

export function setupPagePane(
  container: HTMLElement,
  host?: PaneHost,
  options: PagePaneOptions = {}
): PagePaneHandle | null {
  const pages = detectPageElements(container);
  if (!pages || pages.elements.length === 0) {
    return null;
  }

  const saved = readSavedOpenState(host);
  const initialOpen = saved ?? window.innerWidth >= 900;

  const pane = document.createElement('div');
  pane.className = 'page-pane';
  const scroll = document.createElement('div');
  scroll.className = 'page-pane-scroll';
  pane.appendChild(scroll);

  const cards: HTMLDivElement[] = [];
  pages.elements.forEach((page, index) => {
    const card = document.createElement('div');
    card.className = 'page-card';
    const thumb = document.createElement('div');
    thumb.className = 'page-card-thumb';
    thumb.appendChild(
      pages.mode === 'canvas'
        ? renderCanvasThumb(page as HTMLCanvasElement)
        : renderDomThumb(page)
    );
    const label = document.createElement('div');
    label.className = 'page-card-label';
    label.textContent = String(index + 1);
    card.append(thumb, label);
    card.addEventListener('click', () => {
      const target = page.getBoundingClientRect().top + window.scrollY - 8;
      smoothScrollTo(Math.max(0, target));
    });
    scroll.appendChild(card);
    cards.push(card);
  });

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'page-pane-toggle';
  toggle.title = 'Toggle page thumbnails pane';
  toggle.setAttribute('aria-label', toggle.title);
  toggle.textContent = '▤';
  document.body.append(pane, toggle);

  const prevWidth = container.clientWidth;

  function isOpen(): boolean {
    return document.body.classList.contains('pane-open');
  }

  function persist(open: boolean): void {
    try {
      host?.setState?.({ pagePaneOpen: open });
    } catch {
      // Host API unavailable (e.g. test harness) — the pane still works,
      // only the open/closed memory is lost.
    }
  }

  // Rasterize DOM pages into real thumbnails lazily (see
  // makeCardVisibilityWatcher); the block sketch stays until each real
  // bitmap is ready. PDF cards come pre-rendered from their canvases, no
  // queue.
  let activePageIndex = -1;
  let generationCancelled = false;
  const lazyGeneration =
    pages.mode === 'dom' && options.rasterizeDomPage
      ? makeCardVisibilityWatcher(
          pages.elements,
          cards,
          scroll,
          options.rasterizeDomPage,
          () => generationCancelled,
          () => activePageIndex
        )
      : null;

  function apply(open: boolean, notify = true): void {
    document.body.classList.toggle('pane-open', open);
    pane.style.display = open ? '' : 'none';
    if (open) {
      // Re-opening the pane reveals cards without firing a scroll event.
      lazyGeneration?.scan();
    }
    if (notify) {
      // Let the interactive layer re-fit the document to the new width.
      window.dispatchEvent(
        new CustomEvent('page-pane-toggled', {
          detail: { open, prevWidth, newWidth: container.clientWidth },
        })
      );
    }
    persist(open);
  }

  toggle.addEventListener('click', () => apply(!isOpen()));

  // Scroll spy: highlight the card of the page crossing the upper viewport
  // band and keep it visible inside the pane.
  let raf = 0;
  const onScroll = () => {
    if (raf) {
      return;
    }
    raf = requestAnimationFrame(() => {
      raf = 0;
      const tops = pages.elements.map((page) => page.getBoundingClientRect().top);
      const active = pickActivePage(tops, window.innerHeight * 0.35);
      activePageIndex = active;
      cards.forEach((card, index) => card.classList.toggle('active', index === active));
      const card = cards[active];
      if (!card || !isOpen()) {
        return;
      }
      const paneRect = scroll.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();
      if (cardRect.top < paneRect.top || cardRect.bottom > paneRect.bottom) {
        // Manual scroll: scrollIntoView would also nudge the main document.
        scroll.scrollTop += cardRect.top - paneRect.top - 12;
      }
    });
  };
  window.addEventListener('scroll', onScroll, { passive: true });

  apply(initialOpen);
  onScroll();

  return {
    destroy() {
      generationCancelled = true;
      lazyGeneration?.dispose();
      window.removeEventListener('scroll', onScroll);
      if (raf) {
        cancelAnimationFrame(raf);
      }
      pane.remove();
      toggle.remove();
      document.body.classList.remove('pane-open');
    },
  };
}

/** Native smooth scrollIntoView is suppressed in some webview hosts, so
 * animate the scroll with rAF instead. */
function smoothScrollTo(targetY: number): void {
  const startY = window.scrollY;
  const delta = targetY - startY;
  if (Math.abs(delta) < 2) {
    return;
  }
  const duration = 300;
  const start = performance.now();
  const step = (now: number) => {
    const progress = Math.min(1, (now - start) / duration);
    const eased = 0.5 - Math.cos(Math.PI * progress) / 2;
    window.scrollTo(0, startY + delta * eased);
    if (progress < 1) {
      requestAnimationFrame(step);
    }
  };
  requestAnimationFrame(step);
}

function readSavedOpenState(host?: PaneHost): boolean | null {
  if (!host) {
    return null;
  }
  try {
    const state = host.getState() as { pagePaneOpen?: unknown } | undefined;
    return typeof state?.pagePaneOpen === 'boolean' ? state.pagePaneOpen : null;
  } catch {
    return null;
  }
}

function renderCanvasThumb(source: HTMLCanvasElement): HTMLCanvasElement {
  const ratio = currentThumbPixelRatio();
  const width = CARD_WIDTH * ratio;
  const height = Math.max(
    24 * ratio,
    Math.round((source.height / Math.max(1, source.width)) * width)
  );
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.className = 'page-card-canvas';
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, width, height);
  }
  return canvas;
}

const BLOCK_SELECTOR = 'p, table, img, h1, h2, h3, h4, h5, h6, ul, ol, pre';
const MAX_BLOCKS_PER_PAGE = 500;

const RASTER_TIMEOUT_MS = 10000;
const MAX_RASTER_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1500;

/** Retry policy for a page whose rasterization failed or timed out. */
export function planRasterRetry(failures: number): { retry: boolean } {
  return { retry: failures < MAX_RASTER_ATTEMPTS - 1 };
}

/**
 * Rasterize thumbnails lazily: when a card enters the pane's scroll
 * viewport (plus a margin), queue its page for rasterization; pages are
 * rasterized one at a time with a yield between pages, and the block sketch
 * stays until each real bitmap is ready. Visibility is decided with rects
 * rather than an IntersectionObserver because observer callbacks never fire
 * in some embedded webview hosts (verified in the test harness).
 *
 * A failed or timed-out page is retried (up to MAX_RASTER_ATTEMPTS, shortly
 * after each failure) instead of being stuck on its placeholder forever; a
 * page that succeeds is never re-rasterized. The page currently in view is
 * queued ahead of the others.
 */
function makeCardVisibilityWatcher(
  pages: HTMLElement[],
  cards: HTMLDivElement[],
  viewport: HTMLElement,
  rasterize: DomRasterizer,
  isCancelled: () => boolean,
  getPriorityIndex?: () => number
): { scan(): void; dispose(): void } {
  // Pages already queued or rasterized — a page is rendered at most once
  // (unless a failed attempt releases its claim for a retry), so window
  // resizes or repeated scans cannot trigger re-rasterization.
  const claimed = new Set<number>();
  const attempts = new Map<number, number>();
  let queue: number[] = [];
  let draining = false;
  let scanTimer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const drain = async (): Promise<void> => {
    if (draining) {
      return;
    }
    draining = true;
    while (queue.length > 0 && !isCancelled()) {
      const index = queue.shift()!;
      try {
        // html2canvas can very rarely hang (its iframe load event is
        // missed); race it so one stuck page cannot stall the strip.
        const canvas = await Promise.race([
          rasterize(pages[index]),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('rasterization timed out')), RASTER_TIMEOUT_MS)
          ),
        ]);
        cards[index]?.querySelector('.page-card-thumb')?.replaceChildren(canvas);
      } catch (err) {
        const failures = attempts.get(index) ?? 0;
        attempts.set(index, failures + 1);
        console.warn(
          `page thumbnail rasterization failed for page ${index + 1} ` +
            `(attempt ${failures + 1}/${MAX_RASTER_ATTEMPTS})`,
          err
        );
        if (planRasterRetry(failures).retry) {
          // Release the claim so a later scan can re-queue the page, and
          // rescan shortly so the retry does not wait for a user scroll.
          claimed.delete(index);
          if (!retryTimer) {
            retryTimer = setTimeout(() => {
              retryTimer = null;
              scheduleScan();
            }, RETRY_DELAY_MS);
          }
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 16));
    }
    draining = false;
  };

  const scan = (): void => {
    if (isCancelled()) {
      return;
    }
    // Cards inside a closed (display:none) pane report zero rects, which
    // would pass the visibility test below and queue every page for
    // background rasterization — skip scanning while the pane is hidden.
    if (viewport.offsetParent === null) {
      return;
    }
    const paneRect = viewport.getBoundingClientRect();
    const priorityIndex = getPriorityIndex?.() ?? -1;
    cards.forEach((card, index) => {
      if (claimed.has(index) || (attempts.get(index) ?? 0) >= MAX_RASTER_ATTEMPTS) {
        return;
      }
      const r = card.getBoundingClientRect();
      if (r.bottom > paneRect.top - 200 && r.top < paneRect.bottom + 200) {
        claimed.add(index);
        if (index === priorityIndex) {
          queue.unshift(index);
        } else {
          queue.push(index);
        }
      }
    });
    void drain();
  };

  // Timer-driven, not rAF: requestAnimationFrame is suspended whenever the
  // host hides the page (background IAB pane, hidden webview tab), which
  // would freeze thumbnail generation until the pane is seen again. A short
  // timer coalesces scroll bursts well enough — the scan is a cheap
  // rect-read loop.
  const scheduleScan = (): void => {
    if (scanTimer) {
      return;
    }
    scanTimer = setTimeout(() => {
      scanTimer = null;
      scan();
    }, 64);
  };

  viewport.addEventListener('scroll', scheduleScan, { passive: true });
  window.addEventListener('resize', scheduleScan, { passive: true });
  // No scan here: at creation time the pane is usually still hidden, and
  // zero rects would wrongly pass the visibility test and queue every page.
  // The caller drives the first scan once the pane is actually open.

  return {
    scan: scheduleScan,
    dispose() {
      viewport.removeEventListener('scroll', scheduleScan);
      window.removeEventListener('resize', scheduleScan);
      if (scanTimer) {
        clearTimeout(scanTimer);
      }
      if (retryTimer) {
        clearTimeout(retryTimer);
      }
    },
  };
}

/** Instant placeholder sketch: page geometry drawn as colored structure blocks. */
function renderDomThumb(page: HTMLElement): HTMLCanvasElement {
  const ratio = currentThumbPixelRatio();
  const rect = page.getBoundingClientRect();
  const width = CARD_WIDTH * ratio;
  const height =
    Math.max(40, Math.min(560, Math.round((rect.height / Math.max(1, rect.width)) * CARD_WIDTH))) *
    ratio;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.className = 'page-card-canvas';
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return canvas;
  }
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  const pageWidth = Math.max(1, rect.width);
  const pageHeight = Math.max(1, rect.height);
  let drawn = 0;
  for (const el of Array.from(page.querySelectorAll<HTMLElement>(BLOCK_SELECTOR))) {
    if (drawn >= MAX_BLOCKS_PER_PAGE) {
      break;
    }
    // Tables are drawn as one block; skip paragraphs nested inside them.
    if (el.tagName !== 'TABLE' && el.closest('table')) {
      continue;
    }
    const r = el.getBoundingClientRect();
    if (r.height < 2 || r.width < 2) {
      continue;
    }
    const x = ((r.left - rect.left) / pageWidth) * width;
    const y = ((r.top - rect.top) / pageHeight) * height;
    const blockWidth = Math.max(1, (r.width / pageWidth) * width);
    const blockHeight = Math.max(1, (r.height / pageHeight) * height);
    ctx.fillStyle = blockColor(el);
    ctx.fillRect(x, y, blockWidth, blockHeight);
    drawn++;
  }
  return canvas;
}

function blockColor(el: HTMLElement): string {
  if (el.tagName === 'IMG') {
    return 'rgba(70, 130, 190, 0.55)';
  }
  if (el.tagName === 'TABLE') {
    return 'rgba(110, 120, 135, 0.5)';
  }
  if (/^H[1-6]$/.test(el.tagName)) {
    return 'rgba(60, 70, 85, 0.7)';
  }
  return 'rgba(140, 150, 165, 0.45)';
}

export { PANE_WIDTH, CARD_WIDTH };
