import assert from 'node:assert/strict';
import test from 'node:test';
import { Buffer } from 'node:buffer';
import * as esbuild from 'esbuild';

const result = await esbuild.build({
  entryPoints: ['src/webview/interactive.ts'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2021',
  write: false,
});
const moduleUrl = `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`;
const { computeDblClickZoom, computeWheelZoom, computeZoomAnchorPan, DBLCLICK_ZOOM, MIN_ZOOM, MAX_ZOOM } =
  await import(moduleUrl);

test('interactive module bundles and keeps its DOM hooks', async () => {
  const code = Buffer.from(result.outputFiles[0].contents).toString('utf-8');
  assert.ok(code.includes('setupOfficeInteractive'));
  assert.ok(code.includes('office-interactive-zoom-badge'));
  assert.ok(code.includes('office-space-active'));
  assert.ok(code.includes('office-dragging-active'));
  assert.ok(code.includes('marp-container'));
});

test('double-click zoom jumps to 150% and remembers the previous zoom', () => {
  const first = computeDblClickZoom(1.0, null);
  assert.equal(first.zoom, DBLCLICK_ZOOM);
  assert.equal(first.saved, 1.0);
});

test('second double-click restores the remembered zoom and clears the toggle', () => {
  const second = computeDblClickZoom(DBLCLICK_ZOOM, 1.0);
  assert.equal(second.zoom, 1.0);
  assert.equal(second.saved, null);
});

test('double-click zoom pure function restores the remembered zoom', () => {
  // Pure-function semantics only: IF savedZoom survived a wheel change, a
  // double-click restores it. In the live layer the wheel handler clears
  // savedZoom, so this sequence cannot occur in the app — here it pins the
  // restore rule itself. 100% -> dblclick (150%, saved 100%) -> 180% ->
  // dblclick restores.
  let state = computeDblClickZoom(1.0, null);
  const wheeled = computeWheelZoom(state.zoom, -100);
  state = computeDblClickZoom(wheeled, state.saved);
  assert.equal(state.zoom, 1.0);
  assert.equal(state.saved, null);
});

test('Ctrl+wheel zoom steps clamp at the configured bounds', () => {
  let zoom = 1.0;
  for (let i = 0; i < 30; i++) {
    zoom = computeWheelZoom(zoom, -100);
  }
  assert.equal(zoom, MAX_ZOOM);

  for (let i = 0; i < 60; i++) {
    zoom = computeWheelZoom(zoom, 100);
  }
  assert.equal(zoom, MIN_ZOOM);
});

test('zoom anchor pan scales the cursor-to-origin gap by the zoom ratio', () => {
  // Cursor 200px right / 100px down of the container origin.
  const into = computeZoomAnchorPan(300, 200, 100, 100, 1.0, 1.5);
  assert.ok(Math.abs(into.dx - 100) < 1e-9);
  assert.ok(Math.abs(into.dy - 50) < 1e-9);

  const out = computeZoomAnchorPan(300, 200, 100, 100, 1.5, 1.0);
  // Zoom-out ratio is 1/1.5 - 1 = -1/3, not symmetric with zoom-in.
  assert.ok(Math.abs(out.dx - 200 * (1 / 1.5 - 1)) < 1e-9);
  assert.ok(Math.abs(out.dy - 100 * (1 / 1.5 - 1)) < 1e-9);
});

test('zoom anchor pan is zero at the container origin or without a zoom change', () => {
  const atOrigin = computeZoomAnchorPan(100, 100, 100, 100, 1.0, 1.5);
  assert.equal(atOrigin.dx, 0);
  assert.equal(atOrigin.dy, 0);

  const sameZoom = computeZoomAnchorPan(300, 200, 100, 100, 1.0, 1.0);
  assert.equal(sameZoom.dx, 0);
  assert.equal(sameZoom.dy, 0);
});

test('zoom anchor pan keeps the layout point under the cursor invariant', () => {
  // (cursorX - rect.left) / zoom is the layout coordinate under the cursor;
  // after applying the pan and the new zoom it must be unchanged.
  const clientX = 300;
  const rectLeft = 100;
  const oldZoom = 1.0;
  const newZoom = 1.5;
  const { dx } = computeZoomAnchorPan(clientX, 0, rectLeft, 0, oldZoom, newZoom);
  const rectLeftAfter = rectLeft - dx;
  assert.ok(
    Math.abs((clientX - rectLeft) / oldZoom - (clientX - rectLeftAfter) / newZoom) < 1e-9
  );
});
