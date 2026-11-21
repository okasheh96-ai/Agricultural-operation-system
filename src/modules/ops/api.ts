import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { requireSupabase } from '@/core/supabase';
import { phErrorMessage, phReason } from '@/modules/packing-house/phErrors';

const db = () => requireSupabase();

export async function rpc<T = unknown>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await db().rpc(fn, args);
  if (error) throw error;
  return data as T;
}

/** A server error as one sentence in the user's language (packhouse-ops keys first, then the packing-house ones). */
export function opsErrorMessage(t: TFunction, error: unknown): string {
  const reason = phReason(error);
  if (reason && reason.key.startsWith('po.')) {
    const params: Record<string, string> = {};
    for (const [k, v] of Object.entries(reason)) {
      params[k] = Array.isArray(v)
        ? v.map((x) => (typeof x === 'object' && x !== null ? String((x as Record<string, unknown>).label ?? (x as Record<string, unknown>).key ?? '') : String(x))).join('، ')
        : String(v ?? '');
    }
    return t(`ops.reasons.${reason.key.slice(3).replace(/\./g, '_')}`, { ...params, defaultValue: t('errors.unknown') });
  }
  if (typeof error === 'object' && error !== null && 'message' in error && /Failed to fetch|NetworkError|Load failed/i.test(String((error as { message: unknown }).message))) {
    return t('ops.save.network');
  }
  return phErrorMessage(t, error);
}

export interface OverviewLine {
  line_id: string; code: string; name_ar: string; name_en: string | null; line_shift_id: string | null;
  supervisor_name: string | null; submitted_at: string | null; last_activity_at: string | null; readiness_at: string | null;
  status: 'not_open' | 'open' | 'overdue' | 'submitted' | 'submitted_zero';
  packed_kg: string | null; boxes: number | null; stops: number | null; downtime_min: string | null; open_stops: number | null;
}
export interface AtRisk {
  order_line_id: string; code: string; customer: string; crop_code: string; grade: string; required_date: string;
  ordered_kg: string | null; packed_kg: string; remaining_kg: string | null; promised_loading_at: string | null;
  started_at: string | null; projected_end: string | null; reasons: string[];
}
export interface Overview {
  date: string; from: string; to: string; cutoff: string; generated_at: string;
  shift: { id: string; code: string; planned_start: string; planned_end: string; closed_at: string | null; engineer_name: string | null } | null;
  shifts: { id: string; code: string; planned_start: string; planned_end: string; closed_at: string | null }[];
  totals: { packed_kg: string; boxes: number; nonconforming_boxes: number; planned_kg: string | null; planned_orders: number;
            planned_unknown: number; remaining_kg: string | null };
  lines: OverviewLine[];
  by_crop_grade: { crop_code: string; crop_name_ar: string | null; crop_name_en: string | null; grade: string; kg: string | null; boxes: number }[];
  stock: { fg_available_kg: string; fg_held_kg: string; fg_allocated_kg: string; raw_available_kg: string; raw_held_kg: string };
  kpi: {
    productivity: { kg: string | null; hours: string | null; rate: string | null };
    downtime: { stops: number; minutes: string; open: number; site_minutes: string };
    orders: { count: number; completed: number; running: number; variance_min: string | null; over_plan: number; no_baseline: number };
  };
  queue: {
    open_stops: { id: string; code: string; stopped_at: string; fault: string; lines: string[]; minutes: string }[];
    holds: { id: string; code: string; type: string; status: string; reason: string; since: string }[];
    at_risk: AtRisk[];
    issues_open: number;
  };
}

export interface OverviewFilters { date: string; shift?: string; line?: string; crop?: string; grade?: string; customer?: string }

export function useOverview(f: OverviewFilters) {
  return useQuery({
    queryKey: ['ops', 'overview', f],
    queryFn: () => rpc<Overview>('ph_ops_overview', {
      p_date: f.date, p_shift: f.shift || null,
      p_filters: { line_id: f.line || null, crop_code: f.crop || null, grade: f.grade || null, customer_id: f.customer || null },
    }),
    refetchInterval: 60_000,
  });
}

export function useTrend(from: string | undefined, to: string | undefined) {
  return useQuery({
    queryKey: ['ops', 'trend', from, to],
    enabled: !!from && !!to,
    queryFn: () => rpc<{ bucket: string; line_code: string; kg: string | null; boxes: number }[]>('ph_production_trend', { p_from: from, p_to: to }),
  });
}

