import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { QueryState } from '@/core/components/QueryState';
import { VerificationBadge, type VerificationStatus } from '@/core/components/VerificationBadge';
import { localizedName, rpc, useInvalidatePh, useLookup, useMyPhPermissions } from './api';
import { phErrorMessage } from './phErrors';
import { LocationBoard } from './LocationBoard';
import { ErrorBox, Labelled, btnCls, inputCls, primaryBtnCls } from './ui';

interface Row { id: string; code: string; name_ar: string; name_en: string | null; verification_status: VerificationStatus; source_note: string | null; [k: string]: unknown }

const TABLES: { table: string; area: 'md_operational' | 'md_quality'; columns: string[]; create?: string[] }[] = [
  { table: 'ph_crops', area: 'md_operational', columns: ['version_no', 'storage_group_id', 'doc_temp_note', 'boxes_per_pallet', 'nominal_kg_per_pallet', 'washer_route', 'allowed_lines', 'superseded_at'] },
  { table: 'ph_storage_groups', area: 'md_quality', columns: [] },
  { table: 'ph_locations', area: 'md_operational', columns: ['purpose', 'capacity_pallets'] },
  { table: 'ph_lines', area: 'md_operational', columns: ['kind', 'nominal_rate', 'rate_evidence', 'crop_codes'] },
  { table: 'ph_equipment', area: 'md_operational', columns: ['kind', 'calibration_due_on'] },
  { table: 'ph_sources', area: 'md_operational', columns: ['kind', 'block_code', 'section_code', 'supplier_name'], create: ['kind', 'code', 'name_ar', 'name_en', 'block_code', 'section_code', 'supplier_name'] },
  { table: 'ph_varieties', area: 'md_operational', columns: ['crop_code'], create: ['crop_code', 'code', 'name_ar', 'name_en'] },
];

function show(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (Array.isArray(v)) return v.join(', ');
  return String(v);
}

function CreateForm({ table, fields, onDone }: { table: string; fields: string[]; onDone: () => void }) {
  const { t } = useTranslation();
  const [v, setV] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  async function submit(e: { preventDefault: () => void }) {
    e.preventDefault();
    setError(null);
    try { await rpc('ph_save_master', { p_table: table, p_id: null, p_values: Object.fromEntries(Object.entries(v).filter(([, x]) => x !== '')) }); setV({}); onDone(); }
    catch (err) { setError(phErrorMessage(t, err)); }
  }
  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-2 rounded border border-stone-200 p-2">
      <div className="grid gap-2 sm:grid-cols-3">
        {fields.map((f) => (
          <Labelled key={f} label={t(`ph.md.col.${f}`, { defaultValue: f })} required={['code', 'name_ar', 'kind', 'crop_code'].includes(f)}>
            {f === 'kind' ? (
              <select required className={inputCls} value={v[f] ?? ''} onChange={(e) => setV({ ...v, [f]: e.target.value })}>
                <option value="">—</option><option value="own_farm">{t('ph.md.ownFarm')}</option><option value="supplier">{t('ph.md.supplier')}</option>
              </select>
            ) : (
              <input required={['code', 'name_ar', 'crop_code'].includes(f)} className={inputCls} value={v[f] ?? ''} onChange={(e) => setV({ ...v, [f]: e.target.value })} />
            )}
          </Labelled>
        ))}
      </div>
      <ErrorBox message={error} />
      <div><button type="submit" className={primaryBtnCls}>{t('ph.md.create')}</button></div>
    </form>
  );
}

function MasterTable({ def, perms }: { def: (typeof TABLES)[number]; perms: Map<string, string> | undefined }) {
  const { t, i18n } = useTranslation();
  const invalidate = useInvalidatePh();
  const q = useLookup<Row>(`md_${def.table}`, def.table, '*');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const mayApprove = perms?.has(`${def.area}.approve`);
  const mayCreate = def.create && perms?.has(`${def.area}.edit`);
  async function approve(r: Row) {
    setError(null);
    try { await rpc('ph_approve_master', { p_table: def.table, p_id: r.id, p_note: note }); await invalidate(); }
    catch (e) { setError(phErrorMessage(t, e)); }
  }
  return (
    <section className="flex flex-col gap-2 rounded-lg border bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-semibold">{t(`ph.md.tables.${def.table}`)}</h2>
        <span className="text-xs text-stone-500">{t(`ph.md.area.${def.area}`)}</span>
        {mayCreate && <button type="button" className={`${btnCls} ms-auto`} onClick={() => setCreating(!creating)}>＋ {t('ph.md.new')}</button>}
      </div>
      {creating && def.create && <CreateForm table={def.table} fields={def.create} onDone={() => { setCreating(false); void invalidate(); }} />}
      {mayApprove && (
        <input aria-label={t('ph.md.approvalNote')} placeholder={t('ph.md.approvalNote')} className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} />
      )}
      <ErrorBox message={error} />
      <QueryState isLoading={q.isLoading} error={q.error} isEmpty={(q.data ?? []).length === 0} emptyText={t('ph.md.empty')}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead><tr className="border-b bg-stone-50">
              <th className="p-1.5 text-start">{t('common.code')}</th><th className="p-1.5 text-start">{t('ph.md.name')}</th>
              {def.columns.map((c) => <th key={c} className="p-1.5 text-start">{t(`ph.md.col.${c}`, { defaultValue: c })}</th>)}
              <th className="p-1.5 text-start">{t('ph.md.status')}</th><th className="p-1.5 text-start">{t('ph.md.sourceNote')}</th><th className="p-1.5" /></tr></thead>
            <tbody>
              {(q.data ?? []).sort((a, b) => a.code.localeCompare(b.code)).map((r) => (
                <tr key={r.id} className="border-b align-top">
                  <td className="p-1.5 font-mono"><bdi>{r.code}</bdi></td>
                  <td className="p-1.5">{localizedName(i18n.language, r.name_ar, r.name_en)}</td>
                  {def.columns.map((c) => <td key={c} className="p-1.5"><bdi>{show(r[c])}</bdi></td>)}
                  <td className="p-1.5"><VerificationBadge status={r.verification_status} /></td>
                  <td className="p-1.5 text-xs text-stone-600">{r.source_note ?? '—'}</td>
                  <td className="p-1.5">{mayApprove && r.verification_status !== 'verified' && (
                    <button type="button" className={btnCls} disabled={!note.trim()} onClick={() => void approve(r)}>{t('ph.md.approve')}</button>)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </QueryState>
    </section>
  );
}

/** Packing-house master data (FR-MD-01…06): maker enters, a different person approves (SoD-07). */
export default function MasterPage() {
  const { t } = useTranslation();
  const perms = useMyPhPermissions();
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h1 className="text-xl font-bold">{t('ph.md.title')}</h1>
        <p className="text-sm text-stone-700">{t('ph.md.intro')}</p>
      </div>
      <LocationBoard mayAssign={!!perms.data?.has('stock_move.assign_group')} />
      {TABLES.map((d) => <MasterTable key={d.table} def={d} perms={perms.data} />)}
    </section>
  );
}
