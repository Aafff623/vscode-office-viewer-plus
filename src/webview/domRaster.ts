import html2canvas from 'html2canvas-pro';
import { CARD_WIDTH } from './thumbs';

/**
 * Rasterize a live DOM page (a docx-preview <section>) into a real bitmap
 * thumbnail showing the actual content (text, tables, images). Kept in its
 * own module so only the docx entry — the only format needing DOM
 * rasterization — pulls html2canvas-pro into its bundle.
 */
export async function rasterizeDomPage(page: HTMLElement): Promise<HTMLCanvasElement> {
  const rect = page.getBoundingClientRect();
  const scale = CARD_WIDTH / Math.max(1, rect.width || 794);
  const canvas = await html2canvas(page, {
    scale,
    backgroundColor: '#ffffff',
    logging: false,
    // html2canvas clones the whole document for every call, which is O(total
    // pages) per thumbnail on a long document. Drop the sibling pages from
    // the clone — the render bounds are measured on the cloned element
    // (dist renderElement: parseBounds(context, clonedElement)), so the crop
    // window follows it and pruning cannot misalign the capture.
    onclone: (doc: Document, cloned: HTMLElement) => {
      doc.querySelectorAll('.docx-wrapper > section.docx').forEach((section) => {
        if (section !== cloned) {
          section.remove();
        }
      });
    },
  });
  // html2canvas writes the source element's CSS size (e.g. width:794px) as an
  // inline style on the returned canvas; that would override .page-card-canvas's
  // width:140px and blow up the pane layout. Drop it so the card CSS governs.
  canvas.style.width = '';
  canvas.style.height = '';
  canvas.className = 'page-card-canvas';
  return canvas;
}
