import { requireSupabase } from '@/core/supabase';
import { fieldDb } from '@/core/offline/fieldDb';
import { withDeviceCache } from './cache';

export interface TaskBoardRow {
  id: string;
  code: string;
  title: string;
  status: string;
  priority: number;
  version: number;
  department_id: string;
  department_code: string;
  department_name_ar: string;
  department_name_en: string | null;
  task_type_id: string;
  task_type_name_ar: string;
  task_type_name_en: string | null;
  requires_verification: boolean;
  location_id: string | null;
  location_code: string | null;
  location_name_ar: string | null;
  location_name_en: string | null;
  location_path: string[] | null;
  asset_id: string | null;
  asset_code: string | null;
  planned_date: string | null;
  supervisor_id: string | null;
  supervisor_name: string | null;
  crew_id: string | null;
  crew_code: string | null;
  crew_name_ar: string | null;
  crew_name_en: string | null;
  blocked_reason: string | null;
  blocked_note: string | null;
  rejection_count: number;
  completed_by: string | null;
  actual_quantity: number | null;
  planned_quantity: number | null;
  quantity_unit_id: string | null;
  source_problem_report_id: string | null;
  is_overdue: boolean;
  updated_at: string;
  workflow_version_id: string;
  instructions: string | null;
}

export const ACTIVE_STATUSES = ['planned', 'assigned', 'in_progress', 'blocked'];
export const BLOCK_REASONS = ['material', 'equipment', 'water', 'labour', 'weather', 'access', 'other'] as const;

export function todayInAmman(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Amman' }).format(new Date());
}

/** My Day: everything assigned to me that is due today or still open from earlier, plus today's finished work. */
export function loadMyDay(userId: string): Promise<TaskBoardRow[]> {
  return withDeviceCache(`myday:${userId}`, async () => {
    const today = todayInAmman();
    const { data, error } = await requireSupabase()
      .from('task_board')
      .select('*')
      .eq('supervisor_id', userId)
      .lte('planned_date', today)
      .or(`status.in.(assigned,in_progress,blocked),and(planned_date.eq.${today},status.in.(pending_verification,completed,verified,closed))`)
      .order('priority')
      .order('planned_date')
      .returns<TaskBoardRow[]>();
    if (error) throw error;
    // Each task on My Day is also kept on the device, so it can be opened and worked offline.
    const at = new Date().toISOString();
    await fieldDb.meta.bulkPut(data.map((t) => ({ key: `cache:task:${t.id}`, value: JSON.stringify({ at, data: t }) })));
    return data;
  });
}

export function loadTask(id: string): Promise<TaskBoardRow | null> {
  return withDeviceCache(`task:${id}`, async () => {
    const { data, error } = await requireSupabase().from('task_board').select('*').eq('id', id).maybeSingle<TaskBoardRow>();
    if (error) throw error;
    return data;
  });
}

export async function loadBoard(date: string): Promise<TaskBoardRow[]> {
  const { data, error } = await requireSupabase()
    .from('task_board')
    .select('*')
    .or(`planned_date.eq.${date},and(planned_date.lt.${date},status.in.(planned,assigned,in_progress,blocked)),status.eq.pending_verification,planned_date.is.null`)
    .order('department_code')
    .order('priority')
    .returns<TaskBoardRow[]>();
  if (error) throw error;
  return data;
}

export function localized(locale: string, ar: string | null | undefined, en: string | null | undefined): string {
  return (locale === 'en' && en) || ar || en || '—';
}
