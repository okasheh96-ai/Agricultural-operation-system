import { useState } from 'react';
import Papa from 'papaparse';
import { useTranslation } from 'react-i18next';
import { opsErrorMessage, rpc } from '../api';
import { btn, btnPrimary, DataTable, downloadCsv, Modal } from '../ui';

type Values = Record<string, string | string[]>;
interface Preview { total: number; issues: {row: number; reason: 'duplicate' | 'invalid'}[]; saved: number }

export function MasterImport({table, farm, columns, onClose, onSaved}: {
  table: string; farm: string; columns: string[]; onClose: () => void; onSaved: () => void;
}) {
  const {t} = useTranslation();
  const [rows, setRows] = useState<Values[]>([]);
  const [report, setReport] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function validate(values: Values[], apply: boolean) {
    const result = await rpc<Preview>('ph_import_master', {p_table: table, p_farm: farm, p_rows: values, p_apply: apply});
    setReport(result);
    if (result.saved) onSaved();
  }
  async function read(file?: File) {
    setRows([]); setReport(null); setError('');
    if (!file) return;
    if (file.size > 524288) { setError(t('imports.limit')); return; }
    setBusy(true);
    try {
      const csv = Papa.parse<string[]>((await file.text()).replace(/^\uFEFF/, ''), {skipEmptyLines: 'greedy', delimiter: ','});
      const [header, ...data] = csv.data;
      const keys = header?.map(k => k.trim()) ?? [];
      if (csv.errors.length || !keys.includes('code') || new Set(keys).size !== keys.length ||
        keys.some(k => !columns.includes(k)) || data.some(r => r.length !== keys.length)) {
        setError(t('imports.format')); return;
      }
      if (!data.length || data.length > 200) { setError(t('imports.limit')); return; }
      const values = data.map(cells => {
        const record: Values = {};
        keys.forEach((key, i) => {
          const value = (cells[i] ?? '').trim();
          if (value) record[key] = key === 'crop_codes' ? value.split(/[,،]/).map(c => c.trim()).filter(Boolean) : value;
        });
        return record;
      });
      setRows(values);
      await validate(values, false);
    } catch (e) { setError(opsErrorMessage(t, e)); } finally { setBusy(false); }
  }
  async function commit() {
    setBusy(true); setError('');
    try { await validate(rows, true); } catch (e) { setError(opsErrorMessage(t, e)); } finally { setBusy(false); }
  }
  const issues = new Map(report?.issues.map(i => [i.row, i.reason]));
  return <Modal open wide onClose={() => { if (!busy) onClose(); }} title={t('imports.title')}>
    <p className="mb-4 text-sm text-ops-muted">{t('imports.help', {table:t('ops.md.tables.' + table)})}</p>
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" className={btn} onClick={() => downloadCsv(table + '.csv', columns, [])}>{t('imports.template')}</button>
      <label className="grid gap-1 text-sm font-medium">{t('imports.file')}
        <input type="file" accept=".csv,text/csv" disabled={busy} onChange={e => void read(e.target.files?.[0])} /></label>
    </div>
    {busy && <p role="status">{t('common.loading')}</p>}
    {error && <p role="alert" className="my-3 text-ops-red">{error}</p>}
    {report && <div className="mt-4 space-y-3">
      <p role="status">{report.saved ? t('imports.saved', {count:report.saved}) : t('imports.summary', {total:report.total, problems:report.issues.length})}</p>
      <DataTable label={t('imports.preview')} rows={rows.map((r, i) => ({id:String(i + 1), n:i + 1, values:r}))} pageSize={8} columns={[
        {key:'n', header:t('imports.row'), render:r => r.n},
        {key:'code', header:t('common.code'), render:r => <bdi>{r.values.code}</bdi>},
        {key:'name', header:t('ph.md.name'), render:r => r.values.name_ar || r.values.name_en || '—'},
        {key:'status', header:t('common.status'), render:r => t('imports.' + (issues.get(r.n) ?? (report.saved ? 'pending' : 'ready')))},
      ]} />
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className={btn} disabled={busy} onClick={onClose}>{t('ops.ui.close')}</button>
        {!report.saved && <button type="button" className={btnPrimary} disabled={busy || report.issues.length > 0} onClick={commit}>{t('imports.apply')}</button>}
      </div>
    </div>}
  </Modal>;
}
