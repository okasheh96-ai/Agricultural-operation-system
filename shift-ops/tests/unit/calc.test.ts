import { describe, expect, it } from 'vitest';
import { convert, dueAt, dueRevised, matchedWorkerHours, plannedWorkerHours, productionReport, reconcileLots, salesReport, workSegments } from '../../src/shared/calc';
import type { Fact, PlanData, PlanJob, SalesTarget } from '../../src/shared/types';
import { localToUtcMs, toIso } from '../../src/shared/time';

const D = '2026-11-22';
const at = (hhmm: string, date = D) => localToUtcMs(date, hhmm, 'Asia/Amman');
const iso = (hhmm: string, date = D) => toIso(at(hhmm, date));
let n = 0;
function fact(p: Partial<Fact>): Fact {
  return {
    id: `f${++n}`, batch_id: 'b1', dataset: 'production', shift_date: D, at_ms: null, start_ms: null, end_ms: null,
    line: 'L1', product: 'TOM', grade: null, lot: null, customer: null, order_ref: null, worker: null, reason: null,
    doc_no: null, ref_doc_no: null, status: null, direction: null, mode: 'interval', metric: 'qty', qty: 0, unit: 'kg', ...p,
  };
}
const job: PlanJob = { id: 'j1', line: 'L1', product: 'TOM', start: iso('06:00'), end: iso('14:00'), target: 8000000, unit: 'kg', crew: 20 };
const plan: PlanData = { shift_start: '06:00', jobs: [job], sales: [] };

describe('spec case 2: production and productivity', () => {
  const facts = [
    fact({ at_ms: at('10:00'), qty: 3600000 }),
    fact({ dataset: 'labour', metric: 'crew', qty: 20000, unit: 'person', start_ms: at('06:00'), end_ms: at('10:00') }),
  ];
  const [r] = productionReport(plan, facts, { now: at('10:20'), convs: [] });
  it('target due, variance and percentages', () => {
    expect(r.asOfMs).toBe(at('10:00'));
    expect(r.due).toBe(4000000);
    expect(r.actual).toBe(3600000);
    expect(r.variance).toBe(-400000);
    expect(r.pctOfTarget).toBeCloseTo(0.45, 10);
    expect(r.pctOfDue).toBeCloseTo(0.9, 10);
    expect(r.remaining).toBe(4400000);
    expect(r.paceNeededPerHour).toBe(1100000);
    expect(r.status).toBe('behind');
  });
  it('productivity', () => {
    expect(r.plannedWH).toBe(160000);
    expect(r.plannedRate).toBe(50000);
    expect(r.actualWH).toBe(80000);
    expect(r.actualRate).toBe(45000);
    expect(r.capacityKg).toBe(8000000);
    expect(r.inconsistentTarget).toBe(false);
  });
  it('flags an inconsistent entered rate', () => {
    const [r2] = productionReport({ ...plan, jobs: [{ ...job, rate_target: 60000 }] }, facts, { now: at('10:20'), convs: [] });
    expect(r2.capacityKg).toBe(9600000);
    expect(r2.inconsistentTarget).toBe(true);
  });
  it('missing update shows awaiting, a recorded zero is a result', () => {
    const [a] = productionReport(plan, [], { now: at('10:20'), convs: [] });
    expect(a.status).toBe('awaiting');
    expect(a.actual).toBeNull();
    const [z] = productionReport(plan, [fact({ at_ms: at('08:00'), qty: 0 })], { now: at('10:20'), convs: [] });
    expect(z.actual).toBe(0);
    expect(z.due).toBe(2000000);
    expect(z.status).toBe('behind');
  });
  it('scheduled before the job starts', () => {
    const [s] = productionReport(plan, [], { now: at('05:00'), convs: [] });
    expect(s.status).toBe('scheduled');
  });
  it('cumulative readings replace, intervals add', () => {
    const fs = [fact({ at_ms: at('08:00'), qty: 1500000, mode: 'cumulative' }), fact({ at_ms: at('10:00'), qty: 3600000, mode: 'cumulative' })];
    const [c] = productionReport(plan, fs, { now: at('10:30'), convs: [] });
    expect(c.actual).toBe(3600000);
    const fi = [fact({ at_ms: at('08:00'), qty: 1500000 }), fact({ at_ms: at('10:00'), qty: 2100000 })];
    const [i] = productionReport(plan, fi, { now: at('10:30'), convs: [] });
    expect(i.actual).toBe(3600000);
  });
});

