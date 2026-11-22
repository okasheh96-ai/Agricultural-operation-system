// Calculation engine. Pure functions over approved facts and a plan version. Used by the Worker (dashboard,
// snapshots, exports) and by tests. All quantities are integer thousandths; ratios are returned as plain
// numbers for display only and are null when an input is missing or a denominator is zero.
import { mulDiv, ratio } from './num';
import type { Conversion, Fact, LineStatus, PlanData, PlanJob, SalesTarget } from './types';
import { addDays } from './time';

const HOUR = 3600000;

// ---------------------------------------------------------------- conversions

/** Convert qty (milli of `from`) to milli of `to` using documented conversions only. null = no documented path. */
export function convert(qty: number, from: string, to: string, convs: Conversion[], product?: string | null, grade?: string | null): number | null {
  if (from === to) return qty;
  const pick = (f: string, t: string): Conversion | undefined => {
    const c = convs.filter((x) => x.from_unit === f && x.to_unit === t && (!x.product || x.product === product));
    return c.find((x) => x.grade && x.grade === grade && x.product) ?? c.find((x) => !x.grade && x.product) ?? c.find((x) => !x.product && !x.grade);
  };
  const step = (q: number, f: string, t: string): number | null => {
    const d = pick(f, t);
    if (d) return mulDiv(q, d.factor, 1000);
    const inv = pick(t, f);
    if (inv && inv.factor !== 0) return mulDiv(q, 1000, inv.factor);
    return null;
  };
  // Breadth-first over documented conversions (e.g. pallet -> box -> kg), at most 3 steps.
  const units = new Set<string>();
  for (const c of convs) if (!c.product || c.product === product) { units.add(c.from_unit); units.add(c.to_unit); }
  let frontier: Array<[string, number]> = [[from, qty]];
  const seen = new Set([from]);
  for (let depth = 0; depth < 3 && frontier.length; depth++) {
    const next: Array<[string, number]> = [];
    for (const [u, q] of frontier) {
      for (const v of units) {
        if (seen.has(v)) continue;
        const r = step(q, u, v);
        if (r === null) continue;
        if (v === to) return r;
        seen.add(v);
        next.push([v, r]);
      }
    }
    frontier = next;
  }
  return null;
}

// ---------------------------------------------------------------- plan geometry

export interface Segment { start: number; end: number; crew: number }

/** Working segments of a job: [start,end] minus breaks/changeovers, split at crew changes; crew 0 is not work. */
export function workSegments(job: PlanJob): Segment[] {
  const s = Date.parse(job.start);
  const e = Date.parse(job.end);
  if (!(e > s)) return [];
  const cuts = new Set<number>([s, e]);
  const breaks = (job.breaks ?? []).map((b) => [Date.parse(b.start), Date.parse(b.end)] as const).filter(([a, b]) => b > a);
  for (const [a, b] of breaks) { if (a > s && a < e) cuts.add(a); if (b > s && b < e) cuts.add(b); }
  const changes = (job.crew_changes ?? []).map((c) => ({ at: Date.parse(c.at), crew: c.crew })).sort((a, b) => a.at - b.at);
  for (const c of changes) if (c.at > s && c.at < e) cuts.add(c.at);
  const pts = [...cuts].sort((a, b) => a - b);
  const out: Segment[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const mid = (a + b) / 2;
    if (breaks.some(([x, y]) => mid > x && mid < y)) continue;
    let crew = job.crew;
    for (const c of changes) if (c.at <= a) crew = c.crew;
    if (crew <= 0) continue;
    const last = out[out.length - 1];
    if (last && last.end === a && last.crew === crew) last.end = b;
    else out.push({ start: a, end: b, crew });
  }
  return out;
}

function workMsBetween(segs: Segment[], from: number, to: number): number {
  let t = 0;
  for (const g of segs) t += Math.max(0, Math.min(g.end, to) - Math.max(g.start, from));
  return t;
}

/** Planned worker-hours (milli) in [from, to]: sum of crew x hours per working segment. */
export function plannedWorkerHours(job: PlanJob, from = -Infinity, to = Infinity): number {
  let wh = 0;
  for (const g of workSegments(job)) {
    const ms = Math.max(0, Math.min(g.end, to) - Math.max(g.start, from));
    wh += mulDiv(g.crew * ms, 1000, HOUR);
  }
  return wh;
}

