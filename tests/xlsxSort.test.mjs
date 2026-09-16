import assert from 'node:assert/strict';
import test from 'node:test';
import { Buffer } from 'node:buffer';
import * as esbuild from 'esbuild';

// sheetTable.ts imports the `xlsx` library (used only inside
// appendWorksheetTable); stub it so the pure comparator can be tested
// without bundling the whole spreadsheet engine.
async function bundleWithStubbedXlsx(entryPoint) {
  const result = await esbuild.build({
    entryPoints: [entryPoint],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2021',
    write: false,
    plugins: [
      {
        name: 'stub-xlsx',
        setup(build) {
          build.onResolve({ filter: /^xlsx$/ }, () => ({ path: 'xlsx', namespace: 'stub' }));
          build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
            contents: 'export const utils = {};',
            loader: 'js',
          }));
        },
      },
    ],
  });
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`;
  return import(moduleUrl);
}

const { compareCellValues } = await bundleWithStubbedXlsx('src/webview/sheetTable.ts');

test('numeric cells compare numerically', () => {
  assert.ok(compareCellValues('9', '10') < 0);
  assert.ok(compareCellValues('100', '100') === 0);
  assert.ok(compareCellValues('1,200', '300') > 0);
  assert.ok(compareCellValues('-5', '2') < 0);
  assert.ok(compareCellValues('3.5', '3.25') > 0);
});

test('text cells compare with numeric collation', () => {
  assert.ok(compareCellValues('item2', 'item10') < 0);
  assert.ok(compareCellValues('Alpha', 'beta') < 0);
  assert.ok(compareCellValues('same', 'SAME') === 0);
});

test('mixed text and numbers fall back to text comparison', () => {
  // 'abc' is not numeric, so the pair compares as text; must not throw and
  // must be consistent with its reverse.
  const forward = compareCellValues('abc', '12');
  const backward = compareCellValues('12', 'abc');
  assert.equal(Math.sign(forward), -Math.sign(backward));
});

test('empty and whitespace cells sort as empty text', () => {
  assert.ok(compareCellValues('', '0') !== 0);
  assert.equal(compareCellValues('   ', ''), 0);
});
