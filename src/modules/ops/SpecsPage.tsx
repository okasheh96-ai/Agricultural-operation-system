import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { requireSupabase } from '@/core/supabase';
import { opsErrorMessage, rpc, useInvalidateOps, useMyPermissions } from './api';
import { btn, btnPrimary, Card, field, Loaded, PageTitle, Pill, SaveStatus, Tabs, useFmt, type SaveState, type Tone } from './ui';

interface SpecRow { id: string; code: string; version_no: number; title: string; state: 'awaiting_approval' | 'approved' | 'superseded'; source_ref: string;
  approved_at: string | null; approval_note: string | null; data: SpecData }
interface SpecProduct { code: string; name_en: string; pages: number[]; summary: string; attributes: Record<string, string>;
  defects: Record<string, string[]>; flags: string[] }
interface SpecData { products: SpecProduct[]; procedure: { step: number; en: string; page: number }[]; rule: string; override_note: string;
  inspector_checklist: { items: string[]; page: number }; customers: string[] }
interface RuleRow { product_code: string; grade: string; criterion: string; customer: string | null; band: number; min_value: string | null; max_value: string | null;
  min_exclusive: boolean; unit: string; text_value: string | null; note: string | null; page: number; inactive: boolean }
interface TolRow { product_code: string; grade: string; category: string; max_pct: string; page: number }
interface CheckResult { state: string; version: number; grades: { grade: string; result: 'meets' | 'fails' | 'boundary' | 'qa_review'; fails: string[]; boundary: string[];
  checks: { criterion: string; value: number; ok: boolean; max?: number }[] }[] }

const GRADES = ['premium', 'gr1', 'gr2'] as const;
const RESULT_TONE: Record<string, Tone> = { meets: 'good', fails: 'bad', boundary: 'warn', qa_review: 'warn' };

function useSpec() {
  return useQuery({ queryKey: ['ops', 'spec'], queryFn: async () => {
    const db = requireSupabase();
    const s = await db.from('ph_specs').select('*').is('voided_at', null).eq('code', 'S-07').order('version_no', { ascending: false }).limit(1);
    if (s.error) throw s.error;
    const spec = (s.data ?? [])[0] as SpecRow | undefined;
    if (!spec) return null;
    const [r, t] = await Promise.all([
      db.from('ph_spec_rules').select('*').eq('spec_id', spec.id).is('voided_at', null).order('criterion').order('band'),
      db.from('ph_spec_tolerances').select('*').eq('spec_id', spec.id).is('voided_at', null),
    ]);
    if (r.error) throw r.error;
    if (t.error) throw t.error;
    return { spec, rules: (r.data ?? []) as RuleRow[], tolerances: (t.data ?? []) as TolRow[] };
  } });
}

function range(r: RuleRow, t: (k: string, o?: Record<string, unknown>) => string): string {
  if (r.text_value) return r.text_value;
  if (r.min_value !== null && r.max_value !== null) return `${Number(r.min_value)}–${Number(r.max_value)} ${r.unit}`;
  if (r.min_value !== null) return `${r.min_exclusive ? '>' : '≥'} ${Number(r.min_value)} ${r.unit}`;
  if (r.max_value !== null) return `≤ ${Number(r.max_value)} ${r.unit}`;
  return t('ops.unknown');
}

/** Grading specification S-07 as supplied: product by product, with the page it comes from. QA approves it (OD-43); the
 *  grade check below is a suggestion for the inspector, never an automatic release. */
export default function SpecsPage() {
  const { t } = useTranslation();
  const q = useSpec();
  return (
    <div>
      <PageTitle title={t('ops.specs.title')} sub={t('ops.specs.sub')} />
      <Loaded query={q}>
        {(d) => d ? <Spec d={d} /> : <p className="text-sm text-ops-muted">{t('ops.specs.none')}</p>}
      </Loaded>
    </div>
  );
}

