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
const { computeDblClickZoom, computeWheelZoom, DBLCLICK_ZOOM, MIN_ZOOM, MAX_ZOOM } =
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
