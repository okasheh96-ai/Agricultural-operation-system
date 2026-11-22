// Staged-row validation. Shared by the browser (preview) and the Worker (authoritative, at review and approval).
// A staged row carries raw text; it becomes one fact per measure only when every blocking issue is resolved.
import { parseQuantity } from './num';
import { parseDateText, parseTimeText, shiftTimeToUtcMs, localToUtcMs } from './time';
import type { Fact, ReadingMode } from './types';

export const DIM_FIELDS = ['line', 'product', 'grade', 'lot', 'customer', 'order_ref', 'worker', 'reason', 'doc_no', 'ref_doc_no', 'status', 'direction'] as const;
export type DimField = (typeof DIM_FIELDS)[number];
export const TIME_FIELDS = ['date', 'time', 'start_time', 'end_time'] as const;

export const BUILTIN_UNITS = ['kg', 'box', 'pallet', 'person', 'hour', 'minute'] as const;

export interface Measure { metric: string; value: string; unit: string | null; role: 'actual' | 'plan'; /** dataset of this measure when a row mixes datasets (e.g. a lot report) */ dataset?: string }
export interface RowVals {
  dims: Partial<Record<DimField, string>>;
  date?: string;
  time?: string;
  start_time?: string;
  end_time?: string;
  unit?: string; // row-level unit column
  mode?: ReadingMode;
  measures: Measure[];
  attrs: Record<string, string>;
  /** per-field OCR confidence 0..100, only for photo rows */
  conf?: Record<string, number>;
  /** fields the owner confirmed after an OCR or ambiguity flag */
  confirmed?: string[];
}

export type Severity = 'block' | 'review' | 'warn';
export interface Issue {
  code: string;
  field?: string;
  severity: Severity;
  expected?: string;
  reported?: string;
  difference?: string;
  ref?: string; // other batch/fact id
  source_ref?: string | null;
  detail?: string;
}

export interface ValidationCtx {
  dataset: string;
  shiftDate: string;
  shiftStart: string;
  tz: string;
  defaultTime?: string | null; // "time covered by this report"
  defaultMode: ReadingMode;
  knownUnits: Set<string>;
  knownCodes: Partial<Record<'line' | 'product' | 'grade' | 'customer', Set<string>>>;
  ocrThreshold: number;
}

export type FactDraft = Omit<Fact, 'id' | 'batch_id'> & { natural_key: string };

const REQUIRED: Record<string, { dims: DimField[]; metrics?: string[]; time?: 'at' | 'span' | 'span_or_total' | 'span_or_minutes' }> = {
  production: { dims: ['line', 'product'], metrics: ['qty'], time: 'at' },
  labour: { dims: ['line'], time: 'span_or_total' },
  receiving: { dims: ['lot'], metrics: ['qty'] },
  waste: { dims: ['lot'], metrics: ['qty'] },
  carryover: { dims: ['lot', 'direction'], metrics: ['qty'] },
  downtime: { dims: ['line', 'reason'], time: 'span_or_minutes' },
  order: { dims: ['doc_no'] },
  dispatch: { dims: [], metrics: ['qty'] },
  invoice: { dims: ['doc_no'], metrics: ['value'] },
  credit: { dims: ['doc_no'], metrics: ['value'] },
  plan: { dims: ['line', 'product'] },
};

export function isCustom(dataset: string) { return dataset.startsWith('custom:'); }

export function naturalKey(d: Omit<FactDraft, 'natural_key'>): string {
  if (d.doc_no && ['invoice', 'credit', 'order'].includes(d.dataset)) return [d.dataset, d.doc_no, d.product ?? '', d.metric].join('|');
  return [d.dataset, d.shift_date, d.line, d.product, d.grade, d.lot, d.customer, d.order_ref, d.worker, d.reason, d.direction, d.at_ms, d.start_ms, d.end_ms, d.metric]
    .map((x) => (x === null || x === undefined ? '' : String(x))).join('|');
}

/**
 * Validate one row and, when no blocking issue remains, derive its facts. A row may carry measures for several
 * datasets (a lot report: received -> receiving, packed -> production, waste -> waste); each part is checked
 * against its own dataset's rules and the row publishes all parts or none.
 */
export function validateRow(v: RowVals, ctx: ValidationCtx, sourceRef: string | null = null): { issues: Issue[]; drafts: FactDraft[] } {
  const groups = new Map<string, Measure[]>();
  for (const m of v.measures) {
    const ds = m.dataset || ctx.dataset;
    groups.set(ds, [...(groups.get(ds) ?? []), m]);
  }
  if (groups.size <= 1) {
    const only = [...groups.keys()][0] ?? ctx.dataset;
    if (only === 'mixed') return { issues: [{ code: 'measure_dataset_missing', severity: 'block' }], drafts: [] };
    return validateOne(v, { ...ctx, dataset: only }, sourceRef);
  }
  const issues: Issue[] = [];
  const drafts: FactDraft[] = [];
  const seen = new Set<string>();
  for (const [ds, ms] of groups) {
    if (ds === 'mixed') { issues.push({ code: 'measure_dataset_missing', severity: 'block' }); continue; }
    const r = validateOne({ ...v, measures: ms }, { ...ctx, dataset: ds }, sourceRef);
    for (const i of r.issues) { const k = `${i.code}|${i.field}`; if (!seen.has(k)) { seen.add(k); issues.push(i); } }
    drafts.push(...r.drafts);
  }
  return { issues, drafts: issues.some((i) => i.severity === 'block') ? [] : drafts };
}

