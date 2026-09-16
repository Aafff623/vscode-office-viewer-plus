import { mount } from './bootstrap';
import { renderDocx } from './docx';
import { setupDocxOutline } from './docxOutline';
import { setupDocxSearch } from './docxSearch';
import { rasterizeDomPage } from './domRaster';
import { setupPagePane } from './thumbs';

mount(renderDocx, {
  doubleClickZoom: true,
  afterRender: (container, host) => {
    const destroys = [
      setupPagePane(container, host, { rasterizeDomPage })?.destroy,
      setupDocxOutline(container, host)?.destroy,
      setupDocxSearch(container)?.destroy,
    ];
    return () => destroys.forEach((destroy) => destroy?.());
  },
});