export interface MyLineShift {
  line_shift_id: string; shift_id: string; shift_code: string; planned_start: string; planned_end: string; line_id: string;
  line_code: string; line_name_ar: string; line_name_en: string | null; supervisor_name: string | null; submitted_at: string | null;
  is_mine: boolean; current_order_id: string | null; current_order_code: string | null;
}
export function useMyLineShifts() {
  return useQuery({ queryKey: ['ops', 'my-line-shifts'], queryFn: () => rpc<MyLineShift[]>('ph_my_line_shifts') });
}

export interface SheetOutput {
  id: string; version: number; worker_code: string | null; worker_name: string | null; team_label: string | null; team_session_id: string | null;
  grade: string; pack_code: string; net_kg_per_box: string; boxes: number; kg: string; conforming: boolean; period_start: string | null;
  period_end: string; created_at: string; order_code: string | null; correction_reason: string | null;
}
export interface Sheet {
  line_shift: { id: string; version: number; submitted_at: string | null; readiness_at: string | null; readiness: Record<string, string> | null;
                line_id: string; line_code: string; can_record: boolean; can_submit: boolean; can_correct: boolean };
  shift: { id: string; code: string; planned_start: string; planned_end: string; closed_at: string | null; engineer_name: string | null };
  open: { id: string; worker_id: string; worker_code: string; worker_name: string; task_code: string; task_ar: string; task_en: string | null;
          started_at: string; team_session_id: string | null }[];
  teams: { id: string; label: string | null; task_code: string; started_at: string; ended_at: string | null; order_line_id: string | null;
           last_period_end: string | null; members: number }[];
  output: SheetOutput[];
  totals: { boxes: number; kg: string; entries: number };
  first_pack_checks: { pack_format_id: string; order_line_id: string | null; measured_kg: string; target_net_kg: string; at: string }[];
  instructions: { id: string; code: string; description: string; at: string; acknowledged_at: string | null }[];
}
export function useSheet(lineShiftId: string | undefined) {
  return useQuery({
    queryKey: ['ops', 'sheet', lineShiftId],
    enabled: !!lineShiftId,
    queryFn: () => rpc<Sheet>('ph_line_shift_sheet', { p_line_shift: lineShiftId }),
  });
}

export interface PackFormat { id: string; code: string; name_ar: string; name_en: string | null; nominal_net_kg: string; kind: string; customer_id: string | null }
export interface TaskKind { id: string; code: string; name_ar: string; name_en: string | null; counts_as_packing: boolean; is_shared: boolean }
export interface Worker { id: string; code: string; full_name: string; full_name_en: string | null }
export interface OrderRow { id: string; code: string; customer_name: string; status: string; grade: string; crop_id: string; required_date: string; quantity: string }
export interface Cause { id: string; code: string; name_ar: string; name_en: string | null }
export interface LineRow { id: string; code: string; name_ar: string; name_en: string | null; sort_order: number }

function useTable<T>(key: string, table: string, select: string, approvedOnly = true, order = 'code') {
  return useQuery({
    queryKey: ['ops', 'lookup', key],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      let q = db().from(table).select(select).is('voided_at', null);
      if (approvedOnly) q = q.eq('verification_status', 'verified');
      const { data, error } = await q.order(order);
      if (error) throw error;
      return (data ?? []) as unknown as T[];
    },
  });
}

export const usePackFormats = () => useTable<PackFormat>('pack-formats', 'ph_pack_formats', 'id, code, name_ar, name_en, nominal_net_kg, kind, customer_id, is_active');
export const useTaskKinds = () => useTable<TaskKind>('task-kinds', 'ph_task_kinds', 'id, code, name_ar, name_en, counts_as_packing, is_shared, sort_order', true, 'sort_order');
export const useWorkers = () => useTable<Worker>('workers', 'workers', 'id, code, full_name, full_name_en', false);
export const useCauses = () => useTable<Cause>('causes', 'ph_downtime_causes', 'id, code, name_ar, name_en');
export const useLines = () => useTable<LineRow>('lines', 'ph_lines', 'id, code, name_ar, name_en, sort_order', false, 'sort_order');
export const useCustomers = () => useTable<{ id: string; code: string; name_en: string; name_ar: string | null }>('customers', 'ph_customers', 'id, code, name_en, name_ar');
export function useOpenOrders() {
  return useQuery({
    queryKey: ['ops', 'open-orders'],
    queryFn: async () => {
      const { data, error } = await db().from('ph_order_lines').select('id, code, customer_name, status, grade, crop_id, required_date, quantity')
        .is('voided_at', null).eq('status', 'accepted').order('required_date');
      if (error) throw error;
      return (data ?? []) as OrderRow[];
    },
  });
}

