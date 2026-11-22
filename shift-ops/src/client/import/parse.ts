// Reads spreadsheets and photo grids in the browser into a common Grid, inspects them (header row, subtotals,
// blank rows, merged cells) and turns mapped rows into staged-row values. Nothing is guessed silently: column
// suggestions come from header words only and the owner confirms every mapping before staging.
import type { Measure, RowVals, DimField } from '../../shared/rows';
import { normalizeDigits, parseQuantity } from '../../shared/num';
import { excelSerialToLocal, parseTimeText } from '../../shared/time';

export interface Cell { text: string; num?: number; date?: Date; ref: string; conf?: number; bbox?: [number, number, number, number] }
export interface Grid { name: string; rows: (Cell | null)[][]; merged: string[]; kind: 'sheet' | 'image' }

export function colLetter(i: number): string {
  let s = '';
  i += 1;
  while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
  return s;
}

type ExcelCellValue = null | undefined | number | string | boolean | Date | { formula?: string; result?: unknown; richText?: { text: string }[]; text?: string; error?: string; sharedFormula?: string };

function cellFrom(v: ExcelCellValue, ref: string): Cell | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return { text: String(v), num: v, ref };
  if (typeof v === 'string') return v.trim() ? { text: v.trim(), ref } : null;
  if (typeof v === 'boolean') return { text: String(v), ref };
  if (v instanceof Date) return { text: v.toISOString(), date: v, ref };
  if ('result' in v || 'formula' in v || 'sharedFormula' in v) return cellFrom(v.result as ExcelCellValue, ref);
  if (v.richText) { const s = v.richText.map((r) => r.text).join('').trim(); return s ? { text: s, ref } : null; }
  if (typeof v.text === 'string') return v.text.trim() ? { text: v.text.trim(), ref } : null;
  if (v.error) return { text: '', ref };
  return null;
}

export async function parseXlsx(buf: ArrayBuffer): Promise<Grid[]> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const grids: Grid[] = [];
  wb.eachSheet((ws) => {
    const rows: (Cell | null)[][] = [];
    const maxCol = ws.columnCount;
    for (let r = 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const cells: (Cell | null)[] = [];
      for (let c = 1; c <= maxCol; c++) {
        const cell = row.getCell(c);
        // merged cells: only the master holds the value
        const isSlave = cell.isMerged && cell.master && cell.master.address !== cell.address;
        cells.push(isSlave ? null : cellFrom(cell.value as ExcelCellValue, `${colLetter(c - 1)}${r}`));
      }
      rows.push(cells);
    }
    const merges = ((ws as unknown as { model: { merges?: string[] } }).model.merges ?? []).slice(0, 200);
    grids.push({ name: ws.name, rows, merged: merges, kind: 'sheet' });
  });
  return grids;
}

export function decodeText(buf: ArrayBuffer): string {
  const utf8 = new TextDecoder('utf-8').decode(buf);
  if (!utf8.includes('\ufffd')) return utf8.replace(/^\ufeff/, '');
  try { return new TextDecoder('windows-1256').decode(buf); } catch { return utf8; }
}

export function parseCsv(text: string, name = 'CSV'): Grid {
  const first = text.split(/\r?\n/, 1)[0] ?? '';
  const delim = [',', ';', '\t'].map((d) => [d, first.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const out: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false; } else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === delim) { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); out.push(row); row = []; cur = ''; }
    else cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); out.push(row); }
  const rows = out.map((r, ri) => r.map((v, ci) => (v.trim() ? { text: v.trim(), ref: `${colLetter(ci)}${ri + 1}` } : null)));
  return { name, rows, merged: [], kind: 'sheet' };
}

const SUBTOTAL = /^(sub\s*-?\s*total|total|grand\s*total|sum|المجموع|مجموع|الإجمالي|إجمالي|اجمالي|الاجمالي|المجموع الكلي)\b/i;

export interface Inspection { headerRow: number; firstDataRow: number; dataRows: number[]; subtotalRows: number[]; blankRows: number; columns: number; merged: number; headers: string[]; signature: string }

