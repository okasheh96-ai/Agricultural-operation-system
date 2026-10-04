import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/core/auth/AuthProvider';
import { requireSupabase } from '@/core/supabase';
import { withDeviceCache } from '@/core/data/cache';
import { localized } from '@/core/data/tasks';
import { QueryState } from '@/core/components/QueryState';

interface CrewRow {
  id: string;
  code: string;
  name_ar: string;
  name_en: string | null;
  crew_members: { valid_to: string | null; voided_at: string | null; workers: { id: string; code: string; full_name: string } | null }[];
}

/** Crews I supervise and who is in them today (time-bounded membership). */
export default function MyCrewPage() {
  const { t, i18n } = useTranslation();
  const { access } = useAuth();
  const q = useQuery({
    queryKey: ['mycrew', access?.userId],
    enabled: !!access,
    networkMode: 'always',
    queryFn: () => withDeviceCache(`mycrew:${access?.userId}`, async () => {
      const { data, error } = await requireSupabase()
        .from('crews')
        .select('id, code, name_ar, name_en, crew_members(valid_to, voided_at, workers(id, code, full_name))')
        .eq('supervisor_user_id', access?.userId as string)
        .is('voided_at', null)
        .returns<CrewRow[]>();
      if (error) throw error;
      return data;
    }),
  });
  const now = Date.now();
  return (
    <section className="flex flex-col gap-3">
      <h1 className="text-xl font-bold">{t('crew.title')}</h1>
      <QueryState isLoading={q.isLoading} error={q.error} isEmpty={q.data?.length === 0} emptyText={t('crew.none')} onRetry={() => void q.refetch()}>
        {q.data?.map((c) => {
          const members = c.crew_members.filter((m) => !m.voided_at && (!m.valid_to || Date.parse(m.valid_to) > now) && m.workers);
          return (
            <div key={c.id} className="rounded-lg border bg-white p-3">
              <h2 className="font-semibold">{localized(i18n.language, c.name_ar, c.name_en)} <span className="text-sm text-stone-600">· {t('crew.members', { count: members.length })}</span></h2>
              <ul className="mt-2 grid grid-cols-2 gap-1">
                {members.map((m) => <li key={m.workers?.id}>{m.workers?.full_name} <span className="text-xs text-stone-500"><bdi>{m.workers?.code}</bdi></span></li>)}
              </ul>
            </div>
          );
        })}
      </QueryState>
    </section>
  );
}
