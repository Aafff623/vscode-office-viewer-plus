const INITIAL_ROWS = 1000;
const ROW_INCREMENT = 5000;

export interface DelimitedTextParser {
  readonly done: boolean;
  nextRows(limit: number): string[][];
}

export function renderCsv(bytes: Uint8Array, container: HTMLElement): void {
  renderDelimitedText(bytes, container, ',');
}

export function renderTsv(bytes: Uint8Array, container: HTMLElement): void {
  renderDelimitedText(bytes, container, '\t');
}

function renderDelimitedText(
  bytes: Uint8Array,
  container: HTMLElement,
  delimiter: string
): void {
  const decoded = decodeDelimitedText(bytes);
  const parser = createDelimitedTextParser(decoded.text, delimiter);

  const pane = document.createElement('div');
  pane.className = 'xlsx-sheet csv-sheet';
  container.appendChild(pane);

  const firstRows = parser.nextRows(INITIAL_ROWS);
  if (firstRows.length === 0) {
    pane.textContent = 'No data available.';
    return;
  }

  if (decoded.fallbackUsed) {
    const note = document.createElement('div');
    note.className = 'encoding-note';
    note.textContent =
      'This file is not valid UTF-8; it was decoded as Shift_JIS. Characters may be wrong if it uses another encoding.';
    pane.appendChild(note);
  }

  const table = document.createElement('table');
  const tbody = document.createElement('tbody');
  table.appendChild(tbody);

  const controls = document.createElement('div');
  controls.className = 'csv-controls';
  const count = document.createElement('span');
  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'csv-more';
  more.textContent = 'Load more';
  controls.appendChild(count);
  controls.appendChild(more);

  pane.appendChild(controls);
  pane.appendChild(table);

  let renderedRows = 0;

  const appendRows = (rows: string[][]) => {
    const fragment = document.createDocumentFragment();
    for (const row of rows) {
      fragment.appendChild(createRow(row));
    }
    tbody.appendChild(fragment);
    renderedRows += rows.length;
    count.textContent = `Showing ${renderedRows.toLocaleString()} rows`;
    more.style.display = parser.done ? 'none' : 'inline-block';
  };

  more.addEventListener('click', () => appendRows(parser.nextRows(ROW_INCREMENT)));
  appendRows(firstRows);
}

function createRow(values: string[]): HTMLTableRowElement {
  const tr = document.createElement('tr');
  for (const value of values) {
    const td = document.createElement('td');
    td.textContent = value;
    tr.appendChild(td);
  }
  return tr;
}

export function createDelimitedTextParser(
  text: string,
  delimiter: string
): DelimitedTextParser {
  if (delimiter.length !== 1 || delimiter === '"' || delimiter === '\r' || delimiter === '\n') {
    throw new Error('Delimiter must be a single non-quote, non-newline character.');
  }

  let index = 0;
  let row: string[] = [];
  let value = '';
  let fieldStarted = false;
  let quoted = false;
  let done = false;

  return {
    get done() {
      return done;
    },
    nextRows(limit: number): string[][] {
      const rows: string[][] = [];

      while (!done && rows.length < limit) {
        if (index >= text.length) {
          if (fieldStarted || value.length > 0 || row.length > 0) {
            row.push(value);
            rows.push(row);
          }
          done = true;
          break;
        }

        const ch = text[index++];

        if (quoted) {
          if (ch === '"') {
            if (text[index] === '"') {
              value += '"';
              index++;
            } else {
              quoted = false;
            }
          } else {
            value += ch;
          }
          continue;
        }

        if (ch === '"' && value.length === 0) {
          fieldStarted = true;
          quoted = true;
        } else if (ch === delimiter) {
          row.push(value);
          value = '';
          fieldStarted = false;
        } else if (ch === '\n') {
          row.push(value);
          rows.push(row);
          row = [];
          value = '';
          fieldStarted = false;
        } else if (ch !== '\r') {
          fieldStarted = true;
          value += ch;
        }
      }

      return rows;
    },
  };
}

export interface DecodedDelimitedText {
  text: string;
  encoding: 'utf-8' | 'utf-16le' | 'utf-16be' | 'shift_jis';
  /** True when UTF-8 decoding failed and Shift_JIS was used as a fallback. */
  fallbackUsed: boolean;
}

export function decodeDelimitedText(bytes: Uint8Array): DecodedDelimitedText {
  // TextDecoder strips the matching leading BOM itself.
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return {
      text: new TextDecoder('utf-16le').decode(bytes),
      encoding: 'utf-16le',
      fallbackUsed: false,
    };
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return {
      text: new TextDecoder('utf-16be').decode(bytes),
      encoding: 'utf-16be',
      fallbackUsed: false,
    };
  }
  try {
    return {
      text: stripBom(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
      encoding: 'utf-8',
      fallbackUsed: false,
    };
  } catch {
    return {
      text: new TextDecoder('shift_jis').decode(bytes),
      encoding: 'shift_jis',
      fallbackUsed: true,
    };
  }
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
