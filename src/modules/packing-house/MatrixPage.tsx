import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/core/auth/AuthProvider';
import { QueryState } from '@/core/components/QueryState';
import { rpc, useInvalidatePh, useMatrix, type PermissionCell } from './api';
import { phErrorMessage } from './phErrors';
import { ErrorBox, btnCls, inputCls } from './ui';

const ROLES = ['PHM', 'PE', 'LL', 'PHO', 'TRC', 'DEC', 'WHM', 'STK', 'QCI', 'QCM', 'QAO', 'QAM', 'ENG', 'SAL', 'LOG', 'FIN', 'TOP', 'ADM', 'AUD'];

function Cell({ c }: { c: PermissionCell | undefined }) {
  const { t } = useTranslation();
  if (!c) return <td className="border p-0.5 text-center" />;
  const symbol = c.evidence === 'C' ? '●' : c.evidence === 'P' ? '○' : '?';
  const cls = c.state === 'active' ? 'bg-green-100 text-green-900' : c.state === 'proposed' ? 'bg-sky-50 text-sky-900'
    : c.state === 'pending_decision' ? 'bg-amber-100 text-amber-900' : 'bg-stone-200 text-stone-500';
  return (
    <td className={`border p-0.5 text-center font-bold ${cls}`} title={`${c.evidence} · ${t(`ph.matrix.state.${c.state}`)} · ${c.basis}${c.decision_code ? ` · ${c.decision_code}` : ''}${c.note ? ` — ${c.note}` : ''}`}>
      {symbol}{c.state === 'active' && c.evidence !== 'C' ? '✓' : ''}
    </td>
  );
}

/** Action-level permission matrix (spec §6.3) exactly as the database enforces it, with each cell's label and state. */
export default function MatrixPage() {
  const { t, i18n } = useTranslation();
  const { access } = useAuth();
  const q = useMatrix();
  const invalidate = useInvalidatePh();
  const [milestone, setMilestone] = useState('M1');
  const [error, setError] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const myRoles = new Set((access?.grants ?? []).map((g) => g.roleCode).filter((c) => c.startsWith('ph_')).map((c) => c.slice(3).toUpperCase()));
  const actions = (q.data?.actions ?? []).filter((a) => milestone === 'all' || a.milestone === milestone);
  const cell = (key: string, role: string) => q.data?.cells.find((c) => c.action_key === key && c.spec_code === role);
  // Proposed cells this user owns, within the milestone shown above (so the list matches the grid).
  const shown = new Set(actions.map((a) => a.action_key));
  const approvable = (q.data?.cells ?? []).filter((c) => c.state === 'proposed' && shown.has(c.action_key)
    && (q.data?.actions.find((a) => a.action_key === c.action_key)?.owner_roles ?? []).some((r) => myRoles.has(r)));

  async function approve(c: PermissionCell) {
    setError(null);
    try { await rpc('ph_approve_permission_cell', { p_cell: c.id, p_comment: comment }); setComment(''); await invalidate(); }
    catch (e) { setError(phErrorMessage(t, e)); }
  }

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h1 className="text-xl font-bold">{t('ph.matrix.title')}</h1>
        <p className="text-sm text-stone-700">{t('ph.matrix.intro')}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="rounded bg-green-100 px-2 py-0.5 font-bold text-green-900">● {t('ph.matrix.legendC')}</span>
        <span className="rounded bg-sky-50 px-2 py-0.5 font-bold text-sky-900">○ {t('ph.matrix.legendP')}</span>
        <span className="rounded bg-amber-100 px-2 py-0.5 font-bold text-amber-900">? {t('ph.matrix.legendNyv')}</span>
        <span className="rounded bg-green-100 px-2 py-0.5 font-bold text-green-900">○✓ {t('ph.matrix.legendResolved')}</span>
        <label className="ms-auto flex items-center gap-2">{t('ph.matrix.milestone')}
          <select className={`${inputCls} !w-auto`} value={milestone} onChange={(e) => setMilestone(e.target.value)}>
            {['M1', 'M2', 'M3', 'M4', 'all'].map((m) => <option key={m} value={m}>{m === 'all' ? t('ph.filters.all') : m}</option>)}
          </select></label>
      </div>
      <QueryState isLoading={q.isLoading} error={q.error} isEmpty={actions.length === 0} onRetry={() => void q.refetch()}>
        <div className="overflow-x-auto rounded border bg-white">
          <table className="min-w-[1100px] border-collapse text-xs">
            <thead>
              <tr className="bg-stone-100">
                <th className="sticky start-0 border bg-stone-100 p-1 text-start">{t('ph.matrix.action')}</th>
                {ROLES.map((r) => <th key={r} className={`border p-1 ${myRoles.has(r) ? 'bg-brand text-white' : ''}`}>{r}</th>)}
                <th className="border p-1 text-start">{t('ph.matrix.source')}</th>
              </tr>
            </thead>
            <tbody>
              {actions.map((a) => (
                <tr key={a.action_key}>
                  <td className="sticky start-0 border bg-white p-1">{i18n.language === 'en' ? a.label_en : a.label_ar}
                    <div className="font-mono text-[10px] text-stone-400"><bdi>{a.action_key}</bdi></div></td>
                  {ROLES.map((r) => <Cell key={r} c={cell(a.action_key, r)} />)}
                  <td className="border p-1 text-stone-600">{a.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </QueryState>
      {approvable.length > 0 && (
        <details className="rounded-lg border bg-white p-3">
          <summary className="cursor-pointer font-semibold">{t('ph.matrix.approveTitle')} <bdi>({approvable.length})</bdi></summary>
          <p className="text-sm text-stone-700">{t('ph.matrix.approveIntro')}</p>
          <input aria-label={t('ph.fields.comment')} placeholder={t('ph.fields.comment')} className={`${inputCls} my-2`} value={comment} onChange={(e) => setComment(e.target.value)} />
          <ErrorBox message={error} />
          <ul className="flex flex-col gap-1 text-sm">
            {approvable.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2">
                <span className="font-mono"><bdi>{c.action_key}</bdi></span> → <b>{c.spec_code}</b>
                <button type="button" className={btnCls} disabled={!comment.trim()} onClick={() => void approve(c)}>{t('ph.matrix.approve')}</button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
