import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import * as esbuild from 'esbuild';

const bundle = await esbuild.build({
  entryPoints: ['src/webview/interactive.ts'],
  bundle: true,
  format: 'iife',
  globalName: 'Interactive',
  platform: 'browser',
  target: 'es2021',
  write: false,
});

// A small layout model, not a second implementation of anchorZoom. Its
// physical positions come from local content coordinates, zoom and scrolling.
// Only the DOMRect *readout* differs between standard Blink and VS Code's
// legacy mode. Assertions measure physical content points, never the beacon.
// Real engine layout, rounding and delayed anchoring still need webview tests.
function preview({ geometry, nestedZoom = 1, probe = 'caret', clippedSheet = false,
  stickyHeader = false, sheetTop = 52, outerRange = null, foreignOverlay = false, stickyPosition = 'sticky' }) {
  const listeners = new Map();
  const logs = [];
  let markersCreated = 0;
  let markersRemoved = 0;
  let glyph = { x: 0, y: 0 };
  const window = {
    innerWidth: 1200, innerHeight: 800, scrollX: clippedSheet ? 0 : 70, scrollY: clippedSheet ? 0 : 90,
    addEventListener(type, callback) {
      listeners.set(type, [...(listeners.get(type) || []), callback]);
    },
    scrollTo(x, y) {
      const z = zoom(container);
      const maxX = clippedSheet ? Math.max(0, shift('x') * z + containerWidth() - this.innerWidth) : Infinity;
      const maxY = outerRange ?? (clippedSheet ? Math.max(0, (shift('y') + sheetTop + 648) * z - this.innerHeight) : Infinity);
      this.scrollX = Math.max(0, Math.min(x, maxX));
      this.scrollY = Math.max(0, Math.min(y, maxY));
    },
    scrollBy(x, y) { this.scrollTo(this.scrollX + x, this.scrollY + y); },
    getComputedStyle(el) {
      return { zoom: el.style.zoom || '1', overflowX: el.overflow, overflowY: el.overflow,
        position: el === header ? stickyPosition : 'static', top: el === header ? '0px' : 'auto' };
    },
  };
  class Element {
    constructor(kind, parent = null) {
      this.kind = kind;
      this.parentElement = parent;
      this.style = {};
      this.tagName = 'DIV';
      this.className = '';
      this.isConnected = true;
      this.overflow = 'visible';
      this.scrollLeft = 0;
      this.scrollTop = 0;
      this.clientWidth = 900;
      this.clientHeight = 600;
      this.scrollWidth = 900;
      this.scrollHeight = 600;
      const classes = new Set();
      this.classList = {
        contains: (name) => classes.has(name),
        add: (...names) => names.forEach((name) => classes.add(name)),
        remove: (...names) => names.forEach((name) => classes.delete(name)),
      };
    }
    appendChild(el) { el.parentElement = this; return el; }
    remove() { this.isConnected = false; markersRemoved++; }
    closest() { return null; }
    contains(el) {
      for (let current = el; current; current = current.parentElement) {
        if (current === this) return true;
      }
      return false;
    }
    getBoundingClientRect() {
      if (this.kind === 'marker') {
        return readout(this, { left: -10000, top: 0, width: 16 * zoom(this), height: 16 * zoom(this) });
      }
      if (clippedSheet && this === scroller) return readout(this, clipRect());
      const origin = this === container ? containerOrigin() : contentPoint({ x: 0, y: 0 });
      const scale = this === container ? zoom(container) : contentScale();
      const width = clippedSheet ? this === container ? containerWidth() : 1800 * scale : 1600 * scale;
      return readout(this, { left: origin.x, top: origin.y, width, height: 1200 * scale });
    }
  }
  const html = new Element('html');
  const body = new Element('body', html);
  const container = new Element('container', body);
  const scroller = new Element('scroller', container);
  scroller.style.zoom = String(nestedZoom);
  scroller.overflow = 'auto';
  scroller.scrollWidth = 4900;
  scroller.scrollHeight = 4600;
  scroller.scrollLeft = 210;
  scroller.scrollTop = 145;
  const content = new Element('content', scroller);
  const header = new Element('header', foreignOverlay ? body : scroller);
  container.firstElementChild = scroller;
  const text = { nodeType: 3, data: 'A measured text glyph', parentElement: content, isConnected: true };

  if (clippedSheet) {
    let x = 0;
    let y = 0;
    // Auto-width container plus overflow:auto sheet, as in the real XLSX
    // preview. Enlarging a positive margin can collapse the clipping box even
    // though scrolled-out text still returns a plausible Range rectangle.
    Object.defineProperties(scroller, {
      clientWidth: { get: () => Math.max(0, containerWidth() / zoom(container) - 32) },
      clientHeight: { get: () => 620 },
      scrollWidth: { get() { return Math.max(1800, this.clientWidth); } },
      scrollHeight: { get: () => 5800 },
      scrollLeft: {
        get() { return x = Math.max(0, Math.min(x, this.scrollWidth - this.clientWidth)); },
        set(value) { x = Math.max(0, Math.min(value, this.scrollWidth - this.clientWidth)); },
      },
      scrollTop: {
        get() { return y = Math.max(0, Math.min(y, this.scrollHeight - this.clientHeight)); },
        set(value) { y = Math.max(0, Math.min(value, this.scrollHeight - this.clientHeight)); },
      },
    });
  }

  function zoom(el) { return Number(el.style.zoom || 1); }
  function effectiveZoom(el) {
    return zoom(el) * (el.parentElement ? effectiveZoom(el.parentElement) : 1);
  }
  function readout(el, physical) {
    const divisor = geometry === 'legacy' ? effectiveZoom(el) : 1;
    return Object.fromEntries(Object.entries(physical).map(([key, value]) => [key, value / divisor]));
  }
  function containerOrigin() {
    const z = zoom(container);
    return {
      x: (clippedSheet ? 0 : 96) + shift('x') * z - window.scrollX,
      y: (clippedSheet ? 0 : 72) + shift('y') * z - window.scrollY,
    };
  }
  function shift(axis) { return Number.parseFloat(container.style[axis === 'x' ? 'marginLeft' : 'marginTop'] || 0); }
  function containerWidth() { return Math.max(32 * zoom(container), window.innerWidth - shift('x') * zoom(container)); }
  function clipRect() {
    const origin = containerOrigin();
    const z = zoom(container);
    return { left: origin.x + 16 * z, top: origin.y + sheetTop * z, width: scroller.clientWidth * z, height: scroller.clientHeight * z };
  }
  function visible(point) {
    const clip = clipRect();
    return point.x >= clip.left && point.x < clip.left + clip.width &&
      point.y >= clip.top && point.y < clip.top + clip.height &&
      point.x >= 0 && point.x < window.innerWidth && point.y >= 0 && point.y < window.innerHeight;
  }
  function contentScale() { return zoom(container) * nestedZoom; }
  function contentPoint(local) {
    const origin = containerOrigin();
    return {
      x: origin.x + (clippedSheet ? 16 : 24) * zoom(container) + (local.x - scroller.scrollLeft) * contentScale(),
      y: origin.y + (clippedSheet ? sheetTop : 36) * zoom(container) + (local.y - scroller.scrollTop) * contentScale(),
    };
  }
  function pointAt(screen) {
    const origin = contentPoint({ x: 0, y: 0 });
    return { x: (screen.x - origin.x) / contentScale(), y: (screen.y - origin.y) / contentScale() };
  }
  function hitAt(x, y) {
    if (probe === 'none') return null;
    if (stickyHeader) {
      // Sticky geometry is an independent paint/hit model. The Range keeps
      // its position even when the frozen header paints over the data cell.
      const top = clipRect().top + Math.max(0, 8 - scroller.scrollTop) * contentScale();
      if (y >= top && y < top + 22 * contentScale()) return header;
    }
    return content;
  }
  const document = {
    body, documentElement: html, activeElement: null,
    addEventListener() {},
    getElementById: () => container,
    createElement() { markersCreated++; return new Element('marker'); },
    elementFromPoint: hitAt,
    caretRangeFromPoint: () => probe === 'caret' ? { startContainer: text, startOffset: 0 } : null,
    createRange: () => ({
      setStart() {}, setEnd() {},
      getClientRects() {
        const physical = contentPoint(glyph);
        return [readout(content, { left: physical.x, top: physical.y, width: 9 * contentScale(), height: 18 * contentScale() })];
      },
    }),
  };
  const context = {
    window, document, Element,
    console: { log: (...args) => logs.push(args) },
    setTimeout: () => 1, clearTimeout() {},
  };
  runInNewContext(bundle.outputFiles[0].text, context);
  context.Interactive.setupOfficeInteractive(container, { doubleClickZoom: true });

  return {
    window, scroller, logs, visible, clipRect, content,
    contentVisible: (point) => visible(point) && hitAt(point.x, point.y) === content,
    zoom: () => zoom(container),
    pointAt, contentPoint,
    snapshot: () => ({
      zoom: zoom(container), window: [window.scrollX, window.scrollY],
      scroll: [scroller.scrollLeft, scroller.scrollTop],
      margins: [container.style.marginLeft || '', container.style.marginTop || ''],
    }),
    markerBalance: () => [markersCreated, markersRemoved],
    dispatch(type, pointer, properties = {}) {
      // A caret is nearby, not exactly under the pointer. This catches using
      // the glyph corner itself as the requested zoom anchor.
      const anchor = type === 'wheel' ? { x: 600, y: 400 } : pointer;
      glyph = pointAt({ x: anchor.x - 7, y: anchor.y - 4 });
      const event = {
        target: content, clientX: pointer.x, clientY: pointer.y,
        preventDefault() {}, stopPropagation() {}, ...properties,
      };
      for (const callback of listeners.get(type) || []) callback(event);
    },
  };
}

