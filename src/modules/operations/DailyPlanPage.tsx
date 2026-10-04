import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { requireSupabase } from '@/core/supabase';
import { useAuth } from '@/core/auth/AuthProvider';
import { departmentsWith } from '@/core/rbac/access';
import { errorKey } from '@/core/errors';
import { localized, todayInAmman, type TaskBoardRow } from '@/core/data/tasks';
import { useWorkflow } from '@/core/data/workflow';
import { QueryState } from '@/core/components/QueryState';
import { StatusBadge } from '@/core/components/StatusBadge';
import { useCrews, useDepartments, useExecutors, useLocations, useTaskTypes } from './lookups';

// w-full + min-w-0: long option labels must never push a form wider than a phone screen.
const input = 'min-h-touch w-full min-w-0 rounded border border-stone-300 px-3';

/** The planner's 6 AM screen: create the day's tasks and hand them to supervisors and crews. */
export default function DailyPlanPage() {
  const { t, i18n } = useTranslation();
  const { access } = useAuth();
  const qc = useQueryClient();
  const wf = useWorkflow('task');
  const departments = useDepartments();
  const taskTypes = useTaskTypes();
  const locations = useLocations();
  const crews = useCrews();
  const executors = useExecutors();
  const planScope = departmentsWith(access, 'task', 'plan');
  const plannable = (departments.data ?? []).filter((d) => planScope === 'all' || planScope.includes(d.id));
  const [dept, setDept] = useState('');
  const [date, setDate] = useState(todayInAmman());
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState({ title: '', task_type_id: '', location_id: '', priority: '3', crew_id: '' });
  const department = dept || plannable[0]?.id || '';

  const tasks = useQuery({
    queryKey: ['plan', department, date],
    enabled: !!department,
    queryFn: async () => {
      const { data, error: e } = await requireSupabase().from('task_board').select('*')
        .eq('department_id', department).eq('planned_date', date).order('priority').returns<TaskBoardRow[]>();
      if (e) throw e;
      return data;
    },
  });

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const { data, error: err } = await requireSupabase().from('tasks').insert({
      farm_id: access?.farmId, department_id: department, task_type_id: draft.task_type_id, location_id: draft.location_id || null,
      title: draft.title.trim(), planned_date: date, priority: Number(draft.priority), crew_id: draft.crew_id || null,
    }).select('id').single();
    if (err) { setError(errorKey(err)); return; }
    if (draft.location_id) {
      const { error: tErr } = await requireSupabase().rpc('transition_record', { p_entity_type: 'tasks', p_id: data.id, p_to_status: 'planned' });
      if (tErr) setError(errorKey(tErr));
    }
    setDraft({ title: '', task_type_id: draft.task_type_id, location_id: '', priority: '3', crew_id: draft.crew_id });
    await qc.invalidateQueries({ queryKey: ['plan'] });
  }

  async function assign(task: TaskBoardRow, supervisor: string, crew: string) {
    setError(null);
    const { error: err } = await requireSupabase().rpc('transition_record', {
      p_entity_type: 'tasks', p_id: task.id, p_to_status: 'assigned',
      p_payload: { supervisor_id: supervisor, crew_id: crew || task.crew_id },
    });
    if (err) setError(errorKey(err));
    await qc.invalidateQueries();
  }

  if (departments.isSuccess && plannable.length === 0) return <p className="p-4">{t('plan.noDepartments')}</p>;

  const types = (taskTypes.data ?? []).filter((tt) => tt.department_id === null || tt.department_id === department);
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-xl font-bold">{t('plan.title')}</h1>
        <div className="flex flex-wrap gap-2">
          <label className="flex min-w-0 flex-col gap-1"><span>{t('work.department')}</span>
            <select className={input} value={department} onChange={(e) => setDept(e.target.value)}>
              {plannable.map((d) => <option key={d.id} value={d.id}>{localized(i18n.language, d.name_ar, d.name_en)}</option>)}
            </select></label>
          <label className="flex min-w-0 flex-col gap-1"><span>{t('board.date')}</span>
            <input type="date" dir="ltr" className={input} value={date} onChange={(e) => setDate(e.target.value)} /></label>
        </div>
      </div>

      <form onSubmit={(e) => void create(e)} className="grid gap-3 rounded-lg border bg-white p-4 sm:grid-cols-2 lg:grid-cols-3">
        <h2 className="font-semibold sm:col-span-2 lg:col-span-3">{t('plan.newTask')}</h2>
        <label className="flex flex-col gap-1 sm:col-span-2"><span>{t('work.title')}</span>
          <input required className={input} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></label>
        <label className="flex min-w-0 flex-col gap-1"><span>{t('work.type')}</span>
          <select required className={input} value={draft.task_type_id} onChange={(e) => setDraft({ ...draft, task_type_id: e.target.value })}>
            <option value="">—</option>
            {types.map((tt) => <option key={tt.id} value={tt.id}>{localized(i18n.language, tt.name_ar, tt.name_en)}</option>)}
          </select></label>
        <label className="flex min-w-0 flex-col gap-1"><span>{t('work.location')}</span>
          <select className={input} value={draft.location_id} onChange={(e) => setDraft({ ...draft, location_id: e.target.value })}>
            <option value="">—</option>
            {locations.data?.map((l) => <option key={l.id} value={l.id}>{l.code} · {localized(i18n.language, l.name_ar, l.name_en)}</option>)}
          </select></label>
        <label className="flex min-w-0 flex-col gap-1"><span>{t('work.crew')}</span>
          <select className={input} value={draft.crew_id} onChange={(e) => setDraft({ ...draft, crew_id: e.target.value })}>
            <option value="">—</option>
            {crews.data?.filter((c) => c.department_id === department).map((c) => <option key={c.id} value={c.id}>{localized(i18n.language, c.name_ar, c.name_en)}</option>)}
          </select></label>
        <label className="flex min-w-0 flex-col gap-1"><span>{t('work.priority')}</span>
          <select className={input} value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: e.target.value })}>
            {[1, 2, 3, 4].map((p) => <option key={p} value={p}>{t(`work.priorities.${p}`)}</option>)}
          </select></label>
        <div className="flex items-end"><button type="submit" className="min-h-touch rounded bg-brand px-4 font-semibold text-white">{t('plan.create')}</button></div>
      </form>
      {error && <p role="alert" className="text-red-700">{t(error)}</p>}

      <QueryState isLoading={tasks.isLoading} error={tasks.error} isEmpty={tasks.data?.length === 0} onRetry={() => void tasks.refetch()}>
        <ul className="flex flex-col gap-2">
          {tasks.data?.map((task) => (
            <PlanRow key={task.id} task={task} wfStatus={<StatusBadge workflow={wf.data} versionId={task.workflow_version_id} status={task.status} />}
              executors={(executors.data ?? []).filter((x) => x.department_id === department || x.department_id === null)}
              crews={(crews.data ?? []).filter((c) => c.department_id === department)} onAssign={assign} />
          ))}
        </ul>
      </QueryState>
    </section>
  );
}

