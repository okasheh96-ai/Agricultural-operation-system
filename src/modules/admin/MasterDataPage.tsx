import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { requireSupabase } from '@/core/supabase';
import { useAuth } from '@/core/auth/AuthProvider';
import { can, departmentsWith } from '@/core/rbac/access';
import { errorKey } from '@/core/errors';
import { localized } from '@/core/data/tasks';
import { matchesSearch } from '@/core/i18n/normalizeArabic';
import { nextTransitions, statusLabel, useWorkflow } from '@/core/data/workflow';
import { QueryState } from '@/core/components/QueryState';
import { VerificationBadge, type VerificationStatus } from '@/core/components/VerificationBadge';
import { entitySpec, missingRequired, toPayload, type EntitySpec, type FieldSpec } from './masterData';
import { CrewMembers } from './CrewMembers';

type Row = Record<string, unknown> & { id: string; version: number; verification_status: VerificationStatus; status?: string; workflow_version_id?: string };
type Form = Record<string, string | boolean>;
interface Option { id: string; label: string }

// w-full + min-w-0: long option labels must never push a form wider than a phone screen.
const input = 'min-h-touch w-full min-w-0 rounded border border-stone-300 px-3';

function useLookup(table: string, label: 'name' | 'full_name') {
  const { i18n } = useTranslation();
  return useQuery({
    queryKey: ['lookup', table],
    staleTime: 300_000,
    queryFn: async () => {
      const cols = label === 'full_name' ? 'id, full_name' : table === 'locations' ? 'id, code, name_ar, name_en' : 'id, code, name_ar, name_en';
      let q = requireSupabase().from(table).select(cols);
      if (table !== 'user_profiles') q = q.is('voided_at', null);
      const { data, error } = await q;
      if (error) throw error;
      return (data as unknown as Record<string, string | null>[]).map<Option>((r) => ({
        id: r.id as string,
        label: label === 'full_name' ? (r.full_name ?? '') : `${r.code ? `${r.code} · ` : ''}${localized(i18n.language, r.name_ar, r.name_en)}`,
      }));
    },
  });
}

function emptyForm(spec: EntitySpec, row?: Row): Form {
  const f: Form = {};
  for (const fs of spec.fields) {
    const v = row?.[fs.name];
    f[fs.name] = fs.kind === 'bool' ? (row ? v === true : fs.name !== 'allow_self_verification') : v == null ? '' : String(v);
  }
  return f;
}

/** Administration of farm master data: create, edit, void (with reason), verify (with source) — RLS decides. */
export default function MasterDataPage() {
  const { entity = '' } = useParams();
  const spec = entitySpec(entity);
  const { t } = useTranslation();
  if (!spec) return <p className="p-4">{t('work.taskNotFound')}</p>;
  return <EntityScreen key={spec.key} spec={spec} />;
}

