import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { requireSupabase } from '@/core/supabase';
import { useAuth } from '@/core/auth/AuthProvider';
import { departmentsWith } from '@/core/rbac/access';
import { errorKey } from '@/core/errors';
import { localized, type TaskBoardRow } from '@/core/data/tasks';
import { QueryState } from '@/core/components/QueryState';

/** Verify or send back completed work; the database refuses self-verification (segregation of duties). */
export default function VerificationPage() {
  const { t, i18n } = useTranslation();
  const { access } = useAuth();
  const qc = useQueryClient();
  const scope = departmentsWith(access, 'task', 'verify');
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ['verification-tasks'],
    queryFn: async () => {
      const { data, error: e } = await requireSupabase().from('task_board').select('*').eq('status', 'pending_verification')
        .order('updated_at').returns<TaskBoardRow[]>();
      if (e) throw e;
      return data.filter((r) => scope === 'all' || scope.includes(r.department_id));
    },
  });

  async function act(task: TaskBoardRow, to: 'verified' | 'in_progress', comment?: string) {
    setError(null);
    const { error: e } = await requireSupabase().rpc('transition_record', {
      p_entity_type: 'tasks', p_id: task.id, p_to_status: to, p_comment: comment ?? null, p_expected_version: task.version,
    });
    if (e) setError(errorKey(e));
    setRejecting(null);
    setReason('');
    await qc.invalidateQueries();
  }

  return (
    <section className="flex flex-col gap-3">
      <h1 className="text-xl font-bold">{t('verifyTasks.title')}</h1>
      <p className="text-stone-700">{t('verifyTasks.intro')}</p>
      {error && <p role="alert" className="text-red-700">{t(error)}</p>}
      <QueryState isLoading={q.isLoading} error={q.error} isEmpty={q.data?.length === 0} onRetry={() => void q.refetch()}>
        <ul className="flex flex-col gap-2">
          {q.data?.map((task) => {
            const own = task.completed_by === access?.userId;
            return (
              <li key={task.id} className="rounded-lg border bg-white p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <Link className="font-semibold underline" to={`/office/tasks/${task.id}`}><bdi>{task.code}</bdi> — {task.title}</Link>
                    <div className="text-sm text-stone-600">
                      {localized(i18n.language, task.department_name_ar, task.department_name_en)} · {localized(i18n.language, task.location_name_ar, task.location_name_en)}
                      {task.actual_quantity !== null && <> · {t('work.actualQuantity')}: <bdi>{task.actual_quantity}</bdi></>}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => void act(task, 'verified')}
                      className="min-h-touch rounded bg-brand px-4 font-semibold text-white disabled:opacity-50">{t('work.actions.verified')}</button>
                    <button type="button" onClick={() => setRejecting(task.id)} className="min-h-touch rounded border border-red-600 px-4 text-red-800">{t('work.actions.reject')}</button>
                  </div>
                </div>
                {/* The database decides (a task type may allow a logged self-verification); warn here. */}
                {own && <p className="mt-1 text-sm text-amber-800">{t('errors.P0423')}</p>}
                {rejecting === task.id && (
                  <form className="mt-2 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); void act(task, 'in_progress', reason); }}>
                    <input required aria-label={t('verifyTasks.rejectReason')} placeholder={t('verifyTasks.rejectReason')} className="min-h-touch flex-1 rounded border px-3" value={reason} onChange={(e) => setReason(e.target.value)} />
                    <button type="submit" disabled={!reason.trim()} className="min-h-touch rounded bg-red-700 px-4 text-white disabled:opacity-60">{t('common.save')}</button>
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
