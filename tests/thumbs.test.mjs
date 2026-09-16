import assert from 'node:assert/strict';
import test from 'node:test';
import { Buffer } from 'node:buffer';
import * as esbuild from 'esbuild';

async function bundleModule(entryPoint) {
  const result = await esbuild.build({
    entryPoints: [entryPoint],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2021',
    write: false,
  });
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`;
  return import(moduleUrl);
}

const { pickActivePage, planRasterRetry, thumbPixelRatio } = await bundleModule('src/webview/thumbs.ts');
const { computeOverlayZoom } = await bundleModule('src/webview/interactive.ts');

test('pickActivePage selects the last page crossing the viewport line', () => {
  // Page tops in viewport coordinates; the active page is the one whose top
  // has passed the 35%-height line most recently.
  const tops = [-1200, -300, 150, 900, 2000];
  assert.equal(pickActivePage(tops, 700), 2);
  assert.equal(pickActivePage(tops, -100), 1);
  assert.equal(pickActivePage(tops, 10000), 4);
  assert.equal(pickActivePage([500, 600], 100), 0);
  assert.equal(pickActivePage([], 100), 0);
});

test('overlay zoom shrinks overflowing content, stateless and convergent', () => {
  // 1200-wide content in a 1000 viewport → shrink proportionally with a
  // 1% margin.
  const shrink = computeOverlayZoom(1000, 1200);
  assert.ok(Math.abs(shrink - (1000 / 1200) * 0.99) < 1e-9);
  // The same viewport always yields the same zoom — repeated calls converge.
  assert.equal(computeOverlayZoom(1000, 1200), shrink);
  // Content fits (scrollWidth is clamped to clientWidth when it fits) → 100%.
  assert.equal(computeOverlayZoom(1000, 1000), 1.0);
  // Within rounding distance is treated as fitting.
  assert.equal(computeOverlayZoom(1000, 1002), 1.0);
  // Invalid metrics never zoom.
  assert.equal(computeOverlayZoom(0, 1200), 1.0);
  // Never zoom below the minimum.
  assert.equal(computeOverlayZoom(100, 5000), 0.3);
});

test('planRasterRetry allows two retries then gives up', () => {
  // First and second failures are retried; after the third attempt the page
  // keeps its placeholder so a persistently failing page cannot loop.
  assert.deepEqual(planRasterRetry(0), { retry: true });
  assert.deepEqual(planRasterRetry(1), { retry: true });
  assert.deepEqual(planRasterRetry(2), { retry: false });
  assert.deepEqual(planRasterRetry(99), { retry: false });
});

test('thumbPixelRatio clamps device ratios to [1, 2]', () => {
  // 1x screens render at card width; 1.5x/2x render proportionally larger for
  // sharpness; anything above 2x (or invalid) is capped to bound pixel cost.
  assert.equal(thumbPixelRatio(1), 1);
  assert.equal(thumbPixelRatio(0.75), 1);
  assert.equal(thumbPixelRatio(1.5), 1.5);
  assert.equal(thumbPixelRatio(2), 2);
  assert.equal(thumbPixelRatio(3), 2);
  assert.equal(thumbPixelRatio(Number.NaN), 1);
});
