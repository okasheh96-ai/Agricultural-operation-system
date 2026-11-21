import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { QueryState } from '@/core/components/QueryState';
import { farmToday, localName, rpc, useCustomers, useLines, useOverview, useTrend, type OverviewFilters, type OverviewLine } from './api';
import { BarChart, btn, Card, downloadCsv, field, KpiTile, Num, PageTitle, Pill, useFmt, type Tone } from './ui';
import { KpiCardView, useMyKpiCards } from './config/KpiCards';

const STATUS_TONE: Record<OverviewLine['status'], Tone> = {
  not_open: 'neutral', open: 'info', overdue: 'warn', submitted: 'good', submitted_zero: 'neutral',
};

/** Filters live in the URL so a drill-down and the browser's Back return to the same shift and filters. */
export function useOpsFilters(): [OverviewFilters, (patch: Partial<OverviewFilters>) => void, string] {
  const [sp, setSp] = useSearchParams();
  const f: OverviewFilters = {
    date: sp.get('date') || farmToday(),
    shift: sp.get('shift') || undefined, line: sp.get('line') || undefined, crop: sp.get('crop') || undefined,
    grade: sp.get('grade') || undefined, customer: sp.get('customer') || undefined,
  };
  const set = (patch: Partial<OverviewFilters>) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v); else next.delete(k);
    }
    if ('date' in patch) next.delete('shift');
    setSp(next, { replace: true });
  };
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => !!v) as [string, string][]).toString();
  return [f, set, qs];
}

