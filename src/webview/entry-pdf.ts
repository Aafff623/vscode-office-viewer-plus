import { mount } from './bootstrap';
import { renderPdf } from './pdf';
import { setupPagePane } from './thumbs';

mount(renderPdf, {
  doubleClickZoom: true,
  afterRender: (container) => setupPagePane(container)?.destroy,
});
