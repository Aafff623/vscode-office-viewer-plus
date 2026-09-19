/**
 * Native Canvas-like Interactive Controller for VS Code Office Viewer Plus
 *
 * Provides:
 * - Space + Left Mouse Button drag-to-pan (Hand Tool)
 * - Middle Mouse Button direct pan
 * - Ctrl / Cmd + Mouse Wheel smooth zoom (30% ~ 350%)
 * - Ctrl + 0 quick reset to 100% zoom
 * - Optional double-click zoom toggle for the office formats, anchored at
 *   the cursor position
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

declare global {
  interface Window {
    /** Build beacon injected by the provider's HTML (see officeViewerProvider.getHtml). */
    __OVP_BUILD__?: { htmlAt: string; bundle: string; css: string };
  }
}

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
  /** Enable double-click to toggle 150% zoom, anchored at the cursor (office formats). */
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

/**
 * Scroll compensation that anchors a zoom change at the cursor. CSS zoom
 * scales the content out of the container's top-left, so the visual gap
 * between the cursor and the origin scales with the zoom ratio (gapX/gapY,
 * measured before the zoom change); scrolling by that scaled delta keeps the
 * content point under the pointer stationary. originShiftX/Y is the origin's
 * own movement between the pre-zoom and post-zoom measurements — a scrollbar
 * appearing/disappearing or margins re-balancing shift it too, and the anchor
 * must track where the content actually landed, not where the formula
 * assumes. Works for zoom-out as well, where the ratio is negative.
 */
export function computeZoomAnchorPan(
  gapX: number,
  gapY: number,
  originShiftX: number,
  originShiftY: number,
  oldZoom: number,
  newZoom: number
): { dx: number; dy: number } {
  const k = newZoom / oldZoom - 1;
  return { dx: originShiftX + gapX * k, dy: originShiftY + gapY * k };
}

/** One scroller in the pan chain, described in its own scroll units. */
export interface PanTarget {
  /**
   * Visual px moved per unit of this scroller's own scroll offset — the
   * product of the CSS zooms on it and its ancestors (see scaleOf).
   */
  scale: number;
  /** Current scroll offsets, in the scroller's own units. */
  x: number;
  y: number;
  /** Largest reachable offsets (scrollWidth - clientWidth), same units. */
  maxX: number;
  maxY: number;
}

export interface PanPlan {
  /** Absolute offsets to assign, one entry per target, in the same order. */
  targets: Array<{ x: number; y: number }>;
  /** Residue no target could take, in visual px — the window's share. */
  window: { x: number; y: number };
}

function clampOffset(value: number, max: number): number {
  return Math.max(0, Math.min(value, max));
}

/** One decimal, for numbers that go into the console beacon. */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Spreads a visual-pixel pan across the scroll chain. A scroller inside a
 * CSS-zoomed subtree consumes `step / scale` of its own units — Chromium
 * reports its offsets and ranges in the subtree's local units while rendering
 * them scaled, so writing the visual value there overshoots by the zoom
 * factor (measured: zoom 2, scrollTop 50, content moves 100 visual px).
 * Whatever a scroller cannot take (its range is exhausted) falls through to
 * the next one and finally to the window, where one unit is one visual px.
 * Pure, so the arithmetic is testable without a DOM.
 */
export function planPan(stepX: number, stepY: number, targets: PanTarget[]): PanPlan {
  let remainingX = stepX;
  let remainingY = stepY;
  const planned: Array<{ x: number; y: number }> = [];
  for (const target of targets) {
    const scale = target.scale > 0 ? target.scale : 1;
    let x = target.x;
    let y = target.y;
    if (remainingX !== 0) {
      const want = clampOffset(target.x + remainingX / scale, target.maxX);
      remainingX -= (want - target.x) * scale;
      x = want;
    }
    if (remainingY !== 0) {
      const want = clampOffset(target.y + remainingY / scale, target.maxY);
      remainingY -= (want - target.y) * scale;
      y = want;
    }
    planned.push({ x, y });
  }
  return { targets: planned, window: { x: remainingX, y: remainingY } };
}

/**
 * Where a probed content point must end up when the pointer anchor holds: a
 * CSS zoom scales the layout about the pointer, so a point that started `d`
 * px away sits `d x ratio` away afterwards. Comparing the measured position
 * against this — rather than against its raw starting position — is what
 * keeps the anchor on the pointer itself instead of on the probed neighbour.
 */
