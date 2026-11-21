import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { requireSupabase } from '@/core/supabase';
import { localName, opsErrorMessage, rpc, useInvalidateOps, useMyPermissions } from './api';
import { btn, btnPrimary, Card, EmptyState, field, PageTitle, Pill, SaveStatus, useFmt, type SaveState, type Tone, Loaded } from './ui';
import { FormRenderer } from './config/FormRenderer';
import { useOpTypes, versionInEffect } from './config/useConfig';
import type { OpDef, Values } from './config/types';

interface RunRow {
  id: string; code: string; op_code: string; op_name_ar: string; op_name_en: string | null; version_no: number; definition: OpDef; subject_kind: string;
  subject_id: string | null; subject_code: string | null; current_step: string | null; created_at: string; completed_at: string | null; failed_at: string | null;
  cancelled_at: string | null; cancel_reason: string | null; run_state: 'open' | 'failed' | 'completed' | 'cancelled'; op_retired: boolean;
  step_values: Record<string, { values: Values; by_name: string | null; at: string; passed: boolean; decision: string | null; note: string | null }>;
}
const RUN_TONE: Record<RunRow['run_state'], Tone> = { open: 'info', failed: 'bad', completed: 'good', cancelled: 'neutral' };

function useRuns(id?: string) {
  return useQuery({ queryKey: ['ops', 'op-runs', id ?? 'all'], queryFn: async () => {
    let q = requireSupabase().from('ph_op_runs').select('*').order('created_at', { ascending: false }).limit(200);
    if (id) q = q.eq('id', id);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []) as RunRow[];
  } });
}

