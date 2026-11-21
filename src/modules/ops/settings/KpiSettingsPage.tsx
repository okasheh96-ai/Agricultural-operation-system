import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { requireSupabase } from '@/core/supabase';
import { phReason } from '@/modules/packing-house/phErrors';
import { localName, opsErrorMessage, rpc, useInvalidateOps, useMyPermissions } from '../api';
import { btn, btnPrimary, Card, EmptyState, field, PageTitle, Pill, SaveStatus, type SaveState, Loaded } from '../ui';
import { KpiCardView, type KpiDef, type KpiFilter, type KpiResult } from '../config/KpiCards';
import { useCatalog, useRoleOptions } from '../config/useConfig';
import type { Catalog } from '../config/types';

interface KpiRow { id: string; code: string; version_no: number; state: 'draft' | 'published' | 'superseded' | 'retired'; definition: KpiDef; sort_order: number; published_at: string | null }

function useKpiDefs() {
  return useQuery({ queryKey: ['ops', 'kpi-defs'], queryFn: async () => {
    const { data, error } = await requireSupabase().from('ph_kpi_defs').select('id, code, version_no, state, definition, sort_order, published_at')
      .is('voided_at', null).order('sort_order').order('code').order('version_no', { ascending: false });
    if (error) throw error;
    return (data ?? []) as KpiRow[];
  } });
}

const blank = (): KpiDef => ({ title_ar: '', dataset: 'output', measure: 'count', window: 'today', filters: [], roles: [] });

/** Settings → KPI cards: the Owner picks a dataset, a measure, filters, a grouping, a window, a target and who sees it, previews
 *  the live value, then publishes. The server builds the query only from whitelisted names; values are bound parameters. */
