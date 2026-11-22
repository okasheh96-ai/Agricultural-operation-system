// Builds test workbooks on the fly (clearly test fixtures; never farm data).
import ExcelJS from 'exceljs';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(process.cwd(), 'test-results', 'fixtures');
export async function workbook(name: string, sheets: Record<string, (string | number | null)[][]>): Promise<string> {
  mkdirSync(DIR, { recursive: true });
  const wb = new ExcelJS.Workbook();
  for (const [s, rows] of Object.entries(sheets)) {
    const ws = wb.addWorksheet(s);
    for (const r of rows) ws.addRow(r);
  }
  const p = join(DIR, name);
  await wb.xlsx.writeFile(p);
  return p;
}
