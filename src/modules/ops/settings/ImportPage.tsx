import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { requireSupabase } from '@/core/supabase';
import { opsErrorMessage, rpc, useCustomers, useInvalidateOps, useMyPermissions } from '../api';
import { btn, btnPrimary, Card, downloadCsv, EmptyState, field, PageTitle, Pill, SaveStatus, type SaveState, Tabs, useFmt } from '../ui';
import { TABLES, type Col, type TableDef } from './masterTables';

type Raw = Record<string, string>;
interface Parsed { file: string; rows: Record<string, unknown>[]; problems: { row: number; msg: string }[]; unknownCols: string[] }
interface ImportResult { batch_id: string; saved: number; skipped: number; failed: number; rows: { row: number; status: string; error?: string }[] }
interface Exception { id: string; batch_id: string; row_no: number; data: Record<string, unknown>; error: string; created_at: string }

const MAX_ROWS = 2000;
const TRUE = ['true', 'yes', 'y', '1', 'نعم'];
const FALSE = ['false', 'no', 'n', '0', 'لا'];

/** Minimal RFC 4180 CSV reader (quoted fields, doubled quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = []; let cell = ''; let q = false;
  const s = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); out.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); out.push(row); }
  return out.filter((r) => r.some((x) => x.trim() !== ''));
}

function colKey(c: Col): string { return c.kind === 'customer' ? 'customer_code' : c.key; }

/** Turns the sheet's rows into the values the server's master-data step accepts; anything doubtful is reported, not guessed. */
export function toRows(def: TableDef, grid: string[][], customers: { id: string; code: string }[]): Omit<Parsed, 'file'> {
  const [head = [], ...body] = grid;
  const keys = head.map((h) => h.trim().toLowerCase());
  const known = new Set(def.cols.map(colKey));
  const unknownCols = keys.filter((k) => k && !known.has(k));
  const problems: Parsed['problems'] = [];
  const rows = body.map((cells, i) => {
    const raw: Raw = {};
    keys.forEach((k, j) => { if (known.has(k)) raw[k] = String(cells[j] ?? '').trim(); });
    const v: Record<string, unknown> = {};
    for (const c of def.cols) {
      const x = raw[colKey(c)];
      if (x === undefined || x === '') { if (c.required) problems.push({ row: i + 2, msg: `${colKey(c)}: required` }); continue; }
      if (c.kind === 'bool') {
        const l = x.toLowerCase();
        if (TRUE.includes(l)) v[c.key] = true; else if (FALSE.includes(l)) v[c.key] = false;
        else problems.push({ row: i + 2, msg: `${c.key}: yes/no` });
      } else if (c.kind === 'number') {
        const n = x.replace(',', '.');
        if (/^-?\d+(\.\d+)?$/.test(n)) v[c.key] = n; else problems.push({ row: i + 2, msg: `${c.key}: number` });
      } else if (c.kind === 'select') {
        if (c.options?.includes(x)) v[c.key] = x; else problems.push({ row: i + 2, msg: `${c.key}: ${c.options?.join('/')}` });
      } else if (c.kind === 'time') {
        if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(x)) v[c.key] = x; else problems.push({ row: i + 2, msg: `${c.key}: HH:MM` });
      } else if (c.kind === 'customer') {
        const cu = customers.find((y) => y.code.toLowerCase() === x.toLowerCase());
        if (cu) v[c.key] = cu.id; else problems.push({ row: i + 2, msg: `customer_code: ${x}?` });
      } else v[c.key] = x;
    }
    return v;
  });
  return { rows, problems, unknownCols };
}

async function readGrid(file: File): Promise<string[][]> {
  if (/\.csv$/i.test(file.name)) return parseCsv(await file.text());
  const { readSheet } = await import('read-excel-file/browser');
  const data = await readSheet(file);
  return data.map((r) => r.map((c) => (c === null || c === undefined ? '' : c instanceof Date ? c.toISOString().slice(0, 10) : String(c))));
}

/** Settings → Spreadsheet import: rows go through the same maker step as typing them in (awaiting a second person's approval);
 *  rows the server refuses wait in the exception queue. */
