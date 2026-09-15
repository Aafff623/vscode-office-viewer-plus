import * as XLSX from 'xlsx';
import { appendWorksheetTable } from './sheetTable';

export function renderXlsx(bytes: Uint8Array, container: HTMLElement): void {
  const workbook = XLSX.read(bytes, { type: 'array' });

  const tabs = document.createElement('div');
  tabs.className = 'xlsx-tabs';
  const sheetsWrap = document.createElement('div');
  sheetsWrap.className = 'xlsx-sheets';

  container.appendChild(tabs);
  container.appendChild(sheetsWrap);

  if (workbook.SheetNames.length === 0) {
    sheetsWrap.textContent = 'No sheets available.';
    return;
  }

  // Sheet DOM is built lazily on first activation: eagerly constructing every
  // sheet's table freezes the webview on large workbooks.
  const rendered = new Set<number>();
  const panes: HTMLElement[] = [];
  const tabButtons: HTMLElement[] = [];

  const renderSheet = (index: number) => {
    if (rendered.has(index)) {
      return;
    }
    rendered.add(index);
    appendWorksheetTable(workbook.Sheets[workbook.SheetNames[index]], panes[index]);
  };

  const activate = (index: number) => {
    renderSheet(index);
    panes.forEach((pane, i) => {
      pane.style.display = i === index ? 'block' : 'none';
    });
    tabButtons.forEach((btn, i) => {
      btn.classList.toggle('active', i === index);
    });
  };

  workbook.SheetNames.forEach((name, index) => {
    const pane = document.createElement('div');
    pane.className = 'xlsx-sheet';
    pane.style.display = 'none';
    sheetsWrap.appendChild(pane);
    panes.push(pane);

    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'xlsx-tab';
    tab.textContent = name;
    tab.addEventListener('click', () => activate(index));
    tabs.appendChild(tab);
    tabButtons.push(tab);
  });

  activate(0);
}
