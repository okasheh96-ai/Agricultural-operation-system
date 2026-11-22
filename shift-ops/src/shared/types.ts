// Shared data shapes for the Worker and the browser app.

/** Built-in datasets with known meaning. Anything else is a custom dataset ("custom:<key>"). */
export const BUILTIN_DATASETS = [
  'production', 'labour', 'receiving', 'waste', 'carryover', 'downtime',
  'order', 'dispatch', 'invoice', 'credit',
] as const;
export type BuiltinDataset = (typeof BUILTIN_DATASETS)[number];

export type ReadingMode = 'interval' | 'cumulative' | 'event';

/** One approved, current measurement. qty is in thousandths of `unit`. */
export interface Fact {
  id: string;
  batch_id: string;
  row_id?: string | null;
  dataset: string;
  shift_date: string;
  at_ms: number | null;
  start_ms: number | null;
  end_ms: number | null;
  line: string | null;
  product: string | null;
  grade: string | null;
  lot: string | null;
  customer: string | null;
  order_ref: string | null;
  worker: string | null;
  reason: string | null;
  doc_no: string | null;
  ref_doc_no: string | null;
  status: string | null;
  direction: string | null;
  mode: ReadingMode;
  metric: string;
  qty: number;
  unit: string;
  source_ref?: string | null;
  attrs?: Record<string, string> | null;
}

export interface Conversion {
  product: string | null;
  grade: string | null;
  from_unit: string;
  to_unit: string;
  /** thousandths of to_unit per one from_unit (5 kg per box -> 5000) */
  factor: number;
  note?: string | null;
}

export interface PlanBreak { start: string; end: string; kind: 'break' | 'changeover' }
export interface CrewChange { at: string; crew: number }
export interface Milestone { at: string; cumulative: number }

export interface PlanJob {
  id: string;
  line: string;
  product: string;
  grade?: string | null;
  customer?: string | null;
  order_ref?: string | null;
  start: string; // ISO UTC
  end: string; // ISO UTC
  target: number; // milli of unit
  unit: string; // kg | box | pallet
  crew: number; // people at start
  crew_changes?: CrewChange[];
  breaks?: PlanBreak[];
  /** optional owner-set target, thousandths of kg per worker-hour */
  rate_target?: number | null;
  milestones?: Milestone[];
}

export interface SalesTarget {
  id: string;
  period: 'day' | 'week' | 'month';
  period_start: string; // local date
  customer?: string | null;
  product?: string | null;
  order_ref?: string | null;
  basis: 'orders' | 'dispatch' | 'invoiced';
  measure: 'qty' | 'value';
  unit: string; // kg/box/pallet for qty, currency code for value
  target: number; // milli
  price?: number | null; // milli currency per unit (informational)
  due_date?: string | null;
  milestones?: Milestone[];
}

export interface PlanData {
  shift_start: string; // local HH:MM
  jobs: PlanJob[];
  sales: SalesTarget[];
}

export type LineStatus = 'scheduled' | 'awaiting' | 'on_track' | 'ahead' | 'behind' | 'complete' | 'no_schedule' | 'unavailable';

export type Role = 'owner' | 'viewer';
export interface Me { email: string; role: Role; show_workers: boolean }
