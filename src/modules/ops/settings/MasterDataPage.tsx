import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { requireSupabase } from '@/core/supabase';
import { localName, opsErrorMessage, rpc, useCustomers, useInvalidateOps, useMyPermissions } from '../api';
import { btn, btnPrimary, Card, EmptyState, field, PageTitle, Pill, SaveStatus, type SaveState, Loaded } from '../ui';

type Kind = 'text' | 'number' | 'bool' | 'time' | 'select' | 'customer';
interface Col { key: string; kind: Kind; required?: boolean; options?: string[]; ltr?: boolean }
interface TableDef { table: string; area: 'md_customer' | 'md_operational'; cols: Col[] }

/** The masters the packhouse operations use. Columns match app.ph_master_tables (the server refuses anything else). */
const TABLES: TableDef[] = [
  { table: 'ph_customers', area: 'md_customer', cols: [
    { key: 'code', kind: 'text', required: true, ltr: true }, { key: 'name_en', kind: 'text', required: true, ltr: true }, { key: 'name_ar', kind: 'text' },
    { key: 'market_type', kind: 'select', options: ['export', 'local', 'retail', 'lss'] }, { key: 'long_distance', kind: 'bool' }, { key: 'notes', kind: 'text' }] },
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
      <div role="tablist" aria-label={t('ops.md.title')} className="mb-4 flex flex-wrap gap-1 rounded-ops-sm bg-ops-grey p-1">
        {TABLES.map((d) => (
          <button key={d.table} type="button" role="tab" aria-selected={tab === d.table} onClick={() => setTab(d.table)}
            className={`min-h-[44px] rounded-ops-sm px-4 text-sm font-semibold ${tab === d.table ? 'bg-ops-surface text-ops-accent shadow-ops' : 'text-ops-muted'}`}>{t(`ops.md.tables.${d.table}`)}</button>
        ))}
      </div>
      <Table key={def.table} def={def} />
    </div>
  );
}