for (const geometry of ['standard', 'legacy']) {
  for (const gesture of ['dblclick', 'wheel']) {
    test(`${geometry}: ${gesture} keeps the clicked cell visible below its sticky header`, () => {
      const options = { geometry, clippedSheet: true, sheetTop: gesture === 'wheel' ? 363 : 52 };
      const view = preview({ ...options, stickyHeader: true });
      const control = preview(options);
      const anchor = gesture === 'wheel' ? { x: 600, y: 400 } : { x: 53, y: 89 };
      const pointer = gesture === 'wheel' ? { x: 1100, y: 120 } : anchor;
      const local = view.pointAt(anchor);
      const before = view.snapshot();
      assert.ok(view.contentVisible(anchor));
      const properties = { ctrlKey: true, deltaY: -100 };
      view.dispatch(gesture, pointer, properties);
      control.dispatch(gesture, pointer, properties);
      assertPoint(view.contentPoint(local), anchor);
      assert.ok(view.contentVisible(anchor), 'the same data cell must win the real hit test');
      assert.ok(view.window.scrollY > control.window.scrollY, 'outer scroll must carry the occluding inner pan');
      assert.ok(control.scroller.scrollTop > before.scroll[1], 'without sticky content the inner-first behavior is unchanged');
      assert.equal(control.window.scrollY, before.window[1]);
      assert.equal(view.scroller.scrollLeft, control.scroller.scrollLeft, 'do not redistribute horizontal pan');
      assert.ok(view.scroller.scrollTop >= before.scroll[1], 'do not consume any scroll from before the gesture');
      if (gesture === 'dblclick') {
        view.dispatch('dblclick', { x: 300, y: 230 });
        assert.deepEqual(view.snapshot(), before, 'restore includes both sides of the transferred pan');
        assert.ok(view.contentVisible(anchor));
      }
    });
  }
  test(`${geometry}: a sticky transfer preserves inner scroll from before the zoom`, () => {
    const view = preview({ geometry, clippedSheet: true, stickyHeader: true });
    view.scroller.scrollTop = 37;
    const pointer = { x: 53, y: 89 };
    const local = view.pointAt(pointer);
    const before = view.snapshot();
    assert.ok(view.contentVisible(pointer));
    view.dispatch('dblclick', pointer);
    assertPoint(view.contentPoint(local), pointer);
    assert.ok(view.contentVisible(pointer));
    assert.equal(view.scroller.scrollTop, 37, 'only the newly added inner scroll may move to the window');
    view.dispatch('dblclick', { x: 300, y: 200 });
    assert.deepEqual(view.snapshot(), before);
  });
  test(`${geometry}: unrelated overlays and insufficient outer range leave the pan unchanged`, () => {
    for (const options of [{ outerRange: 0 }, { outerRange: 2 }, { foreignOverlay: true }, { stickyPosition: 'static' }]) {
      const base = { geometry, clippedSheet: true, ...options };
      const view = preview({ ...base, stickyHeader: true });
      const control = preview(base);
      const pointer = { x: 53, y: 89 };
      view.dispatch('dblclick', pointer);
      control.dispatch('dblclick', pointer);
      assert.deepEqual(view.snapshot(), control.snapshot(), 'failed or unrelated transfers must not mutate the view');
    }
  });
}

