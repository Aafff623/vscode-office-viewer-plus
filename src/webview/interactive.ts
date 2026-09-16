/**
 * Native Canvas-like Interactive Controller for VS Code Office Viewer Plus
 *
 * Provides:
 * - Space + Left Mouse Button drag-to-pan (Hand Tool)
 * - Middle Mouse Button direct pan
 * - Ctrl / Cmd + Mouse Wheel smooth zoom (30% ~ 350%)
 * - Ctrl + 0 quick reset to 100% zoom
 * - Optional double-click zoom toggle for the office formats
 * - Glassmorphic HUD zoom badge with auto-fade
 * - Defensive drag guards (click suppression on drag, selection freeze, blur auto-release)
 *
 * The Marp preview ships its own complete zoom and keyboard system (see
 * marp.ts), so this controller's zoom/keys yield whenever the container
 * carries the `marp-container` class; drag-to-pan still works there.
 */

export const DBLCLICK_ZOOM = 1.5;
export const WHEEL_ZOOM_IN_FACTOR = 1.08;
export const WHEEL_ZOOM_OUT_FACTOR = 0.925;
export const MIN_ZOOM = 0.3;
export const MAX_ZOOM = 3.5;

/** Ctrl+wheel zoom step: one wheel tick in either direction, clamped. */
export function computeWheelZoom(curZoom: number, deltaY: number): number {
  const factor = deltaY < 0 ? WHEEL_ZOOM_IN_FACTOR : WHEEL_ZOOM_OUT_FACTOR;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, curZoom * factor));
}

/**
 * Panel-fit zoom, computed from metrics read at 100% zoom. Under CSS zoom
 * both `clientWidth` and `scrollWidth` are unreliable (scrollWidth gets
 * clamped to clientWidth when content fits, and both are reported in the
 * element's own zoomed coordinate space), so the caller resets to 100%,
 * measures once and calls this — stateless, therefore convergent: the same
 * viewport always yields the same zoom, with no drift across repeated
 * toggles/resizes. Returns 1.0 when the content already fits (or is within
 * rounding distance of it).
 */
export function computeOverlayZoom(clientWidth: number, scrollWidth: number): number {
  if (!(clientWidth > 0) || !(scrollWidth > clientWidth + 2)) {
    return 1.0;
  }
  // 1% margin so rounding (and the document wrapper's own margins) cannot
  // leave a pixel column tucked under a panel.
  return Math.max(MIN_ZOOM, Math.min(1, (clientWidth / scrollWidth) * 0.99));
}

export interface InteractiveOptions {
  /** Enable double-click to toggle 150% zoom (used by the office formats). */
  doubleClickZoom?: boolean;
}

/**
 * Double-click zoom toggle: the first toggle remembers the current zoom and
 * jumps to DBLCLICK_ZOOM; the next toggle restores the remembered zoom.
 */
export function computeDblClickZoom(
  curZoom: number,
  savedZoom: number | null
): { zoom: number; saved: number | null } {
  if (savedZoom === null) {
    return { zoom: DBLCLICK_ZOOM, saved: curZoom };
  }
  return { zoom: savedZoom, saved: null };
}

