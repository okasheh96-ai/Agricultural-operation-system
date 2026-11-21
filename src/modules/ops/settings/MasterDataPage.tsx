import { useState, type FormEvent } from 'react';
import { useAuth } from '@/core/auth/AuthProvider';
import { MasterImport } from './MasterImport';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { requireSupabase } from '@/core/supabase';
import { localName, opsErrorMessage, rpc, useCustomers, useInvalidateOps, useMyPermissions } from '../api';
import { btn, btnPrimary, Card, DataTable, Modal, field, PageTitle, Pill, SaveStatus, type SaveState, Loaded, Tabs } from '../ui';

type Kind = 'text' | 'number' | 'bool' | 'time' | 'select' | 'customer' | 'list';
interface Col { key: string; kind: Kind; required?: boolean; options?: string[]; ltr?: boolean }
interface TableDef { table: string; area: 'md_customer' | 'md_operational'; cols: Col[] }

/** The masters the packhouse operations use. Columns match app.ph_master_tables (the server refuses anything else). */
const TABLES: TableDef[] = [
  { table: 'ph_customers', area: 'md_customer', cols: [
    { key: 'code', kind: 'text', required: true, ltr: true }, { key: 'name_en', kind: 'text', required: true, ltr: true }, { key: 'name_ar', kind: 'text' },
    { key: 'market_type', kind: 'select', options: ['export', 'local', 'retail', 'lss'] }, { key: 'long_distance', kind: 'bool' }, { key: 'notes', kind: 'text' }] },
  { table: 'ph_lines', area: 'md_operational', cols: [
    { key: 'code', kind: 'text', required: true, ltr: true }, { key: 'name_ar', kind: 'text', required: true },
    { key: 'name_en', kind: 'text', ltr: true }, { key: 'kind', kind: 'select', required: true, options: ['washer', 'machine_grading', 'manual'] },
    { key: 'nominal_rate', kind: 'text' }, { key: 'crop_codes', kind: 'list', ltr: true }] },
  { table: 'ph_pack_formats', area: 'md_operational', cols: [
    { key: 'code', kind: 'text', required: true, ltr: true }, { key: 'name_ar', kind: 'text', required: true }, { key: 'name_en', kind: 'text', ltr: true },
    { key: 'kind', kind: 'select', required: true, options: ['carton', 'punnet_carton', 'black_box', 'loose', 'bag', 'other'] },
    { key: 'nominal_net_kg', kind: 'number', required: true }, { key: 'units_per_pack', kind: 'number' }, { key: 'crop_code', kind: 'text', ltr: true },
    { key: 'customer_id', kind: 'customer' }] },
  { table: 'ph_shift_templates', area: 'md_operational', cols: [
    { key: 'code', kind: 'text', required: true, ltr: true }, { key: 'name_ar', kind: 'text', required: true }, { key: 'name_en', kind: 'text', ltr: true },
    { key: 'starts_at', kind: 'time', required: true }, { key: 'ends_at', kind: 'time', required: true }, { key: 'sort_order', kind: 'number' }] },
  { table: 'ph_task_kinds', area: 'md_operational', cols: [
    { key: 'code', kind: 'text', required: true, ltr: true }, { key: 'name_ar', kind: 'text', required: true }, { key: 'name_en', kind: 'text', ltr: true },
    { key: 'counts_as_packing', kind: 'bool', required: true }, { key: 'is_shared', kind: 'bool' }, { key: 'sort_order', kind: 'number' }] },
  { table: 'ph_downtime_causes', area: 'md_operational', cols: [
    { key: 'code', kind: 'text', required: true, ltr: true }, { key: 'name_ar', kind: 'text', required: true }, { key: 'name_en', kind: 'text', ltr: true },
    { key: 'category', kind: 'text' }] },
  { table: 'ph_packaging_items', area: 'md_operational', cols: [
    { key: 'code', kind: 'text', required: true, ltr: true }, { key: 'name_ar', kind: 'text', required: true }, { key: 'name_en', kind: 'text', ltr: true },
    { key: 'kind', kind: 'select', required: true, options: ['carton', 'punnet', 'field_crate', 'black_box', 'pallet', 'label', 'lid', 'other'] }] },
];

type Row = Record<string, unknown> & { id: string; code: string; verification_status: string; source_note: string | null; is_active?: boolean; created_by: string | null };

