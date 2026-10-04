import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { requireSupabase } from '@/core/supabase';
import { useAuth } from '@/core/auth/AuthProvider';
import { can } from '@/core/rbac/access';
import { errorKey } from '@/core/errors';
import { localized, todayInAmman } from '@/core/data/tasks';
import { useWorkflow } from '@/core/data/workflow';
import { formatDateTime, type Locale } from '@/core/i18n';
import { QueryState } from '@/core/components/QueryState';
import { StatusBadge } from '@/core/components/StatusBadge';
import { useDepartments, useTaskTypes } from './lookups';

interface ReportRow {
  id: string;
  code: string;
  status: string;
  priority: number;
  description: string;
  created_at: string;
  version: number;
  workflow_version_id: string;
  owning_department_id: string;
  location_id: string | null;
  problem_categories: { name_ar: string; name_en: string | null } | null;
  assets: { code: string } | null;
  locations: { name_ar: string; name_en: string | null } | null;
  departments: { name_ar: string; name_en: string | null } | null;
}

const input = 'min-h-touch rounded border border-stone-300 px-3';

/** Problem reports: the owning department acknowledges and turns them into work, resolves or rejects them. */
export default function ExceptionsPage() {
  const { t, i18n } = useTranslation();
  const { access } = useAuth();
  const qc = useQueryClient();
  const wf = useWorkflow('problem_report');
  const departments = useDepartments();
  const taskTypes = useTaskTypes();
  const [open, setOpen] = useState<{ id: string; mode: 'triage' | 'resolved' | 'rejected' } | null>(null);
  const [form, setForm] = useState({ department: '', taskType: '', title: '', date: todayInAmman(), wo: true, note: '' });
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ['problem_reports'],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error: e } = await requireSupabase().from('problem_reports')
        .select('id, code, status, priority, description, created_at, version, workflow_version_id, owning_department_id, location_id, problem_categories(name_ar, name_en), assets(code), locations(name_ar, name_en), departments(name_ar, name_en)')
        .in('status', ['open', 'acknowledged']).is('voided_at', null).order('priority').order('created_at').returns<ReportRow[]>();
      if (e) throw e;
      return data;
    },
  });

  async function rpc(name: string, args: Record<string, unknown>) {
    setError(null);
    const { data, error: e } = await requireSupabase().rpc(name, args);
    if (e) { setError(errorKey(e)); return null; }
    await qc.invalidateQueries();
    return data as Record<string, unknown>;
  }

  function startTriage(r: ReportRow) {
    setOpen({ id: r.id, mode: 'triage' });
    setForm({ department: r.owning_department_id, taskType: '', title: r.description.slice(0, 80), date: todayInAmman(), wo: true, note: '' });
  }

  async function submit(r: ReportRow) {
    if (!open) return;
    if (open.mode === 'triage') {
      const res = await rpc('triage_problem_report', {
        p_report: r.id, p_department: form.department, p_task_type: form.taskType, p_title: form.title,
        p_planned_date: form.date || null, p_note: form.note || null, p_create_work_order: form.wo,
      });
      if (res) {
        const { data } = await requireSupabase().from('tasks').select('code').eq('id', res.task_id as string).single();
        setDone(t('problems.converted', { code: (data as { code: string } | null)?.code ?? '' }));
      }
    } else {
      await rpc('transition_record', { p_entity_type: 'problem_reports', p_id: r.id, p_to_status: open.mode, p_comment: form.note, p_expected_version: r.version });
    }
    setOpen(null);
  }

  const types = (taskTypes.data ?? []).filter((tt) => tt.department_id === null || tt.department_id === form.department);
  return (
    <section className="flex flex-col gap-3">
      <h1 className="text-xl font-bold">{t('problems.listTitle')}</h1>
      {error && <p role="alert" className="text-red-700">{t(error)}</p>}
      {done && <p role="status" className="rounded bg-green-50 p-3 text-green-900">✓ {done}</p>}
      <QueryState isLoading={q.isLoading} error={q.error} isEmpty={q.data?.length === 0} onRetry={() => void q.refetch()}>
        <ul className="flex flex-col gap-2">
          {q.data?.map((r) => {
            const mayReview = can(access, 'problem_report', 'review', { departmentId: r.owning_department_id });
            return (
              <li key={r.id} className={`rounded-lg border bg-white p-3 ${r.priority <= 2 ? 'border-red-300' : ''}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold"><bdi>{r.code}</bdi> · {localized(i18n.language, r.problem_categories?.name_ar, r.problem_categories?.name_en)} · {t(`work.priorities.${r.priority}`)}</div>
                    <p>{r.description}</p>
                    <div className="text-sm text-stone-600">
                      {t('problems.owner')}: {localized(i18n.language, r.departments?.name_ar, r.departments?.name_en)}
                      {r.assets && <> · <bdi>{r.assets.code}</bdi></>}
                      {r.locations && <> · {localized(i18n.language, r.locations.name_ar, r.locations.name_en)}</>}
                      {' · '}<bdi>{formatDateTime(r.created_at, i18n.language as Locale)}</bdi>
                    </div>
                  </div>
                  <StatusBadge workflow={wf.data} versionId={r.workflow_version_id} status={r.status} />
                </div>
                {mayReview && !open && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {r.status === 'open' && (
                      <button type="button" className="min-h-touch rounded border px-3"
                        onClick={() => void rpc('transition_record', { p_entity_type: 'problem_reports', p_id: r.id, p_to_status: 'acknowledged', p_expected_version: r.version })}>
                        {t('problems.acknowledge')}
                      </button>
                    )}
                    <button type="button" className="min-h-touch rounded bg-brand px-3 font-semibold text-white" onClick={() => startTriage(r)}>{t('problems.triage')}</button>
                    <button type="button" className="min-h-touch rounded border px-3" onClick={() => { setOpen({ id: r.id, mode: 'resolved' }); setForm({ ...form, note: '' }); }}>{t('problems.resolve')}</button>
                    <button type="button" className="min-h-touch rounded border border-red-600 px-3 text-red-800" onClick={() => { setOpen({ id: r.id, mode: 'rejected' }); setForm({ ...form, note: '' }); }}>{t('problems.reject')}</button>
                  </div>
                )}
                {open?.id === r.id && (
                  <form className="mt-3 grid gap-2 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); void submit(r); }}>
                    {open.mode === 'triage' && (
                      <>
                        <label className="flex flex-col gap-1"><span>{t('problems.targetDepartment')}</span>
                          <select className={input} value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value, taskType: '' })}>
                            {departments.data?.map((d) => <option key={d.id} value={d.id}>{localized(i18n.language, d.name_ar, d.name_en)}</option>)}
                          </select></label>
                        <label className="flex flex-col gap-1"><span>{t('problems.taskType')}</span>
                          <select required className={input} value={form.taskType} onChange={(e) => setForm({ ...form, taskType: e.target.value })}>
                            <option value="">—</option>
                            {types.map((tt) => <option key={tt.id} value={tt.id}>{localized(i18n.language, tt.name_ar, tt.name_en)}</option>)}
                          </select></label>
                        <label className="flex flex-col gap-1 sm:col-span-2"><span>{t('problems.taskTitle')}</span>
                          <input required className={input} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
                        <label className="flex flex-col gap-1"><span>{t('problems.plannedDate')}</span>
                          <input type="date" dir="ltr" className={input} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></label>
                        <label className="flex min-h-touch items-center gap-2">
                          <input type="checkbox" className="h-5 w-5" checked={form.wo} onChange={(e) => setForm({ ...form, wo: e.target.checked })} />
                          {t('problems.createWorkOrder')}
                        </label>
                      </>
                    )}
                    <label className="flex flex-col gap-1 sm:col-span-2"><span>{t('work.comment')}</span>
                      <input required={open.mode !== 'triage'} className={input} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
                    <div className="flex gap-2 sm:col-span-2">
                      <button type="submit" className="min-h-touch rounded bg-brand px-4 font-semibold text-white">{t('common.save')}</button>
                      <button type="button" className="min-h-touch rounded border px-4" onClick={() => setOpen(null)}>{t('common.cancel')}</button>
                    </div>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      </QueryState>
    </section>
  );
}
