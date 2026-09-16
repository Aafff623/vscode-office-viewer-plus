import { renderAsync } from 'docx-preview';
import { paginateDocxPages } from './docxPaginate';
import { enhanceDocxTocLayout } from './docxToc';

/** The library's tab-stop pass (+500ms) and our TOC fallback (+800ms) change
 * line heights, so page packing waits for both to land first. */
const PAGINATION_SETTLE_MS = 1000;

export async function renderDocx(bytes: Uint8Array, container: HTMLElement): Promise<void> {
  await renderAsync(bytes, container, undefined, {
    className: 'docx',
    inWrapper: true,
    ignoreWidth: false,
    ignoreHeight: false,
    breakPages: true,
    useBase64URL: true,
    // Compute real tab stops: the library then right-aligns text after a tab
    // to the stop position and draws a dotted-underline leader — this is what
    // renders Word TOC dot leaders correctly.
    experimental: true,
    // Read-only display of comments (highlighted ranges + hover popovers via
    // the CSS Custom Highlight API) and tracked changes (strikethrough for
    // deletions, underlines for insertions).
    renderComments: true,
    renderChanges: true,
  });

  // Fallback pass for TOC lines whose tab stops the library could not
  // resolve (runs delayed, after the library's own +500ms tab pass).
  enhanceDocxTocLayout(container);

  // docx-preview only breaks pages at explicit page breaks; chapters without
  // them render as one continuous white page. Re-pack overflowing sections
  // into real page-sized sections once the layout has settled.
  await new Promise((resolve) => setTimeout(resolve, PAGINATION_SETTLE_MS));
  paginateDocxPages(container);
}