/** Settings → Master data: one person enters a record, a different person approves it before any record may use it. */
export default function MasterDataPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState('ph_customers');
  const def = TABLES.find((d) => d.table === tab) ?? (TABLES[0] as TableDef);
  return (
    <div>
      <PageTitle title={t('ops.md.title')} sub={t('ops.md.sub')} />
      <Tabs label={t('ops.md.title')} value={tab} onChange={setTab} tabs={TABLES.map((d) => ({ key: d.table, label: t(`ops.md.tables.${d.table}`) }))} />
      <Table key={def.table} def={def} />
    </div>
  );
}

function Table({ def }: { def: TableDef }) {
  const { t, i18n } = useTranslation();
  const { access } = useAuth();
  const perms = useMyPermissions();
  const invalidate = useInvalidateOps();
  const customers = useCustomers();
  const rows = useQuery({ enabled: !!access?.farmId, queryKey: ['ops', 'md', def.table, access?.farmId], queryFn: async () => {
    const { data, error } = await requireSupabase().from(def.table).select('*').eq('farm_id', access?.farmId ?? '').is('voided_at', null).order('code');
    if (error) throw error;
    return (data ?? []) as Row[];
  } });
  const [editing, setEditing] = useState<Row | 'new' | null>(null);
  const [importing, setImporting] = useState(false);
  const [note, setNote] = useState('');
  const [state, setState] = useState<SaveState>({ kind: 'idle' });
  const mayEdit = !!perms.data?.has(`${def.area}.edit`);
  const mayApprove = !!perms.data?.has(`${def.area}.approve`);
  const approve = async (r: Row) => {
    setState({ kind: 'pending' });
    try { await rpc('ph_approve_master', { p_table: def.table, p_id: r.id, p_note: note }); setState({ kind: 'saved', at: new Date().toISOString() }); await invalidate(); }
    catch (e) { setState({ kind: 'failed', message: opsErrorMessage(t, e) }); }
  };
  const show = (c: Col, v: unknown) => {
    if (v === null || v === undefined || v === '') return '—';
    if (c.kind === 'bool') return v ? t('ops.yes') : t('ops.no');
    if (c.kind === 'select') return t(`ops.md.opt.${String(v)}`, { defaultValue: String(v) });
    if (c.kind === 'customer') return customers.data?.find((x) => x.id === v)?.code ?? '—';
    return String(v);
  };
  return (
    <div className="grid gap-4">
      <Card title={t(`ops.md.tables.${def.table}`)} action={mayEdit && <div className="flex flex-wrap gap-2"><button type="button" className={btn} onClick={() => setImporting(true)}>{t('imports.title')}</button><button type="button" className={btn} onClick={() => setEditing('new')}>＋ {t('ops.md.new')}</button></div>}>
        {mayApprove && (
          <label className="mb-3 block text-sm">{t('ops.md.approvalNote')}<input className={field} value={note} onChange={(e) => setNote(e.target.value)} />
            <span className="text-xs text-ops-muted">{t('ops.md.approvalHelp')}</span></label>
        )}
        <Loaded query={rows}>
          {(list) => <DataTable label={t(`ops.md.tables.${def.table}`)} searchable rows={list} columns={[
            ...def.cols.map(c => ({ key: c.key, header: t(`ops.md.col.${c.key}`),
              sort: (r: Row) => c.kind === 'number' && r[c.key] != null ? Number(r[c.key]) : show(c, r[c.key]),
              render: (r: Row) => <bdi>{show(c, r[c.key])}</bdi> })),
            { key: 'status', header: t('ops.md.status'), sort: r => r.verification_status, render: r => <>
              <Pill tone={r.verification_status === 'verified' ? 'good' : 'warn'}>{t(r.verification_status === 'verified' ? 'ops.md.approved' : 'ops.md.pending')}</Pill>
              {r.is_active === false && <Pill tone="neutral">{t('ops.md.inactive')}</Pill>}</> },
            { key: 'actions', header: t('common.actions'), render: r => <div className="flex gap-1">
              {mayApprove && r.verification_status !== 'verified' && <button type="button" className={btn} disabled={!note.trim() || state.kind === 'pending'} onClick={() => approve(r)}>{t('ops.md.approve')}</button>}
              {mayEdit && <button type="button" className={btn} onClick={() => setEditing(r)}>{t('ops.md.edit')}</button>}</div> },
          ]} />}
        </Loaded>
        <div className="mt-2"><SaveStatus state={state} /></div>
      </Card>
      {importing && access && <MasterImport table={def.table} farm={access.farmId} columns={def.cols.map(c => c.key)}
        onClose={() => setImporting(false)} onSaved={() => { setState({kind: 'saved', at: new Date().toISOString()}); void invalidate(); }} />}
      {editing && access && <Editor farm={access.farmId} def={def} row={editing === 'new' ? null : editing} customers={customers.data ?? []} lang={i18n.language} onClose={() => setEditing(null)} onDone={() => { setEditing(null); setState({kind:'saved', at:new Date().toISOString()}); void invalidate(); }} />}
    </div>
  );
}