describe('breaks, crew changes, overnight, revisions', () => {
  it('breaks are not working time', () => {
    const j: PlanJob = { ...job, end: iso('15:00'), breaks: [{ start: iso('10:00'), end: iso('11:00'), kind: 'break' }] };
    expect(workSegments(j)).toHaveLength(2);
    expect(dueAt(j, at('10:30'))).toBe(4000000);
    expect(dueAt(j, at('11:00'))).toBe(4000000);
    expect(dueAt(j, at('15:00'))).toBe(8000000);
    expect(plannedWorkerHours(j)).toBe(160000);
  });
  it('crew change changes planned worker-hours', () => {
    const j: PlanJob = { ...job, crew_changes: [{ at: iso('10:00'), crew: 10 }] };
    expect(plannedWorkerHours(j)).toBe(120000); // 20x4 + 10x4
  });
  it('overnight shift across midnight', () => {
    const j: PlanJob = { ...job, start: iso('20:00'), end: iso('04:00', '2026-11-23') };
    expect(dueAt(j, at('00:00', '2026-11-23'))).toBe(4000000);
  });
  it('revision keeps what was due, spreads the new remainder', () => {
    const rev: PlanJob = { ...job, target: 9000000 };
    const eff = at('10:00');
    expect(dueRevised(job, rev, eff, at('09:00'))).toBe(3000000);
    expect(dueRevised(job, rev, eff, at('10:00'))).toBe(4000000);
    expect(dueRevised(job, rev, eff, at('12:00'))).toBe(6500000);
    expect(dueRevised(job, rev, eff, at('14:00'))).toBe(9000000);
    const [r] = productionReport({ ...plan, jobs: [rev] }, [fact({ at_ms: at('12:00'), qty: 6000000 })], { now: at('12:05'), convs: [], baseline: plan, revisionEffectiveMs: eff });
    expect(r.due).toBe(6500000);
    expect(r.variance).toBe(-500000);
  });
});

describe('worker-hours are counted once', () => {
  it('crew transfers between lines', () => {
    const lab = [
      fact({ dataset: 'labour', worker: 'w1', line: 'L1', start_ms: at('06:00'), end_ms: at('10:00'), metric: 'presence', qty: 1000 }),
      fact({ dataset: 'labour', worker: 'w1', line: 'L2', start_ms: at('10:00'), end_ms: at('14:00'), metric: 'presence', qty: 1000 }),
    ];
    expect(matchedWorkerHours(lab, {}).hours).toBe(8000);
    expect(matchedWorkerHours(lab, { line: 'L1' }).hours).toBe(4000);
  });
  it('the same worker on two grades at once counts once', () => {
    const lab = [
      fact({ dataset: 'labour', worker: 'w1', grade: 'A', start_ms: at('06:00'), end_ms: at('10:00'), metric: 'presence', qty: 1000 }),
      fact({ dataset: 'labour', worker: 'w1', grade: 'B', start_ms: at('06:00'), end_ms: at('10:00'), metric: 'presence', qty: 1000 }),
    ];
    const r = matchedWorkerHours(lab, {});
    expect(r.hours).toBe(4000);
    expect(r.overlaps).toBe(1);
  });
  it('a crew row repeated per grade counts once', () => {
    const lab = [
      fact({ dataset: 'labour', grade: 'A', metric: 'crew', qty: 20000, start_ms: at('06:00'), end_ms: at('10:00') }),
      fact({ dataset: 'labour', grade: 'B', metric: 'crew', qty: 20000, start_ms: at('06:00'), end_ms: at('10:00') }),
    ];
    expect(matchedWorkerHours(lab, {}).hours).toBe(80000);
  });
});

describe('spec case 1: lot reconciliation', () => {
  const base = [
    fact({ dataset: 'receiving', lot: 'LOT-1', qty: 4100000 }),
    fact({ dataset: 'production', lot: 'LOT-1', qty: 4000000 }),
  ];
  it('flags the 60 kg gap, then clears after correcting waste to 100 kg', () => {
    const r1 = reconcileLots([...base, fact({ dataset: 'waste', lot: 'LOT-1', qty: 40000 })], { convs: [], closedLots: new Set(['LOT-1']), tolAbsKg: 0, tolPct: 0 });
    expect(r1[0].gap).toBe(60000);
    expect(r1[0].flagged).toBe(true);
    const r2 = reconcileLots([...base, fact({ dataset: 'waste', lot: 'LOT-1', qty: 100000 })], { convs: [], closedLots: new Set(['LOT-1']), tolAbsKg: 0, tolPct: 0 });
    expect(r2[0].gap).toBe(0);
    expect(r2[0].flagged).toBe(false);
    expect(r2[0].wastePct).toBeCloseTo(100 / 4100, 10);
  });
  it('carryover is part of the balance; open lots are not judged', () => {
    const r = reconcileLots([...base, fact({ dataset: 'waste', lot: 'LOT-1', qty: 40000 }), fact({ dataset: 'carryover', lot: 'LOT-1', direction: 'out', qty: 60000 })], { convs: [], closedLots: new Set(['LOT-1']), tolAbsKg: 0, tolPct: 0 });
    expect(r[0].gap).toBe(0);
    const open = reconcileLots([...base], { convs: [], closedLots: new Set(), tolAbsKg: 0, tolPct: 0 });
    expect(open[0].flagged).toBe(false);
  });
  it('no input means waste % is unavailable', () => {
    const r = reconcileLots([fact({ dataset: 'waste', lot: 'X', qty: 1000 })], { convs: [], closedLots: new Set(), tolAbsKg: 0, tolPct: 0 });
    expect(r[0].wastePct).toBeNull();
  });
});

