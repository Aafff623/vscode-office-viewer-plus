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

const { packBlocks } = await bundleModule('src/webview/docxPaginate.ts');

test('packBlocks fills pages greedily without exceeding capacity', () => {
  // 1000 capacity, blocks of 400: 400+400 fits, the third rolls over.
  assert.deepEqual(packBlocks([400, 400, 400], 1000), [[0, 1], [2]]);
  // Everything fits on one page.
  assert.deepEqual(packBlocks([100, 200, 300], 1000), [[0, 1, 2]]);
  // Empty input produces no pages.
  assert.deepEqual(packBlocks([], 1000), []);
  // A block exactly at capacity plus tolerance stays on the page.
  assert.deepEqual(packBlocks([1004], 1000), [[0]]);
});

test('packBlocks gives oversized blocks a page of their own', () => {
  // The 2000px table cannot share; it lands alone between two normal pages.
  assert.deepEqual(packBlocks([300, 2000, 300], 1000), [[0], [1], [2]]);
  // Two oversized blocks never share a page either.
  assert.deepEqual(packBlocks([2000, 2000], 1000), [[0], [1]]);
});

test('packBlocks preserves order and never drops blocks', () => {
  const heights = [120, 120, 120, 120, 120, 120, 120, 120, 120, 120];
  const pages = packBlocks(heights, 500);
  const flat = pages.flat();
  assert.deepEqual(flat, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]); // order kept, nothing lost
  for (const page of pages) {
    const sum = page.reduce((acc, index) => acc + heights[index], 0);
    assert.ok(sum <= 500 + 4, `page weight ${sum} exceeds capacity`);
  }
});
