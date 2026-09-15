import assert from 'node:assert/strict';
import test from 'node:test';
import { Buffer } from 'node:buffer';
import * as esbuild from 'esbuild';

const result = await esbuild.build({
  entryPoints: ['src/webview/docxToc.ts'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2021',
  write: false,
});
const moduleUrl = `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`;
const { looksLikePageNumber, isTocStyleParagraph, looksLikeTocEntry } = await import(moduleUrl);

test('page number predicate accepts digits, romans, and a trailing dot', () => {
  assert.ok(looksLikePageNumber('3'));
  assert.ok(looksLikePageNumber(' 42 '));
  assert.ok(looksLikePageNumber('iv'));
  assert.ok(looksLikePageNumber('XLI.'));
  assert.ok(!looksLikePageNumber(''));
  assert.ok(!looksLikePageNumber('设计'));
  assert.ok(!looksLikePageNumber('1.1'));
});

test('TOC style predicate matches docx-preview escaped style classes', () => {
  const fake = (classNames) => ({ classList: classNames.split(/\s+/) });
  assert.ok(isTocStyleParagraph(fake('docx docx_TOC1')));
  assert.ok(isTocStyleParagraph(fake('docx docx_TOC3 docx-num-1-0')));
  assert.ok(isTocStyleParagraph(fake('docx docx_toc-2')));
  assert.ok(!isTocStyleParagraph(fake('docx docx_TOCHeading')));
  assert.ok(!isTocStyleParagraph(fake('docx Normal')));
});

test('TOC entry heuristic requires title text before a trailing page number', () => {
  const fake = (text) => ({ textContent: text });
  assert.ok(looksLikeTocEntry(fake('1 系统总体设计 3')));
  assert.ok(looksLikeTocEntry(fake('1.1 设计目标 IV')));
  assert.ok(!looksLikeTocEntry(fake('3')));
  assert.ok(!looksLikeTocEntry(fake('设计目标与核心矛盾')));
  // "Chapter 5" is indistinguishable from a TOC line by text alone; the real
  // guard is enhanceDocxTocLayout requiring an unresolved tab span in the
  // paragraph before this heuristic is ever consulted.
  assert.ok(looksLikeTocEntry(fake('Chapter 5')));
});