export interface DowntimeRow {
  id: string; code: string; stopped_at: string; restarted_at: string | null; is_open: boolean; observed_fault: string; cause_code: string | null;
  cause_name_ar: string | null; cause_name_en: string | null; cause_note: string | null; equipment: string | null; line_codes: string[];
  line_ids: string[]; minutes_to_now: string; work_order_ref: string | null; technical_release_at: string | null; response_at: string | null;
}
export function useDowntimeLog(from: string, to: string, openOnly: boolean) {
  return useQuery({
    queryKey: ['ops', 'downtime', from, to, openOnly],
    queryFn: async () => {
      let q = db().from('ph_downtime_log').select('*').lt('stopped_at', to).order('stopped_at', { ascending: false });
      if (openOnly) q = q.eq('is_open', true);
      else q = q.or(`restarted_at.is.null,restarted_at.gte.${from}`);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as DowntimeRow[];
    },
    refetchInterval: 60_000,
  });
}

export interface ProductivityRow {
  worker_id: string; worker_code: string; worker_name: string; kg_individual: string; kg_team_allocated: string; kg_total: string;
  packing_hours: string; kg_per_hour: string | null; includes_allocation: boolean;
}
export interface DowntimeKpiRow { line_id: string; line_code: string; stops: number; open_stops: number; minutes: string }
export interface OrderVarianceRow {
  order_line_id: string; code: string; customer: string; started_at: string; completed_at: string | null; state: 'running' | 'completed';
  actual_min: string; baseline_min: number | null; latest_min: number | null; revisions: number; variance_min: string | null;
  promised_loading_at: string | null; lateness_min: string | null; overrun_reason: string | null; baseline_after_start: boolean | null;
}
export interface TeamKpiRow { team_session_id: string; line_id: string; label: string | null; task_code: string; kg: string; worker_hours: string;
  kg_per_worker_hour: string | null; periods: number }
export interface LineProdRow { line_id: string; line_code: string; conforming_kg: string; packing_hours: string; kg_per_worker_hour: string | null; boxes: number }

export function useKpis(from: string | undefined, to: string | undefined, line?: string) {
  return useQuery({
    queryKey: ['ops', 'kpis', from, to, line],
    enabled: !!from && !!to,
    queryFn: async () => {
      const [people, teams, lines, downtime, site, orders] = await Promise.all([
        rpc<ProductivityRow[]>('ph_kpi_productivity', { p_from: from, p_to: to, p_line: line || null }).catch(() => null),
        rpc<TeamKpiRow[]>('ph_kpi_team', { p_from: from, p_to: to, p_line: line || null }),
        rpc<LineProdRow[]>('ph_kpi_line_productivity', { p_from: from, p_to: to }),
        rpc<DowntimeKpiRow[]>('ph_kpi_downtime', { p_from: from, p_to: to }),
        rpc<string>('ph_kpi_downtime_site', { p_from: from, p_to: to }),
        rpc<OrderVarianceRow[]>('ph_kpi_order_variance', { p_from: from, p_to: to }),
      ]);
      return { people, teams, lines, downtime, site, orders };
    },
  });
}

export function useInvalidateOps() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['ops'] });
}

/** Farm-level actions the signed-in user may perform (the server decides every call); 'delegated.accounts' marks a manager
 *  with a delegation to manage some accounts. */
export function useMyPermissions() {
  return useQuery({
    queryKey: ['ops', 'my-permissions'],
    staleTime: 60_000,
    queryFn: async () => {
      const set = new Set((await rpc<{ action_key: string }[]>('ph_my_permissions')).map((r) => r.action_key));
      const { data } = await db().from('ph_admin_delegations').select('id').is('voided_at', null).limit(1);
      if ((data ?? []).length > 0 && !set.has('users.administer')) set.add('delegated.accounts');
      return set;
    },
  });
}

export function localName(lang: string, ar: string | null | undefined, en: string | null | undefined): string {
  return (lang === 'en' ? en || ar : ar || en) ?? '';
}

/** Today's date in the farm's time zone (Asia/Amman), as YYYY-MM-DD. */
export function farmToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Amman' }).format(new Date());
}

/** A new idempotency key per form submission (kept across retries of the same submission). */
export function newRequestId(): string {
  return crypto.randomUUID();
}