export function inspect(g: Grid, headerRow?: number, firstDataRow?: number): Inspection {
  const isText = (c: Cell | null) => !!c && c.num === undefined && !c.date && !/^[\d.,٠-٩\s:/-]+$/.test(c.text);
  let hr = headerRow ?? -1;
  if (hr < 0) {
    let best = -1;
    for (let r = 0; r < Math.min(g.rows.length, 20); r++) {
      const n = g.rows[r].filter(isText).length;
      if (n >= 2 && n > best) { best = n; hr = r; }
      if (best >= 3 && r > hr + 1) break;
    }
    if (hr < 0) hr = 0;
  }
  const fd = firstDataRow ?? hr + 1;
  const columns = Math.max(0, ...g.rows.map((r) => r.length));
  const dataRows: number[] = [];
  const subtotalRows: number[] = [];
  let blank = 0;
  for (let r = fd; r < g.rows.length; r++) {
    const row = g.rows[r];
    if (!row.some((c) => c && c.text !== '')) { blank++; continue; }
    if (row.some((c) => c && SUBTOTAL.test(normalizeDigits(c.text)))) { subtotalRows.push(r); continue; }
    dataRows.push(r);
  }
  const headers = Array.from({ length: columns }, (_, i) => g.rows[hr]?.[i]?.text ?? colLetter(i));
  return { headerRow: hr, firstDataRow: fd, dataRows, subtotalRows, blankRows: blank, columns, merged: g.merged.length, headers, signature: headers.map((h) => h.toLowerCase().replace(/\s+/g, ' ').trim()).join('|') };
}

export type Role = 'actual' | 'plan' | 'reference' | 'ignore';
export interface ColumnMap { col: number; header: string; role: Role; field: DimField | 'date' | 'time' | 'start_time' | 'end_time' | 'unit' | 'measure' | 'attr' | ''; metric?: string; unit?: string; dataset?: string }
export interface MappingConfig { headerRow: number; firstDataRow: number; columns: ColumnMap[] }

const HINTS: [RegExp, ColumnMap['field']][] = [
  [/(^|\s)(line|خط|الخط)(\s|$)/i, 'line'], [/(product|crop|item|منتج|المنتج|صنف|الصنف|محصول)/i, 'product'], [/(grade|class|درجة|الدرجة|فئة|الفئة|sku)/i, 'grade'],
  [/(lot|batch|دفعة|الدفعة|لوت|رقم الدفعة)/i, 'lot'], [/(customer|client|عميل|العميل|زبون)/i, 'customer'], [/(order|طلبية|الطلبية|أمر)/i, 'order_ref'],
  [/(worker|employee|عامل|العامل|الموظف)/i, 'worker'], [/(reason|cause|سبب|السبب)/i, 'reason'], [/(invoice no|credit no|doc|document|رقم الفاتورة|رقم الإشعار|مستند)/i, 'doc_no'],
  [/(^|\s)(date|تاريخ|التاريخ)(\s|$)/i, 'date'], [/(start|from|بداية|البداية|من الساعة)/i, 'start_time'], [/(end|to|finish|نهاية|النهاية|إلى الساعة)/i, 'end_time'],
  [/(^|\s)(time|hour|وقت|الوقت|ساعة|الساعة)(\s|$)/i, 'time'], [/(^|\s)(unit|وحدة|الوحدة)(\s|$)/i, 'unit'], [/(status|حالة|الحالة)/i, 'status'],
];
export function unitHint(h: string): string | undefined {
  if (/(kg|كغ|كيلو|كجم)/i.test(h)) return 'kg';
  if (/(box|carton|صندوق|صناديق|كرتون|كرتونة)/i.test(h)) return 'box';
  if (/(pallet|طبلية|طبالي|مشطاح)/i.test(h)) return 'pallet';
  if (/(jod|دينار)/i.test(h)) return 'JOD';
  if (/(usd|\$|دولار)/i.test(h)) return 'USD';
  if (/(minute|min|دقيقة|دقائق)/i.test(h)) return 'minute';
  return undefined;
}
export function slug(h: string, i: number): string {
  const s = h.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  return s || `col_${colLetter(i).toLowerCase()}`;
}

