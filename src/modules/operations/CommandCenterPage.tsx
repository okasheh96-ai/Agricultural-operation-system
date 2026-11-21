import { Icon } from '@/modules/ops/icons';
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
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
          {BUCKETS.map((b) => (
            <Link key={b} to={`/office/operations?date=${date}&bucket=${b}`}
              className={`ops-card min-w-0 p-3 md:p-4 ${b === 'blocked' || b === 'overdue' ? 'border-red-300' : ''}`}>
              <div className="text-sm text-stone-600">{t(`board.${b}`)}</div>
              <div className="mt-3 flex items-end justify-between"><bdi className="text-3xl font-bold">{count(b)}</bdi><Icon name="arrow" className="h-4 w-4 text-ops-muted rtl:-scale-x-100" /></div>
            </Link>
          ))}
          <Link to="/office/operations/exceptions" className="ops-card min-w-0 border-amber-300 p-3 md:p-4">
            <div className="text-sm text-stone-600">{t('board.openProblems')}</div>
            <div className="mt-3 text-3xl font-bold"><bdi>{problems.data ?? '…'}</bdi></div>
          </Link>
        </div>
        <h2 className="text-lg font-semibold">{t('board.byDepartment')}</h2>
        {departments.length === 0 && <p className="text-stone-600">{t('board.noTasksDay')}</p>}
        {/* Departments side by side: a sideways strip on a phone, a wrapping row of cards on wider screens. */}
        <ul className="flex snap-x gap-3 overflow-x-auto pb-2 md:grid md:grid-cols-[repeat(auto-fill,minmax(18rem,1fr))] md:overflow-visible">
          {departments.map((d) => {
            const list = rows.filter((r) => r.department_id === d.department_id);
            return (
              <li key={d.department_id} className="w-72 shrink-0 snap-start rounded-lg border bg-white p-3 md:w-auto">
                <h3 className="font-semibold">{localized(i18n.language, d.department_name_ar, d.department_name_en)}</h3>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {BUCKETS.map((b) => {
                    const n = count(b, list);
                    const alarm = (b === 'blocked' || b === 'overdue') && n > 0;
                    return (
                      <Link key={b} to={`/office/operations?date=${date}&bucket=${b}&department=${d.department_id}`}
                        className={`flex min-h-touch flex-col justify-center rounded px-2 py-1 ${alarm ? 'bg-red-50 text-red-800' : 'bg-stone-50'}`}>
                        <span className="text-xs leading-tight text-stone-600 [overflow-wrap:anywhere]">{t(`board.${b}`)}</span>
                        <span className={`text-lg font-bold ${alarm ? 'text-red-700' : ''}`}><bdi>{n}</bdi></span>
                      </Link>
                    );
                  })}
                </div>
              </li>
            );
          })}
        </ul>
      </QueryState>
    </section>
  );
}
