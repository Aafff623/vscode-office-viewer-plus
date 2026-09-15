import assert from 'node:assert/strict';
import test from 'node:test';
import { Buffer } from 'node:buffer';
import * as esbuild from 'esbuild';

const result = await esbuild.build({
  entryPoints: ['src/webview/pdfScale.ts'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2021',
  write: false,
});
const moduleUrl = `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`;
const { computePdfFitScale, PDF_MAX_SCALE } = await import(moduleUrl);

const standardA4Width = 595.28;

test('narrow split pane clamps at the minimum scale and still fits', () => {
  const scale = computePdfFitScale(360, standardA4Width);
  assert.ok(scale >= 0.4 && scale <= 1.4);
  assert.ok(scale * standardA4Width <= 360 + 48);
});

test('mid-size viewports scale the page to the available width', () => {
  // (700 - 48) / 595.28 ≈ 1.095 — inside the clamp, so no capping applies.
  const scale = computePdfFitScale(700, standardA4Width);
  assert.ok(Math.abs(scale - (700 - 48) / standardA4Width) < 1e-9);
});

test('half of a full HD monitor clamps at the maximum scale', () => {
  // (960 - 48) / 595.28 ≈ 1.53 > 1.4, so the cap applies.
  assert.equal(computePdfFitScale(960, standardA4Width), PDF_MAX_SCALE);
});

test('very wide viewports are capped at the maximum scale', () => {
  assert.equal(computePdfFitScale(3840, standardA4Width), PDF_MAX_SCALE);
});

test('zero-width viewport falls back to the 800px default', () => {
  const scale = computePdfFitScale(0, standardA4Width);
  assert.ok(Math.abs(scale - (800 - 48) / standardA4Width) < 1e-9);
});
