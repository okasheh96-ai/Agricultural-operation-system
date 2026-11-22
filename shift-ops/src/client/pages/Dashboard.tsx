import { useEffect, useState } from 'react';
import { api, bumpLocalVersion, todayLocal, useApi, useQueryParams } from '../api';
import { fmtDateTime, fmtPct, fmtQ, fmtSigned, fmtTime, getLang, t, useLang } from '../i18n';
import { ActionButton, BarList, Drawer, Empty, ErrorBox, FactTable, Field, Loading, Progress, Q, Select, StatusBadge, Trend, type FactRowView } from '../ui';
import type { Me } from '../../shared/types';
import type { Dashboard as Dash } from '../../worker/dashboard';
import { QuickUpdate } from './QuickUpdate';
import { SnapshotCreate } from './SnapshotCreate';

const SECTIONS = ['summary', 'today', 'production', 'productivity', 'waste', 'downtime', 'orders', 'sales', 'data'] as const;

export function DashboardPage({ me, frozen }: { me: Me; frozen?: { dashboard: Dash; facts: FactRowView[]; sections: string[] } }) {
  useLang();
  const [params, setParams] = useQueryParams();
  const date = params.get('date') || todayLocal();
  const compare = params.get('compare') === 'baseline' ? 'baseline' : 'current';
  const qs = new URLSearchParams({ date, compare });
  for (const k of ['line', 'product', 'grade', 'customer', 'from', 'to', 'now']) { const v = params.get(k); if (v) qs.set(k, v); }
  const live = useApi<Dash>(frozen ? null : `/api/dashboard?${qs}`, { live: true });
  const ref = useApi<{ ref: { kind: string; code: string; name_ar: string; name_en: string; active: number }[] }>(frozen ? null : '/api/ref');
  const d = frozen?.dashboard ?? live.data;
  const [drill, setDrill] = useState<{ title: string; ids: string[] } | null>(null);
  const [quick, setQuick] = useState(false);
  const [snap, setSnap] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(i); }, []);
  const show = (s: string) => !frozen || frozen.sections.includes(s);
  const open = (title: string, ids: string[]) => setDrill({ title, ids });
  const opts = (kind: string) => {
    const fromRef = (ref.data?.ref ?? []).filter((r) => r.kind === kind && r.active).map((r) => r.code);
    const fromData = kind === 'line' ? d?.lines.map((l) => l.line) ?? [] : kind === 'grade' ? d?.packedByGrade.map((g) => g.grade).filter(Boolean) ?? [] : [];
    return [...new Set([...fromRef, ...fromData])].map((c) => ({ value: c, label: c }));
  };
  const activeCount = ['line', 'product', 'grade', 'customer', 'from'].filter((k) => params.get(k)).length;
  const tap = (k: string, v: string) => !frozen && setParams({ [k]: params.get(k) === v ? null : v });

  return (
    <div className="dash">
      {frozen && <div className="notice warn">{t('snapshot_banner')}</div>}
      {!frozen && (
        <div className="filters" data-testid="filters">
          <div className="fields">
            <Field label={t('dash_date')}><input className="input" type="date" value={date} onChange={(e) => setParams({ date: e.target.value })} data-testid="f-date" /></Field>
            <Field label={t('dash_compare')}>
              <Select value={compare} onChange={(v) => setParams({ compare: v === 'current' ? null : v })} options={[{ value: 'current', label: t('compare_current') }, { value: 'baseline', label: t('compare_baseline') }]} testId="f-compare" />
            </Field>
          </div>
          <details className="morefilters" data-testid="more-filters">
            <summary>{t('filters')}{activeCount ? ` (${activeCount})` : ''}</summary>
            <div className="fields">
            <Field label={t('filter_line')}><Select value={params.get('line') ?? ''} onChange={(v) => setParams({ line: v })} options={opts('line')} allowEmpty={t('all')} testId="f-line" /></Field>
              <Field label={t('filter_product')}><Select value={params.get('product') ?? ''} onChange={(v) => setParams({ product: v })} options={opts('product')} allowEmpty={t('all')} /></Field>
              <Field label={t('filter_grade')}><Select value={params.get('grade') ?? ''} onChange={(v) => setParams({ grade: v })} options={opts('grade')} allowEmpty={t('all')} testId="f-grade" /></Field>
              <Field label={t('filter_customer')}><Select value={params.get('customer') ?? ''} onChange={(v) => setParams({ customer: v })} options={opts('customer')} allowEmpty={t('all')} /></Field>
              <Field label={t('dash_range_from')}><input className="input" type="date" value={params.get('from') ?? ''} onChange={(e) => setParams({ from: e.target.value, to: params.get('to') || date })} /></Field>
              <Field label={t('dash_range_to')}><input className="input" type="date" value={params.get('to') ?? ''} onChange={(e) => setParams({ to: e.target.value, from: params.get('from') || date })} /></Field>
            </div>
          </details>
          <div className="chips">
            {SECTIONS.map((s) => <a key={s} href={`#sec-${s}`}>{t(`sec_${s}`)}</a>)}
            {['line', 'product', 'grade', 'customer', 'from'].some((k) => params.get(k)) && <button onClick={() => setParams({ line: null, product: null, grade: null, customer: null, from: null, to: null })}>{t('clear_filters')}</button>}
          </div>
        </div>
      )}
      <div className="spread" style={{ marginBlock: 8 }}>
        <div className="clock" data-testid="clock">
          <span>{t('dash_now')}: <b>{fmtTime(frozen ? d?.now : now)}</b></span>
          <span>{d?.lastReadingMs ? <>{t('dash_last_reading')}: <b data-testid="last-reading">{fmtTime(d.lastReadingMs)}</b></> : t('dash_no_reading')}</span>
          {!frozen && live.updatedAt && <span className="muted">{live.refreshing ? t('loading') : `${t('live')} · ${t('updated')} ${fmtTime(live.updatedAt)}`}</span>}
          {frozen && d && <span>{t('snap_frozen_at')}: {fmtDateTime(d.now)}</span>}
        </div>
        <div className="row noprint">
          {me.role === 'owner' && !frozen && <button className="btn primary" onClick={() => setQuick(true)} data-testid="quick-open">＋ {t('quick_update')}</button>}
          <button className="btn plain" onClick={() => { document.body.classList.toggle('present'); if (!document.fullscreenElement) void document.documentElement.requestFullscreen?.().catch(() => undefined); else void document.exitFullscreen(); }}>{t('present')}</button>
          <button className="btn plain" onClick={() => window.print()}>{t('print_pdf')}</button>
          {me.role === 'owner' && !frozen && <button className="btn plain" onClick={() => setSnap(true)}>{t('make_snapshot')}</button>}
        </div>
      </div>
      {live.error && !d && <ErrorBox error={live.error} onRetry={live.reload} />}
      {live.error && d && <div className="notice bad">{t('failed')} — <button className="link" onClick={live.reload}>{t('retry')}</button></div>}
      {!d && !live.error && <Loading />}
      {d && (
        <>
          {show('summary') && <Summary d={d} />}
          {show('today') && <Today d={d} me={me} open={open} now={frozen ? d.now : now} />}
          {show('production') && <Production d={d} open={open} tap={tap} params={params} />}
          {show('productivity') && <Productivity d={d} open={open} />}
          {show('waste') && <Waste d={d} open={open} />}
          {show('downtime') && <Downtime d={d} open={open} tap={tap} />}
          {show('orders') && <Orders d={d} open={open} />}
          {show('sales') && <Sales d={d} open={open} />}
          {show('data') && <DataSections d={d} open={open} me={me} frozen={!!frozen} />}
        </>
      )}
      {drill && (
        <Drawer onClose={() => setDrill(null)}>
          {frozen ? <FactTable title={drill.title} staticRows={frozen.facts.filter((f) => drill.ids.includes(f.id))} onClose={() => setDrill(null)} />
            : <FactTable title={drill.title} query={{ ids: drill.ids }} onClose={() => setDrill(null)} />}
        </Drawer>
      )}
      {quick && <Drawer onClose={() => setQuick(false)}><QuickUpdate date={date} onDone={() => { setQuick(false); bumpLocalVersion(); live.reload(); }} /></Drawer>}
      {snap && d && <Drawer onClose={() => setSnap(false)}><SnapshotCreate filters={d.filters} onClose={() => setSnap(false)} /></Drawer>}
    </div>
  );
}

