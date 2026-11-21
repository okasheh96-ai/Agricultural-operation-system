import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { QueryState } from '@/core/components/QueryState';
import { requireSupabase } from '@/core/supabase';
import { localName, newRequestId, opsErrorMessage, rpc, useInvalidateOps, useKpis, useLines, useOverview, type AtRisk } from './api';
import { useOpsFilters } from './OverviewPage';
import { btn, btnPrimary, Card, field, Num, PageTitle, Pill, SaveStatus, useFmt, type SaveState } from './ui';

interface PlanRow { order_line_id: string; version_no: number; planned_duration_min: number; planned_start_at: string | null; promised_loading_at: string | null;
  line_id: string | null; reason: string | null; created_at: string; recorded_after_start: boolean }
interface ExecRow { order_line_id: string; started_at: string; completed_at: string | null; overrun_reason: string | null }
interface OrderRow { id: string; code: string; customer_name: string; grade: string; quantity: string; required_date: string; status: string }

function useOrderTiming() {
  return useQuery({
    queryKey: ['ops', 'order-timing'],
    queryFn: async () => {
      const db = requireSupabase();
      const [o, p, x] = await Promise.all([
        db.from('ph_order_lines').select('id, code, customer_name, grade, quantity, required_date, status').is('voided_at', null).eq('status', 'accepted').order('required_date'),
        db.from('ph_order_plans').select('order_line_id, version_no, planned_duration_min, planned_start_at, promised_loading_at, line_id, reason, created_at, recorded_after_start').is('voided_at', null).order('version_no'),
        db.from('ph_order_execution').select('order_line_id, started_at, completed_at, overrun_reason').is('voided_at', null),
      ]);
      for (const r of [o, p, x]) if (r.error) throw r.error;
      return { orders: (o.data ?? []) as OrderRow[], plans: (p.data ?? []) as PlanRow[], exec: (x.data ?? []) as ExecRow[] };
    },
  });
}