export function expectedProbeScreenPos(
  pointerX: number,
  pointerY: number,
  startX: number,
  startY: number,
  zoomRatio: number
): { x: number; y: number } {
  return {
    x: pointerX + (startX - pointerX) * zoomRatio,
    y: pointerY + (startY - pointerY) * zoomRatio,
  };
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
  let savedView: ViewSnapshot | null = null;
  let fittedZoom: number | null = null;
  // Visual offset of the content, in the container's own (zoomed) px — applied
  // as a margin so it is layout, not paint. Scrolling is the normal way to move
  // the view, but it can only move what has scroll range: centered content that
  // fits the pane re-centers as the zoom changes (its margins are laid out
  // against a container that keeps the viewport's width), and a click near an
  // edge would then be impossible to anchor. A margin moves the content
  // instead, and because a block with auto width keeps its right edge at the
  // body's edge, it costs no horizontal scroll range of its own — a transform
  // or relative offset would (measured: +149px of document width), which then
  // let the next scroll clamp the window back and eat the offset.
  let shiftLocalX = 0;
  let shiftLocalY = 0;
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

  /**
   * Applies the content offset as a margin on the container, in local px so it
   * scales with the zoom exactly like the layout does. Zero clears the inline
   * style, letting the stylesheet's pane margin take over again.
   */
  function applyShift(): void {
    const c = getContainer();
    if (!c) {
      return;
    }
    if (shiftLocalX === 0 && shiftLocalY === 0) {
      c.style.marginLeft = '';
      c.style.marginTop = '';
      return;
    }
    // Kept in sync with viewer.css: body.pane-open #container { margin-left:
    // 188px } — the shift composes with it instead of overriding it, which
    // means a pane toggled while the offset is in place has to be recomposed
    // (see onOverlayToggled), or the inline value would keep the pane's share
    // long after the pane is gone.
    c.style.marginLeft = `${paneMargin() + shiftLocalX}px`;
    if (shiftLocalY !== 0) {
      c.style.marginTop = `${shiftLocalY}px`;
    } else {
      c.style.marginTop = '';
    }
  }

  /** The pane's own left margin, as viewer.css defines it. */
  function paneMargin(): number {
    return document.body.classList.contains('pane-open') ? 188 : 0;
  }

  /** Adds to the offset, capped so a wrong probe cannot fling the view away. */
  function addShift(dxLocal: number, dyLocal: number): void {
    const cap = 4000;
    shiftLocalX = Math.max(-cap, Math.min(cap, shiftLocalX + dxLocal));
    shiftLocalY = Math.max(-cap, Math.min(cap, shiftLocalY + dyLocal));
    applyShift();
  }

  function resetShift(): void {
    if (shiftLocalX !== 0 || shiftLocalY !== 0) {
      shiftLocalX = 0;
      shiftLocalY = 0;
      applyShift();
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

  /**
   * Writes scroll offsets, then reads them back once and rewrites what did not
   * stick. A layout change landing in the same frame (the zoom itself, or a
   * content-offset change) can let the browser's scroll anchoring adjust a
   * scroller right after the write, and a view restore that silently drifts is
   * the exact failure this area keeps producing. A clamped write stays clamped,
   * so this cannot loop.
   */
  function writeOffsets(entries: Array<{ el: Element; x: number; y: number }>): void {
    for (const entry of entries) {
      if (!entry.el.isConnected) {
        continue;
      }
      entry.el.scrollLeft = entry.x;
      entry.el.scrollTop = entry.y;
    }
    for (const entry of entries) {
      if (!entry.el.isConnected) {
        continue;
      }
      if (Math.abs(entry.el.scrollLeft - entry.x) > 1) {
        entry.el.scrollLeft = entry.x;
      }
      if (Math.abs(entry.el.scrollTop - entry.y) > 1) {
        entry.el.scrollTop = entry.y;
      }
    }
  }

  function applyPan(stepX: number, stepY: number): void {
    const plan = planPan(
      stepX,
      stepY,
      scrollChain.map((el) => ({
        scale: scaleOf(el),
        x: el.scrollLeft,
        y: el.scrollTop,
        maxX: el.scrollWidth - el.clientWidth,
        maxY: el.scrollHeight - el.clientHeight,
      }))
    );
    writeOffsets(
      scrollChain.map((el, index) => ({ el, x: plan.targets[index].x, y: plan.targets[index].y }))
    );
    if (plan.window.x !== 0 || plan.window.y !== 0) {
      window.scrollBy(plan.window.x, plan.window.y);
    }
  }

  /**
   * Visual px per unit of an element's own scroll offsets: CSS zoom renders a
   * subtree scaled while scroll offsets and ranges stay in the subtree's local
   * units, so a delta measured in viewport px must be divided by the zooms on
   * the element and its ancestors before it is written (measured in Chromium:
   * zoom 2 + scrollTop 50 moves the content 100 visual px, and nested zooms
   * multiply).
   */
  function scaleOf(el: Element): number {
    let scale = 1;
    let cur: Element | null = el;
    while (cur && cur !== document.documentElement) {
      scale *= ownZoom(cur);
      cur = cur.parentElement;
    }
    return scale;
  }

  /** Computed CSS zoom of an element, 1 when unset or invalid. */
  function ownZoom(el: Element | null | undefined): number {
    if (!el) {
      return 1;
    }
    const zoom = parseFloat(
      (window.getComputedStyle(el) as unknown as { zoom?: string }).zoom ?? '1'
    );
    return Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  }

  /**
   * A content point under the pointer that can be located again after the
   * zoom, so the anchor can be verified against the real layout instead of
   * only trusting the analytic model. Text yields a caret probe; anything
   * else (e.g. a PDF canvas) a fractional-position probe inside its box.
   */
  type AnchorProbe =
    | { kind: 'caret'; node: Text; offset: number }
    | { kind: 'box'; el: Element; fx: number; fy: number };

  function probeScreenPos(probe: AnchorProbe): { x: number; y: number } | null {
    if (probe.kind === 'caret') {
      if (!probe.node.isConnected) {
        return null;
      }
      const range = document.createRange();
      range.setStart(probe.node, probe.offset);
      range.setEnd(probe.node, Math.min(probe.offset + 1, probe.node.data.length));
      const rect = range.getClientRects()[0];
      return rect ? { x: rect.left, y: rect.top } : null;
    }
    if (!probe.el.isConnected) {
      return null;
    }
    const rect = probe.el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) {
      return null;
    }
    return {
      x: rect.left + probe.fx * rect.width,
      y: rect.top + probe.fy * rect.height,
    };
  }

  function probeAnchor(x: number, y: number): AnchorProbe | null {
    // Only content inside the zoomed container is a usable probe: body/html
    // around it does not scale with the container zoom, so a probe there would
    // report a perfect anchor that was never verified.
    const cont = getContainer();
    if (!cont) {
      return null;
    }
    const caretFromPoint = (
      document as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null }
    ).caretRangeFromPoint;
    const caret = caretFromPoint ? caretFromPoint.call(document, x, y) : null;
    const text = caret?.startContainer;
    if (caret && text && text.nodeType === 3 && (text as Text).data.trim()) {
      const node = text as Text;
      const start = caret.startOffset;
      for (const offset of [start, start - 1, start + 1]) {
        if (offset < 0 || offset >= node.data.length) {
          continue;
        }
        if (!node.parentElement || !cont.contains(node.parentElement)) {
          continue;
        }
        const probe: AnchorProbe = { kind: 'caret', node, offset };
        if (probeScreenPos(probe)) {
          return probe;
        }
      }
    }
    const el = document.elementFromPoint(x, y);
    if (el && cont.contains(el)) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 2 && rect.height > 2) {
        return { kind: 'box', el, fx: (x - rect.left) / rect.width, fy: (y - rect.top) / rect.height };
      }
    }
    return null;
  }

  /** The view a double-click zoom-in must be able to go back to. */
  interface ViewSnapshot {
    winX: number;
    winY: number;
    /** Scroll offsets of every scroller in the chain at capture time. */
    chain: Array<{ el: Element; x: number; y: number }>;
    /** Content offset at capture time, in local px (see applyShift). */
    shiftLocalX: number;
    shiftLocalY: number;
  }

  function captureViewSnapshot(): ViewSnapshot {
    return {
      winX: window.scrollX,
      winY: window.scrollY,
      chain: scrollChain.map((el) => ({ el, x: el.scrollLeft, y: el.scrollTop })),
      shiftLocalX,
      shiftLocalY,
    };
  }

  /**
   * Puts the captured offsets back — an exact undo, optionally for one axis
   * only. Returns false when part of the snapshot no longer exists.
   */
  function restoreViewSnapshot(snapshot: ViewSnapshot, axis?: 'x' | 'y'): boolean {
    let complete = true;
    for (const entry of snapshot.chain) {
      if (!entry.el.isConnected) {
        complete = false;
      }
    }
    // The content offset first: it is the layout change in this sequence, and
    // writing scrolls before it would let the layout pass adjust them again.
    if (axis !== 'y') {
      shiftLocalX = snapshot.shiftLocalX;
    }
    if (axis !== 'x') {
      shiftLocalY = snapshot.shiftLocalY;
    }
    applyShift();
    writeOffsets(
      snapshot.chain.map((entry) => ({
        el: entry.el,
        x: axis === 'y' ? entry.el.scrollLeft : entry.x,
        y: axis === 'x' ? entry.el.scrollTop : entry.y,
      }))
    );
    const winX = axis === 'y' ? window.scrollX : snapshot.winX;
    const winY = axis === 'x' ? window.scrollY : snapshot.winY;
    window.scrollTo(winX, winY);
    if (Math.abs(window.scrollX - winX) > 1 || Math.abs(window.scrollY - winY) > 1) {
      window.scrollTo(winX, winY);
    }
    return complete;
  }

  /**
   * Zooms and keeps the content point under (pointerX, pointerY) pinned to it.
   * The analytic pan is a model of the layout; a probe then measures the real
   * one and corrects what is left — through the scroll chain where there is
   * range, and through the content offset where there is not (centered content
   * that fits the pane re-centers as the zoom changes, which no amount of
   * scrolling can express). Returns what happened, for the beacons.
   */
  function anchorZoom(
    newZoom: number,
    pointerX: number,
    pointerY: number,
    target: Element | null
  ): { pan: [number, number] | null; probe: 'caret' | 'box' | null; residual: [number, number] | null } {
    const prevZoom = curZoom;
    const cont = getContainer();
    const probe = probeAnchor(pointerX, pointerY);
    const probeStart = probe ? probeScreenPos(probe) : null;
    const rectBefore = cont?.getBoundingClientRect();
    scrollChain = collectScrollChain(target);
    setZoom(newZoom);
    const rectAfter = cont?.getBoundingClientRect();
    let pan: [number, number] | null = null;
    let residual: [number, number] | null = null;
    if (rectBefore && Math.abs(newZoom - prevZoom) > 1e-9) {
      const { dx, dy } = computeZoomAnchorPan(
        pointerX - rectBefore.left,
        pointerY - rectBefore.top,
        rectAfter ? rectAfter.left - rectBefore.left : 0,
        rectAfter ? rectAfter.top - rectBefore.top : 0,
        prevZoom,
        newZoom
      );
      applyPan(dx, dy);
      pan = [round1(dx), round1(dy)];
      // Verify against the real layout, then correct what is left. Per axis:
      // an axis the scroll could not take (a pinned element, or the range ran
      // out) is put back and carried by the content offset instead — once, so
      // a stale probe cannot fling the view.
      if (probe && probeStart) {
        const expected = expectedProbeScreenPos(
          pointerX,
          pointerY,
          probeStart.x,
          probeStart.y,
          newZoom / prevZoom
        );
        let shiftPassesX = 0;
        let shiftPassesY = 0;
        // Local px of margin that move the content by -residual (the probe's
        // error), measured rather than assumed: a small test margin is applied
        // and its effect on the probe is read back.
        const shiftFor = (residual: number, axis: 'x' | 'y'): number => {
          const zoom = ownZoom(cont) || 1;
          const before = probeScreenPos(probe);
          const probePx = 12;
          if (axis === 'x') {
            addShift(-probePx, 0);
          } else {
            addShift(0, -probePx);
          }
          const after = probeScreenPos(probe);
          if (axis === 'x') {
            addShift(probePx, 0);
          } else {
            addShift(0, probePx);
          }
          const moved = before && after && axis === 'x' ? after.x - before.x : before && after ? after.y - before.y : 0;
          const response = moved / (-probePx * zoom);
          const factor = Math.abs(response) > 0.05 ? response : 0.5;
          return -residual / (factor * zoom);
        };
        for (let pass = 0; pass < 4; pass++) {
          const now = probeScreenPos(probe);
          if (!now) {
            break;
          }
          const rx = now.x - expected.x;
          const ry = now.y - expected.y;
          residual = [round1(rx), round1(ry)];
          if (Math.abs(rx) < 1 && Math.abs(ry) < 1) {
            break;
          }
          const undo = captureViewSnapshot();
          applyPan(rx, ry);
          const after = probeScreenPos(probe);
          if (!after) {
            restoreViewSnapshot(undo);
            residual = [round1(rx), round1(ry)];
            break;
          }
          const nx = after.x - expected.x;
          const ny = after.y - expected.y;
          let remainX = nx;
          let remainY = ny;
          let shiftedThisPass = false;
          // The residual is the probe's error, so the content has to move by
          // minus that. Where the scroll has no range to take it, a margin on
          // the container moves instead; how far the content actually moves per
          // local px of margin depends on the content (a centered page moves
          // half of it, flush-left content all of it), so the response is
          // measured once and the exact margin is then applied.
          if (Math.abs(rx) >= 1 && Math.abs(nx) > Math.abs(rx) * 0.5 && shiftPassesX < 2) {
            restoreViewSnapshot(undo, 'x');
            remainX = 0;
            shiftPassesX += 1;
            shiftedThisPass = true;
            addShift(shiftFor(rx, 'x'), 0);
          }
          if (Math.abs(ry) >= 1 && Math.abs(ny) > Math.abs(ry) * 0.5 && shiftPassesY < 2) {
            restoreViewSnapshot(undo, 'y');
            remainY = 0;
            shiftPassesY += 1;
            shiftedThisPass = true;
            addShift(0, shiftFor(ry, 'y'));
          }
          residual = [round1(remainX), round1(remainY)];
          if (shiftedThisPass) {
            continue;
          }
          if (Math.abs(nx) < 1 && Math.abs(ny) < 1) {
            break;
          }
          if (Math.abs(nx) > Math.abs(rx) * 0.75 || Math.abs(ny) > Math.abs(ry) * 0.75) {
            break;
          }
        }
      }
    }
    return { pan, probe: probe ? probe.kind : null, residual };
  }

  // Diagnostic snapshot of the scroll chain (innermost first) plus the
  // window, for the dblclick anchor beacon — rounded for readable console.
  function snapScrollState(chain: Element[]): string {
    const parts = [`win:${Math.round(window.scrollX)},${Math.round(window.scrollY)}`];
    for (const el of chain) {
      const cls =
        typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/)[0]}` : '';
      parts.push(`${el.tagName.toLowerCase()}${cls}:${Math.round(el.scrollLeft)},${Math.round(el.scrollTop)}`);
    }
    return parts.join(' | ');
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
          savedView = null;
          fittedZoom = null;
          resetShift();
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

  // Double-click toggles 150% zoom (office formats opt in via options),
  // anchored at the cursor: the content point under the pointer stays put.
  // The second double-click is a view restore, not another anchored zoom: it
  // puts back the zoom and every scroll offset captured before the zoom-in,
  // so going back always lands on the region the user zoomed in from.
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
      // fittedZoom is deliberately left alone: refitForOverlays already bails
      // while the zoom toggle is active (savedZoom !== null), and keeping the
      // value means a zoom that came from the pane fit is still recognised as
      // such after the restore, so panels and resizes keep re-fitting.
      const prevZoom = curZoom;
      const restoring = savedZoom !== null;
      const result = computeDblClickZoom(curZoom, savedZoom);

      if (restoring) {
        savedZoom = null;
        const snapshot = savedView;
        savedView = null;
        setZoom(result.zoom);
        const complete = snapshot ? restoreViewSnapshot(snapshot) : false;
        console.log('[ovp:dblclick]', {
          build: window.__OVP_BUILD__?.bundle ?? '?',
          leg: 'out',
          pointer: [e.clientX, e.clientY],
          zoom: [Math.round(prevZoom * 1000) / 1000, Math.round(result.zoom * 1000) / 1000],
          restored: snapshot
            ? {
                win: [Math.round(snapshot.winX), Math.round(snapshot.winY)],
                complete,
              }
            : null,
          scrollAfter: snapScrollState(snapshot ? snapshot.chain.map((entry) => entry.el) : []),
        });
        showTip(`Zoom: ${Math.round(result.zoom * 100)}%`);
        return;
      }

      // Zoom-in leg: snapshot the view first (the second double-click puts it
      // back), then let the shared anchored zoom do the work.
      const cont = getContainer();
      scrollChain = collectScrollChain(target);
      savedView = captureViewSnapshot();
      const scrollBefore = snapScrollState(scrollChain);
      savedZoom = result.saved;
      const outcome = anchorZoom(result.zoom, e.clientX, e.clientY, target);
      // Anchor beacon: every input to the compensation plus the scroll state
      // before/after, so one pasted console line decides between stale build /
      // handler-not-run / wrong pan / pan-overwritten. `residual` is the
      // probe's own verdict on the result in px, near zero when the pointer
      // anchor actually held. The zoom above is container-relative; a nested
      // wrapper may carry its own CSS zoom (e.g. the pptx deck fit), so the
      // effective on-screen scale is reported as container x first-child.
      console.log('[ovp:dblclick]', {
        build: window.__OVP_BUILD__?.bundle ?? '?',
        leg: 'in',
        pointer: [e.clientX, e.clientY],
        zoom: [Math.round(prevZoom * 1000) / 1000, Math.round(result.zoom * 1000) / 1000],
        effectiveZoom:
          Math.round(ownZoom(cont) * ownZoom(cont?.firstElementChild) * 1000) / 1000,
        pan: outcome.pan,
        probe: outcome.probe,
        residual: outcome.residual,
        shift: [
          Math.round(shiftLocalX * (ownZoom(cont) || 1)),
          Math.round(shiftLocalY * (ownZoom(cont) || 1)),
        ],
        scrollBefore,
        scrollAfter: snapScrollState(scrollChain),
      });
      scrollChain = [];
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
    // Re-fitting is a re-layout of the whole view, so any content offset a
    // zoom left behind goes with it — the fit's own geometry is authoritative.
    resetShift();
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
    // A pane toggled while a content offset is in place: recompose the margin
    // with the pane's new share (the fit below bails out while zoomed, so this
    // is the only place that can).
    applyShift();
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

  // Ctrl / Cmd + Mouse Wheel zoom, anchored at the middle of the view: the
  // content point at the center of the pane stays there, so zooming grows out
  // of (and shrinks into) what the user is looking at rather than from the
  // top-left corner.
  window.addEventListener(
    'wheel',
    (e: WheelEvent) => {
      if (isMarpPreview()) {
        return;
      }
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        // A pinch on a precision touchpad arrives as ctrl+wheel; clearing
        // savedZoom here silently breaks the next dblclick's restore, so the
        // clobber is logged to make interference visible in the field.
        if (savedZoom !== null) {
          console.log('[ovp:wheel] cleared savedZoom', {
            saved: Math.round(savedZoom * 1000) / 1000,
            deltaY: e.deltaY,
          });
        }
        savedZoom = null;
        savedView = null;
        fittedZoom = null;
        const centerX = Math.round(window.innerWidth / 2);
        const centerY = Math.round(window.innerHeight / 2);
        const outcome = anchorZoom(
          computeWheelZoom(curZoom, e.deltaY),
          centerX,
          centerY,
          document.elementFromPoint(centerX, centerY)
        );
        scrollChain = [];
        // One line per tick would drown the console; report only the ticks
        // where the anchor could not be honoured exactly.
        if (
          outcome.residual &&
          (Math.abs(outcome.residual[0]) > 2 || Math.abs(outcome.residual[1]) > 2)
        ) {
          console.log('[ovp:wheel] anchor', {
            zoom: Math.round(curZoom * 1000) / 1000,
            pan: outcome.pan,
            probe: outcome.probe,
            residual: outcome.residual,
            shift: [
              Math.round(shiftLocalX * (ownZoom(getContainer()) || 1)),
              Math.round(shiftLocalY * (ownZoom(getContainer()) || 1)),
            ],
          });
        }
        showTip(`Zoom: ${Math.round(curZoom * 100)}%`);
      }
    },
    { passive: false }
  );
}