type Open = (title: string, ids: string[]) => void;

function Kpi({ k, v, ids, open, testId }: { k: string; v: React.ReactNode; ids?: string[]; open?: Open; testId?: string }) {
  return (
    <button className="kpi" onClick={() => ids && open?.(k, ids)} disabled={!ids?.length} data-testid={testId}>
      <span className="k">{k}</span><span className="v">{v}</span>
    </button>
  );
}

function Summary({ d }: { d: Dash }) {
  if (!d.summary.length) return null;
  const fmt = (code: string, p: Record<string, string | number | null>) => {
    const unit = String(p.unit ?? '');
    const q = (x: unknown) => (typeof x === 'number' ? fmtQ(x) : '—');
    if (code.startsWith('line_')) return t(`sum_${code}`, { line: p.line as string, actual: q(p.actual), due: q(p.due), variance: typeof p.variance === 'number' ? fmtSigned(p.variance) : '—', unit });
    if (code === 'productivity') return t('sum_productivity', { rate: q(p.rate), planned: q(p.planned) });
    if (code === 'lot_gap') return t('sum_lot_gap', { lot: p.lot as string, gap: q(p.gap) });
    if (code === 'waste') return t('sum_waste', { pct: fmtPct(p.pct as number), kg: q(p.kg) });
    if (code.startsWith('sales_')) return `${t('sum_sales', { basis: t(`basis_${p.basis}`), actual: q(p.actual), target: q(p.target), unit })} ${t(`st_${code.slice(6)}`)}`;
    return code;
  };
  return (
    <section id="sec-summary" className="dsec card" data-testid="summary">
      <h2>{t('sec_summary')}</h2>
      <ul>{d.summary.map((s, i) => <li key={i}>{fmt(s.code, s.params)} <a href={`#${s.anchor}`} className="small">{t('evidence')}</a></li>)}</ul>
    </section>
  );
}

