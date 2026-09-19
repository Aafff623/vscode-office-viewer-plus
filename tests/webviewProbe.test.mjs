import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('./harness/webview-probe.js', import.meta.url), 'utf8');

// Execute the paste-in probe itself. Geometry and frame timing are controlled
// here; browser layout correctness belongs to the real webview harness.
function createPreview({ text = true, inside = true, geometry = 'standard', nestedZoom = 1 } = {}) {
  const rect = { left: 390, top: 288, width: 20, height: 18 };
  const node = { nodeType: 3, data: 'Text', isConnected: true };
  const element = { isConnected: true, getBoundingClientRect: () => ({ ...rect }) };
  const container = { contains: (value) => inside && (value === node || value === element) };
  element.parentElement = container;
  node.parentElement = element;
  const listeners = new Map();
  const frames = new Map();
  const timers = new Map();
  const logs = [];
  let nextId = 0;
  let zoom = 1;
  const window = {
    innerWidth: 800,
    innerHeight: 600,
    addEventListener(type, callback, capture) {
      const entries = listeners.get(type) || [];
      entries.push({ callback, capture });
      listeners.set(type, entries);
    },
  };
  const context = {
    window,
    navigator: { userAgent: 'probe-test' },
    console: { log: (...args) => logs.push(args) },
    document: {
      documentElement: { appendChild() {} },
      createElement: () => {
        const marker = { style: { zoom: '1', setProperty(name, value) { this[name] = value; } },
          remove() {},
          getBoundingClientRect: () => ({ width: geometry === 'unknown' ? 0 : 40 * (geometry === 'legacy' ? 1 : +marker.style.zoom) }),
        };
        return marker;
      },
      getElementById: () => container,
      caretRangeFromPoint: () => text ? { startContainer: node, startOffset: 0 } : null,
      elementFromPoint: () => element,
      createRange: () => ({
        setStart() {},
        setEnd() {},
        getClientRects: () => [{ ...rect }],
      }),
    },
    getComputedStyle: (el) => ({ zoom: String(el === container ? zoom : el === element ? nestedZoom : 1) }),
    requestAnimationFrame: (callback) => { frames.set(++nextId, callback); return nextId; },
    cancelAnimationFrame: (id) => frames.delete(id),
    setTimeout: (callback) => { timers.set(++nextId, callback); return nextId; },
    clearTimeout: (id) => timers.delete(id),
  };
  runInNewContext(source, context, { filename: 'webview-probe.js' });
  function flush(queue) {
    const callbacks = [...queue.values()];
    queue.clear();
    callbacks.forEach((callback) => callback());
  }
  return {
    api: window.__ovpProbe,
    logs,
    rect,
    setZoom: (value) => { zoom = value; },
    beacon: (leg) => context.console.log('[ovp:dblclick]', { leg, residual: [0, 0] }),
    dispatch(type, properties, app = () => {}) {
      const event = { clientX: 400, clientY: 300, ctrlKey: false, metaKey: false, ...properties };
      const entries = listeners.get(type) || [];
      entries.filter(({ capture }) => capture).forEach(({ callback }) => callback(event));
      app();
      entries.filter(({ capture }) => !capture).forEach(({ callback }) => callback(event));
    },
    frame: () => flush(frames),
    idle: () => flush(timers),
    last: () => JSON.parse(JSON.stringify(window.__ovpProbe.last())),
  };
}

test('double-click measures layout drift after dispatch and retains the immediate result', () => {
  const preview = createPreview();
  preview.dispatch('dblclick', {}, () => {
    preview.setZoom(1.5);
    Object.assign(preview.rect, { left: 385, top: 282 });
    preview.beacon('in');
  });
  assert.deepEqual(preview.last().immediateError, [0, 0]);
  assert.equal(preview.last().sampling, 'pending');

  preview.frame();
  // Model browser scroll/layout that runs after the synchronous app handler.
  preview.rect.top -= 26;
  preview.frame();
  assert.deepEqual(preview.last().error, [0, -26]);
  assert.deepEqual(preview.last().immediateError, [0, 0]);
  assert.equal(preview.last().sampling, 'settled');
  assert.equal(preview.api.events.length, 1);
});

test('restore reports do not require a wheel centre or invent a pointer anchor error', () => {
  const preview = createPreview();
  preview.setZoom(1.5);
  preview.dispatch('dblclick', {}, () => {
    preview.setZoom(1);
    preview.rect.top += 200;
    preview.beacon('out');
  });
  preview.frame();
  preview.frame();
  assert.equal(preview.last().kind, 'dblclick-restore');
  assert.equal(preview.last().error, null);
  assert.equal(preview.last().immediateError, null);
  assert.doesNotThrow(() => preview.api.report());
  assert.ok(preview.logs.some(([message]) => message.includes('dblclick-restore | pointer 400,300')));
});

