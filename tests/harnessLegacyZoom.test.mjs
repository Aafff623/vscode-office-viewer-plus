import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('./harness/anchor-repro.html', import.meta.url), 'utf8');
const script = html.match(/<script id="legacy-zoom-compat">([\s\S]*?)<\/script>/)[1];

function boot({ mode = 'standard', requested = true, rootZoom = 1 } = {}) {
  class Rect {
    constructor(x, y, width, height) { Object.assign(this, { x, y, width, height }); }
    get left() { return this.x; }
    get top() { return this.y; }
    get right() { return this.x + this.width; }
    get bottom() { return this.y + this.height; }
  }
  const zoomOf = (el) => {
    const text = String(el.style.zoom ?? el.style.cssText?.match(/zoom:([\d.]+)/)?.[1] ?? 1);
    return parseFloat(text) / (text.endsWith('%') ? 100 : 1);
  };
  const effective = (el) => el ? zoomOf(el) * effective(el.parentElement) : 1;
  const rect = (values, scale = 1) => new Rect(...values.map((value) => value * scale));
  class Element {
    constructor(zoom = 1, parentElement = null) {
      this.nodeType = 1;
      this.style = { zoom };
      this.parentElement = parentElement;
      this.children = [];
      this.scrollLeft = 31;
      this.scrollTop = 67;
      this.clientWidth = 100;
      this.scrollWidth = 500;
      this.viewportRect = [63, -27, 120, 42];
    }
    appendChild(el) { el.parentElement = this; this.children.push(el); }
    remove() { this.parentElement.children = this.parentElement.children.filter((el) => el !== this); }
    querySelectorAll() { return this.children.flatMap((el) => [el, ...el.querySelectorAll('*')]); }
    getBoundingClientRect() {
      const scale = effective(this);
      if (this.marker) {
        const own = zoomOf(this);
        return rect([10, 10, 40, 20], mode === 'legacy' ? 1 : mode === 'unknown' ? 1 + (own - 1) / 2 : scale);
      }
      return rect(this.viewportRect, mode === 'legacy' ? 1 / scale : 1);
    }
    getClientRects() { return [ElementNativeRect.call(this)]; }
  }
  const ElementNativeRect = Element.prototype.getBoundingClientRect;
  class Range {
    constructor(owner) { this.commonAncestorContainer = owner; this.viewportRect = [72, 36, 12, 18]; }
    intersectsNode() { return true; }
    getBoundingClientRect() {
      const node = this.commonAncestorContainer;
      const owner = node.nodeType === 3 ? node.parentElement : node;
      return rect(this.viewportRect, mode === 'legacy' ? 1 / effective(owner) : 1);
    }
    getClientRects() { return [RangeNativeRect.call(this)]; }
  }
  const RangeNativeRect = Range.prototype.getBoundingClientRect;
  const native = [Element.prototype.getBoundingClientRect, Element.prototype.getClientRects,
    Range.prototype.getBoundingClientRect, Range.prototype.getClientRects];
  const documentElement = new Element(rootZoom);
  const document = {
    documentElement,
    createElement() { const el = new Element(); el.style = {}; el.marker = true; return el; },
  };
  const context = { Element, Range, DOMRect: Rect, document, URLSearchParams,
    location: { search: requested ? '?legacyZoom=1' : '' },
    getComputedStyle: (el) => ({ zoom: zoomOf(el) }),
  };
  context.window = context;
  vm.runInNewContext(script, context, { filename: 'anchor-repro.html#legacy-zoom-compat' });
  return { ...context, geometry: context.__OVP_HARNESS_GEOMETRY__, native, documentElement };
}

const values = (rect) => [rect.left, rect.top, rect.width, rect.height].map((v) => Math.round(v * 1e9) / 1e9);