function Table({ def }: { def: TableDef }) {
  const { t, i18n } = useTranslation();
  const perms = useMyPermissions();
  const invalidate = useInvalidateOps();
  const customers = useCustomers();
  const rows = useQuery({ queryKey: ['ops', 'md', def.table], queryFn: async () => {
    const { data, error } = await requireSupabase().from(def.table).select('*').is('voided_at', null).order('code');
    if (error) throw error;
    return (data ?? []) as Row[];
  } });
  const [editing, setEditing] = useState<Row | 'new' | null>(null);
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
      <Card title={t(`ops.md.tables.${def.table}`)} action={mayEdit && <button type="button" className={btn} onClick={() => setEditing('new')}>＋ {t('ops.md.new')}</button>}>
        {mayApprove && (
          <label className="mb-3 block text-sm">{t('ops.md.approvalNote')}<input className={field} value={note} onChange={(e) => setNote(e.target.value)} />
            <span className="text-xs text-ops-muted">{t('ops.md.approvalHelp')}</span></label>
        )}
        <Loaded query={rows}>
          {(list) => list.length === 0 ? <EmptyState>{t('ops.md.empty')}</EmptyState> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead><tr className="text-ops-muted">
                  {def.cols.map((c) => <th key={c.key} className="py-1 text-start font-medium">{t(`ops.md.col.${c.key}`)}</th>)}
                  <th className="py-1 text-start font-medium">{t('ops.md.status')}</th><th />
                </tr></thead>
                <tbody>
                  {list.map((r) => (
                    <tr key={r.id} className="border-t border-ops-line align-top">
                      {def.cols.map((c) => <td key={c.key} className="py-1"><bdi>{show(c, r[c.key])}</bdi></td>)}
                      <td className="py-1">
                        {r.verification_status === 'verified' ? <Pill tone="good">{t('ops.md.approved')}</Pill> : <Pill tone="warn">{t('ops.md.pending')}</Pill>}
                        {r.is_active === false && <span className="ms-1"><Pill tone="neutral">{t('ops.md.inactive')}</Pill></span>}
                      </td>
                      <td className="py-1 text-end">
                        <span className="flex flex-wrap justify-end gap-1">
                          {mayApprove && r.verification_status !== 'verified' && (
                            <button type="button" className={btn} disabled={!note.trim()} onClick={() => approve(r)}>{t('ops.md.approve')}</button>
                          )}
                          {mayEdit && <button type="button" className={btn} onClick={() => setEditing(r)}>{t('ops.md.edit')}</button>}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Loaded>
        <div className="mt-2"><SaveStatus state={state} /></div>
      </Card>
      {editing && <Editor def={def} row={editing === 'new' ? null : editing} customers={customers.data ?? []} lang={i18n.language} onDone={() => { setEditing(null); void invalidate(); }} />}
    </div>
  );
}

function Editor({ def, row, customers, lang, onDone }: { def: TableDef; row: Row | null; customers: { id: string; code: string; name_en: string; name_ar: string | null }[]; lang: string; onDone: () => void }) {
  const { t } = useTranslation();
  const [v, setV] = useState<Record<string, unknown>>(() => Object.fromEntries(def.cols.map((c) => [c.key, row?.[c.key] ?? (c.kind === 'bool' ? (c.required ? false : null) : '')])));
  const [active, setActive] = useState(row?.is_active !== false);
  const [state, setState] = useState<SaveState>({ kind: 'idle' });
  const submit = async () => {
    setState({ kind: 'pending' });
    const values: Record<string, unknown> = {};
    for (const c of def.cols) {
      const x = v[c.key];
      if (x === '' || x === undefined) continue;
      values[c.key] = c.kind === 'number' ? Number(x) : x;
    }
    if (row) values.is_active = active;
    try { await rpc('ph_save_master', { p_table: def.table, p_id: row?.id ?? null, p_values: values }); setState({ kind: 'saved', at: new Date().toISOString() }); onDone(); }
    catch (e) { setState({ kind: 'failed', message: opsErrorMessage(t, e) }); }
  };
  return (
    <Card title={row ? t('ops.md.editing', { code: row.code }) : t('ops.md.new')} highlight>
      <p className="mb-3 text-sm text-ops-muted">{t('ops.md.makerChecker')}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {def.cols.map((c) => (
          <label key={c.key} className="text-sm">
            {t(`ops.md.col.${c.key}`)}{c.required ? <span className="ms-1 text-ops-red" aria-hidden="true">*</span> : null}
            {c.kind === 'select' ? (
              <select className={field} value={String(v[c.key] ?? '')} onChange={(e) => setV({ ...v, [c.key]: e.target.value })}>
                <option value="">—</option>
                {(c.options ?? []).map((o) => <option key={o} value={o}>{t(`ops.md.opt.${o}`, { defaultValue: o })}</option>)}
              </select>
            ) : c.kind === 'customer' ? (
              <select className={field} value={String(v[c.key] ?? '')} onChange={(e) => setV({ ...v, [c.key]: e.target.value })}>
                <option value="">{t('ops.md.anyCustomer')}</option>
                {customers.map((x) => <option key={x.id} value={x.id}>{x.code} · {localName(lang, x.name_ar, x.name_en)}</option>)}
              </select>
            ) : c.kind === 'bool' ? (
              <select className={field} value={v[c.key] === null || v[c.key] === undefined ? '' : String(v[c.key])} onChange={(e) => setV({ ...v, [c.key]: e.target.value === '' ? null : e.target.value === 'true' })}>
                {!c.required && <option value="">{t('ops.unknown')}</option>}
                <option value="true">{t('ops.yes')}</option><option value="false">{t('ops.no')}</option>
              </select>
            ) : (
              <input className={field} type={c.kind === 'time' ? 'time' : 'text'} inputMode={c.kind === 'number' ? 'decimal' : undefined}
                dir={c.ltr || c.kind !== 'text' ? 'ltr' : undefined} value={String(v[c.key] ?? '')} onChange={(e) => setV({ ...v, [c.key]: e.target.value })} />
            )}
          </label>
        ))}
        {row && (
          <label className="flex min-h-[44px] items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5" checked={active} onChange={(e) => setActive(e.target.checked)} />{t('ops.md.active')}</label>
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={btnPrimary} onClick={submit}>{t('ops.md.save')}</button>
        <button type="button" className={btn} onClick={onDone}>{t('ops.md.cancel')}</button>
      </div>
      <div className="mt-2"><SaveStatus state={state} onRetry={submit} /></div>
    </Card>
  );
}