test('wheel batches scale the original glyph offset instead of treating it as drift', () => {
  const preview = createPreview();
  preview.dispatch('wheel', { ctrlKey: true }, () => {
    preview.setZoom(1.2);
    Object.assign(preview.rect, { left: 388, top: 285.6 });
  });
  preview.dispatch('wheel', { ctrlKey: true }, () => {
    preview.setZoom(1.5);
    Object.assign(preview.rect, { left: 385, top: 282 });
  });
  preview.idle();
  assert.equal(preview.api.events.length, 1);
  assert.deepEqual(preview.last().error, [0, 0]);
  assert.deepEqual(preview.last().zoom, [1, 1.5]);

  preview.dispatch('wheel', { metaKey: true }, () => {
    preview.setZoom(2.25);
    Object.assign(preview.rect, { left: 377.5, top: 265 });
  });
  preview.idle();
  assert.deepEqual(preview.last().error, [0, -8]);
});

test('box probes follow the same fractional position through zoom', () => {
  const preview = createPreview({ text: false });
  Object.assign(preview.rect, { left: 200, top: 100, width: 400, height: 400 });
  preview.dispatch('wheel', { ctrlKey: true }, () => {
    preview.setZoom(1.5);
    Object.assign(preview.rect, { left: 100, top: 0, width: 600, height: 600 });
  });
  preview.idle();
  assert.equal(preview.last().probe, 'box');
  assert.deepEqual(preview.last().error, [0, 0]);
});

test('beacons from an earlier restore do not classify an unrelated double-click', () => {
  const preview = createPreview();
  preview.beacon('out');
  preview.dispatch('dblclick', {});
  assert.equal(preview.last().kind, 'dblclick');
  assert.equal(preview.last().appResidual, null);
});

test('a later gesture interrupts pending measurements instead of changing earlier errors', () => {
  const preview = createPreview();
  preview.dispatch('dblclick', {});
  preview.frame();
  preview.dispatch('wheel', { ctrlKey: true }, () => { preview.rect.top += 80; });
  preview.frame();
  assert.equal(preview.last().sampling, 'interrupted');
  assert.deepEqual(preview.last().error, [0, 0]);
});

test('reset cancels pending wheel and frame samples', () => {
  const preview = createPreview();
  preview.dispatch('wheel', { ctrlKey: true });
  preview.dispatch('dblclick', {});
  preview.api.reset();
  preview.idle();
  preview.frame();
  preview.frame();
  assert.equal(preview.api.events.length, 0);
  assert.equal(preview.api.beacons.length, 0);
  assert.equal(preview.api.last(), null);
});

test('caret hits outside preview content are not used as zoom probes', () => {
  const preview = createPreview({ inside: false });
  preview.dispatch('wheel', { ctrlKey: true });
  preview.idle();
  assert.equal(preview.last().probe, null);
  assert.equal(preview.last().error, null);
});

for (const geometry of ['standard', 'legacy']) {
  test(`${geometry} rectangles preserve a correctly anchored caret under nested CSS zoom`, () => {
    const preview = createPreview({ geometry, nestedZoom: 2 });
    assert.equal(preview.api.geometry.mode, geometry);
    const beforeScale = geometry === 'legacy' ? 2 : 1;
    Object.assign(preview.rect, { left: 390 / beforeScale, top: 288 / beforeScale });
    preview.dispatch('dblclick', {}, () => {
      preview.setZoom(1.5);
      const afterScale = geometry === 'legacy' ? 3 : 1;
      Object.assign(preview.rect, { left: 385 / afterScale, top: 282 / afterScale });
      preview.beacon('in');
    });
    preview.frame(); preview.frame();
    assert.deepEqual(preview.last().error, [0, 0]);
  });

  test(`${geometry} box probes use screen coordinates for their fractional anchor`, () => {
    const preview = createPreview({ geometry, nestedZoom: 2, text: false });
    const beforeScale = geometry === 'legacy' ? 2 : 1;
    Object.assign(preview.rect, { left: 200 / beforeScale, top: 100 / beforeScale, width: 400 / beforeScale, height: 400 / beforeScale });
    preview.dispatch('wheel', { ctrlKey: true }, () => {
      preview.setZoom(1.5);
      const afterScale = geometry === 'legacy' ? 3 : 1;
      Object.assign(preview.rect, { left: 100 / afterScale, top: 0, width: 600 / afterScale, height: 600 / afterScale });
    });
    preview.idle();
    assert.equal(preview.last().probe, 'box');
    assert.deepEqual(preview.last().error, [0, 0]);
  });
}

test('legacy rectangles expose a false pass when the app anchors the unscaled Range coordinates', () => {
  const preview = createPreview({ geometry: 'legacy' });
  preview.dispatch('dblclick', {}, () => {
    preview.setZoom(1.5);
    // These raw coordinates look anchored only if their missing CSS zoom is
    // ignored. The visible glyph corner is actually (577.5, 423).
    Object.assign(preview.rect, { left: 385, top: 282 });
    preview.beacon('in');
  });
  preview.frame(); preview.frame();
  assert.deepEqual(preview.last().appResidual, [0, 0]);
  assert.deepEqual(preview.last().error, [192.5, 141]);
});

test('unknown rectangle semantics do not produce a misleading anchoring verdict', () => {
  const preview = createPreview({ geometry: 'unknown' });
  preview.dispatch('wheel', { ctrlKey: true });
  preview.idle();
  assert.equal(preview.api.geometry.mode, 'unknown');
  assert.equal(preview.last().probe, null);
  assert.equal(preview.last().error, null);
});