for (const geometry of ['standard', 'legacy']) {
  test(`${geometry}: zooming an auto-width sheet from 30% keeps the anchored text inside its clip`, () => {
    const view = preview({ geometry, clippedSheet: true });
    while (view.zoom() > 0.3) {
      view.dispatch('wheel', { x: 1100, y: 100 }, { ctrlKey: true, deltaY: 100 });
    }
    const pointer = { x: 790, y: 390 };
    const local = view.pointAt(pointer);
    const before = view.snapshot();
    assert.ok(view.visible(pointer), 'starting point is in the visible sheet');
    assert.ok(parseFloat(before.margins[0]) > 1000, 'small zoom needs a substantial positive offset');
    view.dispatch('wheel', pointer, { ctrlKey: true, deltaY: 100 });
    assert.deepEqual(view.snapshot(), before, 'a clamped wheel tick must retain the existing offset');

    view.dispatch('dblclick', pointer);
    assert.equal(view.zoom(), 1.5);
    assertPoint(view.contentPoint(local), pointer);
    assert.ok(view.visible(pointer), 'a zero Range residual must not hide text outside the sheet clip');
    assert.ok(view.scroller.clientWidth > 0);
    assert.ok(view.clipRect().width > 0, 'sheet must retain a nonzero clipping width');

    view.dispatch('dblclick', { x: pointer.x - 40, y: pointer.y + 30 });
    assert.deepEqual(view.snapshot(), before, 'restore must retain the original low-zoom margin and offsets');
    assertPoint(view.contentPoint(local), pointer);
    assert.ok(view.visible(pointer));
  });
}