/** Target due by time t (milli of job unit). Milestones are steps; otherwise even over working time. */
export function dueAt(job: PlanJob, t: number): number {
  if (job.milestones && job.milestones.length) {
    let due = 0;
    for (const m of job.milestones) if (Date.parse(m.at) <= t) due = Math.max(due, m.cumulative);
    return due;
  }
  const segs = workSegments(job);
  const total = workMsBetween(segs, -Infinity, Infinity);
  if (total === 0) return t >= Date.parse(job.end) ? job.target : 0;
  return mulDiv(job.target, workMsBetween(segs, -Infinity, t), total);
}

/**
 * Due under a revision effective at `eff`: what was due under the baseline by `eff` stays due; the revised
 * target's remainder is spread over the revised job's working time after `eff`. History is never rewritten.
 */
export function dueRevised(base: PlanJob | undefined, rev: PlanJob | undefined, eff: number, t: number): number {
  const baseAtEff = base ? dueAt(base, Math.min(eff, t)) : 0;
  if (t <= eff) return base ? dueAt(base, t) : 0;
  if (!rev) return baseAtEff; // job removed by the revision: nothing more becomes due
  if (rev.milestones && rev.milestones.length) return Math.max(baseAtEff, dueAt(rev, t));
  const segs = workSegments(rev);
  const after = workMsBetween(segs, eff, Infinity);
  const remaining = rev.target - baseAtEff;
  if (after === 0) return t >= Date.parse(rev.end) ? rev.target : baseAtEff;
  return baseAtEff + mulDiv(remaining, workMsBetween(segs, eff, t), after);
}

// ---------------------------------------------------------------- production actuals

export function factMatchesJob(f: Fact, j: PlanJob): boolean {
  if (f.line !== j.line || f.product !== j.product) return false;
  if (j.grade && f.grade && f.grade !== j.grade) return false;
  if (j.grade && !f.grade) return false;
  if (j.order_ref && f.order_ref && f.order_ref !== j.order_ref) return false;
  return true;
}

/** Assign every production fact to at most one job (by dimensions and reading time). */
export function assignProduction(facts: Fact[], jobs: PlanJob[], graceMs = 30 * 60000): Map<string, Fact[]> {
  const out = new Map<string, Fact[]>(jobs.map((j) => [j.id, []]));
  out.set('__unmatched__', []);
  for (const f of facts) {
    if (f.dataset !== 'production') continue;
    const at = f.at_ms ?? f.end_ms;
    const cands = jobs.filter((j) => factMatchesJob(f, j));
    let chosen: PlanJob | undefined;
    if (at !== null && at !== undefined) {
      chosen = cands.find((j) => at > Date.parse(j.start) && at <= Date.parse(j.end));
      if (!chosen) {
        const late = cands.filter((j) => at > Date.parse(j.end) && at <= Date.parse(j.end) + graceMs).sort((a, b) => Date.parse(b.end) - Date.parse(a.end));
        chosen = late[0];
      }
    } else if (cands.length === 1) chosen = cands[0];
    out.get(chosen ? chosen.id : '__unmatched__')!.push(f);
  }
  return out;
}

export interface JobActual {
  actual: number | null; // milli of job unit; null = cannot be expressed (missing conversion)
  lastReadingMs: number | null;
  readings: number;
  mixedModes: boolean;
  missingConversion: boolean;
  factIds: string[];
}

