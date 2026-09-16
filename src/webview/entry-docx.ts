import { mount } from './bootstrap';
import { renderDocx } from './docx';
import { setupDocxOutline } from './docxOutline';
import { setupDocxSearch } from './docxSearch';
import { rasterizeDomPage } from './domRaster';
import { setupPagePane } from './thumbs';

mount(renderDocx, {
  doubleClickZoom: true,
  afterRender: (container) => {
    const destroys = [
      setupPagePane(container, { rasterizeDomPage })?.destroy,
      setupDocxOutline(container)?.destroy,
      setupDocxSearch(container)?.destroy,
    ];
    return () => destroys.forEach((destroy) => destroy?.());
  },
});
