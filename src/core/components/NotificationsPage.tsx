import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { requireSupabase } from '@/core/supabase';
import { formatDateTime, type Locale } from '@/core/i18n';
import { QueryState } from './QueryState';
import { useNotifications } from './useNotifications';

export default function NotificationsPage({ taskBase }: { taskBase: string }) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const q = useNotifications();
  const unread = (q.data ?? []).filter((n) => !n.read_at).map((n) => n.id);

  async function markAll() {
    await requireSupabase().rpc('mark_notifications_read', { p_ids: unread });
    await qc.invalidateQueries({ queryKey: ['notifications'] });
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-bold">{t('notifications.title')}</h1>
        {unread.length > 0 && (
          <button type="button" onClick={() => void markAll()} className="min-h-touch rounded border px-3">{t('notifications.markAllRead')}</button>
        )}
      </div>
      <QueryState isLoading={q.isLoading} error={q.error} isEmpty={q.data?.length === 0} onRetry={() => void q.refetch()}>
        <ul className="flex flex-col gap-2">
          {q.data?.map((n) => (
            <li key={n.id} className={`rounded-lg border p-3 ${n.read_at ? 'bg-white' : 'border-brand bg-brand-light'}`}>
              <div className="font-semibold">{t(`notifications.kinds.${n.kind}`, { code: n.params.code ?? '' })}</div>
              {n.params.title && <div>{n.params.title}</div>}
              <div className="mt-1 flex items-center justify-between text-sm text-stone-600">
                <bdi>{formatDateTime(n.created_at, i18n.language as Locale)}</bdi>
                {n.entity_type === 'tasks' && <Link className="underline" to={`${taskBase}/${n.entity_id}`}>{t('work.openTask')}</Link>}
              </div>
            </li>
          ))}
        </ul>
      </QueryState>
    </section>
  );
}
