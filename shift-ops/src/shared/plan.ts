import type { PlanData, PlanJob, SalesTarget } from './types';
import { addDays } from './time';

export interface PlanIssue { where: string; code: string; severity: 'block' | 'warn' }

const isIso = (s: unknown) => typeof s === 'string' && !Number.isNaN(Date.parse(s));
const isInt = (n: unknown) => typeof n === 'number' && Number.isSafeInteger(n);

export function emptyPlan(shiftStart = '06:00'): PlanData {
  return { shift_start: shiftStart, jobs: [], sales: [] };
}

/** Structural checks the server enforces before saving a draft, and publish-time completeness checks. */
export function validatePlan(p: unknown, forPublish: boolean, knownUnits?: Set<string>): PlanIssue[] {
  const out: PlanIssue[] = [];
  if (!p || typeof p !== 'object') return [{ where: 'plan', code: 'not_an_object', severity: 'block' }];
  const d = p as PlanData;
  if (typeof d.shift_start !== 'string' || !/^\d{2}:\d{2}$/.test(d.shift_start)) out.push({ where: 'plan', code: 'bad_shift_start', severity: 'block' });
  if (!Array.isArray(d.jobs) || !Array.isArray(d.sales)) return [...out, { where: 'plan', code: 'bad_shape', severity: 'block' }];
  if (forPublish && !d.jobs.length && !d.sales.length) out.push({ where: 'plan', code: 'empty_plan', severity: 'block' });
  const ids = new Set<string>();
  d.jobs.forEach((j: PlanJob, i) => {
    const w = `job ${i + 1}`;
    if (!j.id || ids.has(j.id)) out.push({ where: w, code: 'bad_id', severity: 'block' });
    ids.add(j.id);
    if (!isIso(j.start) || !isIso(j.end)) out.push({ where: w, code: 'bad_time', severity: 'block' });
    else if (Date.parse(j.end) <= Date.parse(j.start)) out.push({ where: w, code: 'end_before_start', severity: 'block' });
    if (!isInt(j.target) || j.target < 0) out.push({ where: w, code: 'bad_target', severity: 'block' });
    if (!isInt(j.crew) || j.crew < 0) out.push({ where: w, code: 'bad_crew', severity: 'block' });
    for (const b of j.breaks ?? []) if (!isIso(b.start) || !isIso(b.end) || Date.parse(b.end) <= Date.parse(b.start)) out.push({ where: w, code: 'bad_break', severity: 'block' });
    for (const c of j.crew_changes ?? []) if (!isIso(c.at) || !isInt(c.crew) || c.crew < 0) out.push({ where: w, code: 'bad_crew_change', severity: 'block' });
    for (const m of j.milestones ?? []) if (!isIso(m.at) || !isInt(m.cumulative)) out.push({ where: w, code: 'bad_milestone', severity: 'block' });
    if (j.rate_target !== undefined && j.rate_target !== null && (!isInt(j.rate_target) || j.rate_target <= 0)) out.push({ where: w, code: 'bad_rate', severity: 'block' });
    if (forPublish) {
      if (!j.line) out.push({ where: w, code: 'missing_line', severity: 'block' });
      if (!j.product) out.push({ where: w, code: 'missing_product', severity: 'block' });
      if (!j.unit || (knownUnits && !knownUnits.has(j.unit))) out.push({ where: w, code: 'bad_unit', severity: 'block' });
      if (!j.target) out.push({ where: w, code: 'missing_target', severity: 'block' });
      if (!j.crew) out.push({ where: w, code: 'no_crew', severity: 'warn' });
    }
  });
  d.sales.forEach((s: SalesTarget, i) => {
    const w = `sales ${i + 1}`;
    if (!s.id || ids.has(s.id)) out.push({ where: w, code: 'bad_id', severity: 'block' });
    ids.add(s.id);
    if (!['day', 'week', 'month'].includes(s.period)) out.push({ where: w, code: 'bad_period', severity: 'block' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s.period_start ?? '')) out.push({ where: w, code: 'bad_period_start', severity: 'block' });
    if (!['orders', 'dispatch', 'invoiced'].includes(s.basis)) out.push({ where: w, code: 'bad_basis', severity: 'block' });
    if (!['qty', 'value'].includes(s.measure)) out.push({ where: w, code: 'bad_measure', severity: 'block' });
    if (s.basis === 'invoiced' && s.measure !== 'value') out.push({ where: w, code: 'invoiced_is_value', severity: 'block' });
    if (!isInt(s.target) || s.target < 0) out.push({ where: w, code: 'bad_target', severity: 'block' });
    for (const m of s.milestones ?? []) if (!isIso(m.at) || !isInt(m.cumulative)) out.push({ where: w, code: 'bad_milestone', severity: 'block' });
    if (forPublish && (!s.unit || (knownUnits && !knownUnits.has(s.unit)))) out.push({ where: w, code: 'bad_unit', severity: 'block' });
    if (forPublish && !s.target) out.push({ where: w, code: 'missing_target', severity: 'block' });
  });
  return out;
}

/** Copy a plan to another shift date, moving every instant by whole days. */
export function shiftPlan(p: PlanData, fromDate: string, toDate: string, newId: () => string): PlanData {
  const days = Math.round((Date.parse(toDate) - Date.parse(fromDate)) / 86400000);
  const mv = (s: string) => new Date(Date.parse(s) + days * 86400000).toISOString();
  return {
    shift_start: p.shift_start,
    jobs: p.jobs.map((j) => ({
      ...j, id: newId(), start: mv(j.start), end: mv(j.end),
      breaks: j.breaks?.map((b) => ({ ...b, start: mv(b.start), end: mv(b.end) })),
      crew_changes: j.crew_changes?.map((c) => ({ ...c, at: mv(c.at) })),
      milestones: j.milestones?.map((m) => ({ ...m, at: mv(m.at) })),
    })),
    sales: p.sales.map((s) => ({ ...s, id: newId(), period_start: s.period === 'day' ? addDays(s.period_start, days) : s.period_start, milestones: s.milestones?.map((m) => ({ ...m, at: mv(m.at) })) })),
  };
}