function PlanRow(props: {
  task: TaskBoardRow;
  wfStatus: React.ReactNode;
  executors: { user_id: string; full_name: string }[];
  crews: { id: string; name_ar: string; name_en: string | null }[];
  onAssign: (task: TaskBoardRow, supervisor: string, crew: string) => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const [sup, setSup] = useState(props.task.supervisor_id ?? '');
  const [crew, setCrew] = useState(props.task.crew_id ?? '');
  const canAssign = ['draft', 'planned'].includes(props.task.status);
  const unique = [...new Map(props.executors.map((x) => [x.user_id, x])).values()];
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-lg border bg-white p-3">
      <div className="min-w-[200px] flex-1">
        <div className="font-semibold"><bdi>{props.task.code}</bdi> — {props.task.title}</div>
        <div className="text-sm text-stone-600">{localized(i18n.language, props.task.location_name_ar, props.task.location_name_en)} · {props.task.supervisor_name ?? t('plan.unassigned')}</div>
      </div>
      {props.wfStatus}
      {canAssign && (
        <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); void props.onAssign(props.task, sup, crew); }}>
          <select aria-label={t('plan.chooseSupervisor')} required className={input} value={sup} onChange={(e) => setSup(e.target.value)}>
            <option value="">{t('plan.chooseSupervisor')}</option>
            {unique.map((x) => <option key={x.user_id} value={x.user_id}>{x.full_name}</option>)}
          </select>
          <select aria-label={t('plan.chooseCrew')} className={input} value={crew} onChange={(e) => setCrew(e.target.value)}>
            <option value="">{t('plan.chooseCrew')}</option>
            {props.crews.map((c) => <option key={c.id} value={c.id}>{localized(i18n.language, c.name_ar, c.name_en)}</option>)}
          </select>
          <button type="submit" disabled={!sup} className="min-h-touch rounded bg-brand px-4 font-semibold text-white disabled:opacity-60">{t('plan.assign')}</button>
        </form>
      )}
    </li>
  );
}
