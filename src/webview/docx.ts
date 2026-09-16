import { renderAsync } from 'docx-preview';
import { enhanceDocxTocLayout } from './docxToc';

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
}
