import { init } from 'pptx-preview';
import { convertEmfToDataUrl, convertWmfToDataUrl } from 'emf-converter';

/**
 * PowerPoint decks often embed vector images as EMF/WMF metafiles, which the
 * browser cannot display — pptx-preview hands them to <img> as blob URLs of
 * type image/x-emf / image/x-wmf, i.e. broken images. Fetch each such blob
 * back, replay the metafile records onto a canvas (emf-converter), and swap
 * in the resulting PNG data URL.
 */
async function replaceMetafileImages(container: HTMLElement): Promise<void> {
  const images = Array.from(container.querySelectorAll('img'));
  await Promise.all(
    images.map(async (img) => {
      let blob: Blob;
      try {
        blob = await fetch(img.src).then((r) => r.blob());
      } catch {
        return; // Not a fetchable blob URL (already a data/http URL).
      }
      const toPng = blob.type === 'image/x-emf' ? convertEmfToDataUrl : blob.type === 'image/x-wmf' ? convertWmfToDataUrl : null;
      if (!toPng) {
        return;
      }
      const buffer = await blob.arrayBuffer();
      // Metafiles are vectors displayed well beyond their logical bounds on
      // slides; the library's default DPI scale is 1, so render at 2x for
      // sharp output (its own clamp caps at 4x).
      const png = await toPng(buffer, { dpiScale: 2 });
      if (png) {
        img.src = png;
      }
    })
  );
}

export async function renderPptx(bytes: Uint8Array, container: HTMLElement): Promise<void> {
  // Decks render on a fixed 960px logical canvas; the library derives each
  // slide's height from the file's own aspect ratio (4:3 and 16:9 both come
  // out correct), so the init height is only the 16:9 default. The rendered
  // wrapper is then scaled to the container with CSS zoom: a fixed canvas
  // avoids measuring the container before the vertical scrollbar exists
  // (which used to leave the deck ~17px wider than the viewport), and the
  // 48px margin keeps slides off the pane edges.
  const RENDER_WIDTH = 960;
  const MARGIN = 48;

  const previewer = init(container, {
    width: RENDER_WIDTH,
    height: Math.round((RENDER_WIDTH * 9) / 16),
    mode: 'list',
  });

  // pptx-preview expects an ArrayBuffer — copy into a fresh one.
  const arrayBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(arrayBuffer).set(bytes);
  await previewer.preview(arrayBuffer);
  await replaceMetafileImages(container);

  const wrapper = container.querySelector<HTMLElement>('.pptx-preview-wrapper');
  if (wrapper) {
    const avail = Math.max(200, (container.clientWidth || RENDER_WIDTH) - MARGIN);
    wrapper.style.zoom = String(avail / RENDER_WIDTH);
  }
  // Geometry beacon (see interactive.ts dblclick beacon): viewport, applied
  // scale and slide-box facts, to diagnose on-machine layout reports.
  const firstSlide = container.querySelector<HTMLElement>('.pptx-preview-slide-wrapper');
  const slideRect = firstSlide?.getBoundingClientRect();
  console.log('[ovp:pptx]', {
    build: window.__OVP_BUILD__?.bundle ?? '?',
    viewport: [window.innerWidth, window.innerHeight],
    containerClient: [container.clientWidth, container.clientHeight],
    zoom: wrapper ? Math.round((parseFloat(wrapper.style.zoom) || 1) * 1000) / 1000 : null,
    slides: container.querySelectorAll('.pptx-preview-slide-wrapper').length,
    firstSlideRect: slideRect
      ? [slideRect.left, slideRect.top, slideRect.width, slideRect.height].map((v) =>
          Math.round(v)
        )
      : null,
    docOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  });
}
