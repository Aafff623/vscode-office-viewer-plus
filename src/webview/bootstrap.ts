import { setupOfficeInteractive, type InteractiveOptions } from './interactive';
import { isAbsoluteOrSpecialUrl } from './resourceUri';
import type { PaneHost } from './thumbs';

export interface RenderContext {
  fileName?: string;
  baseUri?: string;
}

/**
 * A renderer may return a teardown function (e.g. to detach global listeners)
 * which is invoked before the next render replaces the container contents.
 */
export type TeardownFn = () => void;

export interface MountOptions extends InteractiveOptions {
  /**
   * Runs after each successful render — used by the paginated formats to
   * mount the page thumbnail pane. Kept as a hook (rather than always-on in
   * mount) so thumbs.ts and its html2canvas dependency stay out of the
   * bundles of formats that never show a pane. May return a cleanup
   * function invoked before the next render.
   */
  afterRender?: (container: HTMLElement, host: PaneHost) => TeardownFn | void;
}

type RenderFn = (
  bytes: Uint8Array,
  container: HTMLElement,
  context: RenderContext
) => void | TeardownFn | Promise<void | TeardownFn>;

declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  setState(state: unknown): void;
  getState(): unknown;
};

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Shared webview bootstrap: wires up the host <-> webview handshake and hands
 * the decoded file bytes to a single format-specific renderer. Each format has
 * its own entry point so only that format's libraries are bundled and loaded.
 */
export function mount(render: RenderFn, options: MountOptions = {}): void {
  const vscode = acquireVsCodeApi();
  const statusEl = document.getElementById('status') as HTMLElement;
  const containerEl = document.getElementById('container') as HTMLElement;

  setupOfficeInteractive(containerEl, options);

  // Relative links cannot resolve inside the webview's random origin; hand
  // them to the host, which opens the target from the document's directory.
  containerEl.addEventListener('click', (e) => {
    const anchor = (e.target as HTMLElement | null)?.closest?.('a[href]');
    if (!anchor) {
      return;
    }
    const href = anchor.getAttribute('href') ?? '';
    if (!href || isAbsoluteOrSpecialUrl(href)) {
      return;
    }
    e.preventDefault();
    vscode.postMessage({ type: 'openRelative', path: href });
  });

  let teardown: TeardownFn | null = null;
  let afterRenderCleanup: TeardownFn | null = null;

  const setStatus = (text: string | null) => {
    if (text === null) {
      statusEl.style.display = 'none';
    } else {
      statusEl.style.display = 'block';
      statusEl.textContent = text;
    }
  };

  window.addEventListener('message', async (event: MessageEvent) => {
    const msg = event.data;
    if (!msg) {
      return;
    }
    if (msg.type === 'error') {
      setStatus(`Failed to load file: ${msg.message}`);
      return;
    }
    if (msg.type !== 'render') {
      return;
    }

    teardown?.();
    afterRenderCleanup?.();
    teardown = null;
    afterRenderCleanup = null;
    containerEl.innerHTML = '';
    setStatus('Rendering preview…');
    try {
      const result = await render(base64ToBytes(msg.data), containerEl, {
        fileName: msg.fileName,
        baseUri: msg.baseUri,
      });
      teardown = typeof result === 'function' ? result : null;
      afterRenderCleanup = options.afterRender?.(containerEl, vscode) ?? null;
      setStatus(null);
    } catch (err) {
      setStatus(
        `Failed to generate preview: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  });

  vscode.postMessage({ type: 'ready' });
}