export default function ImportPage() {
  const { t } = useTranslation();
  const perms = useMyPermissions();
  // Importing does not widen anyone's rights: a row is saved through the same master-data step, so only tables the person may edit are offered.
  const tables = TABLES.filter((d) => perms.data?.has(`${d.area}.edit`));
  const [tab, setTab] = useState<string>('');
  const def = tables.find((d) => d.table === tab) ?? tables[0];
  return (
    <div>
      <PageTitle title={t('ops.import.title')} sub={t('ops.import.sub')} />
      {perms.data && !def && <EmptyState>{t('ops.import.noTables')}</EmptyState>}
      {def && (
        <>
          <Tabs label={t('ops.import.table')} value={def.table} onChange={setTab} tabs={tables.map((d) => ({ key: d.table, label: t(`ops.md.tables.${d.table}`) }))} />
          <Importer key={def.table} def={def} />
        </>
      )}
      <Exceptions />
    </div>
  );
}

function Importer({ def }: { def: TableDef }) {
  const { t } = useTranslation();
  const customers = useCustomers();
  const invalidate = useInvalidateOps();
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [update, setUpdate] = useState(false);
  const [state, setState] = useState<SaveState>({ kind: 'idle' });
  const [result, setResult] = useState<ImportResult | null>(null);
  const header = def.cols.map(colKey);
  const onFile = async (f: File | undefined) => {
    setResult(null); setState({ kind: 'idle' }); setParsed(null);
    if (!f) return;
    try {
      const grid = await readGrid(f);
      if (grid.length < 2) throw new Error(t('ops.import.empty'));
      if (grid.length - 1 > MAX_ROWS) throw new Error(t('ops.import.tooMany', { n: MAX_ROWS }));
      setParsed({ file: f.name, ...toRows(def, grid, customers.data ?? []) });
    } catch (e) { setState({ kind: 'failed', message: e instanceof Error ? e.message : String(e) }); }
  };
  const run = async () => {
    if (!parsed) return;
    setState({ kind: 'pending' });
    try {
      const r = await rpc<ImportResult>('ph_import_rows', { p_table: def.table, p_rows: parsed.rows, p_file: parsed.file, p_update_existing: update });
      setResult(r); setParsed(null);
      setState({ kind: 'saved', at: new Date().toISOString(), text: t('ops.import.done', { saved: r.saved, skipped: r.skipped, failed: r.failed }) });
      await invalidate();
    } catch (e) { setState({ kind: 'failed', message: opsErrorMessage(t, e) }); }
  };
  return (
    <Card title={t(`ops.md.tables.${def.table}`)} sub={t('ops.import.columns', { cols: header.join(', ') })}
      action={<button type="button" className={btn} onClick={() => downloadCsv(`${def.table}-template.csv`, header, [])}>{t('ops.import.template')}</button>}>
      <div className="grid gap-3">
        <label className="text-sm">{t('ops.import.file')}
          <input type="file" className={field} accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => void onFile(e.target.files?.[0])} />
        </label>
        <label className="flex min-h-[44px] items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5" checked={update} onChange={(e) => setUpdate(e.target.checked)} />{t('ops.import.update')}</label>
        {parsed && (
          <div className="grid gap-2">
            <p className="text-sm">{t('ops.import.preview', { n: parsed.rows.length, file: parsed.file })}</p>
            {parsed.unknownCols.length > 0 && <p className="text-sm text-ops-amber">! {t('ops.import.unknownCols', { cols: parsed.unknownCols.join(', ') })}</p>}
            {parsed.problems.length > 0 && (
              <div role="alert" className="rounded-ops-sm border border-ops-redline bg-ops-redbg p-3 text-sm text-ops-red">
                <p className="font-semibold">{t('ops.import.problems', { n: parsed.problems.length })}</p>
                <ul className="mt-1 list-disc ps-5">{parsed.problems.slice(0, 20).map((p, i) => <li key={i}>{t('ops.import.rowNo', { n: p.row })}: <bdi>{p.msg}</bdi></li>)}</ul>
              </div>
            )}
            <div className="overflow-x-auto rounded-ops-sm border border-ops-line ops-scroll-thin">
              <table className="w-full min-w-[480px] text-sm">
                <thead className="bg-ops-surface2 text-ops-muted"><tr>{def.cols.map((c) => <th key={c.key} className="px-2 py-1 text-start"><bdi>{colKey(c)}</bdi></th>)}</tr></thead>
                <tbody className="divide-y divide-ops-line">{parsed.rows.slice(0, 10).map((r, i) => (
                  <tr key={i}>{def.cols.map((c) => <td key={c.key} className="px-2 py-1"><bdi>{r[c.key] === undefined ? '' : c.kind === 'customer' ? (customers.data?.find((x) => x.id === r[c.key])?.code ?? '') : String(r[c.key])}</bdi></td>)}</tr>
                ))}</tbody>
              </table>
            </div>
            <button type="button" className={btnPrimary} disabled={parsed.problems.length > 0 || parsed.rows.length === 0} onClick={run}>{t('ops.import.run', { n: parsed.rows.length })}</button>
          </div>
        )}
        <SaveStatus state={state} />
        {result && result.rows.some((r) => r.status !== 'created' && r.status !== 'updated') && (
          <ul className="grid gap-1 text-sm">{result.rows.filter((r) => r.status !== 'created' && r.status !== 'updated').slice(0, 50).map((r) => (
            <li key={r.row}>{t('ops.import.rowNo', { n: r.row + 1 })}: <Pill tone={r.status === 'exists' ? 'neutral' : 'bad'}>{t(`ops.import.status.${r.status}`)}</Pill> {r.error && <bdi className="text-xs text-ops-muted">{r.error}</bdi>}</li>
          ))}</ul>
        )}
        <p className="text-xs text-ops-muted">{t('ops.import.approvalNote')}</p>
      </div>
    </Card>
  );
}

