export const PDF_MIN_VIEWPORT_WIDTH = 320;
export const PDF_VIEWPORT_PADDING = 48;
export const PDF_MIN_SCALE = 0.4;
export const PDF_MAX_SCALE = 1.4;

/**
 * Initial PDF render scale: fit the first page's width into the available
 * viewport, clamped so narrow splits stay legible and wide monitors don't
 * blow the page up absurdly.
 */
export function computePdfFitScale(viewportWidth: number, pageWidth: number): number {
  const availW = Math.max(
    PDF_MIN_VIEWPORT_WIDTH,
    (viewportWidth || 800) - PDF_VIEWPORT_PADDING
  );
  return Math.max(PDF_MIN_SCALE, Math.min(PDF_MAX_SCALE, availW / pageWidth));
}