/** Order timing (KPI 3): baseline plan before start, revisions with reasons, start, completion, variance and lateness. */
export default function OrdersPage() {
  const { t } = useTranslation();
  const fmt = useFmt();
  const [f] = useOpsFilters();
  const [sp] = useSearchParams();
  const focus = sp.get('order');
  const ov = useOverview(f);
  const kpi = useKpis(ov.data?.from, ov.data?.to);
  const timing = useOrderTiming();
  const risk = new Map<string, AtRisk>((ov.data?.queue.at_risk ?? []).map((r) => [r.order_line_id, r]));
  useEffect(() => { if (focus) document.getElementById(`order-${focus}`)?.scrollIntoView({ block: 'center' }); }, [focus, timing.data]);

  return (
    <div>
      <PageTitle title={t('ops.orders.title')} sub={t('ops.kpi.ordersFormula')} />
      <Card className="mb-4" title={t('ops.orders.variance')}>
        <QueryState isLoading={kpi.isLoading} error={kpi.error} isEmpty={(kpi.data?.orders.length ?? 0) === 0} emptyText={t('ops.orders.noneInWindow')}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead><tr className="text-ops-muted">
                <th className="py-2 text-start font-medium">{t('ops.orders.order')}</th><th className="text-start font-medium">{t('ops.filters.customer')}</th>
                <th className="text-end font-medium">{t('ops.orders.actual')}</th><th className="text-end font-medium">{t('ops.orders.baseline')}</th>
                <th className="text-end font-medium">{t('ops.orders.varianceCol')}</th><th className="text-end font-medium">{t('ops.orders.lateness')}</th>
                <th className="text-start font-medium">{t('ops.orders.reason')}</th>
              </tr></thead>
              <tbody>
                {kpi.data?.orders.map((o) => (
                  <tr key={o.order_line_id} className="border-t border-ops-line">
                    <td className="py-2"><bdi className="font-semibold">{o.code}</bdi> {o.state === 'running' && <Pill tone="info">{t('ops.orders.running')}</Pill>}</td>
                    <td><bdi>{o.customer}</bdi></td>
                    <td className="text-end"><Num value={o.actual_min} unit="min" digits={0} /></td>
                    <td className="text-end"><Num value={o.baseline_min} unit="min" digits={0} />{o.revisions > 0 && <span className="ms-1 text-xs text-ops-muted">({t('ops.orders.revisions', { n: o.revisions })})</span>}</td>
                    <td className={`text-end font-semibold ${Number(o.variance_min) > 0 ? 'text-ops-amber' : ''}`}><Num value={o.variance_min} unit="minSigned" digits={0} /></td>
                    <td className="text-end"><Num value={o.lateness_min} unit="minSigned" digits={0} /></td>
                    <td className="max-w-[240px] truncate">{o.overrun_reason ?? (o.baseline_after_start ? t('ops.orders.baselineAfterStart') : '—')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </QueryState>
      </Card>
      <QueryState isLoading={timing.isLoading} error={timing.error} isEmpty={(timing.data?.orders.length ?? 0) === 0} emptyText={t('ops.orders.noOpen')}>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {timing.data?.orders.map((o) => (
            <OrderCard key={o.id} order={o} plans={timing.data.plans.filter((p) => p.order_line_id === o.id)}
              exec={timing.data.exec.find((x) => x.order_line_id === o.id)} risk={risk.get(o.id)} focused={o.id === focus} fmtDate={fmt.date} />
          ))}
        </div>
      </QueryState>
    </div>
  );
}

function OrderCard({ order, plans, exec, risk, focused, fmtDate }: {
  order: OrderRow; plans: PlanRow[]; exec: ExecRow | undefined; risk: AtRisk | undefined; focused: boolean; fmtDate: (d: string) => string;
}) {
  const { t, i18n } = useTranslation();
  const fmt = useFmt();
  const inv = useInvalidateOps();
  const lines = useLines();
  const base = plans.find((p) => p.version_no === 1);
  const latest = plans[plans.length - 1];
  const [form, setForm] = useState({ minutes: '', loading: '', line: latest?.line_id ?? '', reason: '' });
  const [overrun, setOverrun] = useState('');
  const [state, setState] = useState<SaveState>({ kind: 'idle' });
  const run = async (fn: () => Promise<unknown>) => {
    setState({ kind: 'pending' });
    try { await fn(); setState({ kind: 'saved', at: new Date().toISOString() }); void inv(); }
    catch (e) { setState({ kind: 'failed', message: opsErrorMessage(t, e) }); }
  };
  const done = !!exec?.completed_at;
  return (
    <section id={`order-${order.id}`} className={`ops-card p-4 ${focused ? 'ring-2 ring-ops-accent' : ''}`} aria-label={order.code}>
      <header className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold"><bdi>{order.code}</bdi> · <bdi>{order.customer_name}</bdi></h2>
        {done ? <Pill tone="good">{t('ops.orders.completed')}</Pill> : exec ? <Pill tone="info">{t('ops.orders.running')}</Pill> : <Pill tone="neutral">{t('ops.orders.notStarted')}</Pill>}
      </header>
      {risk && risk.reasons.length > 0 && <p className="mb-2 rounded-ops-sm bg-ops-amberbg p-2 text-sm text-ops-amber">! {risk.reasons.map((r) => t(`ops.risk.${r}`)).join(' · ')}</p>}
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <div><dt className="text-ops-muted">{t('ops.orders.required')}</dt><dd>{fmtDate(order.required_date)}</dd></div>
        <div><dt className="text-ops-muted">{t('ops.orders.baseline')}</dt><dd><Num value={base?.planned_duration_min ?? null} unit="min" digits={0} /></dd></div>
        <div><dt className="text-ops-muted">{t('ops.orders.promised')}</dt><dd>{latest?.promised_loading_at ? fmt.dateTime(latest.promised_loading_at) : '—'}</dd></div>
        <div><dt className="text-ops-muted">{t('ops.orders.started')}</dt><dd>{exec ? fmt.dateTime(exec.started_at) : '—'}</dd></div>
      </dl>
      {plans.length > 1 && (
        <details className="mt-2 text-sm"><summary className="min-h-[44px] cursor-pointer py-2">{t('ops.orders.revisions', { n: plans.length - 1 })}</summary>
          <ol className="list-decimal ps-5">{plans.map((p) => <li key={p.version_no}>v{p.version_no}: <Num value={p.planned_duration_min} unit="min" digits={0} /> — {p.reason ?? t('ops.orders.baselineLabel')}</li>)}</ol>
        </details>
      )}
      {!done && (
        <div className="mt-3 border-t border-ops-line pt-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <input className={`${field} ops-num`} inputMode="numeric" placeholder={t('ops.orders.plannedMin')} aria-label={t('ops.orders.plannedMin')}
              value={form.minutes} onChange={(e) => setForm({ ...form, minutes: e.target.value.replace(/[^0-9]/g, '') })} />
            <input className={field} type="datetime-local" aria-label={t('ops.orders.promised')} value={form.loading} onChange={(e) => setForm({ ...form, loading: e.target.value })} />
            <select className={field} value={form.line} onChange={(e) => setForm({ ...form, line: e.target.value })} aria-label={t('ops.filters.line')}>
              <option value="">{t('ops.filters.line')}</option>
              {lines.data?.map((l) => <option key={l.id} value={l.id}>{localName(i18n.language, l.name_ar, l.name_en)}</option>)}
            </select>
          </div>
          {base && <input className={`${field} mt-2`} placeholder={t('ops.orders.revisionReason')} aria-label={t('ops.orders.revisionReason')} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />}
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className={btn} disabled={!form.minutes}
              onClick={() => void run(() => rpc('ph_record_order_plan', { p_order_line: order.id, p_request_id: newRequestId(), p: {
                planned_duration_min: Number(form.minutes), ...(form.loading ? { promised_loading_at: new Date(form.loading).toISOString() } : {}),
                ...(form.line ? { line_id: form.line } : {}), reason: form.reason || null } }))}>
              {base ? t('ops.orders.revise') : t('ops.orders.recordBaseline')}
            </button>
            {!exec && <button type="button" className={btnPrimary} onClick={() => void run(() => rpc('ph_order_step', { p_order_line: order.id, p_step: 'start' }))}>▶ {t('ops.orders.start')}</button>}
          </div>
          {exec && (
            <div className="mt-2 flex flex-wrap gap-2">
              <input className={`${field} flex-1`} placeholder={t('ops.orders.overrunReason')} aria-label={t('ops.orders.overrunReason')} value={overrun} onChange={(e) => setOverrun(e.target.value)} />
              <button type="button" className={btnPrimary} onClick={() => void run(() => rpc('ph_order_step', { p_order_line: order.id, p_step: 'complete', p_reason: overrun || null }))}>✓ {t('ops.orders.complete')}</button>
            </div>
          )}
          <div className="mt-2"><SaveStatus state={state} /></div>
        </div>
      )}
    </section>
  );
}
