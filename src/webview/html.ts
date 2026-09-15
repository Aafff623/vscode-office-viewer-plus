export async function renderHtml(bytes: Uint8Array, container: HTMLElement): Promise<void> {
  const text = new TextDecoder().decode(bytes);
  const blob = new Blob([text], { type: 'text/html' });
  const url = URL.createObjectURL(blob);

  const iframe = document.createElement('iframe');
  // A blob: document inherits the webview's CSP (script-src is nonce-only), so
  // the previewed page's own scripts never execute — the preview is static.
  // The sandbox mirrors that honestly: no allow-scripts, and no
  // allow-same-origin, which together with allow-scripts would let a clever
  // page reach back into the webview DOM. allow-popups keeps target="_blank"
  // links usable.
  iframe.setAttribute('sandbox', 'allow-popups');
  iframe.src = url;
  iframe.className = 'html-frame';
  container.appendChild(iframe);

  iframe.addEventListener('load', () => URL.revokeObjectURL(url), { once: true });
}