/** Actual for a job as of t, from facts already assigned to it. Interval readings add; cumulative readings replace. */
export function jobActual(job: PlanJob, assigned: Fact[], t: number, convs: Conversion[], allProduction: Fact[] = []): JobActual {
  const upTo = assigned.filter((f) => (f.at_ms ?? f.end_ms ?? 0) <= t);
  let missing = false;
  const conv = (f: Fact): number | null => {
    const c = convert(f.qty, f.unit, job.unit, convs, f.product, f.grade);
    if (c === null) missing = true;
    return c;
  };
  const cum = upTo.filter((f) => f.mode === 'cumulative').sort((a, b) => (a.at_ms ?? 0) - (b.at_ms ?? 0));
  const ints = upTo.filter((f) => f.mode !== 'cumulative');
  let total = 0;
  let lastCumAt = -Infinity;
  if (cum.length) {
    const last = cum[cum.length - 1];
    lastCumAt = last.at_ms ?? -Infinity;
    const lastV = conv(last);
    // Counter value before the job started on the same stream (line/product/grade), same shift date.
    const before = allProduction
      .filter((f) => f.mode === 'cumulative' && f.line === job.line && f.product === job.product && (f.grade ?? null) === (last.grade ?? null) && f.shift_date === last.shift_date && (f.at_ms ?? 0) <= Date.parse(job.start))
      .sort((a, b) => (b.at_ms ?? 0) - (a.at_ms ?? 0))[0];
    const baseV = before ? conv(before) : 0;
    if (lastV !== null && baseV !== null) total += lastV - baseV;
  }
  for (const f of ints) {
    if ((f.at_ms ?? f.end_ms ?? 0) <= lastCumAt) continue; // already inside a cumulative total
    const v = conv(f);
    if (v !== null) total += v;
  }
  const lastReadingMs = upTo.reduce<number | null>((m, f) => Math.max(m ?? -Infinity, f.at_ms ?? f.end_ms ?? -Infinity), null);
  return {
    actual: missing ? null : upTo.length ? total : null,
    lastReadingMs: lastReadingMs === -Infinity ? null : lastReadingMs,
    readings: upTo.length,
    mixedModes: cum.length > 0 && ints.length > 0,
    missingConversion: missing,
    factIds: upTo.map((f) => f.id),
  };
}

export interface ProgressResult {
  target: number;
  due: number | null;
  actual: number | null;
  variance: number | null; // actual - due (signed)
  pctOfTarget: number | null;
  pctOfDue: number | null;
  remaining: number | null;
  /** thousandths of unit per hour still needed over the remaining scheduled working time */
  paceNeededPerHour: number | null;
  status: LineStatus;
}

export function judge(target: number, due: number | null, actual: number | null, opts: { started: boolean; hasReading: boolean; tolerancePct?: number; remainingWorkMs?: number | null }): ProgressResult {
  const tol = opts.tolerancePct ?? 0;
  const res: ProgressResult = {
    target, due, actual,
    variance: actual !== null && due !== null ? actual - due : null,
    pctOfTarget: ratio(actual, target),
    pctOfDue: ratio(actual, due),
    remaining: actual !== null ? Math.max(0, target - actual) : null,
    paceNeededPerHour: null,
    status: 'unavailable',
  };
  if (actual !== null && opts.remainingWorkMs && opts.remainingWorkMs > 0 && res.remaining !== null) {
    res.paceNeededPerHour = mulDiv(res.remaining, HOUR, opts.remainingWorkMs);
  }
  if (actual !== null && actual >= target && target > 0) res.status = 'complete';
  else if (!opts.hasReading) res.status = opts.started ? 'awaiting' : 'scheduled';
  else if (due === null) res.status = 'no_schedule';
  else if (actual === null) res.status = 'unavailable';
  else {
    const band = Math.abs(mulDiv(due, Math.round(tol * 1000), 100000));
    if (actual < due - band) res.status = 'behind';
    else if (actual > due + band) res.status = 'ahead';
    else res.status = 'on_track';
  }
  return res;
}

export interface JobReport extends ProgressResult {
  job: PlanJob;
  asOfMs: number | null; // time covered by the last approved reading
  plannedWH: number;
  plannedWHDue: number | null;
  targetKg: number | null;
  targetRate: number | null; // milli kg per WH
  rateSource: 'entered' | 'derived' | 'unavailable';
  capacityKg: number | null;
  inconsistentTarget: boolean;
  actualKg: number | null;
  actualWH: number | null;
  actualRate: number | null; // milli kg per WH
  plannedRate: number | null;
  mixedModes: boolean;
  missingConversion: boolean;
  factIds: string[];
}

export interface ProductionOptions {
  now: number;
  convs: Conversion[];
  tolerancePct?: number;
  rateTolerancePct?: number;
  /** compare against a revision: baseline plan and revision effective time */
  baseline?: PlanData | null;
  revisionEffectiveMs?: number | null;
}