/** Suggest a mapping from header words and column contents; the owner reviews it before anything is staged. */
export function suggestMapping(g: Grid, ins: Inspection, dataset: string): MappingConfig {
  const cols: ColumnMap[] = ins.headers.map((h, i) => {
    const sample = ins.dataRows.slice(0, 20).map((r) => g.rows[r][i]).filter(Boolean) as Cell[];
    const numeric = sample.length > 0 && sample.filter((c) => c.num !== undefined || /^[\d٠-٩.,٫٬\s()-]+$/.test(c.text)).length >= sample.length * 0.7;
    const hint = HINTS.find(([re]) => re.test(h))?.[1];
    if (hint && !(numeric && ['line', 'product', 'grade'].includes(hint) && /(kg|كغ|qty|كمية)/i.test(h))) return { col: i, header: h, role: 'reference', field: hint };
    if (numeric) {
      const plan = /(target|plan|planned|هدف|الهدف|مخطط|المخطط|خطة)/i.test(h);
      const metric = /(crew|workers|عدد العمال|عمال)/i.test(h) ? 'crew' : /(worker.?hours|ساعات العمل|ساعات عمل)/i.test(h) ? 'worker_hours' : /(minute|دقائق|دقيقة)/i.test(h) ? 'minutes'
        : /(value|amount|قيمة|مبلغ|المبلغ)/i.test(h) ? 'value' : dataset.startsWith('custom:') ? slug(h, i) : plan ? 'target' : 'qty';
      return { col: i, header: h, role: plan ? 'plan' : 'actual', field: 'measure', metric, unit: unitHint(h) };
    }
    return { col: i, header: h, role: sample.length ? 'reference' : 'ignore', field: sample.length ? 'attr' : '' };
  });
  return { headerRow: ins.headerRow, firstDataRow: ins.firstDataRow, columns: cols };
}

function asText(c: Cell | null, field: ColumnMap['field']): string {
  if (!c) return '';
  if (field === 'date') {
    if (c.date) return c.date.toISOString().slice(0, 16).replace('T', ' ').replace(/ 00:00$/, '');
    if (c.num !== undefined) { const d = excelSerialToLocal(c.num); return d.date ? `${d.date}${d.time ? ` ${d.time}` : ''}` : c.text; }
    return c.text;
  }
  if (field === 'time' || field === 'start_time' || field === 'end_time') {
    if (c.date) {
      const iso = c.date.toISOString();
      return iso.startsWith('1899-12-3') ? iso.slice(11, 16) : `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
    }
    if (c.num !== undefined) return parseTimeText(c.num % 1) ?? c.text;
    return c.text;
  }
  return c.text;
}

export interface StagedRowInput { idx: number; source_ref: string; raw: { cells: Record<string, { ref: string; text: string; conf?: number; bbox?: number[] }> }; vals: RowVals }

export function buildRows(g: Grid, ins: Inspection, m: MappingConfig, fileId: string | null): StagedRowInput[] {
  return ins.dataRows.map((r, idx) => {
    const row = g.rows[r];
    const vals: RowVals = { dims: {}, measures: [], attrs: {} };
    const cells: StagedRowInput['raw']['cells'] = {};
    const conf: Record<string, number> = {};
    for (const c of m.columns) {
      if (c.role === 'ignore' || !c.field) continue;
      const cell = row[c.col] ?? null;
      const text = asText(cell, c.field);
      const key = c.field === 'measure' ? (c.dataset ? `m:${c.dataset}.${c.metric}` : `m:${c.metric}`) : c.field === 'attr' ? `a:${c.header}` : c.field;
      cells[key] = { ref: cell?.ref ?? `${colLetter(c.col)}${r + 1}`, text: cell?.text ?? '', conf: cell?.conf, bbox: cell?.bbox };
      if (g.kind === 'image' && cell?.conf !== undefined) conf[key] = cell.conf;
      if (g.kind === 'image' && !cell && c.field === 'measure') conf[key] = 0; // unreadable: left blank and flagged
      if (c.field === 'measure') {
        if (c.role !== 'actual' && c.role !== 'plan') continue;
        // a photo value that is not a readable number is left blank (raw OCR text stays as evidence only)
        let value = text;
        if (g.kind === 'image' && text && parseQuantity(text).milli === null) { value = ''; conf[key] = 0; }
        const meas: Measure = { metric: c.metric || 'qty', value, unit: c.unit || null, role: c.role };
        if (c.dataset) meas.dataset = c.dataset;
        vals.measures.push(meas);
      } else if (c.field === 'attr') {
        if (text) vals.attrs[c.header] = text;
      } else if (c.field === 'date' || c.field === 'time' || c.field === 'start_time' || c.field === 'end_time' || c.field === 'unit') {
        vals[c.field] = text;
      } else {
        vals.dims[c.field] = text;
      }
    }
    if (Object.keys(conf).length) vals.conf = conf;
    const refs = Object.values(cells).map((x) => x.ref);
    const sourceRef = g.kind === 'image' ? `img:${fileId}#r${r + 1}` : `${g.name}!${refs[0] ?? `A${r + 1}`}:${refs[refs.length - 1] ?? ''}`;
    return { idx, source_ref: sourceRef, raw: { cells }, vals };
  });
}