function Editor({ def, row, customers, lang, farm, onDone, onClose }: { farm: string; onClose: () => void; def: TableDef; row: Row | null; customers: { id: string; code: string; name_en: string; name_ar: string | null }[]; lang: string; onDone: () => void }) {
  const { t } = useTranslation();
  const [v, setV] = useState<Record<string, unknown>>(() => Object.fromEntries(def.cols.map((c) => [c.key, row?.[c.key] ?? (c.kind === 'bool' ? (c.required ? false : null) : '')])));
  const [active, setActive] = useState(row?.is_active !== false);
  const [state, setState] = useState<SaveState>({ kind: 'idle' });
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setState({ kind: 'pending' });
    const values: Record<string, unknown> = {};
    for (const c of def.cols) {
      const x = v[c.key];
      if (c.kind === 'list') {
        values[c.key] = String(x ?? '').split(/[,،]/).map(item => item.trim()).filter(Boolean);
        continue;
      }
      if (x === '' || x === undefined || x === null) {
        if (row && row[c.key] != null) values[c.key] = null;
        continue;
      }
      values[c.key] = c.kind === 'number' ? Number(x) : x;
    }
    if (row && 'is_active' in row) values.is_active = active;
    try { await rpc('ph_save_master', { p_table: def.table, p_id: row?.id ?? null, p_values: values, p_farm: farm }); setState({ kind: 'saved', at: new Date().toISOString() }); onDone(); }
    catch (e) { setState({ kind: 'failed', message: opsErrorMessage(t, e) }); }
  };
  return (
    <Modal open wide title={row ? t('ops.md.editing', {code:row.code}) : t('ops.md.new')} onClose={() => { if (state.kind !== 'pending') onClose(); }}>
      <form onSubmit={submit}>
      <p className="mb-3 text-sm text-ops-muted">{t('ops.md.makerChecker')}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {def.cols.map((c) => (
          <label key={c.key} className="text-sm">
            {t(`ops.md.col.${c.key}`)}{c.required ? <span className="ms-1 text-ops-red" aria-hidden="true">*</span> : null}
            {c.kind === 'select' ? (
              <select required={c.required} className={field} value={String(v[c.key] ?? '')} onChange={(e) => setV({ ...v, [c.key]: e.target.value })}>
                <option value="">—</option>
                {(c.options ?? []).map((o) => <option key={o} value={o}>{t(`ops.md.opt.${o}`, { defaultValue: o })}</option>)}
              </select>
            ) : c.kind === 'customer' ? (
              <select required={c.required} className={field} value={String(v[c.key] ?? '')} onChange={(e) => setV({ ...v, [c.key]: e.target.value })}>
                <option value="">{t('ops.md.anyCustomer')}</option>
                {customers.map((x) => <option key={x.id} value={x.id}>{x.code} · {localName(lang, x.name_ar, x.name_en)}</option>)}
              </select>
            ) : c.kind === 'bool' ? (
              <select className={field} value={v[c.key] === null || v[c.key] === undefined ? '' : String(v[c.key])} onChange={(e) => setV({ ...v, [c.key]: e.target.value === '' ? null : e.target.value === 'true' })}>
                {!c.required && <option value="">{t('ops.unknown')}</option>}
                <option value="true">{t('ops.yes')}</option><option value="false">{t('ops.no')}</option>
              </select>
            ) : (
              <input required={c.required} pattern={c.kind === 'number' ? '-?[0-9]+([.][0-9]+)?' : undefined} className={field} type={c.kind === 'time' ? 'time' : 'text'} inputMode={c.kind === 'number' ? 'decimal' : undefined}
                dir={c.ltr || c.kind !== 'text' ? 'ltr' : undefined} value={String(v[c.key] ?? '')} onChange={(e) => setV({ ...v, [c.key]: e.target.value })} />
            )}
          </label>
        ))}
        {row && 'is_active' in row && (
          <label className="flex min-h-[44px] items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5" checked={active} onChange={(e) => setActive(e.target.checked)} />{t('ops.md.active')}</label>
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="submit" className={btnPrimary} disabled={state.kind === 'pending'}>{t('ops.md.save')}</button>
        <button type="button" className={btn} disabled={state.kind === 'pending'} onClick={onClose}>{t('ops.md.cancel')}</button>
      </div>
      <div className="mt-2"><SaveStatus state={state} /></div>
      </form>
    </Modal>
  );
}
