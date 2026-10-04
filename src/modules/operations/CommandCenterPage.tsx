import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { requireSupabase } from '@/core/supabase';
import { localized, todayInAmman, type TaskBoardRow } from '@/core/data/tasks';
import { QueryState } from '@/core/components/QueryState';
import { BUCKETS, inBucket, useBoard, type Bucket } from './useBoard';

/**
 * Management questions, not charts (§4.4): what is planned, late, blocked, waiting verification, which
 * department has unresolved work, how many problems are open. Every number links to the list behind it.
 */
export default function CommandCenterPage() {
  const { t, i18n } = useTranslation();
  const [date, setDate] = useState(todayInAmman());
  const board = useBoard(date);
  const problems = useQuery({
    queryKey: ['open_problems_count'],
    queryFn: async () => {
      const { count, error } = await requireSupabase().from('problem_reports').select('id', { count: 'exact', head: true })
        .in('status', ['open', 'acknowledged']).is('voided_at', null);
      if (error) throw error;
      return count ?? 0;
    },
  });

  const rows = board.data ?? [];
  const departments = [...new Map(rows.map((r) => [r.department_id, r])).values()];
  const count = (b: Bucket, list: TaskBoardRow[] = rows) => list.filter((r) => inBucket(r, b)).length;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-xl font-bold">{t('board.commandTitle')}</h1>
        <label className="flex flex-col gap-1"><span>{t('board.date')}</span>
          <input type="date" dir="ltr" className="min-h-touch rounded border px-2" value={date} onChange={(e) => setDate(e.target.value)} /></label>
      </div>
      <QueryState isLoading={board.isLoading} error={board.error} isEmpty={false} onRetry={() => void board.refetch()}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-7">
          {BUCKETS.map((b) => (
            <Link key={b} to={`/office/operations?date=${date}&bucket=${b}`}
              className={`rounded-lg border bg-white p-3 ${b === 'blocked' || b === 'overdue' ? 'border-red-300' : ''}`}>
              <div className="text-sm text-stone-600">{t(`board.${b}`)}</div>
              <div className="text-2xl font-bold"><bdi>{count(b)}</bdi></div>
            </Link>
          ))}
          <Link to="/office/operations/exceptions" className="rounded-lg border border-amber-300 bg-white p-3">
            <div className="text-sm text-stone-600">{t('board.openProblems')}</div>
            <div className="text-2xl font-bold"><bdi>{problems.data ?? '…'}</bdi></div>
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse bg-white">
            <thead><tr className="border-b bg-stone-100">
              <th className="p-2 text-start">{t('board.department')}</th>
              {BUCKETS.map((b) => <th key={b} className="p-2 text-end">{t(`board.${b}`)}</th>)}
            </tr></thead>
            <tbody>
              {departments.map((d) => {
                const list = rows.filter((r) => r.department_id === d.department_id);
                return (
                  <tr key={d.department_id} className="border-b">
                    <td className="p-2">{localized(i18n.language, d.department_name_ar, d.department_name_en)}</td>
                    {BUCKETS.map((b) => (
                      <td key={b} className={`p-2 text-end ${(b === 'blocked' || b === 'overdue') && count(b, list) > 0 ? 'font-bold text-red-700' : ''}`}>
                        <Link className="underline-offset-2 hover:underline" to={`/office/operations?date=${date}&bucket=${b}&department=${d.department_id}`}>
                          <bdi>{count(b, list)}</bdi>
                        </Link>
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </QueryState>
    </section>
  );
}
