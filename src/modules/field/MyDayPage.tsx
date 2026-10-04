import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/core/auth/AuthProvider';
import { loadMyDay, localized } from '@/core/data/tasks';
import { useWorkflow } from '@/core/data/workflow';
import { useOutbox } from '@/core/offline/useOutbox';
import { provisionalStatus } from '@/core/offline/outbox';
import { QueryState } from '@/core/components/QueryState';
import { StatusBadge } from '@/core/components/StatusBadge';

/** The supervisor's 6 AM screen: today's work, most urgent first, one tap into each task. */
export default function MyDayPage() {
  const { t, i18n } = useTranslation();
  const { access } = useAuth();
  const wf = useWorkflow('task');
  const outbox = useOutbox();
  const q = useQuery({
    queryKey: ['myday', access?.userId],
    queryFn: () => loadMyDay(access?.userId as string),
    enabled: !!access,
    networkMode: 'always',
  });

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-bold">{t('work.myDayTitle')}</h1>
        <Link to="/field/tasks/new" className="min-h-touch inline-flex items-center rounded-lg bg-brand px-4 font-semibold text-white">{t('quick.newTask')}</Link>
      </div>
      <QueryState isLoading={q.isLoading} error={q.error} isEmpty={q.data?.length === 0} emptyText={t('work.myDayEmpty')} onRetry={() => void q.refetch()}>
        <ul className="flex flex-col gap-3">
          {q.data?.map((task) => {
            const pending = provisionalStatus(outbox.data ?? [], task.id);
            return (
              <li key={task.id}>
                <Link to={`/field/tasks/${task.id}`}
                  className={`block rounded-lg border-2 bg-white p-4 shadow-sm active:bg-stone-50 ${task.priority <= 2 ? 'border-red-300' : 'border-stone-200'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-lg font-semibold">{task.title}</span>
                    <StatusBadge workflow={wf.data} versionId={task.workflow_version_id} status={pending ?? task.status} pending={!!pending} />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-stone-700">
                    <span><bdi>{task.code}</bdi></span>
                    {task.location_code && <span>📍 {localized(i18n.language, task.location_name_ar, task.location_name_en)}</span>}
                    {task.crew_id && <span>👥 {localized(i18n.language, task.crew_name_ar, task.crew_name_en)}</span>}
                    <span>{t(`work.priorities.${task.priority}`)}</span>
                    {task.is_overdue && <span className="font-semibold text-red-700">⏰ {t('work.overdue')}</span>}
                  </div>
                  {task.status === 'blocked' && task.blocked_reason && (
                    <p className="mt-2 text-red-800">⛔ {t(`work.reasons.${task.blocked_reason}`)}{task.blocked_note ? ` — ${task.blocked_note}` : ''}</p>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </QueryState>
    </section>
  );
}
