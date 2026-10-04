import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { requireSupabase } from '@/core/supabase';
import { QueryState } from '@/core/components/QueryState';
import { VerificationBadge, type VerificationStatus } from '@/core/components/VerificationBadge';

interface DepartmentRow {
  id: string;
  code: string;
  name_ar: string;
  name_en: string | null;
  is_independent: boolean;
  verification_status: VerificationStatus;
}

export default function DepartmentsPage() {
  const { t, i18n } = useTranslation();
  const q = useQuery({
    queryKey: ['departments'],
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from('departments')
        .select('id, code, name_ar, name_en, is_independent, verification_status')
        .is('voided_at', null)
        .order('sort_order')
        .returns<DepartmentRow[]>();
      if (error) throw error;
      return data;
    },
  });

  return (
    <section>
      <h1 className="mb-4 text-xl font-bold">{t('admin.departmentsTitle')}</h1>
      <QueryState isLoading={q.isLoading} error={q.error} isEmpty={q.data?.length === 0} onRetry={() => void q.refetch()}>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {q.data?.map((d) => (
            <li key={d.id} className={`rounded-lg border bg-white p-4 ${d.is_independent ? 'border-qa' : 'border-stone-200'}`}>
              <div className="font-semibold">{i18n.language === 'en' && d.name_en ? d.name_en : d.name_ar}</div>
              <div className="mt-1 text-sm text-stone-600"><bdi>{d.code}</bdi></div>
              <div className="mt-2 flex flex-wrap gap-2">
                <VerificationBadge status={d.verification_status} />
                {d.is_independent && (
                  <span className="rounded bg-qa-light px-2 py-0.5 text-sm text-qa">{t('admin.independent')}</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      </QueryState>
    </section>
  );
}
