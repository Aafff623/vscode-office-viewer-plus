import { marked } from 'marked';
import mermaid from 'mermaid';
import DOMPurify from 'dompurify';
import type { RenderContext } from './bootstrap';
import { rewriteResourceUrls } from './resourceUri';

export async function renderMarkdown(
  bytes: Uint8Array,
  container: HTMLElement,
  context: RenderContext = {}
): Promise<void> {
  const text = new TextDecoder().decode(bytes);

  // Show a notice if Marp slide front matter is detected
  // (Marp slides can be viewed with "Reopen Editor With..." -> "Office File Preview (Marp Slides)"
  //  or by naming the file *.marp.md)
  const isMarp = /^---\s*\n[\s\S]*?marp:\s*true[\s\S]*?\n---/m.test(text);
  if (isMarp) {
    const notice = document.createElement('div');
    notice.style.cssText = 'padding:16px;background:#fff3cd;border:1px solid #ffc107;border-radius:8px;margin:16px;font-size:14px;color:#856404;';
    notice.innerHTML = `
      <strong>💡 Marp Slides Detected</strong><br><br>
      To preview as interactive slides:<br>
      • Rename the file to <code>*.marp.md</code><br>
      • Or right-click → "Reopen Editor With..." → select "Office File Preview (Marp Slides)"<br>
      <br>
      <small>Rendering as standard Markdown below</small>
    `;
    container.appendChild(notice);
  }

  const isDark =
    document.body.classList.contains('vscode-dark') ||
    document.body.classList.contains('vscode-high-contrast');

  mermaid.initialize({
    startOnLoad: false,
    theme: isDark ? 'dark' : 'default',
    securityLevel: 'loose',
  });

  // Pull out mermaid code blocks before handing off to marked so they are not
  // HTML-escaped. Each block is replaced with a placeholder <div>. Up to three
  // leading spaces, tilde fences, and a space before the info string are all
  // valid markdown that must still render as a diagram.
  const mermaidDefs: string[] = [];
  const preprocessed = text.replace(
    /^[ \t]{0,3}(`{3,}|~{3,})[ \t]*mermaid\b[^\n]*\r?\n([\s\S]*?)^[ \t]{0,3}\1[ \t]*$/gm,
    (_, fence: string, definition: string) => {
      const index = mermaidDefs.length;
      mermaidDefs.push(definition.trim());
      return `<div class="mermaid-placeholder" data-mermaid-index="${index}"></div>`;
    }
  );

  const article = document.createElement('article');
  article.className = 'markdown-body';
  // marked does not sanitize; DOMPurify is the second line of defense behind
  // the webview CSP. The mermaid placeholders (div/class/data-*) survive it.
  article.innerHTML = DOMPurify.sanitize(marked.parse(preprocessed) as string);
  if (context.baseUri) {
    rewriteResourceUrls(article, context.baseUri);
  }
  container.appendChild(article);

  // Render each mermaid placeholder in document order.
  const placeholders = article.querySelectorAll<HTMLElement>('.mermaid-placeholder');
  for (const el of placeholders) {
    const index = parseInt(el.dataset.mermaidIndex ?? '0', 10);
    const definition = mermaidDefs[index];
    if (!definition) {
      continue;
    }
    try {
      const { svg } = await mermaid.render(`mermaid-md-${index}`, definition);
      el.innerHTML = svg;
      el.className = 'mermaid-wrap';
    } catch (err) {
      el.className = 'mermaid-error';
      el.textContent = String(err);
    }
  }
}