function Spec({ d }: { d: { spec: SpecRow; rules: RuleRow[]; tolerances: TolRow[] } }) {
  const { t } = useTranslation();
  const fmt = useFmt();
  const perms = useMyPermissions();
  const invalidate = useInvalidateOps();
  const products = d.spec.data.products;
  const [tab, setTab] = useState(products[0]?.code ?? '');
  const [note, setNote] = useState('');
  const [state, setState] = useState<SaveState>({ kind: 'idle' });
  const p = products.find((x) => x.code === tab) ?? products[0];
  const approve = async () => {
    setState({ kind: 'pending' });
    try { await rpc('ph_spec_approve', { p_spec: d.spec.id, p_note: note }); setState({ kind: 'saved', at: new Date().toISOString() }); await invalidate(); }
    catch (e) { setState({ kind: 'failed', message: opsErrorMessage(t, e) }); }
  };
  if (!p) return null;
  const rules = d.rules.filter((r) => r.product_code === p.code);
  const criteria = [...new Set(rules.map((r) => r.criterion))];
  return (
    <div className="grid gap-4">
      <Card title={`${d.spec.code} · v${d.spec.version_no}`} sub={d.spec.source_ref}
        action={d.spec.state === 'approved' ? <Pill tone="good">{t('ops.specs.approved', { when: fmt.date(d.spec.approved_at) })}</Pill> : <Pill tone="warn">{t('ops.specs.awaiting')}</Pill>}>
        {d.spec.state === 'awaiting_approval' && <p className="text-sm text-ops-muted">{t('ops.specs.awaitingHelp')}</p>}
        {d.spec.state === 'awaiting_approval' && perms.data?.has('spec.approve') && (
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="min-w-[16rem] flex-1 text-sm">{t('ops.specs.approvalNote')}<input className={field} value={note} onChange={(e) => setNote(e.target.value)} /></label>
            <button type="button" className={btnPrimary} disabled={!note.trim()} onClick={approve}>{t('ops.specs.approve')}</button>
          </div>
        )}
        <div className="mt-2"><SaveStatus state={state} /></div>
      </Card>

      <Tabs label={t('ops.specs.products')} value={p.code} onChange={setTab} tabs={products.map((x) => ({ key: x.code, label: x.name_en }))} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="grid content-start gap-4">
          <Card title={p.name_en} sub={`${p.summary} · ${t('ops.specs.pages', { p: p.pages.join(', ') })}`}>
            <div className="overflow-x-auto rounded-ops-sm border border-ops-line ops-scroll-thin">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="bg-ops-surface2 text-ops-muted"><tr>
                  <th className="px-3 py-2 text-start">{t('ops.specs.criterion')}</th>
                  {GRADES.map((g) => <th key={g} className="px-3 py-2 text-start">{t(`ops.grades.${g}`)}</th>)}
                </tr></thead>
                <tbody className="divide-y divide-ops-line">
                  {criteria.map((c) => (
                    <tr key={c} className="align-top">
                      <td className="px-3 py-2 font-medium">{t(`ops.specs.crit.${c}`)}</td>
                      {GRADES.map((g) => (
                        <td key={g} className="px-3 py-2">
                          {rules.filter((r) => r.criterion === c && r.grade === g).map((r, i) => (
                            <div key={i} className={`mb-1 ${r.inactive ? 'opacity-60' : ''}`}>
                              {r.customer && <Pill tone="info">{r.customer}</Pill>} <bdi className="ops-num">{range(r, t)}</bdi>
                              {r.inactive && <span className="ms-1 text-xs text-ops-amber">({t('ops.specs.inactive')})</span>}
                              {r.note && <div className="text-xs text-ops-muted">{r.note}</div>}
                            </div>
                          ))}
                        </td>
                      ))}
                    </tr>
                  ))}
                  <tr className="align-top bg-ops-surface2/50">
                    <td className="px-3 py-2 font-medium">{t('ops.specs.tolerances')}</td>
                    {GRADES.map((g) => (
                      <td key={g} className="px-3 py-2 text-xs">
                        {d.tolerances.filter((x) => x.product_code === p.code && x.grade === g).map((x) => (
                          <div key={x.category}>{t(`ops.specs.cat.${x.category}`)}: <bdi className="ops-num font-semibold">{Number(x.max_pct)}%</bdi></div>
                        ))}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
            {p.flags.length > 0 && (
              <ul className="mt-3 grid gap-1 text-xs text-ops-amber">{p.flags.map((f) => <li key={f}>! {f}</li>)}</ul>
            )}
          </Card>
          {Object.keys(p.attributes).length > 0 && (
            <Card title={t('ops.specs.quality')}>
              <dl className="grid gap-2 text-sm sm:grid-cols-2">
                {Object.entries(p.attributes).map(([k, v]) => <div key={k}><dt className="font-semibold">{k}</dt><dd className="text-ops-muted">{v}</dd></div>)}
              </dl>
            </Card>
          )}
          {Object.keys(p.defects).length > 0 && (
            <Card title={t('ops.specs.defects')}>
              <div className="grid gap-3 sm:grid-cols-2">
                {Object.entries(p.defects).map(([cat, list]) => (
                  <div key={cat} className="rounded-ops-sm border border-ops-line p-3">
                    <h3 className="mb-1 text-sm font-semibold">{t(`ops.specs.cat.${cat}`)}</h3>
                    <ul className="list-disc ps-5 text-sm text-ops-muted">{list.map((x) => <li key={x}>{x}</li>)}</ul>
                  </div>
                ))}
              </div>
            </Card>
          )}
          <Card title={t('ops.specs.procedure')} sub={d.spec.data.rule}>
            <ol className="grid gap-2 text-sm">{d.spec.data.procedure.map((s) => (
              <li key={s.step} className="flex gap-3"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-ops-soft text-xs font-bold text-ops-accent">{s.step}</span>{s.en}</li>
            ))}</ol>
            <p className="mt-3 text-xs text-ops-muted">{d.spec.data.override_note}</p>
          </Card>
        </div>
        <GradeCheck product={p.code} customers={d.spec.data.customers} />
      </div>
    </div>
  );
}

function GradeCheck({ product, customers }: { product: string; customers: string[] }) {
  const { t } = useTranslation();
  const [m, setM] = useState<Record<string, string>>({});
  const [def, setDef] = useState<Record<string, string>>({});
  const [customer, setCustomer] = useState('');
  const [soft, setSoft] = useState(false);
  const [res, setRes] = useState<CheckResult | null>(null);
  const [err, setErr] = useState('');
  const inputs = useMemo(() => ['colour_stage', 'colour_coverage', 'diameter', 'length', 'weight'], []);
  const run = async () => {
    setErr('');
    try {
      const measures: Record<string, unknown> = { soft };
      for (const k of inputs) if (m[k]) measures[k] = Number(m[k]);
      const defects: Record<string, unknown> = {};
      for (const k of ['sample', 'colour', 'minor', 'major', 'unacceptable', 'live_insects']) if (def[k]) defects[k] = Number(def[k]);
      setRes(await rpc<CheckResult>('ph_spec_check', { p_product: product, p_customer: customer || null, p_measures: measures, p_defects: defects }));
    } catch (e) { setErr(opsErrorMessage(t, e)); }
  };
  return (
    <aside className="ops-card sticky top-20 grid content-start gap-3 self-start p-4" aria-label={t('ops.specs.check')}>
      <h2 className="font-semibold">{t('ops.specs.check')}</h2>
      <p className="text-xs text-ops-muted">{t('ops.specs.checkHelp')}</p>
      <label className="text-sm">{t('ops.specs.customer')}
        <select className={field} value={customer} onChange={(e) => setCustomer(e.target.value)}>
          <option value="">{t('ops.specs.standard')}</option>
          {customers.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-2">
        {inputs.map((k) => (
          <label key={k} className="text-xs">{t(`ops.specs.crit.${k}`)}
            <input className={field} dir="ltr" inputMode="decimal" value={m[k] ?? ''} onChange={(e) => setM({ ...m, [k]: e.target.value.replace(',', '.') })} /></label>
        ))}
        <label className="flex min-h-[44px] items-center gap-2 self-end text-sm"><input type="checkbox" className="h-5 w-5" checked={soft} onChange={(e) => setSoft(e.target.checked)} />{t('ops.specs.soft')}</label>
      </div>
      <fieldset className="grid grid-cols-3 gap-2 rounded-ops-sm border border-ops-line p-2">
        <legend className="px-1 text-xs font-medium">{t('ops.specs.defectCounts')}</legend>
        {['sample', 'colour', 'minor', 'major', 'unacceptable', 'live_insects'].map((k) => (
          <label key={k} className="text-xs">{t(`ops.specs.cat.${k}`)}
            <input className={field} dir="ltr" inputMode="numeric" value={def[k] ?? ''} onChange={(e) => setDef({ ...def, [k]: e.target.value })} /></label>
        ))}
      </fieldset>
      <button type="button" className={btn} onClick={run}>{t('ops.specs.runCheck')}</button>
      {err && <p role="alert" className="text-sm text-ops-red">{err}</p>}
      {res && (
        <div className="grid gap-2" role="status">
          {res.state !== 'approved' && <p className="text-xs text-ops-amber">! {t('ops.specs.awaiting')}</p>}
          {res.grades.map((g) => (
            <div key={g.grade} className="rounded-ops-sm border border-ops-line p-2 text-sm">
              <div className="flex items-center justify-between gap-2"><span className="font-semibold">{t(`ops.grades.${g.grade}`)}</span>
                <Pill tone={RESULT_TONE[g.result] ?? 'neutral'}>{t(`ops.specs.result.${g.result}`)}</Pill></div>
              {g.fails.length > 0 && <p className="mt-1 text-xs text-ops-red">{g.fails.map((f) => t(`ops.specs.fail.${f}`, { defaultValue: t(`ops.specs.crit.${f}`, { defaultValue: f }) })).join('، ')}</p>}
              {g.boundary.length > 0 && <p className="mt-1 text-xs text-ops-amber">{t('ops.specs.boundaryHelp')}</p>}
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}
