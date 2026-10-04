import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { requireSupabase } from '@/core/supabase';
import { formatDateTime, type Locale } from '@/core/i18n';
import { QueryState } from '@/core/components/QueryState';

interface AuditRow {
  id: number;
  actor_user_id: string | null;
  actor_kind: string;
  action: 'insert' | 'update' | 'transition' | 'verify' | 'void';
  entity_type: string;
  entity_id: string;
  comment: string | null;
  server_received_at: string;
}

/** Administration → Audit Log (read-only; the table is append-only in the database). */
export default function AuditLogPage() {
  const { t, i18n } = useTranslation();
  const [entity, setEntity] = useState('');
  const q = useQuery({
    queryKey: ['audit_events', entity],
    queryFn: async () => {
      let query = requireSupabase()
        .from('audit_events')
        .select('id, actor_user_id, actor_kind, action, entity_type, entity_id, comment, server_received_at')
        .order('id', { ascending: false })
        .limit(200);
      if (entity) query = query.eq('entity_type', entity);
      const { data, error } = await query.returns<AuditRow[]>();
      if (error) throw error;
      return data;
    },
  });

  return (
    <section>
      <h1 className="mb-4 text-xl font-bold">{t('admin.auditTitle')}</h1>
      <label className="mb-3 flex max-w-xs flex-col gap-1"><span>{t('admin.entity')}</span>
        <input dir="ltr" className="min-h-touch rounded border border-stone-300 px-3" value={entity}
          onChange={(e) => setEntity(e.target.value.trim())} placeholder="locations" /></label>
      <QueryState isLoading={q.isLoading} error={q.error} isEmpty={q.data?.length === 0} onRetry={() => void q.refetch()}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse bg-white">
            <thead><tr className="border-b bg-stone-100">
              <th className="p-2 text-start">{t('admin.when')}</th>
              <th className="p-2 text-start">{t('admin.who')}</th>
              <th className="p-2 text-start">{t('admin.action')}</th>
              <th className="p-2 text-start">{t('admin.entity')}</th>
              <th className="p-2 text-start">{t('admin.comment')}</th>
            </tr></thead>
            <tbody>
              {q.data?.map((r) => (
                <tr key={r.id} className="border-b align-top">
                  <td className="p-2"><bdi>{formatDateTime(r.server_received_at, i18n.language as Locale)}</bdi></td>
                  <td className="p-2"><bdi className="font-mono text-xs">{r.actor_user_id ?? r.actor_kind}</bdi></td>
                  <td className="p-2">{t(`admin.auditActions.${r.action}`)}</td>
                  <td className="p-2"><bdi>{r.entity_type}</bdi></td>
                  <td className="p-2">{r.comment ?? t('common.none')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </QueryState>
    </section>
  );
}
