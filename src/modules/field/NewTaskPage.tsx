import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/core/auth/AuthProvider';
import { requireSupabase } from '@/core/supabase';
import { departmentsWith } from '@/core/rbac/access';
import { withDeviceCache } from '@/core/data/cache';
import { cacheProvisionalTask, localized, todayInAmman, type TaskBoardRow } from '@/core/data/tasks';
import { useWorkflow } from '@/core/data/workflow';
import { queueInsert, queueTransition } from '@/core/offline/sync';

interface TypeRow { id: string; code: string; name_ar: string; name_en: string | null; department_id: string | null; requires_verification: boolean }
interface LocationRow { id: string; code: string; name_ar: string; name_en: string | null; type: string; owning_department_id: string | null; path: string[] }
interface CrewRow { id: string; code: string; name_ar: string; name_en: string | null; department_id: string; supervisor_user_id: string | null }
interface DeptRow { id: string; code: string; name_ar: string; name_en: string | null }

const cached = <T,>(key: string, load: () => PromiseLike<{ data: unknown; error: unknown }>) =>
  withDeviceCache(key, async () => {
    const { data, error } = await load();
    if (error) throw error;
    return data as T[];
  });

/**
 * Unplanned work at 6 AM: what (type) → where (location) → start. The task is assigned to the supervisor
 * who creates it (server rule: self-assignment only), so it never bypasses a planner's authority over others.
 * Works offline: the task and its status changes queue on the device and sync later.
 */
