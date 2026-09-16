import assert from 'node:assert/strict';
import test from 'node:test';
import { writeFileSync, readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as XLSX from 'xlsx';

// Guards the capability the .xls registration relies on: the SheetJS build
// shipped with the extension must parse legacy BIFF8 workbooks (Excel
// 97-2003). If a dependency swap ever drops the BIFF reader, this fails.
test('SheetJS parses legacy BIFF8 .xls workbooks', () => {
  const dir = mkdtempSync(join(tmpdir(), 'xls-legacy-'));
  const file = join(dir, 'roundtrip.xls');
  const rows = [
    ['产品', '数量', '单价'],
    ['笔记本', 12, 5999],
    ['键盘', 25, 299],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), '数据');
  writeFileSync(file, XLSX.write(wb, { type: 'buffer', bookType: 'biff8' }));

  const back = XLSX.read(readFileSync(file), { type: 'buffer' });
  assert.deepEqual(back.SheetNames, ['数据']);
  const aoa = XLSX.utils.sheet_to_json(back.Sheets['数据'], { header: 1 });
  assert.deepEqual(aoa[0], ['产品', '数量', '单价']);
  assert.deepEqual(aoa[1], ['笔记本', 12, 5999]);
  assert.deepEqual(aoa[2], ['键盘', 25, 299]);
});
