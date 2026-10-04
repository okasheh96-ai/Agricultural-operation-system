import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { localized, todayInAmman } from '@/core/data/tasks';
import { useWorkflow } from '@/core/data/workflow';
import { QueryState } from '@/core/components/QueryState';
import { StatusBadge } from '@/core/components/StatusBadge';
import { BUCKETS, inBucket, useBoard, type Bucket } from './useBoard';

/** Operations board: every live task for the day across departments, filterable by bucket and department. */
export default function OperationsBoardPage() {
  const { t, i18n } = useTranslation();
  const [params, setParams] = useSearchParams();
  const date = params.get('date') ?? todayInAmman();
  const bucket = params.get('bucket') as Bucket | null;
  const department = params.get('department');
  const board = useBoard(date);
  const wf = useWorkflow('task');

  const rows = (board.data ?? [])
    .filter((r) => !bucket || inBucket(r, bucket))
    .filter((r) => !department || r.department_id === department)
    .sort((a, b) => Number(b.status === 'blocked') - Number(a.status === 'blocked') || Number(b.is_overdue) - Number(a.is_overdue) || a.priority - b.priority);

  function set(key: string, value: string | null) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next);
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-xl font-bold">{t('board.title')}</h1>
        <label className="flex flex-col gap-1"><span>{t('board.date')}</span>
          <input type="date" dir="ltr" className="min-h-touch rounded border px-2" value={date} onChange={(e) => set('date', e.target.value)} /></label>
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label={t('common.status')}>
        <button type="button" aria-pressed={!bucket} onClick={() => set('bucket', null)}
          className={`min-h-touch rounded-full border px-3 ${!bucket ? 'bg-brand text-white' : 'bg-white'}`}>{t('board.all')}</button>
        {BUCKETS.map((b) => (
          <button key={b} type="button" aria-pressed={bucket === b} onClick={() => set('bucket', b)}
            className={`min-h-touch rounded-full border px-3 ${bucket === b ? 'bg-brand text-white' : 'bg-white'}`}>
            {t(`board.${b}`)} (<bdi>{(board.data ?? []).filter((r) => inBucket(r, b) && (!department || r.department_id === department)).length}</bdi>)
          </button>
        ))}
        {department && <button type="button" onClick={() => set('department', null)} className="min-h-touch underline">{t('board.clear')}</button>}
      </div>
      <QueryState isLoading={board.isLoading} error={board.error} isEmpty={rows.length === 0} onRetry={() => void board.refetch()}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse bg-white">
            <thead><tr className="border-b bg-stone-100">
              <th className="p-2 text-start">{t('common.code')}</th>
              <th className="p-2 text-start">{t('work.title')}</th>
              <th className="p-2 text-start">{t('work.department')}</th>
              <th className="p-2 text-start">{t('work.location')}</th>
              <th className="p-2 text-start">{t('work.supervisor')}</th>
              <th className="p-2 text-start">{t('common.status')}</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={`border-b align-top ${r.status === 'blocked' ? 'bg-red-50' : ''}`}>
                  <td className="p-2"><Link className="underline" to={`/office/tasks/${r.id}`}><bdi>{r.code}</bdi></Link></td>
                  <td className="p-2">{r.title}{r.is_overdue && <span className="ms-2 font-semibold text-red-700">⏰ {t('work.overdue')}</span>}
                    {r.status === 'blocked' && r.blocked_reason && <div className="text-sm text-red-800">⛔ {t(`work.reasons.${r.blocked_reason}`)}{r.blocked_note ? ` — ${r.blocked_note}` : ''}</div>}
                  </td>
                  <td className="p-2">{localized(i18n.language, r.department_name_ar, r.department_name_en)}</td>
                  <td className="p-2">{localized(i18n.language, r.location_name_ar, r.location_name_en)}</td>
                  <td className="p-2">{r.supervisor_name ?? t('plan.unassigned')}</td>
                  <td className="p-2"><StatusBadge workflow={wf.data} versionId={r.workflow_version_id} status={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </QueryState>
    </section>
  );
}