function validateOne(v: RowVals, ctx: ValidationCtx, sourceRef: string | null): { issues: Issue[]; drafts: FactDraft[] } {
  const issues: Issue[] = [];
  const confirmed = new Set(v.confirmed ?? []);
  const ds = ctx.dataset;
  const req = REQUIRED[ds] ?? { dims: [] };
  const dims: Partial<Record<DimField, string | null>> = {};
  for (const f of DIM_FIELDS) {
    const val = (v.dims[f] ?? '').trim();
    dims[f] = val === '' ? null : val;
  }
  for (const f of req.dims) if (!dims[f]) issues.push({ code: 'missing_field', field: f, severity: 'block', source_ref: sourceRef });
  if (ds === 'carryover' && dims.direction && !['in', 'out'].includes(dims.direction)) issues.push({ code: 'bad_direction', field: 'direction', severity: 'block', reported: dims.direction });
  if (ds === 'order' && dims.status && !['confirmed', 'cancelled'].includes(dims.status)) issues.push({ code: 'bad_status', field: 'status', severity: 'block', reported: dims.status });
  for (const k of ['line', 'product', 'grade', 'customer'] as const) {
    const set = ctx.knownCodes[k];
    if (dims[k] && set && set.size && !set.has(dims[k]!)) issues.push({ code: 'unknown_code', field: k, severity: 'warn', reported: dims[k]! });
  }
  // OCR confidence
  for (const [field, c] of Object.entries(v.conf ?? {})) {
    if (c < ctx.ocrThreshold && !confirmed.has(field)) issues.push({ code: 'uncertain_ocr', field, severity: 'block', detail: String(Math.round(c)) });
  }
  // date & times
  let shiftDate = ctx.shiftDate;
  if (v.date && v.date.trim()) {
    const pd = parseDateText(v.date);
    if (!pd.date) issues.push({ code: 'unreadable_date', field: 'date', severity: 'block', reported: v.date });
    else {
      if (pd.issue === 'ambiguous_date' && !confirmed.has('date')) issues.push({ code: 'ambiguous_date', field: 'date', severity: 'block', reported: v.date, expected: pd.date });
      shiftDate = pd.date;
    }
  }
  const toMs = (field: 'time' | 'start_time' | 'end_time', raw?: string): number | null => {
    if (!raw || !raw.trim()) return null;
    const pd = parseDateText(raw);
    if (pd.date && pd.time && /\d{4}|\d{1,2}[/.-]\d{1,2}[/.-]\d{2}/.test(raw)) return localToUtcMs(pd.date, pd.time, ctx.tz);
    const t = parseTimeText(raw);
    if (!t) { issues.push({ code: 'unreadable_time', field, severity: 'block', reported: raw }); return null; }
    return shiftTimeToUtcMs(shiftDate, t, ctx.shiftStart, ctx.tz);
  };
  let at = toMs('time', v.time);
  if (at === null && ctx.defaultTime && req.time === 'at') at = toMs('time', ctx.defaultTime);
  const start = toMs('start_time', v.start_time);
  let end = toMs('end_time', v.end_time);
  if (start !== null && end !== null && end <= start) end += 86400000; // crosses midnight
  if (req.time === 'at' && at === null && !issues.some((i) => i.field === 'time')) issues.push({ code: 'missing_field', field: 'time', severity: 'block' });
  // measures
  const actuals = v.measures.filter((m) => m.role === 'actual');
  const drafts: FactDraft[] = [];
  const mode: ReadingMode = v.mode ?? (['production'].includes(ds) ? ctx.defaultMode : 'event');
  let parsedAny = false;
  for (const m of actuals) {
    const field = measureKey(m);
    if (!m.value || !m.value.trim()) {
      // blank stays blank: never invent a quantity
      if (v.conf && v.conf[field] !== undefined) issues.push({ code: 'unreadable_value', field, severity: 'block' });
      continue;
    }
    const p = parseQuantity(m.value);
    if (p.milli === null) { issues.push({ code: 'unreadable_number', field, severity: 'block', reported: m.value, source_ref: sourceRef }); continue; }
    if (p.issue === 'ambiguous_separator' && !confirmed.has(field)) issues.push({ code: 'ambiguous_number', field, severity: 'block', reported: m.value, expected: String(p.normalized) });
    if (p.issue === 'too_many_decimals') issues.push({ code: 'rounded', field, severity: 'warn', reported: m.value, expected: String(p.normalized) });
    const unit = (m.unit || v.unit || '').trim();
    if (!unit) { issues.push({ code: 'missing_unit', field, severity: 'block' }); continue; }
    if (!ctx.knownUnits.has(unit)) { issues.push({ code: 'unknown_unit', field, severity: 'block', reported: unit }); continue; }
    if (p.milli < 0 && !isCustom(ds)) issues.push({ code: 'negative', field, severity: 'block', reported: m.value });
    parsedAny = true;
    const d: Omit<FactDraft, 'natural_key'> = {
      dataset: ds, shift_date: shiftDate, at_ms: at, start_ms: start, end_ms: end,
      line: dims.line ?? null, product: dims.product ?? null, grade: dims.grade ?? null, lot: dims.lot ?? null,
      customer: dims.customer ?? null, order_ref: dims.order_ref ?? null, worker: dims.worker ?? null, reason: dims.reason ?? null,
      doc_no: dims.doc_no ?? null, ref_doc_no: dims.ref_doc_no ?? null,
      status: ds === 'order' ? dims.status ?? 'confirmed' : dims.status ?? null, direction: dims.direction ?? null,
      mode, metric: m.metric, qty: p.milli, unit, source_ref: sourceRef,
      attrs: Object.keys(v.attrs).length ? v.attrs : null,
    };
    drafts.push({ ...d, natural_key: naturalKey(d) });
  }
  if (req.metrics) {
    for (const met of req.metrics) {
      const fk = measureKey({ metric: met, dataset: actuals.some((m) => m.dataset) ? ds : undefined });
      if (!actuals.some((m) => m.metric === met) || !drafts.some((d) => d.metric === met)) {
        if (!issues.some((i) => i.field === fk)) issues.push({ code: 'missing_field', field: fk, severity: 'block' });
      }
    }
  }
  if (req.time === 'span_or_total' && !(start !== null && end !== null) && !drafts.some((d) => d.metric === 'worker_hours')) {
    issues.push({ code: 'missing_field', field: 'start_time', severity: 'block', detail: 'labour needs start+end with crew/worker, or worker_hours' });
  }
  if (req.time === 'span_or_total' && start !== null && end !== null && !dims.worker && !drafts.some((d) => d.metric === 'crew' || d.metric === 'worker_hours')) {
    issues.push({ code: 'missing_field', field: 'm:crew', severity: 'block' });
  }
  if (ds === 'labour' && dims.worker && start !== null && end !== null && !drafts.length) {
    const d: Omit<FactDraft, 'natural_key'> = { dataset: ds, shift_date: shiftDate, at_ms: at, start_ms: start, end_ms: end, line: dims.line ?? null, product: dims.product ?? null, grade: dims.grade ?? null, lot: null, customer: null, order_ref: null, worker: dims.worker, reason: null, doc_no: null, ref_doc_no: null, status: null, direction: null, mode: 'event', metric: 'presence', qty: 1000, unit: 'person', source_ref: sourceRef, attrs: null };
    drafts.push({ ...d, natural_key: naturalKey(d) });
    parsedAny = true;
  }
  if (req.time === 'span_or_minutes' && !(start !== null && end !== null) && !drafts.some((d) => d.metric === 'minutes')) {
    issues.push({ code: 'missing_field', field: 'm:minutes', severity: 'block' });
  }
  if (ds === 'downtime' && start !== null && end !== null && !drafts.length) {
    const mins = Math.round((end - start) / 60) ; // milli-minutes
    const d: Omit<FactDraft, 'natural_key'> = { dataset: ds, shift_date: shiftDate, at_ms: at, start_ms: start, end_ms: end, line: dims.line ?? null, product: null, grade: null, lot: null, customer: null, order_ref: null, worker: null, reason: dims.reason ?? null, doc_no: null, ref_doc_no: null, status: null, direction: null, mode: 'event', metric: 'minutes', qty: mins, unit: 'minute', source_ref: sourceRef, attrs: null };
    drafts.push({ ...d, natural_key: naturalKey(d) });
    parsedAny = true;
  }
  if (ds === 'order' && !drafts.some((d) => d.metric === 'qty' || d.metric === 'value')) issues.push({ code: 'missing_field', field: 'm:qty', severity: 'block' });
  if (ds === 'dispatch' && !dims.customer && !dims.order_ref) issues.push({ code: 'missing_field', field: 'customer', severity: 'block' });
  if (!parsedAny && !actuals.length && ds !== 'plan' && !issues.length) issues.push({ code: 'no_measure', severity: 'block' });
  if (ds === 'plan') return { issues, drafts: [] };
  return { issues, drafts: issues.some((i) => i.severity === 'block') ? [] : drafts };
}

/** Stable field key of a measure, qualified by dataset when the row mixes datasets. */
export function measureKey(m: { metric: string; dataset?: string }): string {
  return m.dataset ? `m:${m.dataset}.${m.metric}` : `m:${m.metric}`;
}

export function blocking(issues: Issue[]) { return issues.filter((i) => i.severity === 'block'); }