describe('spec case 3: sales', () => {
  it('dispatch milestones: 10 planned, 4 due, 3 shipped', () => {
    const t: SalesTarget = { id: 's1', period: 'day', period_start: D, basis: 'dispatch', measure: 'qty', unit: 'pallet', target: 10000,
      milestones: [{ at: iso('10:00'), cumulative: 4000 }, { at: iso('16:00'), cumulative: 10000 }] };
    const fs = [1, 2, 3].map(() => fact({ dataset: 'dispatch', qty: 1000, unit: 'pallet', at_ms: at('09:00') }));
    const [r] = salesReport([t], fs, { now: at('11:00'), convs: [] });
    expect(r.due).toBe(4000);
    expect(r.actual).toBe(3000);
    expect(r.variance).toBe(-1000);
    expect(r.remaining).toBe(7000);
    expect(r.status).toBe('behind');
  });
  it('invoiced sales = invoices less credits, currencies separate', () => {
    const t: SalesTarget = { id: 's2', period: 'day', period_start: D, basis: 'invoiced', measure: 'value', unit: 'JOD', target: 2000000,
      milestones: [{ at: iso('12:00'), cumulative: 800000 }] };
    const fs = [
      fact({ dataset: 'invoice', doc_no: 'INV-1', metric: 'value', qty: 650000, unit: 'JOD' }),
      fact({ dataset: 'credit', doc_no: 'CR-1', ref_doc_no: 'INV-1', metric: 'value', qty: 50000, unit: 'JOD' }),
      fact({ dataset: 'invoice', doc_no: 'INV-9', metric: 'value', qty: 999000, unit: 'USD' }),
    ];
    const [r] = salesReport([t], fs, { now: at('13:00'), convs: [] });
    expect(r.actual).toBe(600000);
    expect(r.due).toBe(800000);
    expect(r.variance).toBe(-200000);
    expect(r.breakdown).toMatchObject({ gross: 650000, credits: 50000 });
  });
  it('without milestones there is no lateness verdict', () => {
    const t: SalesTarget = { id: 's3', period: 'month', period_start: '2026-11-01', basis: 'invoiced', measure: 'value', unit: 'JOD', target: 2000000 };
    const [r] = salesReport([t], [fact({ dataset: 'invoice', doc_no: 'I', metric: 'value', qty: 650000, unit: 'JOD' })], { now: at('13:00'), convs: [] });
    expect(r.status).toBe('no_schedule');
    expect(r.variance).toBeNull();
    expect(r.pctOfTarget).toBeCloseTo(0.325, 10);
  });
  it('cancelled orders count zero; latest order record wins', () => {
    const t: SalesTarget = { id: 's4', period: 'day', period_start: D, basis: 'orders', measure: 'qty', unit: 'kg', target: 5000000 };
    const fs = [
      fact({ dataset: 'order', doc_no: 'O1', qty: 1000000, at_ms: at('08:00'), status: 'confirmed' }),
      fact({ dataset: 'order', doc_no: 'O1', qty: 1000000, at_ms: at('09:00'), status: 'cancelled' }),
      fact({ dataset: 'order', doc_no: 'O2', qty: 2000000, at_ms: at('08:00'), status: 'confirmed' }),
    ];
    expect(salesReport([t], fs, { now: at('10:00'), convs: [] })[0].actual).toBe(2000000);
  });
});

describe('conversions are documented only', () => {
  const convs = [{ product: 'TOM', grade: null, from_unit: 'box', to_unit: 'kg', factor: 5000 }, { product: 'TOM', grade: null, from_unit: 'pallet', to_unit: 'box', factor: 120000 }];
  it('direct, inverse and via kg', () => {
    expect(convert(10000, 'box', 'kg', convs, 'TOM')).toBe(50000);
    expect(convert(50000, 'kg', 'box', convs, 'TOM')).toBe(10000);
    expect(convert(1000, 'pallet', 'kg', convs, 'TOM')).toBe(600000);
    expect(convert(1000, 'box', 'kg', convs, 'CUC')).toBeNull();
  });
});
