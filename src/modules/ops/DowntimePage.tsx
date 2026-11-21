import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { QueryState } from '@/core/components/QueryState';
import { localName, newRequestId, opsErrorMessage, rpc, useCauses, useDowntimeLog, useInvalidateOps, useKpis, useLines, useOverview, type DowntimeRow } from './api';
import { useOpsFilters } from './OverviewPage';
import { btn, btnPrimary, Card, EmptyState, field, Num, PageTitle, Pill, SaveStatus, useFmt, type SaveState } from './ui';

/** Stop log (S-04 PE §8, KPI 2): stop, observed fault, restart, confirmed cause, technical release; drill-down target. */
export default function DowntimePage() {
  const { t, i18n } = useTranslation();
  const fmt = useFmt();
  const [f] = useOpsFilters();
  const [sp] = useSearchParams();
  const focus = sp.get('stop');
  const ov = useOverview(f);
  const from = ov.data?.from;
  const to = ov.data?.to;
  const [openOnly, setOpenOnly] = useState(!!focus);
  const log = useDowntimeLog(from ?? '', to ?? '', openOnly);
  const kpi = useKpis(from, to);
  const lines = useLines();
  const rows = (log.data ?? []).filter((r) => !f.line || r.line_ids.includes(f.line));
  useEffect(() => {
    if (focus) document.getElementById(`stop-${focus}`)?.scrollIntoView({ block: 'center' });
  }, [focus, log.data]);

  return (
    <div>
      <PageTitle title={t('ops.downtime.title')} sub={ov.data ? t('ops.overview.window', { from: fmt.dateTime(from), to: fmt.dateTime(to) }) : null} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <Card className="lg:col-span-4" title={t('ops.downtime.byLine')}>
          <p className="mb-2 text-xs text-ops-muted">{t('ops.kpi.downtimeFormula')}</p>
          <table className="w-full text-sm">
            <thead><tr className="text-ops-muted"><th className="py-1 text-start font-medium">{t('ops.filters.line')}</th><th className="text-end font-medium">{t('ops.downtime.stops')}</th><th className="text-end font-medium">{t('ops.units.min')}</th></tr></thead>
            <tbody>
              {(kpi.data?.downtime ?? []).map((r) => (
                <tr key={r.line_id} className="border-t border-ops-line">
                  <td className="py-1.5">{localName(i18n.language, lines.data?.find((l) => l.id === r.line_id)?.name_ar, lines.data?.find((l) => l.id === r.line_id)?.name_en) || r.line_code}</td>
                  <td className="text-end">{r.stops}{r.open_stops > 0 && <span className="ms-1 font-semibold text-ops-red">({t('ops.downtime.openN', { n: r.open_stops })})</span>}</td>
                  <td className="text-end"><Num value={r.minutes} digits={0} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-sm">{t('ops.kpi.siteMinutes')}: <Num value={kpi.data?.site ?? null} unit="min" digits={0} /></p>
          <p className="text-xs text-ops-muted">{t('ops.downtime.siteHelp')}</p>
        </Card>
        <div className="space-y-3 lg:col-span-8">
          <ReportStop />
          <Card title={t('ops.downtime.log')} action={
            <label className="flex min-h-[44px] items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} />{t('ops.downtime.openOnly')}</label>}>
            <QueryState isLoading={log.isLoading} error={log.error} isEmpty={rows.length === 0} emptyText={t('ops.downtime.none')} onRetry={() => void log.refetch()}>
              <ul className="space-y-2">{rows.map((r) => <StopRow key={r.id} row={r} focused={r.id === focus} />)}</ul>
            </QueryState>
          </Card>
        </div>
      </div>
    </div>
  );
}

function ReportStop() {
  const { t, i18n } = useTranslation();
  const lines = useLines();
  const inv = useInvalidateOps();
  const [pick, setPick] = useState<string[]>([]);
  const [fault, setFault] = useState('');
  const [state, setState] = useState<SaveState>({ kind: 'idle' });
  const [req, setReq] = useState(newRequestId);
  const send = async () => {
    setState({ kind: 'pending' });
    try {
      await rpc('ph_report_stop', { p: { line_ids: pick, observed_fault: fault }, p_request_id: req });
      setState({ kind: 'saved', at: new Date().toISOString() }); setPick([]); setFault(''); setReq(newRequestId()); void inv();
    } catch (e) { setState({ kind: 'failed', message: opsErrorMessage(t, e) }); }
  };
  return (
    <Card title={t('ops.shift.reportStop')}>
      <fieldset><legend className="text-sm font-medium">{t('ops.downtime.affectedLines')}</legend>
        <div className="mt-1 flex flex-wrap gap-2">
          {lines.data?.map((l) => (
            <label key={l.id} className="flex min-h-[44px] items-center gap-2 rounded-ops-sm border border-ops-line px-3 text-sm">
              <input type="checkbox" className="h-5 w-5" checked={pick.includes(l.id)} onChange={(e) => setPick(e.target.checked ? [...pick, l.id] : pick.filter((x) => x !== l.id))} />
              {localName(i18n.language, l.name_ar, l.name_en)}
            </label>
          ))}
        </div>
      </fieldset>
      <textarea className={`${field} mt-2 min-h-[72px] py-2`} value={fault} onChange={(e) => setFault(e.target.value)} aria-label={t('ops.shift.observedFault')} placeholder={t('ops.shift.observedFault')} />
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button type="button" className={btnPrimary} disabled={pick.length === 0 || !fault.trim() || state.kind === 'pending'} onClick={() => void send()}>■ {t('ops.shift.stopNow')}</button>
        <SaveStatus state={state} onRetry={() => void send()} />
      </div>
    </Card>
  );
}

function StopRow({ row, focused }: { row: DowntimeRow; focused: boolean }) {
  const { t, i18n } = useTranslation();
  const fmt = useFmt();
  const causes = useCauses();
  const inv = useInvalidateOps();
  const [cause, setCause] = useState('');
  const [state, setState] = useState<SaveState>({ kind: 'idle' });
  const step = async (s: string, p: Record<string, unknown> = {}) => {
    setState({ kind: 'pending' });
    try { await rpc('ph_stop_step', { p_event: row.id, p_step: s, p }); setState({ kind: 'saved', at: new Date().toISOString() }); void inv(); }
    catch (e) { setState({ kind: 'failed', message: opsErrorMessage(t, e) }); }
  };
  return (
    <li id={`stop-${row.id}`} className={`rounded-ops-sm border p-3 ${focused ? 'border-ops-accent ring-2 ring-ops-accent' : row.is_open ? 'border-ops-redline bg-ops-redbg' : 'border-ops-line'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-semibold"><bdi>{row.code}</bdi> · {row.line_codes.join('، ')}</div>
        {row.is_open ? <Pill tone="bad">{t('ops.downtime.open')}</Pill> : <Pill tone="neutral" icon="✓">{t('ops.downtime.restarted')}</Pill>}
      </div>
      <p className="my-1 text-sm">{row.observed_fault}</p>
      <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <div><dt className="text-ops-muted">{t('ops.downtime.stoppedAt')}</dt><dd>{fmt.dateTime(row.stopped_at)}</dd></div>
        <div><dt className="text-ops-muted">{t('ops.downtime.restartedAt')}</dt><dd>{row.restarted_at ? fmt.dateTime(row.restarted_at) : '—'}</dd></div>
        <div><dt className="text-ops-muted">{row.is_open ? t('ops.downtime.elapsed') : t('ops.downtime.duration')}</dt><dd><Num value={row.minutes_to_now} unit="min" digits={0} /></dd></div>
        <div><dt className="text-ops-muted">{t('ops.downtime.cause')}</dt><dd>{row.cause_code ? localName(i18n.language, row.cause_name_ar, row.cause_name_en) : <span className="text-ops-amber">{t('ops.downtime.causePending')}</span>}</dd></div>
      </dl>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {row.is_open && <button type="button" className={btn} onClick={() => void step('restart')}>▶ {t('ops.downtime.restartNow')}</button>}
        {!row.cause_code && (
          <>
            <select className={`${field} w-auto`} value={cause} onChange={(e) => setCause(e.target.value)} aria-label={t('ops.downtime.cause')}>
              <option value="">{t('ops.downtime.chooseCause')}</option>
              {causes.data?.map((c) => <option key={c.id} value={c.id}>{localName(i18n.language, c.name_ar, c.name_en)}</option>)}
            </select>
            <button type="button" className={btn} disabled={!cause} onClick={() => void step('cause', { cause_id: cause })}>{t('ops.downtime.confirmCause')}</button>
          </>
        )}
        {!row.technical_release_at ? (
          <button type="button" className={btn} onClick={() => void step('release')}>{t('ops.downtime.release')}</button>
        ) : <Pill tone="good">{t('ops.downtime.released')}</Pill>}
      </div>
      <div className="mt-1"><SaveStatus state={state} /></div>
      {causes.data?.length === 0 && !row.cause_code && <EmptyState>{t('ops.downtime.noCauses')}</EmptyState>}
    </li>
  );
}