function assertPoint(actual, expected) {
  for (const axis of ['x', 'y']) {
    assert.ok(Math.abs(actual[axis] - expected[axis]) < 0.01,
      `${axis}: content landed at ${actual[axis]}, expected ${expected[axis]}`);
  }
}

// Real VS Code at 120% window zoom delivered these fractional pointerup
// coordinates, followed 1.2ms later by an integer-coordinate dblclick.
// Exercise the actual event listeners and measure a physical material point;
// asserting only the rounded dblclick position would hide this regression.
const preciseMouse = { x: 449.34893798828125, y: 141.8489532470703 };
const roundedMouse = { x: 449, y: 141 };
const mouseInput = { isTrusted: true, isPrimary: true, pointerType: 'mouse', pointerId: 1,
  button: 0, screenX: 1579, screenY: 598, timeStamp: 100 };
const doubleInput = { isTrusted: true, detail: 2, button: 0, screenX: 1579, screenY: 598, timeStamp: 101.2 };

for (const geometry of ['standard', 'legacy']) {
  for (const probe of ['caret', 'box']) {
    test(`${geometry}: trusted fractional ${probe} double-click anchors the actual mouse point and restores`, () => {
      const view = preview({ geometry, probe, nestedZoom: 1.124 });
      while (view.zoom() > 0.3) view.dispatch('wheel', roundedMouse, { ctrlKey: true, deltaY: 100 });
      const local = view.pointAt(preciseMouse);
      const before = view.snapshot();
      view.dispatch('pointerdown', preciseMouse, { ...mouseInput, timeStamp: 80 });
      view.dispatch('pointerup', preciseMouse, mouseInput);
      view.dispatch('dblclick', roundedMouse, doubleInput);
      assertPoint(view.contentPoint(local), preciseMouse);
      const beacon = view.logs.at(-1)[1];
      assert.deepEqual([...beacon.pointer], [preciseMouse.x, preciseMouse.y]);
      assert.deepEqual([...beacon.eventPointer], [roundedMouse.x, roundedMouse.y]);
      // A second physical click at another location still undoes the original
      // view, regardless of its own fractional coordinates or intervening pan.
      view.scroller.scrollTop += 40;
      view.dispatch('pointerup', { x: 340.5, y: 310.2 }, { ...mouseInput, timeStamp: 150 });
      view.dispatch('dblclick', { x: 340, y: 310 }, { ...doubleInput, timeStamp: 151 });
      assert.deepEqual(view.snapshot(), before);
      // The release was consumed by the restore and cannot anchor a later
      // mouse/keyboard-originated dblclick at the old fractional location.
      const integerPoint = view.pointAt({ x: 340, y: 310 });
      view.dispatch('dblclick', { x: 340, y: 310 }, { ...doubleInput, timeStamp: 152 });
      assertPoint(view.contentPoint(integerPoint), { x: 340, y: 310 });
    });
  }
  test(`${geometry}: unmatched, stale and synthetic releases preserve the event-coordinate fallback`, () => {
    const cases = [
      { release: { isTrusted: false } }, { release: { isPrimary: false } },
      { release: { pointerType: 'touch' } }, { release: { pointerType: 'pen' } },
      { release: { button: 1 } }, { release: { target: {} } },
      { release: { screenX: 1577 } }, { release: { screenY: 600 } },
      { release: { clientX: 450.2 } }, { release: { clientY: 142.2 } },
      { release: { timeStamp: 102 } }, { release: { timeStamp: 0 } },
      { double: { isTrusted: false } }, { double: { detail: 0 } },
      { double: { button: 1 } }, { missing: true },
    ];
    for (const scenario of cases) {
      const view = preview({ geometry, nestedZoom: 1.124 });
      const local = view.pointAt(roundedMouse);
      if (!scenario.missing) view.dispatch('pointerup', preciseMouse, { ...mouseInput, ...scenario.release });
      view.dispatch('dblclick', roundedMouse, { ...doubleInput, ...scenario.double });
      assertPoint(view.contentPoint(local), roundedMouse);
    }
  });
  test(`${geometry}: keyboard, cancellation, new presses and drag releases cannot reuse a mouse sample`, () => {
    for (const reset of ['keydown','blur','pointercancel','pointerdown','drag']) {
      const view = preview({ geometry, nestedZoom: 1.124 });
      view.dispatch('pointerup', preciseMouse, mouseInput);
      if (reset === 'drag') {
        view.dispatch('keydown', roundedMouse, { code: 'Space', key: ' ' });
        view.dispatch('pointerdown', preciseMouse, mouseInput);
        view.dispatch('pointermove', { x: 465.3, y: 161.8 }, mouseInput);
        view.dispatch('pointerup', preciseMouse, mouseInput);
        view.dispatch('keyup', roundedMouse, { code: 'Space', key: ' ' });
      } else {
        view.dispatch(reset, roundedMouse, { key: 'Enter', pointerType: 'touch', isPrimary: true, button: 0 });
      }
      const local = view.pointAt(roundedMouse);
      view.dispatch('dblclick', roundedMouse, doubleInput);
      assertPoint(view.contentPoint(local), roundedMouse);
    }
  });
}

