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
const {
  computeDblClickZoom,
  computeWheelZoom,
  computeZoomAnchorPan,
  computeOverlayZoom,
  planPan,
  expectedProbeScreenPos,
  DBLCLICK_ZOOM,
  MIN_ZOOM,
  MAX_ZOOM,
} = await import(moduleUrl);

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
  // Cursor 200px right / 100px down of the container origin, origin unmoved.
  const into = computeZoomAnchorPan(200, 100, 0, 0, 1.0, 1.5);
  assert.ok(Math.abs(into.dx - 100) < 1e-9);
  assert.ok(Math.abs(into.dy - 50) < 1e-9);

  const out = computeZoomAnchorPan(200, 100, 0, 0, 1.5, 1.0);
  // Zoom-out ratio is 1/1.5 - 1 = -1/3, not symmetric with zoom-in.
  assert.ok(Math.abs(out.dx - 200 * (1 / 1.5 - 1)) < 1e-9);
  assert.ok(Math.abs(out.dy - 100 * (1 / 1.5 - 1)) < 1e-9);
});

test('zoom anchor pan is zero at the container origin or without a zoom change', () => {
  const atOrigin = computeZoomAnchorPan(0, 0, 0, 0, 1.0, 1.5);
  assert.equal(atOrigin.dx, 0);
  assert.equal(atOrigin.dy, 0);

  const sameZoom = computeZoomAnchorPan(200, 100, 0, 0, 1.0, 1.0);
  assert.equal(sameZoom.dx, 0);
  assert.equal(sameZoom.dy, 0);
});

test('zoom anchor pan absorbs an origin shift that coincided with the zoom', () => {
  // A scrollbar appearing moved the origin 8px left / 17px up between the
  // two measurements: the pan must add that shift on top of the scaled gap.
  const { dx, dy } = computeZoomAnchorPan(200, 100, -8, -17, 1.0, 1.5);
  assert.ok(Math.abs(dx - (-8 + 100)) < 1e-9);
  assert.ok(Math.abs(dy - (-17 + 50)) < 1e-9);
});

test('zoom anchor pan keeps the layout point under the cursor invariant', () => {
  // (cursorX - rect.left) / zoom is the layout coordinate under the cursor;
  // after applying the pan and the new zoom it must be unchanged.
  const clientX = 300;
  const rectLeft = 100;
  const oldZoom = 1.0;
  const newZoom = 1.5;
  const { dx } = computeZoomAnchorPan(clientX - rectLeft, 0, 0, 0, oldZoom, newZoom);
  const rectLeftAfter = rectLeft - dx;
  assert.ok(
    Math.abs((clientX - rectLeft) / oldZoom - (clientX - rectLeftAfter) / newZoom) < 1e-9
  );
});

test('pan plan converts a visual delta into an inner scroller\'s local units', () => {
  // The pane carries CSS zoom 1.5, so one unit of its scroll offset moves the
  // content 1.5 visual px: a 120px visual pan must write 80 local units.
  const plan = planPan(120, 60, [{ scale: 1.5, x: 10, y: 20, maxX: 500, maxY: 500 }]);
  assert.equal(plan.targets.length, 1);
  assert.equal(plan.targets[0].x, 90);
  assert.equal(plan.targets[0].y, 60);
  assert.equal(plan.window.x, 0);
  assert.equal(plan.window.y, 0);
});

test('pan plan hands the residue to the window when an inner scroller clamps', () => {
  const plan = planPan(120, 60, [{ scale: 1.5, x: 0, y: 0, maxX: 30, maxY: 10 }]);
  assert.equal(plan.targets[0].x, 30);
  assert.equal(plan.targets[0].y, 10);
  // 120 - 30*1.5 = 75 visual px left for the window.
  assert.equal(plan.window.x, 75);
  assert.equal(plan.window.y, 45);
});

test('pan plan lets a scale-1 target absorb the whole delta and leaves the window at zero', () => {
  const withTarget = planPan(-40, 25, [{ scale: 1, x: 100, y: 100, maxX: 500, maxY: 500 }]);
  assert.equal(withTarget.targets[0].x, 60);
  assert.equal(withTarget.targets[0].y, 125);
  assert.equal(withTarget.window.x, 0);
  assert.equal(withTarget.window.y, 0);

  const noTargets = planPan(-40, 25, []);
  assert.equal(noTargets.window.x, -40);
  assert.equal(noTargets.window.y, 25);
});

test('pan plan walks an outer scroller with the residue and clamps per target', () => {
  const plan = planPan(100, 0, [
    { scale: 1, x: 0, y: 0, maxX: 40, maxY: 0 },
    { scale: 2, x: 0, y: 0, maxX: 100, maxY: 0 },
  ]);
  assert.equal(plan.targets[0].x, 40); // clamped at its own range
  assert.equal(plan.targets[1].x, 30); // (100-40)/2 local units
  assert.equal(plan.window.x, 0);
});

test('pan plan clamps at zero and never scrolls a target backwards past it', () => {
  const plan = planPan(-100, 0, [{ scale: 1, x: 10, y: 0, maxX: 500, maxY: 0 }]);
  assert.equal(plan.targets[0].x, 0);
  assert.equal(plan.window.x, -90);
});

test('probe expectation places a probed point by scaling it about the pointer', () => {
  // A probe exactly under the pointer stays there...
  const atPointer = expectedProbeScreenPos(300, 400, 300, 400, 1.5);
  assert.equal(atPointer.x, 300);
  assert.equal(atPointer.y, 400);

  // ...and a probe 20px right / 10px down sits 1.5x that distance afterwards.
  const offset = expectedProbeScreenPos(300, 400, 320, 410, 1.5);
  assert.equal(offset.x, 330);
  assert.equal(offset.y, 415);
});

test('overlay fit returns 1.0 when the content already fits or within tolerance', () => {
  assert.equal(computeOverlayZoom(1000, 1000), 1.0);
  assert.equal(computeOverlayZoom(1000, 1002), 1.0); // +2px rounding tolerance
  assert.equal(computeOverlayZoom(0, 5000), 1.0); // degenerate measurement
});

test('overlay fit scales down by the overflow ratio with a 1% margin', () => {
  const zoom = computeOverlayZoom(980, 1000);
  assert.ok(Math.abs(zoom - (980 / 1000) * 0.99) < 1e-9);
  assert.ok(zoom < 1 && zoom > MIN_ZOOM);
});

test('overlay fit clamps extreme overflow at MIN_ZOOM', () => {
  assert.equal(computeOverlayZoom(400, 100000), MIN_ZOOM);
});