/** Per-job report as of each job's last approved reading (or now when nothing is reported yet). */
export function productionReport(plan: PlanData, facts: Fact[], opts: ProductionOptions): JobReport[] {
  const prod = facts.filter((f) => f.dataset === 'production');
  const assigned = assignProduction(prod, plan.jobs);
  const labour = facts.filter((f) => f.dataset === 'labour');
  return plan.jobs.map((job) => {
    const js = Date.parse(job.start);
    const je = Date.parse(job.end);
    const mine = assigned.get(job.id) ?? [];
    const probe = jobActual(job, mine, opts.now, opts.convs, prod);
    const asOf = probe.lastReadingMs;
    const t = asOf ?? opts.now;
    const act = asOf !== null ? jobActual(job, mine, asOf, opts.convs, prod) : probe;
    const baseJob = opts.baseline?.jobs.find((b) => b.id === job.id);
    const due = asOf === null ? null
      : opts.baseline && opts.revisionEffectiveMs ? dueRevised(baseJob, job, opts.revisionEffectiveMs, asOf)
      : dueAt(job, asOf);
    const segs = workSegments(job);
    const remainingWorkMs = workMsBetween(segs, t, Infinity);
    const r = judge(job.target, due, act.actual, { started: opts.now > js, hasReading: asOf !== null, tolerancePct: opts.tolerancePct, remainingWorkMs });
    // productivity
    const plannedWH = plannedWorkerHours(job);
    const plannedWHDue = asOf !== null ? plannedWorkerHours(job, -Infinity, asOf) : null;
    const targetKg = convert(job.target, job.unit, 'kg', opts.convs, job.product, job.grade);
    let targetRate: number | null = null;
    let rateSource: JobReport['rateSource'] = 'unavailable';
    if (job.rate_target) { targetRate = job.rate_target; rateSource = 'entered'; }
    else if (targetKg !== null && plannedWH > 0) { targetRate = mulDiv(targetKg, 1000, plannedWH); rateSource = 'derived'; }
    const capacityKg = targetRate !== null ? mulDiv(targetRate, plannedWH, 1000) : null;
    const rtol = opts.rateTolerancePct ?? 0;
    const inconsistentTarget = rateSource === 'entered' && targetKg !== null && capacityKg !== null &&
      Math.abs(capacityKg - targetKg) > Math.abs(mulDiv(targetKg, Math.round(rtol * 1000), 100000));
    const actualKg = act.actual === null ? null : convert(act.actual, job.unit, 'kg', opts.convs, job.product, job.grade);
    const wh = asOf !== null ? matchedWorkerHours(labour, { line: job.line, from: js, to: Math.min(asOf, je), shiftDate: shiftDateOfFacts(mine) }).hours : null;
    return {
      ...r, job, asOfMs: asOf, plannedWH, plannedWHDue, targetKg, targetRate, rateSource, capacityKg, inconsistentTarget,
      actualKg, actualWH: wh, actualRate: actualKg !== null && wh ? mulDiv(actualKg, 1000, wh) : null,
      plannedRate: targetRate, mixedModes: act.mixedModes, missingConversion: act.missingConversion, factIds: act.factIds,
    };
  });
}

function shiftDateOfFacts(fs: Fact[]): string | null {
  return fs[0]?.shift_date ?? null;
}

// ---------------------------------------------------------------- worker-hours

export interface WorkerHours { hours: number; overlaps: number; factIds: string[] }

/** Milli worker-hours of a labour fact clipped to [from,to]. Rows with only a total are not clippable. */
function labourInterval(f: Fact): { start: number; end: number; crew: number } | null {
  if (f.start_ms === null || f.end_ms === null || f.end_ms <= f.start_ms) return null;
  const crew = f.metric === 'crew' ? f.qty / 1000 : f.worker ? 1 : null;
  if (crew === null) return null;
  return { start: f.start_ms, end: f.end_ms, crew };
}

/**
 * Actual worker-hours matched to a line (or all lines) in [from,to]. Each worker-hour is counted once:
 * named workers' intervals are merged across lines and grades; identical crew rows repeated per grade count once.
 */