export default function NewTaskPage() {
  const { t, i18n } = useTranslation();
  const { access } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const wf = useWorkflow('task');
  const createScope = departmentsWith(access, 'task', 'create');
  const executeScope = departmentsWith(access, 'task', 'execute');

  const departments = useQuery({ queryKey: ['departments-lite'], networkMode: 'always',
    queryFn: () => cached<DeptRow>('departments-lite', () => requireSupabase().from('departments').select('id, code, name_ar, name_en').is('voided_at', null).order('sort_order')) });
  const types = useQuery({ queryKey: ['task_types-lite'], networkMode: 'always',
    queryFn: () => cached<TypeRow>('task_types-lite', () => requireSupabase().from('task_types').select('id, code, name_ar, name_en, department_id, requires_verification').is('voided_at', null).order('code')) });
  const locations = useQuery({ queryKey: ['locations-lite'], networkMode: 'always',
    queryFn: () => cached<LocationRow>('locations-lite', () => requireSupabase().from('locations').select('id, code, name_ar, name_en, type, owning_department_id, path').is('voided_at', null).order('code')) });
  const crews = useQuery({ queryKey: ['crews-lite'], networkMode: 'always',
    queryFn: () => cached<CrewRow>('crews-lite', () => requireSupabase().from('crews').select('id, code, name_ar, name_en, department_id, supervisor_user_id').is('voided_at', null)) });

  // Departments where I can both create and execute (my own work).
  const mine = (departments.data ?? []).filter((d) =>
    (createScope === 'all' || createScope.includes(d.id)) && (executeScope === 'all' || executeScope.includes(d.id)));
  const [dept, setDept] = useState('');
  const [type, setType] = useState('');
  const [location, setLocation] = useState('');
  const [title, setTitle] = useState('');
  const [startNow, setStartNow] = useState(true);
  const [busy, setBusy] = useState(false);
  const department = dept || mine[0]?.id || '';

  const typeList = (types.data ?? []).filter((x) => x.department_id === null || x.department_id === department);
  const fieldLocations = (locations.data ?? []).filter((l) => !['farm', 'production_system', 'warehouse'].includes(l.type));
  const myCrews = (crews.data ?? []).filter((c) => c.department_id === department && c.supervisor_user_id === access?.userId);

  async function create() {
    if (!access || !department || !type || !location || !wf.data?.activeVersionId) return;
    setBusy(true);
    const id = crypto.randomUUID();
    const tt = typeList.find((x) => x.id === type);
    const loc = fieldLocations.find((x) => x.id === location);
    const d = mine.find((x) => x.id === department);
    const crew = myCrews.length === 1 ? myCrews[0] : undefined;
    const finalTitle = title.trim() || `${localized(i18n.language, tt?.name_ar, tt?.name_en)} — ${localized(i18n.language, loc?.name_ar, loc?.name_en)}`;
    const row = {
      id, farm_id: access.farmId, department_id: department, task_type_id: type, location_id: location, title: finalTitle,
      planned_date: todayInAmman(), supervisor_id: access.userId, crew_id: crew?.id ?? null,
    };
    await cacheProvisionalTask(access.userId, {
      ...row, code: '…', status: 'draft', priority: 3, version: 1, department_code: d?.code ?? '', department_name_ar: d?.name_ar ?? '',
      department_name_en: d?.name_en ?? null, task_type_name_ar: tt?.name_ar ?? '', task_type_name_en: tt?.name_en ?? null,
      requires_verification: tt?.requires_verification ?? true, location_code: loc?.code ?? null, location_name_ar: loc?.name_ar ?? null,
      location_name_en: loc?.name_en ?? null, location_path: loc?.path ?? null, asset_id: null, asset_code: null, supervisor_name: null,
      crew_code: crew?.code ?? null, crew_name_ar: crew?.name_ar ?? null, crew_name_en: crew?.name_en ?? null, blocked_reason: null,
      blocked_note: null, rejection_count: 0, completed_by: null, actual_quantity: null, planned_quantity: null, quantity_unit_id: null,
      source_problem_report_id: null, is_overdue: false, updated_at: new Date().toISOString(),
      workflow_version_id: wf.data.activeVersionId, instructions: null,
    } satisfies TaskBoardRow);
    await queueInsert(qc, { table: 'tasks', entityId: id, row });
    await queueTransition(qc, { entityType: 'tasks', entityId: id, payload: { toStatus: 'assigned' } });
    if (startNow) await queueTransition(qc, { entityType: 'tasks', entityId: id, payload: { toStatus: 'in_progress' } });
    setBusy(false);
    navigate(`/field/tasks/${id}`, { replace: true });
  }

  const pick = (active: boolean) => `min-h-[56px] rounded-lg border-2 px-2 text-start ${active ? 'border-brand bg-brand-light font-semibold' : 'border-stone-300 bg-white'}`;
  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void create(); }}>
      <h1 className="text-xl font-bold">{t('quick.title')}</h1>
      {mine.length > 1 && (
        <label className="flex flex-col gap-1"><span>{t('work.department')}</span>
          <select className="min-h-touch rounded border border-stone-300 px-3" value={department} onChange={(e) => { setDept(e.target.value); setType(''); }}>
            {mine.map((d) => <option key={d.id} value={d.id}>{localized(i18n.language, d.name_ar, d.name_en)}</option>)}
          </select></label>
      )}
      {departments.isSuccess && mine.length === 0 && <p role="alert" className="text-amber-900">{t('quick.noRights')}</p>}
      <fieldset className="grid grid-cols-2 gap-2">
        <legend className="mb-1 font-semibold">{t('quick.what')}</legend>
        {typeList.map((x) => (
          <button key={x.id} type="button" aria-pressed={type === x.id} onClick={() => setType(x.id)} className={pick(type === x.id)}>
            {localized(i18n.language, x.name_ar, x.name_en)}
          </button>
        ))}
      </fieldset>
      <label className="flex flex-col gap-1"><span className="font-semibold">{t('quick.where')}</span>
        <select required className="min-h-[56px] rounded-lg border-2 border-stone-300 px-3" value={location} onChange={(e) => setLocation(e.target.value)}>
          <option value="">—</option>
          {fieldLocations.map((l) => <option key={l.id} value={l.id}>{l.code} · {localized(i18n.language, l.name_ar, l.name_en)}</option>)}
        </select></label>
      <label className="flex flex-col gap-1"><span>{t('quick.titleOptional')}</span>
        <input className="min-h-touch rounded border border-stone-300 px-3" value={title} onChange={(e) => setTitle(e.target.value)} /></label>
      <label className="flex min-h-touch items-center gap-2">
        <input type="checkbox" className="h-6 w-6" checked={startNow} onChange={(e) => setStartNow(e.target.checked)} />
        {t('quick.startNow')}
      </label>
      <button type="submit" disabled={busy || !type || !location || !wf.data?.activeVersionId}
        className="min-h-[56px] rounded-lg bg-brand px-4 text-lg font-semibold text-white disabled:opacity-60">
        {startNow ? t('quick.createAndStart') : t('quick.create')}
      </button>
    </form>
  );
}