for (const geometry of ['standard', 'legacy']) {
  for (const nestedZoom of [1, 0.8]) {
    for (const probe of ['caret', 'box']) {
      test(`${geometry} rects, ${probe}, nested zoom ${nestedZoom}: gestures pin physical points and restore the view`, () => {
        const view = preview({ geometry, nestedZoom, probe });
        const pointer = { x: 1020, y: 510 };
        const local = view.pointAt(pointer);
        const before = view.snapshot();
        view.dispatch('dblclick', pointer);
        assert.equal(view.zoom(), 1.5);
        assertPoint(view.contentPoint(local), pointer);
        assert.equal(view.logs[0][1].probe, probe);

        // Panning and moving the second click must still restore all offsets.
        view.scroller.scrollLeft += 43;
        view.scroller.scrollTop += 57;
        view.window.scrollBy(31, 29);
        view.dispatch('dblclick', { x: 160, y: 210 });
        assert.deepEqual(view.snapshot(), before);
        assertPoint(view.contentPoint(local), pointer);

        for (const deltaY of [-100, -100, 100, -100, 100]) {
          const center = { x: 600, y: 400 };
          const centerLocal = view.pointAt(center);
          const oldZoom = view.zoom();
          // Wheel pointer deliberately differs from the viewport center.
          view.dispatch('wheel', { x: 1030, y: 160 }, { ctrlKey: true, deltaY });
          assert.notEqual(view.zoom(), oldZoom);
          assertPoint(view.contentPoint(centerLocal), center);
        }
        // Only the persistent zoom badge remains. Capability detection must
        // not leak elements or keep mutating the DOM on subsequent gestures.
        const [created, removed] = view.markerBalance();
        assert.equal(created - removed, 1);
        assert.ok(removed <= 1);
      });
    }
  }
  test(`${geometry} rects: the container origin anchors zoom even without a content probe`, () => {
    const view = preview({ geometry, probe: 'none' });
    // Starting from a nonzero window offset makes origin normalization matter.
    for (const pointer of [{ x: 170, y: 270 }, { x: 1050, y: 480 }]) {
      const local = view.pointAt(pointer);
      view.dispatch('dblclick', pointer);
      assertPoint(view.contentPoint(local), pointer);
      assert.equal(view.logs.at(-1)[1].probe, null);
      view.dispatch('dblclick', { x: 600, y: 400 });
    }
  });
}