export function matchedWorkerHours(labour: Fact[], q: { line?: string | null; from?: number; to?: number; shiftDate?: string | null }): WorkerHours {
  const from = q.from ?? -Infinity;
  const to = q.to ?? Infinity;
  let total = 0;
  let overlaps = 0;
  const ids: string[] = [];
  const seenCrew = new Set<string>();
  const perWorker = new Map<string, Array<[number, number, string | null]>>();
  for (const f of labour) {
    if (f.dataset !== 'labour') continue;
    const iv = labourInterval(f);
    if (!iv) {
      // aggregated hours with no times: only by line and shift date
      if (f.metric !== 'worker_hours') continue;
      if (q.line && f.line !== q.line) continue;
      if (q.shiftDate && f.shift_date !== q.shiftDate) continue;
      if (f.at_ms !== null && f.at_ms > to) continue;
      const key = `${f.line}|${f.shift_date}|${f.worker ?? ''}|${f.at_ms}|${f.qty}`;
      if (seenCrew.has(key)) continue;
      seenCrew.add(key);
      total += f.qty;
      ids.push(f.id);
      continue;
    }
    const a = Math.max(iv.start, from);
    const b = Math.min(iv.end, to);
    if (b <= a) continue;
    if (f.worker) {
      const arr = perWorker.get(f.worker) ?? [];
      arr.push([a, b, f.line]);
      perWorker.set(f.worker, arr);
      ids.push(f.id);
      continue;
    }
    if (q.line && f.line !== q.line) continue;
    const key = `${f.line}|${iv.start}|${iv.end}|${iv.crew}`;
    if (seenCrew.has(key)) { overlaps++; continue; }
    seenCrew.add(key);
    total += mulDiv(Math.round(iv.crew * 1000) * (b - a), 1, HOUR);
    ids.push(f.id);
  }
  for (const [, ivs] of perWorker) {
    ivs.sort((x, y) => x[0] - y[0]);
    let curEnd = -Infinity;
    for (const [a, b, line] of ivs) {
      const s = Math.max(a, curEnd);
      if (a < curEnd) overlaps++;
      if (b > s && (!q.line || line === q.line)) total += mulDiv(b - s, 1000, HOUR);
      curEnd = Math.max(curEnd, b);
    }
  }
  return { hours: total, overlaps, factIds: ids };
}

// ---------------------------------------------------------------- sales

export function periodRange(t: SalesTarget): { from: string; to: string } {
  const from = t.period_start;
  if (t.period === 'day') return { from, to: addDays(from, 1) };
  if (t.period === 'week') return { from, to: addDays(from, 7) };
  const [y, m] = from.split('-').map(Number);
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  return { from: `${y}-${String(m).padStart(2, '0')}-01`, to: next };
}

export interface SalesReport extends ProgressResult {
  target_def: SalesTarget;
  periodElapsedPct: number | null;
  factIds: string[];
  missingConversion: boolean;
  breakdown: { gross?: number; credits?: number; cancelled?: number };
}

function salesFactMatches(f: Fact, t: SalesTarget, range: { from: string; to: string }): boolean {
  if (f.shift_date < range.from || f.shift_date >= range.to) return false;
  if (t.customer && f.customer !== t.customer) return false;
  if (t.product && f.product && f.product !== t.product) return false;
  if (t.product && !f.product && t.basis !== 'invoiced') return false;
  if (t.order_ref && f.order_ref !== t.order_ref && f.doc_no !== t.order_ref) return false;
  return true;
}

