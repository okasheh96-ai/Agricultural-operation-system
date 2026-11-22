// Builds the dashboard model from approved, current facts and published plans. Cards, charts, tables,
// snapshots and exports all read this one model, so the same figure is the same everywhere.
import type { Env } from './env';
import { closedLots, conversions, currentFacts, settings } from './db';
import {
  downtimeByLineReason, matchedWorkerHours, periodRange, plannedWorkerHours, productionReport, productionTotals, reconcileLots, salesReport,
  type JobReport,
} from '../shared/calc';
import { mulDiv } from '../shared/num';
import { addDays, localToUtcMs } from '../shared/time';
import { BUILTIN_DATASETS, type Fact, type LineStatus, type PlanData, type SalesTarget } from '../shared/types';

export interface DashFilters { date: string; compare: 'current' | 'baseline'; line?: string; product?: string; grade?: string; customer?: string; from?: string; to?: string }

interface VersionRow { id: string; plan_id: string; n: number; status: string; data: string; effective_at: string | null; reason: string | null; published_at: string | null; shift_date: string }

const STATUS_RANK: Record<LineStatus, number> = { behind: 0, awaiting: 1, unavailable: 2, on_track: 3, ahead: 4, no_schedule: 5, scheduled: 6, complete: 7 };

export async function publishedVersions(env: Env, from: string, to: string): Promise<VersionRow[]> {
  const { results } = await env.DB.prepare(
    "SELECT v.*, p.shift_date FROM plan_versions v JOIN plans p ON p.id = v.plan_id WHERE v.status = 'published' AND p.shift_date >= ? AND p.shift_date <= ? ORDER BY p.shift_date, v.n",
  ).bind(from, to).all<VersionRow>();
  return results;
}

function slimJob(r: JobReport) {
  return {
    id: r.job.id, line: r.job.line, product: r.job.product, grade: r.job.grade ?? null, customer: r.job.customer ?? null, order_ref: r.job.order_ref ?? null,
    start: r.job.start, end: r.job.end, unit: r.job.unit, target: r.target, due: r.due, actual: r.actual, variance: r.variance, pctOfTarget: r.pctOfTarget,
    pctOfDue: r.pctOfDue, remaining: r.remaining, paceNeededPerHour: r.paceNeededPerHour, status: r.status, asOfMs: r.asOfMs, plannedWH: r.plannedWH,
    targetRate: r.targetRate, rateSource: r.rateSource, capacityKg: r.capacityKg, inconsistentTarget: r.inconsistentTarget, actualKg: r.actualKg,
    actualWH: r.actualWH, actualRate: r.actualRate, mixedModes: r.mixedModes, missingConversion: r.missingConversion, factIds: r.factIds,
  };
}
export type SlimJob = ReturnType<typeof slimJob>;

function filt(f: Fact, q: DashFilters) {
  if (q.line && f.line && f.line !== q.line) return false;
  if (q.line && !f.line && ['production', 'labour', 'downtime'].includes(f.dataset)) return false;
  if (q.product && f.product && f.product !== q.product) return false;
  if (q.grade && f.grade !== q.grade && f.dataset === 'production') return false;
  if (q.customer && f.customer && f.customer !== q.customer) return false;
  return true;
}