function EntityScreen({ spec }: { spec: EntitySpec }) {
  const { t, i18n } = useTranslation();
  const { access } = useAuth();
  const qc = useQueryClient();
  const wf = useWorkflow(spec.workflowCode ?? 'asset_status');
  const lookups = {
    departments: useLookup('departments', 'name'),
    locations: useLookup('locations', 'name'),
    asset_classes: useLookup('asset_classes', 'name'),
    user_profiles: useLookup('user_profiles', 'full_name'),
  };
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<Form>(() => emptyForm(spec));
  const [open, setOpen] = useState<{ id: string; mode: 'edit' | 'void' | 'verify' | 'status' | 'members' } | null>(null);
  const [extra, setExtra] = useState({ reason: '', to: '' });
  const [error, setError] = useState<string | null>(null);

  const createScope = departmentsWith(access, spec.objectType, 'create');
  const mayCreate = createScope === 'all' || createScope.length > 0;

  const q = useQuery({
    queryKey: ['md', spec.table],
    queryFn: async () => {
      const { data, error: e } = await requireSupabase().from(spec.table).select('*').is('voided_at', null).order('code').returns<Row[]>();
      if (e) throw e;
      return data;
    },
  });

  const rows = (q.data ?? []).filter((r) => matchesSearch(`${String(r.code ?? '')} ${String(r[spec.nameColumns.ar] ?? '')} ${String(r[spec.nameColumns.en] ?? '')}`, search));

  async function run(action: () => PromiseLike<{ error: unknown }>, after?: () => void) {
    setError(null);
    const { error: e } = await action();
    if (e) { setError(errorKey(e)); return; }
    after?.();
    await qc.invalidateQueries({ queryKey: ['md', spec.table] });
    await qc.invalidateQueries({ queryKey: ['lookup'] });
  }

  function optionsFor(f: FieldSpec): Option[] {
    const all = f.lookup ? lookups[f.lookup.table].data ?? [] : [];
    // On create, the department list is limited to where the user may create.
    if (creating && f.lookup?.table === 'departments' && f.name === spec.departmentColumn && createScope !== 'all') {
      return all.filter((o) => createScope.includes(o.id));
    }
    return all;
  }

  function display(r: Row, f: FieldSpec): string {
    const v = r[f.name];
    if (f.kind === 'bool') return v ? '✓' : '—';
    if (f.kind === 'lookup' && f.lookup) {
      if (v == null) return f.lookup.nullLabelKey ? t(f.lookup.nullLabelKey) : '—';
      return lookups[f.lookup.table].data?.find((o) => o.id === v)?.label ?? '…';
    }
    return v == null || v === '' ? '—' : String(v);
  }

  function fields(f: Form, set: (f: Form) => void) {
    return spec.fields.map((fs) => (
      <label key={fs.name} className={fs.kind === 'bool' ? 'flex min-h-touch items-center gap-2' : 'flex flex-col gap-1'}>
        {fs.kind === 'bool' ? (
          <><input type="checkbox" className="h-5 w-5" checked={f[fs.name] === true} onChange={(e) => set({ ...f, [fs.name]: e.target.checked })} />{t(fs.labelKey)}</>
        ) : (
          <>
            <span>{t(fs.labelKey)}{fs.required ? ' *' : ''}</span>
            {fs.kind === 'lookup' ? (
              <select className={input} value={String(f[fs.name] ?? '')} onChange={(e) => set({ ...f, [fs.name]: e.target.value })}>
                <option value="">{fs.lookup?.nullLabelKey ? t(fs.lookup.nullLabelKey) : '—'}</option>
                {optionsFor(fs).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            ) : (
              <input dir={fs.kind === 'textLtr' ? 'ltr' : undefined} className={input} value={String(f[fs.name] ?? '')}
                onChange={(e) => set({ ...f, [fs.name]: e.target.value })} />
            )}
          </>
        )}
      </label>
    ));
  }

  function submitCreate() {
    const missing = missingRequired(spec, form);
    if (missing) { setError('errors.required'); return; }
    void run(() => requireSupabase().from(spec.table).insert({ ...toPayload(spec, form), farm_id: access?.farmId }), () => {
      setCreating(false);
      setForm(emptyForm(spec));
    });
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">{t(spec.titleKey)}</h1>
        {mayCreate && !creating && (
          <button type="button" onClick={() => { setCreating(true); setForm(emptyForm(spec)); }} className="min-h-touch rounded bg-brand px-4 font-semibold text-white">{t('md.add')}</button>
        )}
      </div>
      <p className="text-sm text-stone-600">{t('md.honesty')}</p>
      {error && <p role="alert" className="text-red-700">{t(error)}</p>}
      {creating && (
        <form className="grid gap-3 rounded-lg border bg-white p-4 sm:grid-cols-2 lg:grid-cols-3" onSubmit={(e) => { e.preventDefault(); submitCreate(); }}>
          {fields(form, setForm)}
          <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-3">
            <button type="submit" className="min-h-touch rounded bg-brand px-4 font-semibold text-white">{t('common.save')}</button>
            <button type="button" className="min-h-touch rounded border px-4" onClick={() => setCreating(false)}>{t('common.cancel')}</button>
          </div>
        </form>
      )}
      <label className="flex max-w-sm flex-col gap-1"><span>{t('common.search')}</span>
        <input type="search" className={input} value={search} onChange={(e) => setSearch(e.target.value)} /></label>
      <QueryState isLoading={q.isLoading} error={q.error} isEmpty={rows.length === 0} onRetry={() => void q.refetch()}>
        <ul className="flex flex-col gap-2">
          {rows.map((r) => {
            const deptId = spec.departmentColumn ? (r[spec.departmentColumn] as string | null) : null;
            const allow = (action: string) => can(access, spec.objectType, action, { departmentId: deptId });
            return (
              <li key={r.id} className="rounded-lg border bg-white p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {spec.fields.filter((f) => f.list).map((f) => (
                      <span key={f.name}><span className="text-xs text-stone-500">{t(f.labelKey)}: </span>{f.kind === 'textLtr' ? <bdi>{display(r, f)}</bdi> : display(r, f)}</span>
                    ))}
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {spec.workflowCode && r.status && <span className="rounded border px-2 py-0.5 text-sm">{statusLabel(wf.data, r.workflow_version_id ?? null, r.status, i18n.language)}</span>}
                    <VerificationBadge status={r.verification_status} />
                  </div>
                </div>
                {!open && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {allow('configure') && <button type="button" className="min-h-touch rounded border px-3" onClick={() => { setOpen({ id: r.id, mode: 'edit' }); setForm(emptyForm(spec, r)); }}>{t('md.edit')}</button>}
                    {spec.workflowCode && allow('configure') && <button type="button" className="min-h-touch rounded border px-3" onClick={() => { setOpen({ id: r.id, mode: 'status' }); setExtra({ reason: '', to: '' }); }}>{t('wells.changeStatus')}</button>}
                    {spec.key === 'crews' && <button type="button" className="min-h-touch rounded border px-3" onClick={() => setOpen({ id: r.id, mode: 'members' })}>{t('md.members')}</button>}
                    {allow('verify') && r.verification_status !== 'verified' && <button type="button" className="min-h-touch rounded border border-brand px-3 text-brand-dark" onClick={() => { setOpen({ id: r.id, mode: 'verify' }); setExtra({ reason: '', to: '' }); }}>{t('admin.verify')}</button>}
                    {allow('void') && <button type="button" className="min-h-touch rounded border border-red-600 px-3 text-red-800" onClick={() => { setOpen({ id: r.id, mode: 'void' }); setExtra({ reason: '', to: '' }); }}>{t('md.void')}</button>}
                  </div>
                )}
                {open?.id === r.id && open.mode === 'members' && (
                  <CrewMembers crewId={r.id} departmentId={deptId} onClose={() => setOpen(null)} />
                )}
                {open?.id === r.id && open.mode !== 'members' && (
                  <form className="mt-3 grid gap-2 sm:grid-cols-2" onSubmit={(e) => {
                    e.preventDefault();
                    const db = requireSupabase();
                    const done = () => setOpen(null);
                    if (open.mode === 'edit') {
                      if (missingRequired(spec, form)) { setError('errors.required'); return; }
                      void run(() => db.from(spec.table).update({ ...toPayload(spec, form), version: r.version }).eq('id', r.id), done);
                    }
                    if (open.mode === 'void') void run(() => db.rpc('void_record', { p_entity_type: spec.table, p_id: r.id, p_reason: extra.reason, p_expected_version: r.version }), done);
                    if (open.mode === 'verify') void run(() => db.rpc('set_verification_status', { p_entity_type: spec.table, p_id: r.id, p_status: 'verified', p_source_note: extra.reason, p_expected_version: r.version }), done);
                    if (open.mode === 'status') void run(() => db.rpc('transition_record', { p_entity_type: spec.table, p_id: r.id, p_to_status: extra.to, p_comment: extra.reason, p_expected_version: r.version }), done);
                  }}>
                    {open.mode === 'edit' && fields(form, setForm)}
                    {open.mode === 'status' && (
                      <label className="flex min-w-0 flex-col gap-1"><span>{t('wells.newStatus')}</span>
                        <select required className={input} value={extra.to} onChange={(e) => setExtra({ ...extra, to: e.target.value })}>
                          <option value="">—</option>
                          {nextTransitions(wf.data, r.workflow_version_id ?? '', r.status ?? '').map((o) => (
                            <option key={o.to_status} value={o.to_status}>{statusLabel(wf.data, r.workflow_version_id ?? null, o.to_status, i18n.language)}</option>
                          ))}
                        </select></label>
                    )}
                    {open.mode !== 'edit' && (
                      <label className="flex flex-col gap-1 sm:col-span-2">
                        <span>{open.mode === 'verify' ? t('admin.sourceNote') : open.mode === 'void' ? t('md.voidReason') : t('wells.reason')}</span>
                        <input required className={input} value={extra.reason} onChange={(e) => setExtra({ ...extra, reason: e.target.value })} />
                      </label>
                    )}
                    <div className="flex gap-2 sm:col-span-2">
                      <button type="submit" className="min-h-touch rounded bg-brand px-4 font-semibold text-white">{t('common.save')}</button>
                      <button type="button" className="min-h-touch rounded border px-4" onClick={() => setOpen(null)}>{t('common.cancel')}</button>
                    </div>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      </QueryState>
    </section>
  );
}