export default function KpiSettingsPage() {
  const { t, i18n } = useTranslation();
  const defs = useKpiDefs();
  const catalog = useCatalog();
  const perms = useMyPermissions();
  const [code, setCode] = useState('');
  const [def, setDef] = useState<KpiDef>(blank);
  const [editKey, setEditKey] = useState(0);
  const open = (c: string, d: KpiDef) => { setCode(c); setDef(d); setEditKey((k) => k + 1); };
  const latest = (rows: KpiRow[]) => rows.filter((r, i) => rows.findIndex((x) => x.code === r.code) === i);
  return (
    <div>
      <PageTitle title={t('ops.kpiset.title')} sub={t('ops.kpiset.sub')} />
      <Loaded query={defs}>
        {(rows) => (
          <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
            <Card title={t('ops.kpiset.list')}>
              {rows.length === 0 ? <EmptyState>{t('ops.kpiset.none')}</EmptyState> : (
                <ul className="grid gap-1">
                  {latest(rows).map((r) => {
                    const pub = rows.find((x) => x.code === r.code && x.state === 'published');
                    return (
                      <li key={r.code}>
                        <button type="button" aria-current={code === r.code} onClick={() => open(r.code, structuredClone(r.definition))}
                          className={`w-full rounded-ops-sm border p-2 text-start ${code === r.code ? 'border-ops-accent bg-ops-soft' : 'border-ops-line'}`}>
                          <span className="block font-semibold">{localName(i18n.language, r.definition.title_ar, r.definition.title_en)}</span>
                          <span className="mt-1 flex flex-wrap gap-1"><bdi className="text-xs text-ops-muted">{r.code}</bdi>
                            {pub ? <Pill tone="good">{t('ops.opset.inEffect', { v: pub.version_no })}</Pill> : <Pill tone={r.state === 'retired' ? 'neutral' : 'warn'}>{t(`ops.kpiset.states.${r.state}`)}</Pill>}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              <button type="button" className={`${btn} mt-3 w-full`} onClick={() => open('', blank())}>＋ {t('ops.kpiset.new')}</button>
            </Card>
            {catalog.data && <Builder key={editKey} initialCode={code} def={def} setDef={setDef} catalog={catalog.data}
              canEdit={!!perms.data?.has('settings.edit')} canPublish={!!perms.data?.has('settings.publish')} onSaved={setCode} />}
          </div>
        )}
      </Loaded>
    </div>
  );
}

function Builder({ initialCode, def, setDef, catalog, canEdit, canPublish, onSaved }: {
  initialCode: string; def: KpiDef; setDef: (d: KpiDef) => void; catalog: Catalog; canEdit: boolean; canPublish: boolean; onSaved: (c: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const roles = useRoleOptions();
  const invalidate = useInvalidateOps();
  const [code, setCode] = useState(initialCode);
  const [preview, setPreview] = useState<KpiResult | { error: string } | undefined>();
  const [problems, setProblems] = useState<{ key: string; field?: string }[]>([]);
  const [state, setState] = useState<SaveState>({ kind: 'idle' });
  const [note, setNote] = useState('');
  const ds = catalog.datasets.find((d) => d.dataset === def.dataset) ?? catalog.datasets[0] ?? { dataset: '', time_column: '', columns: [], numeric_columns: [], label_en: '', label_ar: '' };
  const set = (patch: Partial<KpiDef>) => setDef({ ...def, ...patch });
  const filterFields = [...ds.columns, ...ds.numeric_columns];

  useEffect(() => {
    let live = true;
    const h = window.setTimeout(async () => {
      try {
        const errs = await rpc<{ key: string; field?: string }[]>('ph_kpi_validate', { p_def: def });
        if (!live) return;
        setProblems(errs);
        setPreview(errs.length ? undefined : await rpc<KpiResult>('ph_kpi_eval', { p_def: def }));
      } catch (e) { if (live) setPreview({ error: opsErrorMessage(t, e) }); }
    }, 400);
    return () => { live = false; window.clearTimeout(h); };
  }, [def, t]);

  const save = async (publish: boolean) => {
    setState({ kind: 'pending' });
    try {
      const r = await rpc<{ code: string; version: number }>('ph_kpi_save', { p_code: code, p_def: def, p_publish: publish, p_note: note || null });
      setState({ kind: 'saved', at: new Date().toISOString(), text: publish ? t('ops.opset.published', { v: r.version }) : t('ops.kpiset.draftSaved') });
      await invalidate(); onSaved(r.code);
    } catch (e) {
      const reason = phReason(e);
      if (reason?.key === 'po.kpi.invalid' && Array.isArray(reason.errors)) setProblems(reason.errors as { key: string }[]);
      setState({ kind: 'failed', message: opsErrorMessage(t, e) });
    }
  };
  const retire = async () => {
    const reason = window.prompt(t('ops.kpiset.retireReason')) ?? '';
    if (!reason.trim()) return;
    try { await rpc('ph_kpi_retire', { p_code: code, p_reason: reason }); await invalidate(); setState({ kind: 'saved', at: new Date().toISOString(), text: t('ops.kpiset.retired') }); }
    catch (e) { setState({ kind: 'failed', message: opsErrorMessage(t, e) }); }
  };

  const filterRow = (list: KpiFilter[], key: 'filters' | 'numerator_filters') => (
    <fieldset className="grid gap-2 rounded-ops-sm border border-ops-line p-2">
      <legend className="px-1 text-sm font-medium">{key === 'filters' ? t('ops.kpiset.filters') : t('ops.kpiset.numerator')}</legend>
      {list.length === 0 && <p className="text-xs text-ops-muted">{t('ops.kpiset.noFilters')}</p>}
      {list.map((f, i) => {
        const numeric = ds.numeric_columns.includes(f.field);
        return (
          <div key={i} className="grid gap-2 sm:grid-cols-[1fr_8rem_1fr_auto]">
            <select aria-label={t('ops.opset.condField')} className={field} value={f.field} onChange={(e) => set({ [key]: list.map((x, j) => (j === i ? { ...x, field: e.target.value, op: 'eq' } : x)) })}>
              {filterFields.map((c) => <option key={c} value={c}>{t(`ops.kpiset.cols.${c}`, { defaultValue: c })}</option>)}
            </select>
            <select aria-label={t('ops.opset.condOp')} className={field} value={f.op} onChange={(e) => set({ [key]: list.map((x, j) => (j === i ? { ...x, op: e.target.value } : x)) })}>
              {(numeric ? ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'] : ['eq', 'neq']).map((o) => <option key={o} value={o}>{t(`ops.opset.ops.${o}`)}</option>)}
            </select>
            <input aria-label={t('ops.opset.condValue')} className={field} dir={numeric ? 'ltr' : undefined} value={f.value} onChange={(e) => set({ [key]: list.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} />
            <button type="button" className={btn} onClick={() => set({ [key]: list.filter((_, j) => j !== i) })}>{t('ops.run.removeRow')}</button>
          </div>
        );
      })}
      <button type="button" className={btn} onClick={() => set({ [key]: [...list, { field: ds.columns[0] ?? '', op: 'eq', value: '' }] })}>＋ {t('ops.kpiset.addFilter')}</button>
    </fieldset>
  );

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <Card title={code ? <bdi>{code}</bdi> : t('ops.kpiset.new')}>
        <fieldset disabled={!canEdit} className="grid gap-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-sm">{t('ops.kpiset.code')}<input className={field} dir="ltr" value={code} disabled={!!initialCode} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))} /></label>
            <label className="text-sm">{t('ops.kpiset.order')}<input className={field} dir="ltr" inputMode="numeric" value={def.sort_order ?? ''} onChange={(e) => set({ sort_order: e.target.value ? Number(e.target.value) : undefined })} /></label>
            <label className="text-sm">{t('ops.kpiset.titleAr')}<input className={field} value={def.title_ar} onChange={(e) => set({ title_ar: e.target.value })} /></label>
            <label className="text-sm">{t('ops.kpiset.titleEn')}<input className={field} dir="ltr" value={def.title_en ?? ''} onChange={(e) => set({ title_en: e.target.value })} /></label>
            <label className="text-sm">{t('ops.kpiset.dataset')}
              <select className={field} value={def.dataset} onChange={(e) => set({ dataset: e.target.value, field: undefined, filters: [], numerator_filters: undefined, group_by: undefined })}>
                {catalog.datasets.map((d) => <option key={d.dataset} value={d.dataset}>{localName(i18n.language, d.label_ar, d.label_en)}</option>)}
              </select>
            </label>
            <label className="text-sm">{t('ops.kpiset.measure')}
              <select className={field} value={def.measure} onChange={(e) => set({ measure: e.target.value as KpiDef['measure'], numerator_filters: e.target.value === 'ratio' ? (def.numerator_filters ?? []) : undefined })}>
                {catalog.measures.map((m) => <option key={m} value={m}>{t(`ops.kpiset.measures.${m}`)}</option>)}
              </select>
            </label>
            {['sum', 'avg', 'rate_per_hour'].includes(def.measure) && (
              <label className="text-sm">{t('ops.kpiset.field')}
                <select className={field} value={def.field ?? ''} onChange={(e) => set({ field: e.target.value })}>
                  <option value="">{t('ops.run.choose')}</option>
                  {ds.numeric_columns.map((c) => <option key={c} value={c}>{t(`ops.kpiset.cols.${c}`, { defaultValue: c })}</option>)}
                </select>
              </label>
            )}
            <label className="text-sm">{t('ops.kpiset.window')}
              <select className={field} value={def.window} onChange={(e) => set({ window: e.target.value })}>
                {catalog.windows.map((w) => <option key={w} value={w}>{t(`ops.kpiset.windows.${w}`)}</option>)}
              </select>
            </label>
            <label className="text-sm">{t('ops.kpiset.groupBy')}
              <select className={field} value={def.group_by ?? ''} onChange={(e) => set({ group_by: e.target.value || undefined })}>
                <option value="">{t('ops.kpiset.noGroup')}</option>
                <option value="day">{t('ops.kpiset.byDay')}</option>
                {ds.columns.map((c) => <option key={c} value={c}>{t(`ops.kpiset.cols.${c}`, { defaultValue: c })}</option>)}
              </select>
            </label>
            <label className="text-sm">{t('ops.kpiset.unit')}<input className={field} dir="ltr" value={def.unit ?? ''} onChange={(e) => set({ unit: e.target.value || undefined })} /></label>
            <label className="text-sm">{t('ops.kpiset.target')}<input className={field} dir="ltr" inputMode="decimal" value={def.target ?? ''} onChange={(e) => set({ target: e.target.value || undefined })} /></label>
            <label className="text-sm">{t('ops.kpiset.targetDir')}
              <select className={field} value={def.target_dir ?? 'max'} onChange={(e) => set({ target_dir: e.target.value as 'min' | 'max' })}>
                <option value="max">{t('ops.kpiset.atMost')}</option><option value="min">{t('ops.kpiset.atLeast')}</option>
              </select>
            </label>
          </div>
          {filterRow(def.filters ?? [], 'filters')}
          {def.measure === 'ratio' && filterRow(def.numerator_filters ?? [], 'numerator_filters')}
          <fieldset className="rounded-ops-sm border border-ops-line p-2">
            <legend className="px-1 text-sm font-medium">{t('ops.kpiset.visibleTo')}</legend>
            <p className="mb-2 text-xs text-ops-muted">{t('ops.kpiset.visibleHelp')}</p>
            <div className="flex flex-wrap gap-2">
              {(roles.data ?? []).map((r) => (
                <label key={r.spec_code} className="flex min-h-[44px] items-center gap-2 rounded-ops-sm border border-ops-line px-2 text-sm">
                  <input type="checkbox" className="h-5 w-5" checked={(def.roles ?? []).includes(r.spec_code)}
                    onChange={(e) => set({ roles: e.target.checked ? [...(def.roles ?? []), r.spec_code] : (def.roles ?? []).filter((x) => x !== r.spec_code) })} />
                  <bdi>{r.spec_code}</bdi>
                </label>
              ))}
            </div>
          </fieldset>
          <label className="text-sm">{t('ops.opset.changeNote')}<input className={field} value={note} onChange={(e) => setNote(e.target.value)} /></label>
        </fieldset>
        {problems.length > 0 && (
          <ul className="mt-3 list-disc ps-5 text-sm text-ops-red" role="alert">{problems.map((p, i) => <li key={i}>{t(`ops.kpiErrors.${p.key}`, { field: p.field ?? '', defaultValue: p.key })}</li>)}</ul>
        )}
        {canEdit && (
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={btn} disabled={!code} onClick={() => save(false)}>{t('ops.opset.saveDraft')}</button>
            {canPublish && <button type="button" className={btnPrimary} disabled={!code || problems.length > 0} onClick={() => save(true)}>{t('ops.opset.publish')}</button>}
            {canPublish && initialCode && <button type="button" className={btn} onClick={retire}>{t('ops.opset.retire')}</button>}
          </div>
        )}
        <div className="mt-2"><SaveStatus state={state} /></div>
      </Card>
      <aside className="grid content-start gap-2" aria-label={t('ops.opset.previewTitle')}>
        <h3 className="font-semibold">{t('ops.kpiset.livePreview')}</h3>
        <KpiCardView def={def} result={preview} code={code} />
        <p className="text-xs text-ops-muted">{t('ops.kpiset.unknownNote')}</p>
      </aside>
    </div>
  );
}
