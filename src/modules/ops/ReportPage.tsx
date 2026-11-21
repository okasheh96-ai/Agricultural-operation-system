import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { QueryState } from '@/core/components/QueryState';
import { localName, rpc, useKpis, useLines, useOverview } from './api';
import { useOpsFilters } from './OverviewPage';
import { btn, Card, downloadCsv, Num, PageTitle, Pill, useFmt, useToast } from './ui';

/**
 * Daily KPI report (S-04 p.3, draft): the three KPIs with their formula, denominator and source records. Worker-level rows
 * appear only for lines on which the reader may see people; otherwise the section says so.
 */
export default function ReportPage() {
  const { t, i18n } = useTranslation();
  const fmt = useFmt();
  const toast = useToast();
  const loc = useLocation();
  const [f] = useOpsFilters();
  const ov = useOverview(f);
  const k = useKpis(ov.data?.from, ov.data?.to, f.line);
  const lines = useLines();
  const lineName = (id: string, code: string) => {
    const l = lines.data?.find((x) => x.id === id);
    return l ? localName(i18n.language, l.name_ar, l.name_en) : code;
  };
  useEffect(() => {
    if (loc.hash && k.data) document.getElementById(loc.hash.slice(1))?.scrollIntoView({ block: 'start' });
  }, [loc.hash, k.data]);

  const exportCsv = async () => {
    if (!k.data) return;
    await rpc('ph_log_export', { p_report: 'daily_kpi', p_filters: f });
    const rows: (string | number | null)[][] = [];
    for (const p of k.data.people ?? []) rows.push(['productivity_worker', p.worker_code, p.kg_total, p.packing_hours, p.kg_per_hour, p.includes_allocation ? 'allocated' : '']);
    for (const tm of k.data.teams) rows.push(['productivity_team', tm.label ?? tm.task_code, tm.kg, tm.worker_hours, tm.kg_per_worker_hour, 'team']);
    for (const d of k.data.downtime) rows.push(['downtime_line', d.line_code, d.stops, d.minutes, d.open_stops, '']);
    for (const o of k.data.orders) rows.push(['order_variance', o.code, o.actual_min, o.baseline_min, o.variance_min, o.overrun_reason]);
    downloadCsv(`daily-kpi-${f.date}.csv`, ['kpi', 'subject', 'value_1', 'value_2', 'value_3', 'note'], rows);
  };

  return (
    <div>
      <PageTitle title={t('ops.report.title')}
        sub={ov.data ? <>{t('ops.overview.window', { from: fmt.dateTime(ov.data.from), to: fmt.dateTime(ov.data.to) })} · {t('ops.report.cutoff', { time: fmt.dateTime(ov.data.cutoff) })}</> : null}
        actions={<>
          <button type="button" className={btn} onClick={() => window.print()}>{t('ops.print')}</button>
          <button type="button" className={btn} disabled={!k.data} onClick={() => void exportCsv().catch(() => toast(t('ops.report.exportDenied'), 'bad'))}>{t('ops.exportCsv')}</button>
        </>} />
      <p className="mb-4 rounded-ops-sm border border-ops-line bg-ops-surface p-3 text-sm text-ops-muted">{t('ops.report.draftNote')}</p>
      <QueryState isLoading={k.isLoading || ov.isLoading} error={k.error ?? ov.error} isEmpty={!k.data} onRetry={() => void k.refetch()}>
        {k.data && (
          <div className="space-y-4">
            <Card id="productivity" title={`1. ${t('ops.kpi.productivity')}`}>
              <p className="mb-3 text-sm">{t('ops.report.productivityFormula')}</p>
              <h3 className="mb-1 text-sm font-semibold">{t('ops.report.byLine')}</h3>
              <table className="mb-4 w-full text-sm">
                <thead><tr className="text-ops-muted"><th className="py-1 text-start font-medium">{t('ops.filters.line')}</th><th className="text-end font-medium">{t('ops.report.conformingKg')}</th>
                  <th className="text-end font-medium">{t('ops.report.packingHours')}</th><th className="text-end font-medium">{t('ops.units.kgPerWorkerHour')}</th></tr></thead>
                <tbody>{k.data.lines.filter((l) => !f.line || l.line_id === f.line).map((l) => (
                  <tr key={l.line_id} className="border-t border-ops-line"><td className="py-1.5">{lineName(l.line_id, l.line_code)}</td>
                    <td className="text-end"><Num value={l.conforming_kg} digits={1} /></td><td className="text-end"><Num value={l.packing_hours} digits={2} /></td>
                    <td className="text-end font-semibold"><Num value={l.kg_per_worker_hour} digits={1} /></td></tr>
                ))}</tbody>
              </table>
              <h3 className="mb-1 text-sm font-semibold">{t('ops.report.byWorker')}</h3>
              {k.data.people === null ? <p className="text-sm text-ops-muted">{t('ops.report.peopleRestricted')}</p> : k.data.people.length === 0 ? (
                <p className="text-sm text-ops-muted">{t('ops.report.noPeople')}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead><tr className="text-ops-muted"><th className="py-1 text-start font-medium">{t('ops.shift.worker')}</th>
                      <th className="text-end font-medium">{t('ops.report.kgIndividual')}</th><th className="text-end font-medium">{t('ops.report.kgAllocated')}</th>
                      <th className="text-end font-medium">{t('ops.report.packingHours')}</th><th className="text-end font-medium">{t('ops.units.kgPerWorkerHour')}</th></tr></thead>
                    <tbody>{k.data.people.map((p) => (
                      <tr key={p.worker_id} className="border-t border-ops-line"><td className="py-1.5"><bdi>{p.worker_code}</bdi> · {p.worker_name}</td>
                        <td className="text-end"><Num value={p.kg_individual} digits={1} /></td>
                        <td className="text-end"><Num value={p.kg_team_allocated} digits={1} />{p.includes_allocation && <span className="ms-1"><Pill tone="info">{t('ops.report.allocated')}</Pill></span>}</td>
                        <td className="text-end"><Num value={p.packing_hours} digits={2} /></td><td className="text-end font-semibold"><Num value={p.kg_per_hour} digits={1} /></td></tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
              <h3 className="mb-1 mt-4 text-sm font-semibold">{t('ops.report.teams')}</h3>
              <p className="mb-1 text-xs text-ops-muted">{t('ops.report.teamFormula')}</p>
              {k.data.teams.length === 0 ? <p className="text-sm text-ops-muted">{t('ops.report.noTeams')}</p> : (
                <table className="w-full text-sm"><tbody>{k.data.teams.map((tm) => (
                  <tr key={tm.team_session_id} className="border-t border-ops-line"><td className="py-1.5">👥 {tm.label ?? tm.task_code}</td>
                    <td className="text-end"><Num value={tm.kg} unit="kg" digits={1} /></td><td className="text-end"><Num value={tm.worker_hours} unit="workerHours" digits={2} /></td>
                    <td className="text-end font-semibold"><Num value={tm.kg_per_worker_hour} unit="kgPerWorkerHour" digits={1} /></td></tr>
                ))}</tbody></table>
              )}
            </Card>

            <Card id="downtime" title={`2. ${t('ops.kpi.downtime')}`}>
              <p className="mb-3 text-sm">{t('ops.report.downtimeFormula')}</p>
              <table className="w-full text-sm">
                <thead><tr className="text-ops-muted"><th className="py-1 text-start font-medium">{t('ops.filters.line')}</th><th className="text-end font-medium">{t('ops.downtime.stops')}</th>
                  <th className="text-end font-medium">{t('ops.downtime.openStops')}</th><th className="text-end font-medium">{t('ops.units.min')}</th></tr></thead>
                <tbody>{k.data.downtime.filter((d) => !f.line || d.line_id === f.line).map((d) => (
                  <tr key={d.line_id} className="border-t border-ops-line"><td className="py-1.5">{lineName(d.line_id, d.line_code)}</td><td className="text-end">{d.stops}</td>
                    <td className={`text-end ${d.open_stops > 0 ? 'font-semibold text-ops-red' : ''}`}>{d.open_stops}</td><td className="text-end"><Num value={d.minutes} digits={0} /></td></tr>
                ))}</tbody>
              </table>
              <p className="mt-2 text-sm">{t('ops.kpi.siteMinutes')}: <Num value={k.data.site} unit="min" digits={0} /> — {t('ops.downtime.siteHelp')}</p>
            </Card>

            <Card id="orders" title={`3. ${t('ops.kpi.orders')}`}>
              <p className="mb-3 text-sm">{t('ops.report.ordersFormula')}</p>
              {k.data.orders.length === 0 ? <p className="text-sm text-ops-muted">{t('ops.orders.noneInWindow')}</p> : (
                <table className="w-full text-sm">
                  <thead><tr className="text-ops-muted"><th className="py-1 text-start font-medium">{t('ops.orders.order')}</th><th className="text-end font-medium">{t('ops.orders.actual')}</th>
                    <th className="text-end font-medium">{t('ops.orders.baseline')}</th><th className="text-end font-medium">{t('ops.orders.varianceCol')}</th>
                    <th className="text-start font-medium">{t('ops.orders.reason')}</th></tr></thead>
                  <tbody>{k.data.orders.map((o) => (
                    <tr key={o.order_line_id} className="border-t border-ops-line"><td className="py-1.5"><bdi>{o.code}</bdi> {o.state === 'running' && <Pill tone="info">{t('ops.orders.running')}</Pill>}</td>
                      <td className="text-end"><Num value={o.actual_min} digits={0} /></td><td className="text-end"><Num value={o.baseline_min} digits={0} /></td>
                      <td className="text-end font-semibold"><Num value={o.variance_min} unit="minSigned" digits={0} /></td><td>{o.overrun_reason ?? '—'}</td></tr>
                  ))}</tbody>
                </table>
              )}
            </Card>
          </div>
        )}
      </QueryState>
    </div>
  );
}
