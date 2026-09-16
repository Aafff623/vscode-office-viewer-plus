import * as XLSX from 'xlsx';

/** Parses a cell text as a number, or null when it is not purely numeric. */
function parseNumeric(text: string): number | null {
  const cleaned = text.replace(/[,\s]/g, '');
  if (cleaned === '') {
    return null;
  }
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

/**
 * Compares two cell texts for column sorting: numeric when both sides parse
 * as numbers, otherwise locale-aware collation with digit runs compared
 * numerically ("item2" < "item10"). Inputs are trimmed, so whitespace-only
 * cells compare equal to empty ones.
 */
export function compareCellValues(a: string, b: string): number {
  const ta = a.trim();
  const tb = b.trim();
  const na = parseNumeric(ta);
  const nb = parseNumeric(tb);
  if (na !== null && nb !== null) {
    return na - nb;
  }
  return ta.localeCompare(tb, undefined, { numeric: true, sensitivity: 'base' });
}

function cellText(row: HTMLTableRowElement, column: number): string {
  return row.cells[column]?.textContent?.trim() ?? '';
}

/** Reorders the body rows for `column`; Array.prototype.sort is stable, so
 * equal keys keep their original order. */
function sortRows(tbody: HTMLTableSectionElement, column: number, ascending: boolean): void {
  const rows = Array.from(tbody.rows);
  const direction = ascending ? 1 : -1;
  rows.sort(
    (ra, rb) => direction * compareCellValues(cellText(ra, column), cellText(rb, column))
  );
  const fragment = document.createDocumentFragment();
  for (const row of rows) {
    fragment.appendChild(row);
  }
  tbody.appendChild(fragment);
}

/**
 * Promotes the first row into a sticky, clickable `<thead>` header and wires
 * per-column sorting (click, Enter/Space). The first row is treated as the
 * header, matching how spreadsheets are read by default. sheet_to_html emits
 * every cell as `<td>` — including the header row — so the promoted cells are
 * rebuilt as real `<th>` elements (attributes and styles carried over); the
 * sticky/sort styles key off `thead th`.
 */
function makeSortable(table: HTMLTableElement): void {
  const tbody = table.tBodies[0];
  const headRow = tbody?.rows[0];
  if (!tbody || !headRow || headRow.cells.length === 0) {
    return;
  }
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  for (const cell of Array.from(headRow.cells)) {
    const th = document.createElement('th');
    for (const attribute of Array.from(cell.attributes)) {
      th.setAttribute(attribute.name, attribute.value);
    }
    th.append(...Array.from(cell.childNodes));
    headerRow.appendChild(th);
  }
  thead.appendChild(headerRow);
  table.insertBefore(thead, tbody);
  headRow.remove();

  let sortedColumn = -1;
  let ascending = true;

  Array.from(headerRow.cells).forEach((th, column) => {
    th.tabIndex = 0;
    th.title = 'Sort by this column';
    const apply = () => {
      if (sortedColumn === column) {
        ascending = !ascending;
      } else {
        sortedColumn = column;
        ascending = true;
      }
      sortRows(tbody, column, ascending);
      Array.from(headerRow.cells).forEach((cell, index) => {
        cell.querySelector('.xlsx-sort-indicator')?.remove();
        cell.removeAttribute('aria-sort');
        if (index === column) {
          cell.setAttribute('aria-sort', ascending ? 'ascending' : 'descending');
          const indicator = document.createElement('span');
          indicator.className = 'xlsx-sort-indicator';
          indicator.textContent = ascending ? ' ▲' : ' ▼';
          cell.appendChild(indicator);
        }
      });
    };
    th.addEventListener('click', apply);
    th.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        apply();
      }
    });
  });
}

export function appendWorksheetTable(worksheet: XLSX.WorkSheet, container: HTMLElement): void {
  // sheet_to_html returns a full <html> document; extract just the <table>
  // rather than injecting <html>/<head>/<body> into a <div>.
  const html = XLSX.utils.sheet_to_html(worksheet, { editable: false });
  const table = new DOMParser().parseFromString(html, 'text/html').querySelector('table');
  if (!table) {
    return;
  }
  // Import first, then wire sorting: importNode deep-clones the tree and a
  // clone does not carry the event listeners, so listeners must be attached
  // to the live copy.
  const imported = document.importNode(table, true);
  container.appendChild(imported);
  makeSortable(imported);
}