test('default standard mode preserves native APIs and cleans up the sentinel', () => {
  const env = boot({ requested: false });
  const { Element, Range, native, geometry, documentElement } = env;
  assert.deepEqual([Element.prototype.getBoundingClientRect, Element.prototype.getClientRects,
    Range.prototype.getBoundingClientRect, Range.prototype.getClientRects], native);
  assert.equal(geometry.metadata.nativeMode, 'standard');
  assert.equal(geometry.metadata.shimInstalled, false);
  assert.equal(documentElement.children.length, 0);
});

test('legacy shim scales origins and sizes by all ancestor zooms; independent readings stay on screen', () => {
  const { Element, Range, geometry, documentElement } = boot({ rootZoom: 1.25 });
  const parent = new Element('150%', documentElement);
  const el = new Element(0.8, parent); // Effective CSS zoom = 1.5.
  assert.equal(geometry.metadata.nativeMode, 'standard');
  assert.equal(geometry.metadata.activeMode, 'legacy');
  assert.equal(geometry.metadata.shimInstalled, true);
  assert.deepEqual(values(el.getBoundingClientRect()), [42, -18, 80, 28]);
  assert.deepEqual(values(el.getClientRects().item(0)), [42, -18, 80, 28]);
  assert.equal(el.getClientRects().item(1), null);
  assert.deepEqual(values(geometry.elementRect(el)), [63, -27, 120, 42]);
  assert.deepEqual([el.scrollLeft, el.scrollTop, el.clientWidth, el.scrollWidth], [31, 67, 100, 500]);
  const text = { nodeType: 3, parentElement: el };
  const range = new Range(text);
  assert.deepEqual(values(range.getBoundingClientRect()), [48, 24, 8, 12]);
  assert.deepEqual(values(range.getClientRects()[0]), [48, 24, 8, 12]);
  assert.deepEqual(values(geometry.rangeRects(range)[0]), [72, 36, 12, 18]);
  el.style.zoom = 1;
  assert.equal(el.getBoundingClientRect().width, 64); // Fresh factor, not a cached 1.5.
});

test('a native legacy host is never divided twice and measurements normalize its native rects', () => {
  const { Element, Range, native, geometry, documentElement } = boot({ mode: 'legacy', rootZoom: 1.25 });
  const el = new Element(2, documentElement);
  assert.deepEqual([Element.prototype.getBoundingClientRect, Element.prototype.getClientRects,
    Range.prototype.getBoundingClientRect, Range.prototype.getClientRects], native);
  assert.equal(geometry.metadata.nativeMode, 'legacy');
  assert.equal(geometry.metadata.shimInstalled, false);
  assert.deepEqual(values(el.getBoundingClientRect()), [25.2, -10.8, 48, 16.8]);
  assert.deepEqual(values(geometry.elementRect(el)).map((v) => Math.round(v * 100) / 100), [63, -27, 120, 42]);
  const range = new Range({ nodeType: 3, parentElement: el });
  assert.deepEqual(values(geometry.rangeRects(range)[0]), [72, 36, 12, 18]);
});

test('unknown rectangle semantics invalidate the run without installing a shim', () => {
  const { geometry } = boot({ mode: 'unknown' });
  assert.equal(geometry.metadata.nativeMode, 'unknown');
  assert.equal(geometry.metadata.shimInstalled, false);
  assert.equal(geometry.metadata.valid, false);
  assert.match(geometry.metadata.warnings[0], /Unrecognized/);
});

test('mixed-zoom ranges explicitly invalidate simulation instead of silently claiming coverage', () => {
  const { Element, Range, geometry, documentElement } = boot();
  const owner = new Element(1.5, documentElement);
  owner.appendChild(new Element(0.8));
  new Range(owner).getClientRects();
  assert.equal(geometry.metadata.valid, false);
  assert.match(geometry.metadata.warnings[0], /Mixed-zoom Range/);
});

test('all scenario geometry reads use the independent viewport adapter', () => {
  const scenarios = html.slice(html.indexOf('(async () => {'));
  assert.doesNotMatch(scenarios, /\.get(?:BoundingClientRect|ClientRects)\(/);
  assert.match(scenarios, /geometry: geometry\.metadata/);
  assert.match(scenarios, /anchor-repro:invalid-geometry/);
});