export function salesReport(targets: SalesTarget[], facts: Fact[], opts: { now: number; convs: Conversion[]; tolerancePct?: number; periodEndMs?: (t: SalesTarget) => { start: number; end: number } }): SalesReport[] {
  return targets.map((t) => {
    const range = periodRange(t);
    let actual = 0;
    let missing = false;
    const ids: string[] = [];
    const breakdown: SalesReport['breakdown'] = {};
    const measureOk = (f: Fact) => (t.measure === 'value' ? f.metric === 'value' && f.unit === t.unit : f.metric === 'qty');
    const add = (f: Fact, sign: 1 | -1) => {
      let v: number | null = f.qty;
      if (t.measure === 'qty') v = convert(f.qty, f.unit, t.unit, opts.convs, f.product, f.grade);
      if (v === null) { missing = true; return 0; }
      actual += sign * v;
      ids.push(f.id);
      return v;
    };
    if (t.basis === 'orders') {
      // Latest record per order wins; cancelled orders count zero.
      const byOrder = new Map<string, Fact[]>();
      for (const f of facts) if (f.dataset === 'order' && measureOk(f) && salesFactMatches(f, t, range)) {
        const k = `${f.doc_no ?? f.order_ref ?? f.id}|${f.product ?? ''}`;
        byOrder.set(k, [...(byOrder.get(k) ?? []), f]);
      }
      let cancelled = 0;
      for (const [, fs] of byOrder) {
        const last = fs.sort((a, b) => (a.at_ms ?? 0) - (b.at_ms ?? 0))[fs.length - 1];
        if (last.status === 'cancelled') { cancelled += last.qty; continue; }
        add(last, 1);
      }
      breakdown.cancelled = cancelled;
    } else if (t.basis === 'dispatch') {
      for (const f of facts) if (f.dataset === 'dispatch' && measureOk(f) && salesFactMatches(f, t, range)) add(f, 1);
    } else {
      let gross = 0;
      let credits = 0;
      for (const f of facts) {
        if (!(f.metric === 'value' && f.unit === t.unit && salesFactMatches(f, t, range))) continue;
        if (f.dataset === 'invoice') gross += add(f, 1);
        else if (f.dataset === 'credit') credits += add(f, -1);
      }
      breakdown.gross = gross;
      breakdown.credits = credits;
    }
    const hasMilestones = !!(t.milestones && t.milestones.length);
    let due: number | null = null;
    if (hasMilestones) {
      due = 0;
      for (const m of t.milestones!) if (Date.parse(m.at) <= opts.now) due = Math.max(due, m.cumulative);
    }
    const r = judge(t.target, due, missing ? null : actual, { started: true, hasReading: true, tolerancePct: opts.tolerancePct });
    if (!hasMilestones && r.status !== 'complete') r.status = 'no_schedule';
    if (!hasMilestones) r.variance = null;
    let elapsed: number | null = null;
    if (opts.periodEndMs) {
      const { start, end } = opts.periodEndMs(t);
      elapsed = Math.min(1, Math.max(0, (opts.now - start) / (end - start)));
    }
    return { ...r, target_def: t, periodElapsedPct: elapsed, factIds: ids, missingConversion: missing, breakdown };
  });
}

// ---------------------------------------------------------------- lot reconciliation

export interface LotReconciliation {
  lot: string;
  closed: boolean;
  input: number | null; // kg milli: receiving + carryover in
  packed: number | null;
  waste: number | null;
  carryOut: number | null;
  output: number | null; // packed + waste + carryover out
  gap: number | null; // input - output
  gapPct: number | null;
  wastePct: number | null; // waste / input
  flagged: boolean;
  missingConversion: boolean;
  sources: { role: 'receiving' | 'carry_in' | 'packed' | 'waste' | 'carry_out'; factId: string; qtyKg: number | null; source_ref: string | null }[];
}