function jobLabel(j: { product: string; grade: string | null; start: string; end: string; order_ref: string | null }) {
  return `${j.product}${j.grade ? ` · ${j.grade}` : ''}${j.order_ref ? ` · ${j.order_ref}` : ''} (${fmtTime(j.start)}–${fmtTime(j.end)})`;
}

function Today({ d, me, open, now }: { d: Dash; me: Me; open: Open; now: number }) {
  return (
    <section id="sec-today" className="dsec">
      <h2>{t('sec_today')}</h2>
      {!d.plan.has_plan && <div className="notice">{me.role === 'owner' ? t('no_plan_owner') : t('no_plan')}</div>}
      {d.plan.has_plan && d.plan.versions.length > 1 && (
        <p className="small muted">{d.plan.compare === 'baseline' ? t('compare_baseline') : `${t('compare_current')} · ${t('effective_at')}: ${fmtTime(d.plan.versions[d.plan.versions.length - 1].effective_at)} · ${d.plan.versions[d.plan.versions.length - 1].reason ?? ''}`}</p>
      )}
      <div className="grid two">
        {d.lines.map((l) => {
          const stale = l.asOfMs !== null && l.status !== 'complete' && l.current && now - l.asOfMs > 60 * 60000;
          return (
            <div className="card" key={l.line} id={`line-${l.line}`} data-testid={`line-${l.line}`}>
              <div className="spread">
                <h3>{t('filter_line')} {l.line}</h3>
                <span className="row">{stale && <StatusBadge s="awaiting" />}<StatusBadge s={l.status} /></span>
              </div>
              <div className="small">
                <div>{t('current_job')}: {l.current ? jobLabel(l.current) : '—'}</div>
                <div>{t('next_job')}: {l.next ? jobLabel(l.next) : '—'}</div>
                {l.asOfMs && <div className="muted">{t('dash_last_reading')} {fmtTime(l.asOfMs)}</div>}
              </div>
              {l.target !== null && <Progress actual={l.actual} due={l.due} target={l.target} />}
              <div className="kpis">
                <Kpi k={t('full_target')} v={<Q v={l.target} unit={l.unit} />} testId="k-target" />
                <Kpi k={t('due_now')} v={l.asOfMs === null ? t('awaiting_update') : <Q v={l.due} unit={l.unit} />} testId="k-due" />
                <Kpi k={t('approved_actual')} v={<Q v={l.actual} unit={l.unit} />} ids={l.factIds} open={open} testId="k-actual" />
                <Kpi k={t('variance')} v={l.variance === null ? t('unavailable') : fmtSigned(l.variance)} ids={l.factIds} open={open} testId="k-variance" />
                <Kpi k={t('pct_full')} v={fmtPct(l.pctOfTarget)} testId="k-pct-full" />
                <Kpi k={t('pct_due')} v={fmtPct(l.pctOfDue)} testId="k-pct-due" />
                <Kpi k={t('remaining')} v={<Q v={l.remaining} unit={l.unit} />} testId="k-remaining" />
                <Kpi k={t('pace_needed')} v={l.paceNeededPerHour === null ? t('unavailable') : <>{fmtQ(l.paceNeededPerHour, 1)} {l.unit}{t('per_hour')}</>} testId="k-pace" />
              </div>
            </div>
          );
        })}
      </div>
      {!d.lines.length && d.plan.has_plan && <Empty />}
    </section>
  );
}

