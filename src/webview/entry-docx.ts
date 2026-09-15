import { mount } from './bootstrap';
import { renderDocx } from './docx';
import { rasterizeDomPage } from './domRaster';
import { setupPagePane } from './thumbs';

mount(renderDocx, {
  doubleClickZoom: true,
  afterRender: (container, host) =>
    setupPagePane(container, host, { rasterizeDomPage })?.destroy,
});