export function setupOfficeInteractive(
  containerTarget?: HTMLElement | null,
  options: InteractiveOptions = {}
): void {
  let isSpacePressed = false;
  let isDragging = false;
  let lastX = 0;
  let lastY = 0;
  let scrollChain: Element[] = [];
  let dragMoved = false;
  let dragButton = -1;
  let curZoom = 1.0;
  let savedZoom: number | null = null;
  let fittedZoom: number | null = null;
  let tipTimer: ReturnType<typeof setTimeout> | null = null;
  let tipElement: HTMLDivElement | null = null;

  function getContainer(): HTMLElement | null {
    return containerTarget || document.getElementById('container');
  }

  // The class is added by marp.ts at render time, so it must be checked
  // dynamically rather than captured at setup time.
  function isMarpPreview(): boolean {
    return getContainer()?.classList.contains('marp-container') ?? false;
  }

  function getTipElement(): HTMLDivElement {
    if (!tipElement) {
      tipElement = document.createElement('div');
      tipElement.id = 'office-interactive-zoom-badge';
      tipElement.style.cssText = [
        'position: fixed',
        'top: 18px',
        'right: 24px',
        'background: rgba(18, 24, 38, 0.88)',
        'backdrop-filter: blur(8px)',
        '-webkit-backdrop-filter: blur(8px)',
        'color: #58a6ff',
        'border: 1px solid rgba(88, 166, 255, 0.35)',
        'padding: 6px 14px',
        'border-radius: 20px',
        'font-size: 13px',
        'font-weight: 600',
        'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        'z-index: 999999',
        'pointer-events: none',
        'opacity: 0',
        'transition: opacity 0.2s ease, transform 0.15s ease',
        'box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4)',
        'transform: scale(0.92)',
      ].join(';') + ';';
      document.body.appendChild(tipElement);
    }
    return tipElement;
  }

  function showTip(msg: string): void {
    const tip = getTipElement();
    tip.textContent = msg;
    tip.style.opacity = '1';
    tip.style.transform = 'scale(1.0)';
    if (tipTimer !== null) {
      clearTimeout(tipTimer);
    }
    tipTimer = setTimeout(() => {
      tip.style.opacity = '0';
      tip.style.transform = 'scale(0.92)';
    }, 1200);
  }

  function setZoom(zoom: number): void {
    curZoom = zoom;
    const c = getContainer();
    if (c) {
      // Use CSS zoom where supported, or fallback
      (c.style as unknown as { zoom?: string }).zoom = String(zoom);
    }
  }

  function isEditable(el: Element | null): boolean {
    if (!el) return false;
    const tag = (el.tagName || '').toUpperCase();
    return (
      tag === 'INPUT' ||
      tag === 'TEXTAREA' ||
      tag === 'SELECT' ||
      tag === 'BUTTON' ||
      (el as HTMLElement).isContentEditable
    );
  }

  /**
   * All scrollable ancestors between the event target and the window,
   * innermost first. Wide tables overflow their pane on one axis only, so a
   * drag must hand leftover delta to outer scrollers (e.g. a pane that only
   * scrolls horizontally must not swallow the vertical pan).
   */
  function collectScrollChain(start: EventTarget | null): Element[] {
    const chain: Element[] = [];
    let cur = start instanceof Element ? start : null;
    while (cur && cur !== document.body && cur !== document.documentElement) {
      try {
        const style = window.getComputedStyle(cur);
        const canY =
          (style.overflowY === 'auto' || style.overflowY === 'scroll') &&
          cur.scrollHeight > cur.clientHeight + 4;
        const canX =
          (style.overflowX === 'auto' || style.overflowX === 'scroll') &&
          cur.scrollWidth > cur.clientWidth + 4;
        if (canY || canX) {
          chain.push(cur);
        }
      } catch {
        // Ignore cross-origin frame or detached node security exceptions
      }
      cur = cur.parentElement;
    }
    return chain;
  }

  function applyPan(stepX: number, stepY: number): void {
    let remainingX = stepX;
    let remainingY = stepY;
    for (const el of scrollChain) {
      if (remainingX !== 0) {
        const before = el.scrollLeft;
        el.scrollLeft = before + remainingX;
        remainingX -= el.scrollLeft - before;
      }
      if (remainingY !== 0) {
        const before = el.scrollTop;
        el.scrollTop = before + remainingY;
        remainingY -= el.scrollTop - before;
      }
      if (remainingX === 0 && remainingY === 0) {
        return;
      }
    }
    if (remainingX !== 0 || remainingY !== 0) {
      window.scrollBy(remainingX, remainingY);
    }
  }

  window.addEventListener(
    'keydown',
    (e: KeyboardEvent) => {
      if (isMarpPreview()) {
        return;
      }
      if (e.code === 'Space' || e.key === ' ') {
        if (isEditable(document.activeElement)) return;
        e.preventDefault();
        if (!isSpacePressed) {
          isSpacePressed = true;
          if (!isDragging) {
            document.body.classList.add('office-space-active');
          }
        }
      }

      if (e.ctrlKey || e.metaKey) {
        if (e.key === '0' || e.code === 'Digit0' || e.code === 'Numpad0') {
          e.preventDefault();
          savedZoom = null;
          fittedZoom = null;
          setZoom(1.0);
          showTip('Reset: 100%');
        }
      }
    },
    { capture: true }
  );

  window.addEventListener(
    'keyup',
    (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.key === ' ') {
        if (isEditable(document.activeElement)) return;
        isSpacePressed = false;
        if (!isDragging) {
          document.body.classList.remove('office-space-active');
        }
      }
    },
    { capture: true }
  );

  function resetState(): void {
    isSpacePressed = false;
    isDragging = false;
    dragMoved = false;
    scrollChain = [];
    document.body.classList.remove('office-space-active', 'office-dragging-active');
  }

  window.addEventListener('blur', resetState);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) resetState();
  });

  window.addEventListener(
    'pointerdown',
    (e: PointerEvent) => {
      if (!e.isPrimary) return;
      const isSpacePan = isSpacePressed && e.button === 0;
      const isMiddlePan = e.button === 1;

      if (isSpacePan || isMiddlePan) {
        e.preventDefault();
        e.stopPropagation();
        isDragging = true;
        dragMoved = false;
        dragButton = e.button;
        lastX = e.clientX;
        lastY = e.clientY;
        scrollChain = collectScrollChain(e.target);
        document.body.classList.add('office-dragging-active');
        // Keep receiving pointermove/pointerup even when the cursor leaves
        // the webview iframe, so the drag cannot get stuck half-finished.
        try {
          document.documentElement.setPointerCapture(e.pointerId);
        } catch {
          // Pointer may already be gone; dragging still works inside bounds.
        }
      }
    },
    { capture: true }
  );

  window.addEventListener(
    'pointermove',
    (e: PointerEvent) => {
      if (!isDragging) return;
      e.preventDefault();
      const stepX = -(e.clientX - lastX);
      const stepY = -(e.clientY - lastY);
      if (Math.abs(e.clientX - lastX) > 2 || Math.abs(e.clientY - lastY) > 2) {
        dragMoved = true;
      }
      lastX = e.clientX;
      lastY = e.clientY;
      applyPan(stepX, stepY);
    },
    { capture: true }
  );

  window.addEventListener(
    'pointerup',
    (e: PointerEvent) => {
      if (isDragging) {
        isDragging = false;
        scrollChain = [];
        document.body.classList.remove('office-dragging-active');
        if (!isSpacePressed) {
          document.body.classList.remove('office-space-active');
        }
        // Middle-button drags emit auxclick, not click — their dragMoved
        // flag would otherwise swallow the next real left click.
        if (dragButton !== 0) {
          dragMoved = false;
        }
      }
    },
    { capture: true }
  );

  window.addEventListener(
    'pointercancel',
    () => {
      resetState();
    },
    { capture: true }
  );

  // Native drags (images, links) must not race the pan gesture.
  window.addEventListener('dragstart', (e: DragEvent) => {
    if (isDragging) {
      e.preventDefault();
    }
  });

  // Suppress clicks that occur as the trailing edge of a drag gesture
  // (space+left drags only — middle-button drags never produce a click)
  window.addEventListener(
    'click',
    (e: MouseEvent) => {
      if (dragMoved && dragButton === 0) {
        e.preventDefault();
        e.stopPropagation();
      }
      dragMoved = false;
    },
    { capture: true }
  );

  // Double-click toggles 150% zoom (office formats opt in via options)
  if (options.doubleClickZoom) {
    window.addEventListener('dblclick', (e: MouseEvent) => {
      // Double-clicks on interactive chrome (links, buttons, sheet tabs,
      // thumbnail cards) keep their native meaning and must not zoom.
      const target = e.target as Element | null;
      if (
        target?.closest?.(
          'a, button, input, select, textarea, label, .page-pane, .xlsx-tabs, .csv-controls, .docx-outline, .docx-searchbar'
        )
      ) {
        return;
      }
      fittedZoom = null;
      const result = computeDblClickZoom(curZoom, savedZoom);
      savedZoom = result.saved;
      setZoom(result.zoom);
      showTip(`Zoom: ${Math.round(result.zoom * 100)}%`);
    });
  }

  // Side panels open/close (thumbnail pane on the left, outline panel on the
  // right) and window resizes change the available width: keep the document
  // fitted to the remaining area so the page is never occluded. Measurements
  // are taken at 100% (see computeOverlayZoom) — the reset and the re-applied
  // zoom happen within one synchronous block, so no intermediate state is
  // painted. A zoom the user set (wheel, Ctrl+0, double-click) is untouched.
  const refitForOverlays = (): void => {
    const c = getContainer();
    if (!c) {
      return;
    }
    if (savedZoom !== null) {
      return;
    }
    if (Math.abs(curZoom - 1) > 1e-9 && curZoom !== fittedZoom) {
      return;
    }
    const wasFitted = fittedZoom !== null;
    setZoom(1.0);
    const next = computeOverlayZoom(c.clientWidth, c.scrollWidth);
    fittedZoom = next < 1 ? next : null;
    if (fittedZoom !== null) {
      setZoom(fittedZoom);
      showTip(`Zoom: ${Math.round(fittedZoom * 100)}%`);
    } else if (wasFitted) {
      showTip('Zoom: 100%');
    }
  };
  // A toggle can be dispatched while the document is mid-layout (e.g. the
  // TOC tab-stop pass landing later), so re-check once things settle.
  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  const onOverlayToggled = (): void => {
    refitForOverlays();
    if (settleTimer) {
      clearTimeout(settleTimer);
    }
    settleTimer = setTimeout(refitForOverlays, 1400);
  };
  window.addEventListener('page-pane-toggled', onOverlayToggled);
  window.addEventListener('docx-outline-toggled', onOverlayToggled);
  // The editor splitting or resizing changes the available width the same
  // way a panel toggle does — refit (or restore) on resize as well.
  window.addEventListener('resize', refitForOverlays);

  // Ctrl / Cmd + Mouse Wheel smooth zoom
  window.addEventListener(
    'wheel',
    (e: WheelEvent) => {
      if (isMarpPreview()) {
        return;
      }
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        savedZoom = null;
        fittedZoom = null;
        setZoom(computeWheelZoom(curZoom, e.deltaY));
        showTip(`Zoom: ${Math.round(curZoom * 100)}%`);
      }
    },
    { passive: false }
  );
}