export async function buildDashboard(env: Env, q: DashFilters, opts: { now?: number; showWorkers: boolean }) {
  const now = opts.now ?? Date.now();
  const st = await settings(env);
  const tz = String(st.timezone ?? 'Asia/Amman');
  const convs = await conversions(env);
  const from = q.from ?? q.date;
  const to = q.to ?? q.date;

  // ---- plan versions for the shift date
  const versions = (await publishedVersions(env, q.date, q.date)).filter((v) => v.shift_date === q.date);
  const baseline = versions.find((v) => v.n === versions[0]?.n) ?? null;
  const current = versions[versions.length - 1] ?? null;
  const usingRevision = q.compare === 'current' && current && baseline && current.id !== baseline.id;
  const chosen = q.compare === 'baseline' ? baseline : current;
  const planData: PlanData | null = chosen ? JSON.parse(chosen.data) : null;
  const basePlan: PlanData | null = baseline ? JSON.parse(baseline.data) : null;
  const jobsF = (p: PlanData | null): PlanData | null => p && {
    ...p, jobs: p.jobs.filter((j) => (!q.line || j.line === q.line) && (!q.product || j.product === q.product) && (!q.grade || j.grade === q.grade) && (!q.customer || j.customer === q.customer)),
  };
  const plan = jobsF(planData);
  const base = jobsF(basePlan);

  // ---- facts
  const dayFacts = (await currentFacts(env, { from: q.date, to: q.date })).filter((f) => filt(f, q));
  const reports = plan ? productionReport(plan, dayFacts, {
    now, convs, tolerancePct: Number(st.pace_tol_pct ?? 0), rateTolerancePct: Number(st.rate_tol_pct ?? 0),
    baseline: usingRevision ? base : null, revisionEffectiveMs: usingRevision && current!.effective_at ? Date.parse(current!.effective_at) : null,
  }) : [];
  const jobs = reports.map(slimJob);

  // ---- lines: current + next job, totals when units agree
  const lineNames = [...new Set([...jobs.map((j) => j.line), ...dayFacts.filter((f) => f.dataset === 'production' && f.line).map((f) => f.line!)])].sort();
  const lines = lineNames.map((line) => {
    const lj = jobs.filter((j) => j.line === line).sort((a, b) => a.start.localeCompare(b.start));
    const current = lj.find((j) => Date.parse(j.start) <= now && now < Date.parse(j.end)) ?? null;
    const next = lj.find((j) => Date.parse(j.start) > now) ?? null;
    const units = [...new Set(lj.map((j) => j.unit))];
    const sum = (k: 'target' | 'due' | 'actual' | 'remaining') => {
      if (units.length !== 1) return null;
      let s = 0;
      for (const j of lj) {
        const v = j[k];
        if (k === 'due' && j.asOfMs === null && Date.parse(j.start) > now) continue; // not started: nothing due
        if (v === null) return null;
        s += v;
      }
      return s;
    };
    const target = sum('target');
    const actual = sum('actual');
    const due = sum('due');
    const statuses = lj.map((j) => j.status);
    const status: LineStatus = !lj.length ? 'no_schedule' : statuses.every((s) => s === 'complete') ? 'complete'
      : statuses.sort((a, b) => STATUS_RANK[a] - STATUS_RANK[b])[0];
    const asOf = lj.reduce<number | null>((m, j) => (j.asOfMs !== null && (m === null || j.asOfMs > m) ? j.asOfMs : m), null);
    const remainingWork = lj.reduce((s, j) => s + Math.max(0, Date.parse(j.end) - Math.max(asOf ?? now, Date.parse(j.start))), 0);
    return {
      line, status, unit: units.length === 1 ? units[0] : null, target, due, actual,
      variance: actual !== null && due !== null ? actual - due : null,
      pctOfTarget: actual !== null && target ? actual / target : null,
      pctOfDue: actual !== null && due ? actual / due : null,
      remaining: actual !== null && target !== null ? Math.max(0, target - actual) : null,
      paceNeededPerHour: actual !== null && target !== null && remainingWork > 0 ? mulDiv(Math.max(0, target - actual), 3600000, remainingWork) : null,
      asOfMs: asOf, current, next, jobIds: lj.map((j) => j.id), factIds: lj.flatMap((j) => j.factIds),
    };
  });

  // ---- productivity (each worker-hour once)
  const labour = dayFacts.filter((f) => f.dataset === 'labour');
  const totals = productionTotals(dayFacts, convs);
  const prodLine = (line: string | null) => {
    const ts = totals.filter((t) => line === null || t.line === line);
    const missing = ts.some((t) => t.kg === null);
    return { kg: missing ? null : ts.reduce((s, t) => s + (t.kg ?? 0), 0), missing, factIds: ts.flatMap((t) => t.factIds) };
  };
  const productivityLines = lineNames.map((line) => {
    const p = prodLine(line);
    const wh = matchedWorkerHours(labour, { line });
    const lj = reports.filter((r) => r.job.line === line);
    const plannedWH = lj.reduce((s, r) => s + r.plannedWH, 0);
    const plannedKg = lj.every((r) => r.targetKg !== null) ? lj.reduce((s, r) => s + (r.targetKg ?? 0), 0) : null;
    return {
      line, packedKg: p.kg, wh: wh.hours || null, rate: p.kg !== null && wh.hours ? mulDiv(p.kg, 1000, wh.hours) : null,
      plannedWH: plannedWH || null, plannedRate: plannedKg !== null && plannedWH ? mulDiv(plannedKg, 1000, plannedWH) : null,
      inconsistentTargets: lj.filter((r) => r.inconsistentTarget).map((r) => r.job.id), missingConversion: p.missing,
      factIds: [...p.factIds, ...wh.factIds],
    };
  });
  const allP = prodLine(null);
  const allWH = matchedWorkerHours(labour, {});
  const plannedWHAll = plan ? plan.jobs.reduce((s, j) => s + plannedWorkerHours(j), 0) : 0;
  const plannedKgAll = reports.every((r) => r.targetKg !== null) ? reports.reduce((s, r) => s + (r.targetKg ?? 0), 0) : null;
  const productivity = {
    lines: productivityLines,
    total: {
      packedKg: allP.kg, wh: allWH.hours || null, overlaps: allWH.overlaps,
      rate: allP.kg !== null && allWH.hours ? mulDiv(allP.kg, 1000, allWH.hours) : null,
      plannedWH: plannedWHAll || null, plannedRate: plannedKgAll !== null && plannedWHAll ? mulDiv(plannedKgAll, 1000, plannedWHAll) : null,
      factIds: [...allP.factIds, ...allWH.factIds],
    },
  };

  // ---- packed kg by grade
  const gradeMap = new Map<string, { grade: string; kg: number | null; factIds: string[] }>();
  for (const t of totals) {
    const g = t.grade ?? '';
    const e = gradeMap.get(g) ?? { grade: g, kg: 0, factIds: [] };
    e.kg = e.kg === null || t.kg === null ? null : e.kg + t.kg;
    e.factIds.push(...t.factIds);
    gradeMap.set(g, e);
  }
  const packedByGrade = [...gradeMap.values()].sort((a, b) => (b.kg ?? 0) - (a.kg ?? 0));

  // ---- lots and waste (matched lot input)
  const lotsTouched = new Set(dayFacts.map((f) => f.lot).filter((x): x is string => !!x));
  const lotFacts = lotsTouched.size ? (await currentFacts(env, { datasets: ['receiving', 'production', 'waste', 'carryover'] })).filter((f) => f.lot && lotsTouched.has(f.lot)) : [];
  const lots = reconcileLots(lotFacts, { convs, closedLots: await closedLots(env), tolAbsKg: Number(st.lot_tol_abs_kg ?? 0), tolPct: Number(st.lot_tol_pct ?? 0) });
  const withInput = lots.filter((l) => l.input && l.waste !== null);
  const wasteInput = withInput.reduce((s, l) => s + (l.input ?? 0), 0);
  const wasteKg = withInput.reduce((s, l) => s + (l.waste ?? 0), 0);
  const waste = { kg: withInput.length ? wasteKg : null, inputKg: withInput.length ? wasteInput : null, pct: wasteInput ? wasteKg / wasteInput : null, lotsWithoutInput: lots.filter((l) => !l.input).map((l) => l.lot) };

  // ---- downtime
  const downtime = downtimeByLineReason(dayFacts);

  // ---- sales: targets from published plans whose period covers the date
  const salesVersions = await publishedVersions(env, addDays(q.date, -31), q.date);
  const latestByPlan = new Map<string, VersionRow>();
  for (const v of salesVersions) if (q.compare === 'baseline' ? !latestByPlan.has(v.plan_id) : true) latestByPlan.set(v.plan_id, v);
  const targets: SalesTarget[] = [];
  for (const v of latestByPlan.values()) {
    const d: PlanData = JSON.parse(v.data);
    for (const t of d.sales ?? []) {
      const r = periodRange(t);
      if (q.date >= r.from && q.date < r.to && (!q.customer || !t.customer || t.customer === q.customer) && (!q.product || !t.product || t.product === q.product)) targets.push(t);
    }
  }
  let salesFrom = q.date;
  let salesTo = q.date;
  for (const t of targets) { const r = periodRange(t); if (r.from < salesFrom) salesFrom = r.from; if (addDays(r.to, -1) > salesTo) salesTo = addDays(r.to, -1); }
  const salesFacts = (await currentFacts(env, { from: salesFrom, to: salesTo, datasets: ['order', 'dispatch', 'invoice', 'credit'] })).filter((f) => filt(f, q));
  const sales = salesReport(targets, salesFacts, {
    now, convs, tolerancePct: Number(st.pace_tol_pct ?? 0),
    periodEndMs: (t) => { const r = periodRange(t); return { start: localToUtcMs(r.from, '00:00', tz), end: localToUtcMs(r.to, '00:00', tz) }; },
  }).map((s) => ({ ...s, target_def: s.target_def }));

  // ---- orders: planned vs produced vs dispatched where recorded
  const orderRefs = new Set<string>([...jobs.map((j) => j.order_ref).filter((x): x is string => !!x), ...dayFacts.filter((f) => f.order_ref).map((f) => f.order_ref!)]);
  const orders = [...orderRefs].sort().map((ref) => {
    const oj = jobs.filter((j) => j.order_ref === ref);
    const units = [...new Set(oj.map((j) => j.unit))];
    const prod = totals.filter((t) => t.order_ref === ref);
    const disp = salesFacts.filter((f) => f.dataset === 'dispatch' && f.order_ref === ref && f.shift_date === q.date);
    return {
      order_ref: ref, customer: oj[0]?.customer ?? disp[0]?.customer ?? null, unit: units.length === 1 ? units[0] : null,
      planned: units.length === 1 ? oj.reduce((s, j) => s + j.target, 0) : null,
      actual: units.length === 1 && oj.every((j) => j.actual !== null) && oj.length ? oj.reduce((s, j) => s + (j.actual ?? 0), 0) : null,
      packedKg: prod.some((p) => p.kg === null) ? null : prod.reduce((s, p) => s + (p.kg ?? 0), 0),
      dispatched: disp.map((d) => ({ qty: d.qty, unit: d.unit })), factIds: [...prod.flatMap((p) => p.factIds), ...disp.map((d) => d.id)],
    };
  });

  // ---- generic sections for every approved dataset (including custom ones)
  const rangeFacts = from === q.date && to === q.date ? dayFacts : (await currentFacts(env, { from, to })).filter((f) => filt(f, q));
  const { results: rules } = await env.DB.prepare('SELECT * FROM metric_rules').all<{ dataset: string; metric: string; kind: string; aggregation: string; confirmed: number; label_ar: string; label_en: string }>();
  const ruleOf = (ds: string, m: string) => {
    const r = rules.find((x) => x.dataset === ds && x.metric === m);
    if (r) return { kind: r.kind, aggregation: r.aggregation, confirmed: r.confirmed === 1, label_ar: r.label_ar, label_en: r.label_en };
    if ((BUILTIN_DATASETS as readonly string[]).includes(ds)) return { kind: 'quantity', aggregation: 'sum', confirmed: true, label_ar: '', label_en: '' };
    return { kind: 'quantity', aggregation: 'sum', confirmed: false, label_ar: '', label_en: '' };
  };
  const dsMap = new Map<string, Fact[]>();
  for (const f of rangeFacts) dsMap.set(f.dataset, [...(dsMap.get(f.dataset) ?? []), f]);
  const datasets = [...dsMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([dataset, fs]) => {
    const metrics = new Map<string, Fact[]>();
    for (const f of fs) { const k = `${f.metric}|${f.unit}`; metrics.set(k, [...(metrics.get(k) ?? []), f]); }
    return {
      dataset, rows: fs.length,
      metrics: [...metrics.entries()].map(([k, mf]) => {
        const [metric, unit] = k.split('|');
        const rule = ruleOf(dataset, metric);
        const multiDay = from !== to;
        const timeKey = (f: Fact) => (multiDay ? f.shift_date : f.at_ms ?? f.start_ms ? new Date(f.at_ms ?? f.start_ms!).toISOString() : f.shift_date);
        const dims = ['line', 'grade', 'product', 'customer', 'lot', 'reason', 'order_ref'] as const;
        const catDim = dims.find((d) => new Set(mf.map((f) => f[d]).filter(Boolean)).size > 1) ?? dims.find((d) => mf.some((f) => f[d])) ?? null;
        const agg = (xs: Fact[]): number | null => {
          if (!rule.confirmed) return null;
          if (!xs.length) return null;
          if (rule.aggregation === 'sum') {
            if (dataset === 'production') return xs.filter((x) => x.mode !== 'cumulative').reduce((s, x) => s + x.qty, 0) + latestCum(xs);
            return xs.reduce((s, x) => s + x.qty, 0);
          }
          if (rule.aggregation === 'latest') return [...xs].sort((a, b) => (a.at_ms ?? 0) - (b.at_ms ?? 0) || a.shift_date.localeCompare(b.shift_date))[xs.length - 1].qty;
          return Math.round(xs.reduce((s, x) => s + x.qty, 0) / xs.length);
        };
        const group = (key: (f: Fact) => string | null) => {
          const g = new Map<string, Fact[]>();
          for (const f of mf) { const kk = key(f) ?? ''; g.set(kk, [...(g.get(kk) ?? []), f]); }
          return [...g.entries()].map(([key, xs]) => ({ key, value: agg(xs), n: xs.length }));
        };
        const hasTime = mf.some((f) => f.at_ms || f.start_ms) || multiDay;
        return {
          metric, unit, rule,
          // never sum rates, prices or balances across dates: their total is the latest/average within one date only
          total: rule.aggregation !== 'sum' && multiDay ? null : agg(mf),
          series: hasTime ? group(timeKey).sort((a, b) => a.key.localeCompare(b.key)) : [],
          byCategory: catDim ? { dim: catDim, items: group((f) => f[catDim]).sort((a, b) => (b.value ?? 0) - (a.value ?? 0)) } : null,
          n: mf.length,
        };
      }),
    };
  });

  // ---- previous period for comparison
  const span = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
  const prevFrom = addDays(from, -span);
  const prevTo = addDays(from, -1);
  const prevFacts = (await currentFacts(env, { from: prevFrom, to: prevTo, datasets: ['production', 'labour'] })).filter((f) => filt(f, q));
  const prevTot = productionTotals(prevFacts, convs);
  const prevKg = prevTot.some((t) => t.kg === null) ? null : prevTot.reduce((s, t) => s + (t.kg ?? 0), 0);
  const prevWH = matchedWorkerHours(prevFacts.filter((f) => f.dataset === 'labour'), {}).hours;
  const previous = { from: prevFrom, to: prevTo, packedKg: prevFacts.length ? prevKg : null, wh: prevWH || null, rate: prevKg !== null && prevWH ? mulDiv(prevKg, 1000, prevWH) : null };

  const lastReadingMs = dayFacts.reduce<number | null>((m, f) => { const t = f.at_ms ?? f.end_ms; return t !== null && t <= now && (m === null || t > m) ? t : m; }, null);

  // ---- grounded summary: every sentence cites figures above and links to its section
  const summary: { code: string; params: Record<string, string | number | null>; anchor: string }[] = [];
  for (const l of lines) {
    if (l.status === 'awaiting') summary.push({ code: 'line_awaiting', params: { line: l.line }, anchor: `line-${l.line}` });
    else if (l.variance !== null && l.unit) summary.push({ code: `line_${l.status}`, params: { line: l.line, actual: l.actual, due: l.due, variance: l.variance, unit: l.unit, pctDue: l.pctOfDue }, anchor: `line-${l.line}` });
  }
  if (productivity.total.rate !== null) summary.push({ code: 'productivity', params: { rate: productivity.total.rate, planned: productivity.total.plannedRate }, anchor: 'sec-productivity' });
  for (const l of lots.filter((x) => x.flagged)) summary.push({ code: 'lot_gap', params: { lot: l.lot, gap: l.gap }, anchor: `lot-${l.lot}` });
  if (waste.pct !== null) summary.push({ code: 'waste', params: { pct: waste.pct, kg: waste.kg }, anchor: 'sec-waste' });
  for (const s of sales) summary.push({ code: `sales_${s.status}`, params: { basis: s.target_def.basis, actual: s.actual, due: s.due, target: s.target, unit: s.target_def.unit, variance: s.variance }, anchor: `sales-${s.target_def.id}` });

  return {
    now, tz, date: q.date, from, to, filters: q, lastReadingMs,
    plan: {
      has_plan: !!chosen, compare: q.compare, chosen_id: chosen?.id ?? null, baseline_id: baseline?.id ?? null, current_id: current?.id ?? null,
      versions: versions.map((v) => ({ id: v.id, n: v.n, effective_at: v.effective_at, reason: v.reason, published_at: v.published_at })),
    },
    lines, jobs, productivity, packedByGrade, lots, waste, downtime,
    sales: sales.map((s) => ({ id: s.target_def.id, def: s.target_def, target: s.target, due: s.due, actual: s.actual, variance: s.variance, pctOfTarget: s.pctOfTarget, pctOfDue: s.pctOfDue, remaining: s.remaining, status: s.status, periodElapsedPct: s.periodElapsedPct, breakdown: s.breakdown, missingConversion: s.missingConversion, factIds: s.factIds })),
    orders, datasets, previous, summary, showWorkers: opts.showWorkers,
  };
}
export type Dashboard = Awaited<ReturnType<typeof buildDashboard>>;

function latestCum(xs: Fact[]): number {
  const by = new Map<string, Fact>();
  for (const f of xs) if (f.mode === 'cumulative') {
    const k = [f.line, f.product, f.grade, f.lot, f.shift_date].join('|');
    const p = by.get(k);
    if (!p || (f.at_ms ?? 0) > (p.at_ms ?? 0)) by.set(k, f);
  }
  return [...by.values()].reduce((s, f) => s + f.qty, 0);
}