export default function OverviewPage() {
  const { t, i18n } = useTranslation();
  const fmt = useFmt();
  const [f, setF, qs] = useOpsFilters();
  const ov = useOverview(f);
  const trend = useTrend(ov.data?.from, ov.data?.to);
  const lines = useLines();
  const customers = useCustomers();
  const d = ov.data;

  const trendRows = useMemo(() => {
    const by = new Map<string, number>();
    for (const r of trend.data ?? []) {
      if (f.line && lines.data?.find((l) => l.id === f.line)?.code !== r.line_code) continue;
      const k = fmt.time(r.bucket);
      by.set(k, (by.get(k) ?? 0) + Number(r.kg ?? 0));
    }
    return [...by.entries()].map(([label, value]) => ({ label, value }));
  }, [trend.data, f.line, lines.data, fmt]);

  const planned = d?.totals.planned_kg !== null && d?.totals.planned_kg !== undefined ? Number(d.totals.planned_kg) : null;
  const packed = d ? Number(d.totals.packed_kg) : 0;
  const pct = planned && planned > 0 ? Math.min(100, (packed / planned) * 100) : null;

  const exportCsv = async () => {
    if (!d) return;
    await rpc('ph_log_export', { p_report: 'overview_lines', p_filters: f });
    downloadCsv(`overview-${f.date}.csv`, ['line', 'status', 'supervisor', 'packed_kg', 'boxes', 'stops', 'downtime_min', 'submitted_at'],
      d.lines.map((l) => [l.code, l.status, l.supervisor_name, l.packed_kg, l.boxes, l.stops, l.downtime_min, l.submitted_at]));
  };

  return (
    <div>
      <PageTitle title={t('ops.overview.title')}
        sub={d ? <>{t('ops.overview.window', { from: fmt.dateTime(d.from), to: fmt.dateTime(d.to) })} · {t('ops.overview.updated', { time: fmt.time(d.generated_at) })}</> : null}
        actions={<>
          <button type="button" className={btn} onClick={() => window.print()}>{t('ops.print')}</button>
          <button type="button" className={btn} onClick={() => void exportCsv().catch(() => undefined)}>{t('ops.exportCsv')}</button>
        </>} />

      {/* Filters */}
      <div className="ops-card ops-noprint mb-4 grid grid-cols-2 gap-3 p-3 md:grid-cols-3 xl:grid-cols-6" role="group" aria-label={t('ops.filters.label')}>
        <label className="text-xs font-medium text-ops-muted">{t('ops.filters.date')}
          <input aria-label={t('ops.filters.date')} type="date" className={field} value={f.date} onChange={(e) => setF({ date: e.target.value })} />
        </label>
        <label className="text-xs font-medium text-ops-muted">{t('ops.filters.shift')}
          <select aria-label={t('ops.filters.shift')} className={field} value={f.shift ?? ''} onChange={(e) => setF({ shift: e.target.value })}>
            <option value="">{t('ops.filters.wholeDay')}</option>
            {d?.shifts.map((s) => <option key={s.id} value={s.id}>{s.code} · {fmt.time(s.planned_start)}–{fmt.time(s.planned_end)}</option>)}
          </select>
        </label>
        <label className="text-xs font-medium text-ops-muted">{t('ops.filters.line')}
          <select aria-label={t('ops.filters.line')} className={field} value={f.line ?? ''} onChange={(e) => setF({ line: e.target.value })}>
            <option value="">{t('ops.filters.all')}</option>
            {lines.data?.map((l) => <option key={l.id} value={l.id}>{localName(i18n.language, l.name_ar, l.name_en)}</option>)}
          </select>
        </label>
        <label className="text-xs font-medium text-ops-muted">{t('ops.filters.crop')}
          <select aria-label={t('ops.filters.crop')} className={field} value={f.crop ?? ''} onChange={(e) => setF({ crop: e.target.value })}>
            <option value="">{t('ops.filters.all')}</option>
            {['cherry_tomato', 'regular_tomato', 'blocky', 'sweetbite', 'eggplant', 'mini_cucumber', 'watermelon'].map((c) => (
              <option key={c} value={c}>{t(`ops.crops.${c}`, { defaultValue: c })}</option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-ops-muted">{t('ops.filters.grade')}
          <select aria-label={t('ops.filters.grade')} className={field} value={f.grade ?? ''} onChange={(e) => setF({ grade: e.target.value })}>
            <option value="">{t('ops.filters.all')}</option>
            {['premium', 'gr1', 'gr2'].map((g) => <option key={g} value={g}>{t(`ops.grades.${g}`)}</option>)}
          </select>
        </label>
        <label className="text-xs font-medium text-ops-muted">{t('ops.filters.customer')}
          <select aria-label={t('ops.filters.customer')} className={field} value={f.customer ?? ''} onChange={(e) => setF({ customer: e.target.value })}>
            <option value="">{t('ops.filters.all')}</option>
            {customers.data?.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}
          </select>
        </label>
      </div>

      <QueryState isLoading={ov.isLoading} error={ov.error} isEmpty={!d} onRetry={() => void ov.refetch()}>
        {d && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
            {/* Wide shift summary */}
            <Card highlight className="lg:col-span-8" title={d.shift ? t('ops.overview.shiftSummary', { code: d.shift.code }) : t('ops.overview.daySummary')}>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <div className="text-sm text-ops-muted">{t('ops.overview.packed')}</div>
                  <div className="text-4xl font-bold"><Num value={d.totals.packed_kg} unit="kg" digits={0} /></div>
                  <div className="text-sm text-ops-muted"><Num value={d.totals.boxes} unit="boxes" digits={0} />
                    {d.totals.nonconforming_boxes > 0 && <> · {t('ops.overview.nonconforming', { n: d.totals.nonconforming_boxes })}</>}</div>
                </div>
                <div>
                  <div className="text-sm text-ops-muted">{t('ops.overview.planned')}</div>
                  <div className="text-4xl font-bold"><Num value={d.totals.planned_kg} unit="kg" digits={0} /></div>
                  <div className="text-sm text-ops-muted">{t('ops.overview.plannedOrders', { n: d.totals.planned_orders })}
                    {d.totals.planned_unknown > 0 && <> · <span className="text-ops-amber">{t('ops.overview.plannedUnknown', { n: d.totals.planned_unknown })}</span></>}</div>
                </div>
                <div>
                  <div className="text-sm text-ops-muted">{t('ops.overview.remaining')}</div>
                  <div className="text-4xl font-bold"><Num value={d.totals.remaining_kg} unit="kg" digits={0} /></div>
                  <div className="text-sm text-ops-muted">{t('ops.overview.remainingFormula')}</div>
                </div>
              </div>
              {pct !== null ? (
                <div className="mt-4">
                  <div className="mb-1 flex justify-between text-sm"><span>{t('ops.overview.progress')}</span><Num value={pct} unit="pct" digits={0} /></div>
                  <div className="h-3 overflow-hidden rounded-full bg-ops-grey" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}
                    aria-label={t('ops.overview.progress')}>
                    <div className="ops-accent-bar h-full rounded-full" style={{ inlineSize: `${pct}%` }} />
                  </div>
                </div>
              ) : (
                <p className="mt-4 text-sm text-ops-muted">{t('ops.overview.noTarget')}</p>
              )}
              <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-ops-line pt-3 text-sm sm:grid-cols-4">
                <div><dt className="text-ops-muted">{t('ops.overview.start')}</dt><dd className="font-medium">{d.shift ? fmt.dateTime(d.shift.planned_start) : fmt.dateTime(d.from)}</dd></div>
                <div><dt className="text-ops-muted">{t('ops.overview.end')}</dt><dd className="font-medium">{d.shift ? fmt.dateTime(d.shift.planned_end) : fmt.dateTime(d.to)}</dd></div>
                <div><dt className="text-ops-muted">{t('ops.overview.engineer')}</dt><dd className="font-medium">{d.shift?.engineer_name ?? '—'}</dd></div>
                <div><dt className="text-ops-muted">{t('ops.overview.issuesOpen')}</dt><dd className="font-medium"><Num value={d.queue.issues_open} digits={0} /></dd></div>
              </dl>
            </Card>

            {/* Exceptions queue */}
            <Card className="lg:col-span-4" title={t('ops.overview.queue')}>
              <h3 className="mb-1 text-sm font-semibold">{t('ops.overview.atRisk')} ({d.queue.at_risk.length})</h3>
              <ul className="mb-3 space-y-1">
                {d.queue.at_risk.length === 0 && <li className="text-sm text-ops-muted">{t('ops.overview.noneAtRisk')}</li>}
                {d.queue.at_risk.map((o) => (
                  <li key={o.order_line_id}>
                    <Link to={`/ops/orders?${qs}&order=${o.order_line_id}`} className="ops-fade block rounded-ops-sm border border-[#f3cf94] bg-ops-amberbg p-2 text-sm hover:border-ops-amber">
                      <div className="flex items-center justify-between gap-2"><bdi className="font-semibold">{o.code}</bdi><bdi>{o.customer}</bdi></div>
                      <div className="text-ops-amber">! {o.reasons.map((r) => t(`ops.risk.${r}`)).join(' · ')}</div>
                      <div className="text-xs text-ops-muted">{t('ops.overview.remainingShort')}: <Num value={o.remaining_kg} unit="kg" digits={0} />
                        {o.promised_loading_at && <> · {t('ops.overview.loading')}: {fmt.time(o.promised_loading_at)}</>}</div>
                    </Link>
                  </li>
                ))}
              </ul>
              <h3 className="mb-1 text-sm font-semibold">{t('ops.overview.openStops')} ({d.queue.open_stops.length})</h3>
              <ul className="mb-3 space-y-1">
                {d.queue.open_stops.length === 0 && <li className="text-sm text-ops-muted">{t('ops.overview.noOpenStops')}</li>}
                {d.queue.open_stops.map((s) => (
                  <li key={s.id}>
                    <Link to={`/ops/downtime?${qs}&stop=${s.id}`} className="ops-fade block rounded-ops-sm border border-[#f2b8b3] bg-ops-redbg p-2 text-sm hover:border-ops-red">
                      <div className="flex items-center justify-between gap-2"><span className="font-semibold text-ops-red">■ <bdi>{s.code}</bdi> · {s.lines.join('، ')}</span>
                        <Num value={s.minutes} unit="min" digits={0} /></div>
                      <div className="truncate">{s.fault}</div>
                    </Link>
                  </li>
                ))}
              </ul>
              <h3 className="mb-1 text-sm font-semibold">{t('ops.overview.holds')} ({d.queue.holds.length})</h3>
              <ul className="space-y-1">
                {d.queue.holds.length === 0 && <li className="text-sm text-ops-muted">{t('ops.overview.noHolds')}</li>}
                {d.queue.holds.map((h) => (
                  <li key={h.id}>
                    <Link to="/office/packing-house/exceptions" className="ops-fade block rounded-ops-sm border border-ops-line p-2 text-sm hover:border-ops-accent">
                      <div className="flex items-center justify-between gap-2"><bdi className="font-semibold">{h.code}</bdi><Pill tone="warn">{t(`ops.holdType.${h.type}`)}</Pill></div>
                      <div className="truncate text-ops-muted">{h.reason}</div>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>

            {/* The three KPIs of the roles and KPI draft (S-04 p.3); each opens its source records. */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:col-span-12">
              <KpiTile label={t('ops.kpi.productivity')} to={`/ops/report?${qs}#productivity`}
                value={<Num value={d.kpi.productivity.rate} unit="kgPerWorkerHour" digits={1} />}
                sub={<><Num value={d.kpi.productivity.kg} unit="kg" digits={0} /> ÷ <Num value={d.kpi.productivity.hours} unit="h" digits={1} /></>}
                formula={t('ops.kpi.productivityFormula')} />
              <KpiTile label={t('ops.kpi.downtime')} to={`/ops/downtime?${qs}`} tone={d.kpi.downtime.open > 0 ? 'bad' : 'neutral'}
                value={<Num value={d.kpi.downtime.minutes} unit="min" digits={0} />}
                sub={<>{t('ops.kpi.stops', { n: d.kpi.downtime.stops })}{d.kpi.downtime.open > 0 && <> · <span className="font-semibold text-ops-red">{t('ops.kpi.openStops', { n: d.kpi.downtime.open })}</span></>}
                  {' · '}{t('ops.kpi.siteMinutes')}: <Num value={d.kpi.downtime.site_minutes} unit="min" digits={0} /></>}
                formula={t('ops.kpi.downtimeFormula')} />
              <KpiTile label={t('ops.kpi.orders')} to={`/ops/orders?${qs}`} tone={d.kpi.orders.over_plan > 0 ? 'warn' : 'neutral'}
                value={d.kpi.orders.completed > 0 ? <Num value={d.kpi.orders.variance_min} unit="minSigned" digits={0} /> : <span className="text-ops-muted">{t('ops.kpi.noCompleted')}</span>}
                sub={t('ops.kpi.ordersSub', { completed: d.kpi.orders.completed, running: d.kpi.orders.running, over: d.kpi.orders.over_plan })}
                formula={t('ops.kpi.ordersFormula')} />
            </div>

            {/* Cards the Owner built in Settings → KPI cards (published, visible to this person's roles). */}
            <OwnerCards />

            <Card className="lg:col-span-7" title={t('ops.overview.trend')}>
              <BarChart title={t('ops.overview.trendChart')} unit="kg" rows={trendRows} />
            </Card>
            <Card className="lg:col-span-5" title={t('ops.overview.byCropGrade')}>
              {d.by_crop_grade.length === 0 ? <p className="text-sm text-ops-muted">{t('ops.overview.noOutput')}</p> : (
                <table className="w-full text-sm">
                  <thead><tr className="text-ops-muted"><th className="py-1 text-start font-medium">{t('ops.filters.crop')}</th><th className="text-start font-medium">{t('ops.filters.grade')}</th>
                    <th className="text-end font-medium">{t('ops.units.kg')}</th><th className="text-end font-medium">{t('ops.units.boxes')}</th></tr></thead>
                  <tbody>
                    {d.by_crop_grade.map((r) => (
                      <tr key={`${r.crop_code}-${r.grade}`} className="border-t border-ops-line">
                        <td className="py-1.5">{r.crop_code === '?' ? t('ops.unknown') : localName(i18n.language, r.crop_name_ar, r.crop_name_en) || r.crop_code}</td>
                        <td>{t(`ops.grades.${r.grade}`)}</td><td className="text-end"><Num value={r.kg} digits={0} /></td><td className="text-end"><Num value={r.boxes} digits={0} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>

            <Card className="lg:col-span-12" title={t('ops.overview.lines')}>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead><tr className="text-ops-muted">
                    <th className="py-2 text-start font-medium">{t('ops.filters.line')}</th><th className="text-start font-medium">{t('ops.overview.status')}</th>
                    <th className="text-start font-medium">{t('ops.overview.supervisor')}</th><th className="text-end font-medium">{t('ops.overview.packed')}</th>
                    <th className="text-end font-medium">{t('ops.units.boxes')}</th><th className="pe-4 text-end font-medium">{t('ops.kpi.downtime')}</th>
                    <th className="text-start font-medium">{t('ops.overview.lastSubmission')}</th>
                  </tr></thead>
                  <tbody>
                    {d.lines.map((l) => (
                      <tr key={l.line_id} className="border-t border-ops-line align-middle">
                        <td className="py-2 font-semibold">{l.line_shift_id ? <Link className="text-ops-accent underline" to={`/ops/shift?ls=${l.line_shift_id}`}>{localName(i18n.language, l.name_ar, l.name_en)}</Link> : localName(i18n.language, l.name_ar, l.name_en)}</td>
                        <td><Pill tone={STATUS_TONE[l.status]}>{t(`ops.lineStatus.${l.status}`)}</Pill></td>
                        <td>{l.supervisor_name ?? '—'}</td>
                        <td className="text-end"><Num value={l.packed_kg} unit="kg" digits={0} /></td>
                        <td className="text-end"><Num value={l.boxes} digits={0} /></td>
                        <td className="pe-4 text-end">{l.open_stops ? <span className="font-semibold text-ops-red">■ </span> : null}<Num value={l.downtime_min} unit="min" digits={0} /></td>
                        <td>{l.submitted_at ? fmt.dateTime(l.submitted_at) : l.last_activity_at ? t('ops.overview.lastActivity', { time: fmt.time(l.last_activity_at) }) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card className="lg:col-span-12" title={t('ops.overview.stock')}>
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-5">
                <div><dt className="text-sm text-ops-muted">{t('ops.stock.fgAvailable')}</dt><dd className="text-xl font-bold"><Num value={d.stock.fg_available_kg} unit="kg" digits={0} /></dd></div>
                <div><dt className="text-sm text-ops-muted">{t('ops.stock.fgAllocated')}</dt><dd className="text-xl font-bold"><Num value={d.stock.fg_allocated_kg} unit="kg" digits={0} /></dd></div>
                <div><dt className="text-sm text-ops-muted">{t('ops.stock.fgHeld')}</dt><dd className={`text-xl font-bold ${Number(d.stock.fg_held_kg) > 0 ? 'text-ops-amber' : ''}`}><Num value={d.stock.fg_held_kg} unit="kg" digits={0} /></dd></div>
                <div><dt className="text-sm text-ops-muted">{t('ops.stock.rawAvailable')}</dt><dd className="text-xl font-bold"><Num value={d.stock.raw_available_kg} unit="kg" digits={0} /></dd></div>
                <div><dt className="text-sm text-ops-muted">{t('ops.stock.rawHeld')}</dt><dd className={`text-xl font-bold ${Number(d.stock.raw_held_kg) > 0 ? 'text-ops-amber' : ''}`}><Num value={d.stock.raw_held_kg} unit="kg" digits={0} /></dd></div>
              </dl>
            </Card>
          </div>
        )}
      </QueryState>
    </div>
  );
}

function OwnerCards() {
  const { t } = useTranslation();
  const cards = useMyKpiCards();
  if (!cards.data || cards.data.length === 0) return null;
  return (
    <section aria-label={t('ops.kpiset.ownerCards')} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:col-span-12 lg:grid-cols-4">
      {cards.data.map((c) => <KpiCardView key={c.code} code={c.code} def={c.definition} result={c.result} />)}
    </section>
  );
}