function Exceptions() {
  const { t } = useTranslation();
  const fmt = useFmt();
  const invalidate = useInvalidateOps();
  const q = useQuery({ queryKey: ['ops', 'import-exceptions'], queryFn: async () => {
    const { data, error } = await requireSupabase().from('ph_import_exceptions').select('id, batch_id, row_no, data, error, created_at')
      .is('voided_at', null).is('resolved_at', null).order('created_at', { ascending: false }).limit(200);
    if (error) throw error;
    return (data ?? []) as Exception[];
  } });
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [reason, setReason] = useState<Record<string, string>>({});
  const [state, setState] = useState<SaveState>({ kind: 'idle' });
  const act = async (id: string, action: 'retry' | 'dismiss') => {
    setState({ kind: 'pending' });
    try {
      const txt = edit[id];
      const data = action === 'retry' && txt !== undefined ? JSON.parse(txt) as unknown : null;
      await rpc('ph_import_resolve', { p_exception: id, p_action: action, p_data: data, p_reason: reason[id] ?? null });
      setState({ kind: 'saved', at: new Date().toISOString() });
      await Promise.all([invalidate(), q.refetch()]);
    } catch (e) { setState({ kind: 'failed', message: e instanceof SyntaxError ? t('ops.import.badJson') : opsErrorMessage(t, e) }); }
  };
  return (
    <Card title={t('ops.import.queue')} className="mt-4" highlight={(q.data?.length ?? 0) > 0}>
      {(q.data ?? []).length === 0 ? <EmptyState icon="✓">{t('ops.import.queueEmpty')}</EmptyState> : (
        <ul className="grid gap-3">
          {(q.data ?? []).map((e) => (
            <li key={e.id} className="rounded-ops-sm border border-ops-line p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{t('ops.import.rowNo', { n: e.row_no + 1 })}</span>
                <span className="text-xs text-ops-muted">{fmt.dateTime(e.created_at)}</span></div>
              <p className="mt-1 text-ops-red"><bdi>{e.error}</bdi></p>
              <label className="mt-2 block text-xs">{t('ops.import.fix')}
                <textarea dir="ltr" className={`${field} min-h-[80px] py-2 font-mono text-xs`} value={edit[e.id] ?? JSON.stringify(e.data, null, 1)} onChange={(x) => setEdit({ ...edit, [e.id]: x.target.value })} /></label>
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <button type="button" className={btn} onClick={() => void act(e.id, 'retry')}>{t('ops.import.retry')}</button>
                <label className="min-w-[12rem] flex-1 text-xs">{t('ops.import.reason')}<input className={field} value={reason[e.id] ?? ''} onChange={(x) => setReason({ ...reason, [e.id]: x.target.value })} /></label>
                <button type="button" className={btn} disabled={!(reason[e.id] ?? '').trim()} onClick={() => void act(e.id, 'dismiss')}>{t('ops.import.dismiss')}</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2"><SaveStatus state={state} /></div>
    </Card>
  );
}
