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
  const width = container.clientWidth || 960;
  const height = Math.round((width * 9) / 16);

  const previewer = init(container, {
    width,
    height,
    mode: 'list',
  });

  // pptx-preview expects an ArrayBuffer — copy into a fresh one.
  const arrayBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(arrayBuffer).set(bytes);
  await previewer.preview(arrayBuffer);
  await replaceMetafileImages(container);
}
