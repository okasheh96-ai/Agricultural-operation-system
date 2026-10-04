import { useQuery } from '@tanstack/react-query';
import { requireSupabase } from '@/core/supabase';

export interface Named { id: string; code: string; name_ar: string; name_en: string | null }
export interface TaskTypeRow extends Named { department_id: string | null; requires_verification: boolean }
export interface PersonRow { user_id: string; full_name: string; department_id: string | null }

async function rows<T>(q: PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const { data, error } = await q;
  if (error) throw error;
  return data as T[];
}

export const useDepartments = () => useQuery({ queryKey: ['departments'], staleTime: 600_000, queryFn: () =>
  rows<Named>(requireSupabase().from('departments').select('id, code, name_ar, name_en').is('voided_at', null).order('sort_order')) });

export const useTaskTypes = () => useQuery({ queryKey: ['task_types'], staleTime: 600_000, queryFn: () =>
  rows<TaskTypeRow>(requireSupabase().from('task_types').select('id, code, name_ar, name_en, department_id, requires_verification').is('voided_at', null).order('code')) });

export const useLocations = () => useQuery({ queryKey: ['locations-lookup'], staleTime: 600_000, queryFn: () =>
  rows<Named & { type: string }>(requireSupabase().from('locations').select('id, code, name_ar, name_en, type').is('voided_at', null).order('code')) });

export const useCrews = () => useQuery({ queryKey: ['crews'], staleTime: 600_000, queryFn: () =>
  rows<Named & { department_id: string }>(requireSupabase().from('crews').select('id, code, name_ar, name_en, department_id').is('voided_at', null).order('code')) });

/** People who can execute field work (supervisors, technicians, field users), per department. */
export const EXECUTOR_ROLES = ['supervisor', 'maintenance_technician', 'irrigation_user', 'fleet_user', 'packing_house_user'];
export const useExecutors = () => useQuery({ queryKey: ['executors'], staleTime: 300_000, queryFn: async () => {
  const data = await rows<{ user_id: string; department_id: string | null; user_profiles: { full_name: string } | null; roles: { code: string } }>(
    requireSupabase().from('user_roles').select('user_id, department_id, user_profiles(full_name), roles!inner(code)')
      .in('roles.code', EXECUTOR_ROLES).is('voided_at', null));
  return data.map((r) => ({ user_id: r.user_id, department_id: r.department_id, full_name: r.user_profiles?.full_name ?? r.user_id }));
} });
