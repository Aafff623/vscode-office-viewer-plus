import * as pdfjsLib from 'pdfjs-dist';
import { computePdfFitScale } from './pdfScale';
import { applyPdfPolyfills, PDF_WORKER_POLYFILL_SOURCE } from './pdfPolyfills';

declare global {
  interface Window {
    __PDF_WORKER_SRC__?: string;
    __PDF_WASM_URL__?: string;
    __PDF_CMAP_URL__?: string;
    __PDF_STDFONT_URL__?: string;
  }
}

applyPdfPolyfills();

/**
 * pdf.js 6 builds its worker as an ES module. A module Worker cannot be
 * constructed from a cross-origin script URL, and the VS Code webview resource
 * (vscode-cdn.net) is a different origin than the webview document. So we
 * fetch the worker bytes (cross-origin fetch is permitted), prepend the
 * polyfills (the worker runs in the same old Chromium as the page), and hand
 * pdf.js the running worker via `workerPort` — pdf.js's own bootstrap would
 * try to import the cross-origin URL from inside a blob wrapper and stall.
 */
async function ensureWorker(): Promise<void> {
  const workerOptions = pdfjsLib.GlobalWorkerOptions;
  if (workerOptions.workerPort || workerOptions.workerSrc) {
    return;
  }
  const src = window.__PDF_WORKER_SRC__;
  if (!src) {
    return;
  }
  try {
    const response = await fetch(src);
    const code = await response.text();
    const blobUrl = URL.createObjectURL(
      new Blob([PDF_WORKER_POLYFILL_SOURCE, '\n', code], { type: 'text/javascript' })
    );
    workerOptions.workerPort = new Worker(blobUrl, { type: 'module', name: 'pdfjs-worker' });
  } catch {
    // Fall back to the direct URI; pdf.js will degrade to a main-thread worker.
    workerOptions.workerSrc = src;
  }
}

export async function renderPdf(bytes: Uint8Array, container: HTMLElement): Promise<void> {
  await ensureWorker();

  const loadingTask = pdfjsLib.getDocument({
    data: bytes,
    // Where the JBIG2/JPX/QCMS WASM decoders live (trailing slash required).
    wasmUrl: window.__PDF_WASM_URL__,
    // CJK CMap tables and standard-font data, fetched on demand.
    cMapUrl: window.__PDF_CMAP_URL__,
    cMapPacked: true,
    standardFontDataUrl: window.__PDF_STDFONT_URL__,
  });
  const pdf = await loadingTask.promise;

  const outputScale = window.devicePixelRatio || 1;

  let fitScale = 1.0;
  if (pdf.numPages > 0) {
    const firstPage = await pdf.getPage(1);
    const baseViewport = firstPage.getViewport({ scale: 1.0 });
    const viewportWidth =
      container.clientWidth ||
      window.innerWidth ||
      document.documentElement.clientWidth ||
      800;
    fitScale = computePdfFitScale(viewportWidth, baseViewport.width);
  }

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: fitScale });

    const canvas = document.createElement('canvas');
    canvas.className = 'pdf-page';
    canvas.width = Math.floor(viewport.width * outputScale);
    canvas.height = Math.floor(viewport.height * outputScale);
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;
    container.appendChild(canvas);

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      continue;
    }
    const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined;
    // pdf.js 6 requires the canvas element itself (canvasContext alone is
    // deprecated in the render parameters).
    await page.render({ canvas, canvasContext: ctx, viewport, transform }).promise;
  }
}