function Production({ d, open, tap, params }: { d: Dash; open: Open; tap: (k: string, v: string) => void; params: URLSearchParams }) {
  return (
    <section id="sec-production" className="dsec card">
      <h2>{t('sec_production')}</h2>
      {d.jobs.length > 0 && (
        <div className="tablewrap">
          <table data-testid="jobs-table">
            <thead><tr><th>{t('job_line')}</th><th>{t('jobs')}</th><th className="num">{t('full_target')}</th><th className="num">{t('due_now')}</th><th className="num">{t('approved_actual')}</th><th className="num">{t('variance')}</th><th>{t('status')}</th></tr></thead>
            <tbody>
              {d.jobs.map((j) => (
                <tr key={j.id}>
                  <td>{j.line}</td><td>{jobLabel(j)}{j.missingConversion && <div className="small sev-review">{t('missing_conversion')}</div>}</td>
                  <td className="num"><Q v={j.target} unit={j.unit} /></td><td className="num">{j.asOfMs === null ? '—' : <Q v={j.due} />}</td>
                  <td className="num"><button className="link" onClick={() => open(jobLabel(j), j.factIds)} disabled={!j.factIds.length}><Q v={j.actual} /></button></td>
                  <td className="num">{fmtSigned(j.variance)}</td><td><StatusBadge s={j.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <h3 style={{ marginBlockStart: 12 }}>{t('packed_by_grade')}</h3>
      {d.packedByGrade.length ? (
        <BarList items={d.packedByGrade.map((g) => ({ key: g.grade, label: g.grade || '—', value: g.kg }))} unit={t('kg')} onSelect={(k) => tap('grade', k)} selected={params.get('grade')} />
      ) : <Empty />}
      {d.packedByGrade.length > 0 && <button className="link small" onClick={() => open(t('packed_by_grade'), d.packedByGrade.flatMap((g) => g.factIds))}>{t('drill')}</button>}
      {d.previous.packedKg !== null && <p className="small muted">{t('previous_period')} ({d.previous.from} → {d.previous.to}): <Q v={d.previous.packedKg} unit={t('kg')} /></p>}
    </section>
  );
}

function Productivity({ d, open }: { d: Dash; open: Open }) {
  const p = d.productivity;
  return (
    <section id="sec-productivity" className="dsec card">
      <h2>{t('sec_productivity')}</h2>
      <div className="kpis">
        <Kpi k={`${t('actual')} ${t('kg_per_wh')}`} v={p.total.rate === null ? t('unavailable') : fmtQ(p.total.rate, 2)} ids={p.total.factIds} open={open} testId="k-rate-actual" />
        <Kpi k={`${t('planned')} ${t('kg_per_wh')}`} v={p.total.plannedRate === null ? t('unavailable') : fmtQ(p.total.plannedRate, 2)} testId="k-rate-planned" />
        <Kpi k={`${t('actual')} ${t('worker_hours')}`} v={<Q v={p.total.wh} />} ids={p.total.factIds} open={open} testId="k-wh-actual" />
        <Kpi k={`${t('planned')} ${t('worker_hours')}`} v={<Q v={p.total.plannedWH} />} testId="k-wh-planned" />
      </div>
      {p.total.overlaps > 0 && <p className="small sev-review">{p.total.overlaps} · {t('overlap_hours')}</p>}
      {d.previous.rate !== null && <p className="small muted">{t('previous_period')}: {fmtQ(d.previous.rate, 2)} {t('kg_per_wh')}</p>}
      {p.lines.length > 0 && (
        <div className="tablewrap"><table>
          <thead><tr><th>{t('job_line')}</th><th className="num">{t('packed')} ({t('kg')})</th><th className="num">{t('worker_hours')}</th><th className="num">{t('actual')}</th><th className="num">{t('planned')}</th></tr></thead>
          <tbody>{p.lines.map((l) => (
            <tr key={l.line}><td>{l.line}{l.inconsistentTargets.length > 0 && <div className="small sev-review">{t('inconsistent_target')}</div>}</td>
              <td className="num"><Q v={l.packedKg} /></td><td className="num"><Q v={l.wh} /></td>
              <td className="num"><button className="link" onClick={() => open(`${l.line} · ${t('kg_per_wh')}`, l.factIds)} disabled={!l.factIds.length}>{l.rate === null ? t('unavailable') : fmtQ(l.rate, 2)}</button></td>
              <td className="num">{l.plannedRate === null ? t('unavailable') : fmtQ(l.plannedRate, 2)}</td></tr>
          ))}</tbody>
        </table></div>
      )}
      {d.jobs.some((j) => j.inconsistentTarget) && <div className="notice warn">{t('inconsistent_target')}</div>}
    </section>
  );
}

function Waste({ d, open }: { d: Dash; open: Open }) {
  return (
    <section id="sec-waste" className="dsec card">
      <h2>{t('sec_waste')}</h2>
      <div className="kpis">
        <Kpi k={t('waste_vs_input')} v={fmtPct(d.waste.pct)} testId="k-waste-pct" />
        <Kpi k={t('waste')} v={<Q v={d.waste.kg} unit={t('kg')} />} />
        <Kpi k={t('input')} v={<Q v={d.waste.inputKg} unit={t('kg')} />} />
      </div>
      {d.lots.length ? (
        <div className="tablewrap"><table data-testid="lots-table">
          <thead><tr><th>{t('lot')}</th><th className="num">{t('input')}</th><th className="num">{t('packed')}</th><th className="num">{t('waste')}</th><th className="num">{t('carry_out')}</th><th className="num">{t('gap')}</th><th className="num">{t('waste_pct')}</th></tr></thead>
          <tbody>{d.lots.map((l) => (
            <tr key={l.lot} id={`lot-${l.lot}`} className={l.flagged ? 'blocked' : ''}>
              <td><button className="link" onClick={() => open(`${t('lot')} ${l.lot}`, l.sources.map((s) => s.factId))}>{l.lot}</button> <span className="badge">{l.closed ? t('lot_closed') : t('lot_open')}</span>{l.flagged && <div className="small sev-block">{t('lot_flag')}</div>}</td>
              <td className="num"><Q v={l.input} /></td><td className="num"><Q v={l.packed} /></td><td className="num"><Q v={l.waste} /></td><td className="num"><Q v={l.carryOut} /></td>
              <td className="num">{fmtSigned(l.gap)}</td><td className="num">{fmtPct(l.wastePct)}</td>
            </tr>
          ))}</tbody>
        </table></div>
      ) : <Empty />}
    </section>
  );
}

function Downtime({ d, open, tap }: { d: Dash; open: Open; tap: (k: string, v: string) => void }) {
  return (
    <section id="sec-downtime" className="dsec card">
      <h2>{t('sec_downtime')} <span className="muted small">{t('by_line_reason')}</span></h2>
      {d.downtime.length ? (
        <>
          <BarList items={d.downtime.map((x) => ({ key: x.line, label: `${x.line || '—'} · ${x.reason || '—'}`, value: x.minutes }))} unit={t('downtime_min')} onSelect={(k) => tap('line', k)} />
          <button className="link small" onClick={() => open(t('sec_downtime'), d.downtime.flatMap((x) => x.factIds))}>{t('drill')}</button>
        </>
      ) : <Empty />}
    </section>
  );
}

function Orders({ d, open }: { d: Dash; open: Open }) {
  if (!d.orders.length) return <section id="sec-orders" className="dsec card"><h2>{t('sec_orders')}</h2><Empty /></section>;
  return (
    <section id="sec-orders" className="dsec card">
      <h2>{t('sec_orders')}</h2>
      <div className="tablewrap"><table>
        <thead><tr><th>{t('order')}</th><th>{t('filter_customer')}</th><th className="num">{t('planned')}</th><th className="num">{t('produced')}</th><th className="num">{t('dispatched')}</th><th className="num">{t('pct_full')}</th></tr></thead>
        <tbody>{d.orders.map((o) => (
          <tr key={o.order_ref}><td><button className="link" onClick={() => open(o.order_ref, o.factIds)}>{o.order_ref}</button></td><td>{o.customer ?? '—'}</td>
            <td className="num"><Q v={o.planned} unit={o.unit} /></td><td className="num"><Q v={o.actual} unit={o.unit} /></td>
            <td className="num">{o.dispatched.length ? o.dispatched.map((x, i) => <div key={i}><Q v={x.qty} unit={x.unit} /></div>) : '—'}</td>
            <td className="num">{fmtPct(o.planned && o.actual !== null ? o.actual / o.planned : null)}</td></tr>
        ))}</tbody>
      </table></div>
    </section>
  );
}

function Sales({ d, open }: { d: Dash; open: Open }) {
  return (
    <section id="sec-sales" className="dsec">
      <h2>{t('sec_sales')}</h2>
      {!d.sales.length && <Empty />}
      <div className="grid two">
        {d.sales.map((s) => (
          <div className="card" key={s.id} id={`sales-${s.id}`} data-testid={`sales-${s.def.basis}`}>
            <div className="spread"><h3>{t(`basis_${s.def.basis}`)} · {t(`period_${s.def.period}`)} {s.def.period_start}</h3><StatusBadge s={s.status} /></div>
            <div className="small muted">{[s.def.customer, s.def.product, s.def.order_ref].filter(Boolean).join(' · ')}</div>
            <Progress actual={s.actual} due={s.due} target={s.target} />
            <div className="kpis">
              <Kpi k={t('full_target')} v={<Q v={s.target} unit={s.def.unit} />} />
              <Kpi k={t('due_now')} v={s.due === null ? t('wait_schedule') : <Q v={s.due} unit={s.def.unit} />} testId="s-due" />
              <Kpi k={s.def.basis === 'invoiced' ? t('net') : t('approved_actual')} v={<Q v={s.actual} unit={s.def.unit} />} ids={s.factIds} open={open} testId="s-actual" />
              <Kpi k={t('variance')} v={s.variance === null ? '—' : fmtSigned(s.variance)} testId="s-variance" />
              <Kpi k={t('remaining')} v={<Q v={s.remaining} unit={s.def.unit} />} testId="s-remaining" />
              <Kpi k={t('pct_full')} v={fmtPct(s.pctOfTarget)} />
              {s.periodElapsedPct !== null && <Kpi k={t('period_elapsed')} v={fmtPct(s.periodElapsedPct)} />}
              {s.def.basis === 'invoiced' && <Kpi k={`${t('gross')} / ${t('credits')}`} v={<>{fmtQ(s.breakdown.gross ?? null)} / {fmtQ(s.breakdown.credits ?? null)}</>} />}
            </div>
            {s.missingConversion && <p className="small sev-review">{t('missing_conversion')}</p>}
          </div>
        ))}
      </div>
    </section>
  );
}

function DataSections({ d, me, frozen }: { d: Dash; open: Open; me: Me; frozen: boolean }) {
  return (
    <section id="sec-data" className="dsec">
      <h2>{t('sec_data')}</h2>
      {!d.datasets.length && <Empty />}
      {d.datasets.map((ds) => (
        <div className="card" key={ds.dataset} data-testid={`ds-${ds.dataset}`}>
          <h3>{t(`ds_${ds.dataset}`) !== `ds_${ds.dataset}` ? t(`ds_${ds.dataset}`) : ds.dataset.replace(/^custom:/, '')}</h3>
          {ds.metrics.map((m) => (
            <div key={`${m.metric}|${m.unit}`} style={{ marginBlockEnd: 12 }}>
              <div className="spread">
                <strong>{(getLang() === 'ar' ? m.rule.label_ar : m.rule.label_en) || m.metric} <span className="unit">{m.unit}</span></strong>
                <span>{m.total !== null ? <Q v={m.total} unit={m.unit} /> : <span className="muted small">{m.rule.confirmed ? '—' : t('unconfirmed_rule')}</span>}</span>
              </div>
              {!m.rule.confirmed && me.role === 'owner' && !frozen && <ConfirmRule dataset={ds.dataset} metric={m.metric} />}
              {m.rule.confirmed && m.series.length > 0 && <Trend points={m.series.map((p) => ({ key: p.key, value: p.value }))} unit={m.unit} />}
              {m.rule.confirmed && !m.series.length && m.byCategory && <BarList items={m.byCategory.items.map((i) => ({ key: i.key, value: i.value }))} unit={m.unit} />}
              {!frozen && <FactsLink dataset={ds.dataset} from={d.from} to={d.to} />}
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}

function FactsLink({ dataset, from, to }: { dataset: string; from: string; to: string }) {
  const [show, setShow] = useState(false);
  return (
    <>
      <button className="link small" onClick={() => setShow(true)}>{t('drill')}</button>
      {show && <Drawer onClose={() => setShow(false)}><FactTable title={dataset} query={{ dataset, from, to }} onClose={() => setShow(false)} /></Drawer>}
    </>
  );
}

function ConfirmRule({ dataset, metric }: { dataset: string; metric: string }) {
  const [kind, setKind] = useState('quantity');
  const [agg, setAgg] = useState('sum');
  const [la, setLa] = useState('');
  const [le, setLe] = useState('');
  const kinds = ['quantity', 'count', 'duration', 'rate', 'price', 'balance'];
  const aggOptions = ['rate', 'price', 'balance'].includes(kind) ? ['latest', 'avg'] : ['sum'];
  useEffect(() => { if (!aggOptions.includes(agg)) setAgg(aggOptions[0]); }, [kind]);
  return (
    <div className="notice warn" data-testid="confirm-rule">
      <div className="small">{t('unconfirmed_rule')}</div>
      <div className="fields">
        <Field label={t('rule_kind')}><Select value={kind} onChange={setKind} options={kinds.map((k) => ({ value: k, label: t(`kind_${k}`) }))} /></Field>
        <Field label={t('rule_agg')}><Select value={agg} onChange={setAgg} options={aggOptions.map((a) => ({ value: a, label: t(`agg_${a}`) }))} /></Field>
        <Field label={t('name_ar')}><input className="input" value={la} onChange={(e) => setLa(e.target.value)} /></Field>
        <Field label={t('name_en')}><input className="input" value={le} onChange={(e) => setLe(e.target.value)} /></Field>
      </div>
      <ActionButton onClick={async () => { await api('/api/metric-rules', { method: 'PUT', body: { dataset, metric, kind, aggregation: agg, label_ar: la, label_en: le } }); bumpLocalVersion(); }}>{t('confirm_rule')}</ActionButton>
    </div>
  );
}
