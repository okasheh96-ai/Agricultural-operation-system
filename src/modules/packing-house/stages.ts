/**
 * Workflow bar of the packing house, in the order of the TO-BE process (PH-OAS-SPEC-001 §5.3, ST-00 … ST-17). Which
 * stage a record is in is decided by the database (app.ph_ip_stage) so tab counts always equal the rows shown; this list
 * only names and orders the tabs and says which are built. Unbuilt stages stay visible and labelled, without counts.
 */
export type StageKey =
  | 'orders' | 'arrivals' | 'arrival_check' | 'precooling' | 'qa_acceptance' | 'storage' | 'qc1_released'
  | 'production' | 'qc2' | 'fg_pallets' | 'waste' | 'fg_storage' | 'dispatch' | 'exceptions' | 'closed';

export interface StageDef {
  key: StageKey;
  spec: string;
  /** Gate checked at this stage (§8.2), if any. */
  gate?: string;
  /** Who acts here (role queue), as documented. */
  owner: string;
  built: boolean;
  milestone?: string;
  kind: 'arrivals' | 'pallets' | 'jobcards' | 'fg' | 'waste' | 'later';
}

export const STAGES: StageDef[] = [
  { key: 'orders', spec: 'ST-00', owner: 'SAL · PHM', built: false, milestone: 'M2', kind: 'later' },
  { key: 'arrivals', spec: 'ST-01 · ST-02', gate: 'G1', owner: 'DEC', built: true, kind: 'arrivals' },
  { key: 'arrival_check', spec: 'ST-03', gate: 'G2', owner: 'QCI · QAO', built: true, kind: 'pallets' },
  { key: 'precooling', spec: 'ST-04', owner: 'PHO · DEC', built: true, kind: 'pallets' },
  { key: 'qa_acceptance', spec: 'ST-05', gate: 'G3', owner: 'QAO · ENG · DEC', built: true, kind: 'pallets' },
  { key: 'storage', spec: 'ST-06', owner: 'PHO', built: true, kind: 'pallets' },
  { key: 'qc1_released', spec: 'ST-07', gate: 'G4', owner: 'QCI', built: true, kind: 'pallets' },
  { key: 'production', spec: 'ST-08', gate: 'G5', owner: 'PE · PHM · LL · STK · QCI', built: true, kind: 'jobcards' },
  { key: 'qc2', spec: 'ST-09', gate: 'G6', owner: 'QCI', built: true, kind: 'jobcards' },
  { key: 'fg_pallets', spec: 'ST-10', owner: 'PHO · QCI', built: true, kind: 'fg' },
  { key: 'waste', spec: 'ST-11', gate: 'G7', owner: 'PHO · QCI · PHM', built: true, milestone: 'M2', kind: 'waste' },
  { key: 'fg_storage', spec: 'ST-12', owner: 'PHO', built: true, kind: 'fg' },
  { key: 'dispatch', spec: 'ST-13 · ST-14', gate: 'G8', owner: 'PHM · QCI · QAO', built: false, milestone: 'M3', kind: 'later' },
  { key: 'exceptions', spec: 'X-01 · E-03', gate: 'G9', owner: 'QCI · QAO · QCM · QAM', built: true, kind: 'pallets' },
  { key: 'closed', spec: '—', owner: '—', built: true, kind: 'pallets' },
];

/** Incoming-pallet path drawn in the record view (stage stepper). Later stages are shown greyed. */
export const PALLET_PATH: { key: string; spec: string; statuses: string[]; milestone?: string }[] = [
  { key: 'registered', spec: 'ST-02', statuses: ['registered'] },
  { key: 'arrival_check', spec: 'ST-03', statuses: ['arrival_rejected', 'returned_to_source'] },
  { key: 'precooling', spec: 'ST-04', statuses: ['pre_cooling'] },
  { key: 'qa_acceptance', spec: 'ST-05', statuses: ['awaiting_qa', 'qa_rejected', 'in_regrade', 'awaiting_recheck'] },
  { key: 'storage', spec: 'ST-06', statuses: ['accepted', 'stored'] },
  { key: 'qc1_released', spec: 'ST-07', statuses: ['released'] },
  { key: 'production', spec: 'ST-08', statuses: ['issued', 'consumed'] },
];

/** Index of the furthest path step a pallet has reached (for the stepper), from its status and recorded facts. */
export function pathIndex(p: { status: string; arrival_check_result: string | null; precool_in_at: string | null }): number {
  const direct = PALLET_PATH.findIndex((s) => s.statuses.includes(p.status));
  if (p.status === 'registered') return p.arrival_check_result ? 1 : 0;
  if (p.status === 'on_hold' || p.status === 'waste' || p.status === 'void') {
    if (p.precool_in_at) return 2;
    return p.arrival_check_result ? 1 : 0;
  }
  return direct;
}