/** Operations menu: start an owner-defined operation by hand, and see runs (open first). */
export function OperationsListPage() {
  const { t, i18n } = useTranslation();
  const fmt = useFmt();
  const types = useOpTypes();
  const runs = useRuns();
  const nav = useNavigate();
  const [state, setState] = useState<SaveState>({ kind: 'idle' });
  const invalidate = useInvalidateOps();
  const start = async (code: string) => {
    setState({ kind: 'pending' });
    try { const r = await rpc<{ id: string }>('ph_op_start', { p_code: code }); await invalidate(); nav(`/ops/run/${r.id}`); }
    catch (e) { setState({ kind: 'failed', message: opsErrorMessage(t, e) }); }
  };
  const manual = (types.data ?? []).filter((o) => !o.retired_at && versionInEffect(o)?.definition.trigger.hook === 'manual');
  return (
    <div>
      <PageTitle title={t('ops.run.listTitle')} sub={t('ops.run.listSub')} />
      <div className="grid gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
        <Card title={t('ops.run.startTitle')}>
          {manual.length === 0 ? <EmptyState>{t('ops.run.noManual')}</EmptyState> : (
            <ul className="grid gap-2">{manual.map((o) => (
              <li key={o.id}><button type="button" className={`${btn} w-full justify-start`} onClick={() => start(o.code)}>▶ {localName(i18n.language, o.name_ar, o.name_en)}</button></li>
            ))}</ul>
          )}
          <div className="mt-2"><SaveStatus state={state} /></div>
        </Card>
        <Loaded query={runs}>
          {(rows) => rows.length === 0 ? <EmptyState>{t('ops.run.none')}</EmptyState> : (
            <Card title={t('ops.run.runs')}>
              <table className="w-full text-sm">
                <thead><tr className="text-ops-muted"><th className="py-1 text-start font-medium">{t('ops.run.run')}</th><th className="py-1 text-start font-medium">{t('ops.run.operation')}</th>
                  <th className="py-1 text-start font-medium">{t('ops.run.subject')}</th><th className="py-1 text-start font-medium">{t('ops.run.state')}</th><th className="py-1 text-start font-medium">{t('ops.run.started')}</th></tr></thead>
                <tbody>
                  {[...rows].sort((a, b) => Number(['completed', 'cancelled'].includes(a.run_state)) - Number(['completed', 'cancelled'].includes(b.run_state))).map((r) => (
                    <tr key={r.id} className="border-t border-ops-line">
                      <td className="py-1"><Link className="font-semibold text-ops-accent underline" to={`/ops/run/${r.id}`}><bdi>{r.code}</bdi></Link></td>
                      <td className="py-1">{localName(i18n.language, r.op_name_ar, r.op_name_en)} <span className="text-ops-muted">v{r.version_no}</span></td>
                      <td className="py-1"><bdi>{r.subject_code ?? '—'}</bdi></td>
                      <td className="py-1"><Pill tone={RUN_TONE[r.run_state]}>{t(`ops.run.states.${r.run_state}`)}</Pill></td>
                      <td className="py-1">{fmt.dateTime(r.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </Loaded>
      </div>
    </div>
  );
}

/** One run: the steps of the version it is pinned to, what was recorded (who, when), and the current step as a form. */
export default function OperationsRunPage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const runs = useRuns(id);
  return (
    <Loaded query={runs}>
      {(rows) => rows[0] ? <Run run={rows[0]} /> : <EmptyState>{t('ops.run.notFound')}</EmptyState>}
    </Loaded>
  );
}

function Run({ run }: { run: RunRow }) {
  const { t, i18n } = useTranslation();
  const fmt = useFmt();
  const invalidate = useInvalidateOps();
  const [values, setValues] = useState<Values>({});
  const [note, setNote] = useState('');
  const [state, setState] = useState<SaveState>({ kind: 'idle' });
  const lang = i18n.language;
  const steps = run.definition.steps;
  const current = steps.find((s) => s.key === run.current_step);
  const perms = useMyPermissions();
  const mayRecord = !!current && !!perms.data?.has(`op_${run.op_code.toLowerCase()}.${current.key}`);
  const record = async (decision?: 'approve' | 'reject') => {
    if (!current) return;
    setState({ kind: 'pending' });
    try {
      const r = await rpc<{ passed: boolean; completed: boolean }>('ph_op_record_step', { p_run: run.id, p_step: current.key, p_values: values, p_decision: decision ?? null, p_note: note || null });
      setState({ kind: 'saved', at: new Date().toISOString(), text: r.completed ? t('ops.run.completedMsg') : r.passed ? t('ops.run.passedMsg') : t('ops.run.failedMsg') });
      setValues({}); setNote(''); await invalidate();
    } catch (e) { setState({ kind: 'failed', message: opsErrorMessage(t, e) }); }
  };
  return (
    <div>
      <PageTitle title={`${localName(lang, run.op_name_ar, run.op_name_en)} · ${run.code}`}
        sub={<span className="flex flex-wrap items-center gap-2"><Pill tone={RUN_TONE[run.run_state]}>{t(`ops.run.states.${run.run_state}`)}</Pill>
          <span>{t('ops.run.pinned', { v: run.version_no })}</span>{run.subject_code && <span>· {t('ops.run.for')} <bdi>{run.subject_code}</bdi></span>}
          {run.op_retired && <Pill tone="neutral">{t('ops.opset.retired')}</Pill>}</span>}
        actions={<Link className={btn} to="/ops/tasks">{t('ops.nav.tasks')}</Link>} />
      {run.cancel_reason && <p className="mb-3 rounded-ops-sm bg-ops-grey p-2 text-sm">{t('ops.run.cancelledBecause', { reason: run.cancel_reason })}</p>}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card title={t('ops.run.history')}>
          <ol className="grid gap-2">
            {steps.map((s, i) => {
              const rec = run.step_values[s.key];
              return (
                <li key={s.key} className={`rounded-ops-sm border p-2 ${s.key === run.current_step ? 'border-ops-accent' : 'border-ops-line'} ${s.disabled ? 'opacity-60' : ''}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold">{i + 1}. {localName(lang, s.name_ar, s.name_en)} <span className="text-xs font-normal text-ops-muted">({s.role})</span></span>
                    {rec ? <Pill tone={rec.passed ? 'good' : 'bad'}>{rec.decision ? t(`ops.run.decisions.${rec.decision}`) : rec.passed ? t('ops.run.passed') : t('ops.run.failed')}</Pill>
                      : s.key === run.current_step ? <Pill tone="info">{t('ops.run.now')}</Pill> : s.disabled ? <Pill tone="neutral">{t('ops.opset.stepRetired')}</Pill> : null}
                  </div>
                  {rec && (
                    <div className="mt-1 text-sm">
                      <p className="text-ops-muted"><bdi>{rec.by_name ?? ''}</bdi> · {fmt.dateTime(rec.at)}</p>
                      <dl className="mt-1 grid gap-x-3 sm:grid-cols-2">
                        {(s.fields ?? []).map((f) => (
                          <div key={f.key}><dt className="text-ops-muted">{localName(lang, f.label_ar, f.label_en)}</dt>
                            <dd><bdi>{formatValue(t, rec.values[f.key], f.unit)}</bdi></dd></div>
                        ))}
                      </dl>
                      {rec.note && <p className="mt-1">{rec.note}</p>}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </Card>
        {current && ['open', 'failed'].includes(run.run_state) && !mayRecord ? (
          <Card title={localName(lang, current.name_ar, current.name_en)}>
            <p className="text-sm">{t('ops.run.waitingFor', { role: current.role })}</p>
            <SaveStatus state={state} />
          </Card>
        ) : current && ['open', 'failed'].includes(run.run_state) ? (
          <Card title={localName(lang, current.name_ar, current.name_en)} highlight>
            {run.run_state === 'failed' && <p className="mb-2 text-sm text-ops-red">{t('ops.run.failedRetry')}</p>}
            {current.kind === 'approval' ? (
              <div className="grid gap-2">
                <p className="text-sm">{t('ops.opset.approvalHelp')}</p>
                <label className="text-sm">{t('ops.run.note')}<input className={field} value={note} onChange={(e) => setNote(e.target.value)} /></label>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={btnPrimary} onClick={() => record('approve')}>{t('ops.run.approve')}</button>
                  <button type="button" className={btn} onClick={() => record('reject')}>{t('ops.run.reject')}</button>
                </div>
              </div>
            ) : (
              <div className="grid gap-3">
                <FormRenderer fields={current.fields ?? []} values={values} onChange={setValues} />
                <label className="text-sm">{t('ops.run.note')}<input className={field} value={note} onChange={(e) => setNote(e.target.value)} /></label>
                <button type="button" className={btnPrimary} onClick={() => record()}>{t('ops.run.record')}</button>
              </div>
            )}
            <div className="mt-2"><SaveStatus state={state} onRetry={() => record()} /></div>
          </Card>
        ) : (
          <Card title={t('ops.run.state')}><p className="text-sm">{t(`ops.run.states.${run.run_state}`)}</p><SaveStatus state={state} /></Card>
        )}
      </div>
    </div>
  );
}

function formatValue(t: (k: string) => string, v: unknown, unit?: string): string {
  if (v === undefined || v === null || v === '') return '—';
  if (typeof v === 'boolean') return v ? t('ops.yes') : t('ops.no');
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'object' && x !== null ? Object.values(x).join(' / ') : String(x))).join('؛ ');
  return unit ? `${String(v)} ${t(`ops.units.${unit}`)}` : String(v);
}