export function reconcileLots(facts: Fact[], opts: { convs: Conversion[]; closedLots: Set<string>; tolAbsKg: number; tolPct: number }): LotReconciliation[] {
  const lots = new Map<string, LotReconciliation>();
  const get = (lot: string) => {
    let r = lots.get(lot);
    if (!r) {
      r = { lot, closed: opts.closedLots.has(lot), input: 0, packed: 0, waste: 0, carryOut: 0, output: 0, gap: 0, gapPct: null, wastePct: null, flagged: false, missingConversion: false, sources: [] };
      lots.set(lot, r);
    }
    return r;
  };
  for (const f of facts) {
    if (!f.lot) continue;
    let role: LotReconciliation['sources'][number]['role'] | null = null;
    if (f.dataset === 'receiving') role = 'receiving';
    else if (f.dataset === 'production') role = 'packed';
    else if (f.dataset === 'waste') role = 'waste';
    else if (f.dataset === 'carryover') role = f.direction === 'in' ? 'carry_in' : f.direction === 'out' ? 'carry_out' : null;
    if (!role) continue;
    if (role === 'packed' && f.mode === 'cumulative') continue; // lot balance uses interval/event quantities only
    const r = get(f.lot);
    const kg = convert(f.qty, f.unit, 'kg', opts.convs, f.product, f.grade);
    r.sources.push({ role, factId: f.id, qtyKg: kg, source_ref: f.source_ref ?? null });
    if (kg === null) { r.missingConversion = true; continue; }
    if (role === 'receiving' || role === 'carry_in') r.input! += kg;
    if (role === 'packed') r.packed! += kg;
    if (role === 'waste') r.waste! += kg;
    if (role === 'carry_out') r.carryOut! += kg;
  }
  for (const r of lots.values()) {
    if (r.missingConversion) {
      r.input = r.packed = r.waste = r.carryOut = r.output = r.gap = null;
      continue;
    }
    r.output = r.packed! + r.waste! + r.carryOut!;
    r.gap = r.input! - r.output;
    r.gapPct = ratio(r.gap, r.input);
    r.wastePct = r.input ? ratio(r.waste, r.input) : null;
    const tol = Math.max(opts.tolAbsKg, r.input ? Math.abs(mulDiv(r.input, Math.round(opts.tolPct * 1000), 100000)) : 0);
    r.flagged = r.closed && Math.abs(r.gap) > tol;
  }
  return [...lots.values()].sort((a, b) => a.lot.localeCompare(b.lot));
}

// ---------------------------------------------------------------- downtime

export function downtimeByLineReason(facts: Fact[]): { line: string; reason: string; minutes: number; factIds: string[] }[] {
  const m = new Map<string, { line: string; reason: string; minutes: number; factIds: string[] }>();
  for (const f of facts) {
    if (f.dataset !== 'downtime') continue;
    let minutes: number | null = null;
    if (f.metric === 'minutes') minutes = f.qty;
    else if (f.start_ms !== null && f.end_ms !== null) minutes = mulDiv(f.end_ms - f.start_ms, 1000, 60000);
    if (minutes === null) continue;
    const k = `${f.line ?? ''}|${f.reason ?? ''}`;
    const e = m.get(k) ?? { line: f.line ?? '', reason: f.reason ?? '', minutes: 0, factIds: [] };
    e.minutes += minutes;
    e.factIds.push(f.id);
    m.set(k, e);
  }
  return [...m.values()];
}

// ---------------------------------------------------------------- production totals per stream

export interface StreamTotal { line: string | null; product: string | null; grade: string | null; lot: string | null; order_ref: string | null; shift_date: string; kg: number | null; factIds: string[] }

/** Packed quantity per stream (line/product/grade/lot/order/date): latest cumulative reading plus later interval readings. */
export function productionTotals(facts: Fact[], convs: Conversion[]): StreamTotal[] {
  const groups = new Map<string, Fact[]>();
  for (const f of facts) {
    if (f.dataset !== 'production') continue;
    const k = [f.line, f.product, f.grade, f.lot, f.order_ref, f.shift_date].join('|');
    groups.set(k, [...(groups.get(k) ?? []), f]);
  }
  const out: StreamTotal[] = [];
  for (const fs of groups.values()) {
    const cum = fs.filter((f) => f.mode === 'cumulative').sort((a, b) => (a.at_ms ?? 0) - (b.at_ms ?? 0));
    const last = cum[cum.length - 1];
    const lastAt = last ? last.at_ms ?? -Infinity : -Infinity;
    let kg: number | null = 0;
    const ids: string[] = [];
    const use = [...(last ? [last] : []), ...fs.filter((f) => f.mode !== 'cumulative' && (f.at_ms ?? f.end_ms ?? Infinity) > lastAt)];
    for (const f of use) {
      const v = convert(f.qty, f.unit, 'kg', convs, f.product, f.grade);
      ids.push(f.id);
      if (v === null) { kg = null; break; }
      kg += v;
    }
    const f0 = fs[0];
    out.push({ line: f0.line, product: f0.product, grade: f0.grade, lot: f0.lot, order_ref: f0.order_ref, shift_date: f0.shift_date, kg, factIds: ids });
  }
  return out;
}