/** Status shown with an icon and a colour family; never colour alone (§4.1). */
export const STATUS_STYLE: Record<string, { icon: string; tone: 'blue' | 'green' | 'amber' | 'red' | 'grey' | 'violet' }> = {
  draft: { icon: '✎', tone: 'grey' },
  vehicle_hold: { icon: '⏸', tone: 'red' },
  submitted: { icon: '➜', tone: 'blue' },
  not_accepted: { icon: '✕', tone: 'red' },
  closed: { icon: '■', tone: 'grey' },
  registered: { icon: '⚖', tone: 'blue' },
  arrival_rejected: { icon: '✕', tone: 'red' },
  returned_to_source: { icon: '↩', tone: 'grey' },
  pre_cooling: { icon: '❄', tone: 'blue' },
  awaiting_qa: { icon: '⌛', tone: 'amber' },
  qa_rejected: { icon: '✕', tone: 'red' },
  in_regrade: { icon: '⟳', tone: 'amber' },
  awaiting_recheck: { icon: '⌛', tone: 'amber' },
  accepted: { icon: '✓', tone: 'green' },
  stored: { icon: '▣', tone: 'green' },
  released: { icon: '✔', tone: 'green' },
  issued: { icon: '▶', tone: 'blue' },
  consumed: { icon: '■', tone: 'grey' },
  on_hold: { icon: '⏸', tone: 'red' },
  waste: { icon: '🗑', tone: 'grey' },
  void: { icon: '⊘', tone: 'grey' },
  open: { icon: '!', tone: 'red' },
  under_assessment: { icon: '⌛', tone: 'amber' },
  disposition_decided: { icon: '➜', tone: 'blue' },
  disposition_executed: { icon: '✓', tone: 'blue' },
  verified: { icon: '✔', tone: 'green' },
  cancelled: { icon: '✕', tone: 'grey' },
  planned: { icon: '📋', tone: 'blue' },
  ready: { icon: '✓', tone: 'blue' },
  line_check_failed: { icon: '✕', tone: 'red' },
  in_progress: { icon: '▶', tone: 'green' },
  paused: { icon: '⏸', tone: 'amber' },
  completed: { icon: '■', tone: 'green' },
  reconciled: { icon: '⚖', tone: 'green' },
  created: { icon: '▦', tone: 'blue' },
  qc_approved: { icon: '✔', tone: 'green' },
  in_storage: { icon: '▣', tone: 'green' },
};

/** Job Card path (SM-JC) for the record view; reconciliation and closing come with M2.2. */
export const JOB_CARD_PATH: { key: string; statuses: string[]; milestone?: string }[] = [
  { key: 'draft', statuses: ['draft'] },
  { key: 'planned', statuses: ['planned'] },
  { key: 'ready', statuses: ['ready', 'line_check_failed'] },
  { key: 'in_progress', statuses: ['in_progress', 'paused'] },
  { key: 'completed', statuses: ['completed'] },
  { key: 'reconciled', statuses: ['reconciled', 'closed'], milestone: 'M2.2' },
];

/** Finished-goods pallet path (SM-FGP) up to storage; allocation, loading and dispatch come with M3. */
export const FG_PATH: { key: string; statuses: string[]; milestone?: string }[] = [
  { key: 'created', statuses: ['created'] },
  { key: 'qc_approved', statuses: ['qc_approved'] },
  { key: 'in_storage', statuses: ['in_storage'] },
  { key: 'dispatch', statuses: ['allocated', 'picked', 'loaded', 'dispatched'], milestone: 'M3' },
];

export const TONE_CLASS: Record<string, string> = {
  blue: 'bg-sky-50 text-sky-900 border-sky-300',
  green: 'bg-green-50 text-green-900 border-green-300',
  amber: 'bg-amber-50 text-amber-900 border-amber-300',
  red: 'bg-red-50 text-red-900 border-red-300',
  grey: 'bg-stone-100 text-stone-700 border-stone-300',
  violet: 'bg-violet-50 text-violet-900 border-violet-300',
};

export const ACCENT_CLASS: Record<string, string> = {
  blue: 'border-s-sky-500',
  green: 'border-s-green-600',
  amber: 'border-s-amber-500',
  red: 'border-s-red-600',
  grey: 'border-s-stone-400',
  violet: 'border-s-violet-500',
};

export function minutesBetween(fromIso: string | null, toIso?: string | null): number | null {
  if (!fromIso) return null;
  const end = toIso ? Date.parse(toIso) : Date.now();
  return Math.max(0, Math.round((end - Date.parse(fromIso)) / 60000));
}

/** 1:05 h / 42 min / 2 d 4 h — durations for strips and tabs. */
export function formatDuration(minutes: number | null): string {
  if (minutes === null) return '—';
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  if (h < 48) return `${h}:${String(minutes % 60).padStart(2, '0')} h`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}
