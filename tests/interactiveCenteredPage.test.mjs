import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import * as esbuild from 'esbuild';

const bundle = await esbuild.build({
  entryPoints: ['src/webview/interactive.ts'], bundle: true, format: 'iife',
  globalName: 'Interactive', platform: 'browser', target: 'es2021', write: false,
});

// Match the real PDF's 833px canvas, 16px padding and 1127px layout viewport.
// CSS auto margins center a fitting page but become zero when it overflows.
// Negative container margins increase its available width, so one correction
// can cross that boundary. Scroll writes round to whole screen pixels and
// reads clamp offsets after a layout change, as in the recorded VS Code host.
function centeredPage(geometry) {
  const listeners = new Map();
  const logs = [];
  let sx = 0;
  let sy = 0;
  class Element {
    constructor(parent = null) {
      this.parentElement = parent;
      this.style = {};
      this.tagName = 'DIV';
      this.isConnected = true;
      this.scrollLeft = this.scrollTop = 0;
      this.clientWidth = this.scrollWidth = 1127;
      this.clientHeight = this.scrollHeight = 4808;
      this.classList = { contains: () => false, add() {}, remove() {} };
    }
    contains(other) {
      for (let el = other; el; el = el.parentElement) if (el === this) return true;
      return false;
    }
    closest() { return null; }
    appendChild(el) { el.parentElement = this; }
    remove() { this.isConnected = false; }
    getBoundingClientRect() {
      if (this === canvas) return apiRect(this, pageRect());
      if (this === container) return apiRect(this, {
        left: margin('x') * z() - window.scrollX, top: margin('y') * z() - window.scrollY,
        width: 1127 - margin('x') * z(), height: 4808 * z(),
      });
      const zoom = Number(this.style.zoom || 1);
      return apiRect(this, { left: -10000, top: 0, width: 16 * zoom, height: 16 * zoom });
    }
  }
  const html = new Element();
  const body = new Element(html);
  const container = new Element(body);
  const canvas = new Element(container);
  canvas.tagName = 'CANVAS';
  container.firstElementChild = canvas;
  const z = () => Number(container.style.zoom || 1);
  const margin = axis => parseFloat(container.style[axis === 'x' ? 'marginLeft' : 'marginTop'] || 0);
  function pageLeft() {
    const offset = margin('x') * z();
    const available = 1127 - offset - 32 * z();
    return offset + 16 * z() + Math.max(0, (available - 833 * z()) / 2);
  }
  const maxX = () => Math.max(0, Math.ceil(pageLeft() + 833 * z() - 1127));
  const maxY = () => Math.max(0, Math.ceil((margin('y') + 4808) * z() - 677));
  // Avoid a floating fraction (172.49999999999994) changing a half-pixel tie.
  const clamp = (value, max) => Math.max(0, Math.min(Math.round(value + 1e-9), max));
  const window = {
    innerWidth: 1142, innerHeight: 677,
    get scrollX() { return sx = clamp(sx, maxX()); },
    get scrollY() { return sy = clamp(sy, maxY()); },
    scrollTo(x, y) { sx = clamp(x, maxX()); sy = clamp(y, maxY()); },
    scrollBy(x, y) { this.scrollTo(this.scrollX + x, this.scrollY + y); },
    addEventListener(name, callback) {
      listeners.set(name, [...(listeners.get(name) || []), callback]);
    },
    getComputedStyle(el) {
      return { zoom: el.style.zoom || '1', overflowX: 'visible', overflowY: 'visible', position: 'static', top: 'auto' };
    },
  };
  function pageRect() {
    return { left: pageLeft() - window.scrollX, top: (margin('y') + 16) * z() - window.scrollY,
      width: 833 * z(), height: 1178 * z() };
  }
  function apiRect(el, rect) {
    let divisor = 1;
    if (geometry === 'legacy') {
      for (let current = el; current; current = current.parentElement) divisor *= Number(current.style.zoom || 1);
    }
    return Object.fromEntries(Object.entries(rect).map(([key, value]) => [key, value / divisor]));
  }
  const document = {
    body, documentElement: html, activeElement: null,
    addEventListener() {}, getElementById: () => container,
    createElement: () => new Element(), elementFromPoint: () => canvas,
    caretRangeFromPoint: () => null,
  };
  const context = { window, document, Element, console: { log: (...args) => logs.push(args) },
    setTimeout: () => 1, clearTimeout() {} };
  runInNewContext(bundle.outputFiles[0].text, context);
  context.Interactive.setupOfficeInteractive(container, { doubleClickZoom: true });
  return {
    window, logs, pageRect,
    snapshot: () => ({ zoom: z(), scroll: [window.scrollX, window.scrollY],
      margin: [container.style.marginLeft || '', container.style.marginTop || ''] }),
    materialAt(point) {
      const rect = pageRect();
      return { x: (point.x - rect.left) / rect.width, y: (point.y - rect.top) / rect.height };
    },
    physicalPoint(material) {
      const rect = pageRect();
      return { x: rect.left + material.x * rect.width, y: rect.top + material.y * rect.height };
    },
    dispatch(type, point, extra = {}) {
      const event = { target: canvas, clientX: point.x, clientY: point.y,
        preventDefault() {}, stopPropagation() {}, ...extra };
      for (const callback of listeners.get(type) || []) callback(event);
    },
  };
}

function assertAnchored(actual, expected) {
  for (const axis of ['x', 'y']) assert.ok(Math.abs(actual[axis] - expected[axis]) < 1,
    `${axis}: physical error ${actual[axis] - expected[axis]}px`);
}

for (const geometry of ['standard', 'legacy']) {
  for (const pointer of [{ x: 834, y: 258 }, { x: 314, y: 345 }]) {
    test(`${geometry}: centered PDF page anchors (${pointer.x}, ${pointer.y}) across overflow and pixel-rounded scrolling`, () => {
      const view = centeredPage(geometry);
      const before = view.snapshot();
      assert.equal(view.pageRect().left, 147);
      const material = view.materialAt(pointer);
      view.dispatch('dblclick', pointer);
      const actual = view.physicalPoint(material);
      assertAnchored(actual, pointer);
      const beacon = view.logs.findLast(entry => entry[0] === '[ovp:dblclick]')[1];
      assert.ok(Math.abs(beacon.residual[0] - (actual.x - pointer.x)) <= 0.051);
      assert.ok(Math.abs(beacon.residual[1] - (actual.y - pointer.y)) <= 0.051,
        'diagnostics must report the final measured error, including scroll rounding');
      view.dispatch('dblclick', { x: 547, y: 408 });
      assert.deepEqual(view.snapshot(), before);

      for (const deltaY of [-100, -100, -100, -100, -100, 100, 100, 100, 100, 100]) {
        const center = { x: 571, y: 338.5 };
        const centeredMaterial = view.materialAt(center);
        view.dispatch('wheel', pointer, { ctrlKey: true, deltaY });
        assertAnchored(view.physicalPoint(centeredMaterial), center);
      }
    });
  }
}
