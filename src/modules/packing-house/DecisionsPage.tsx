import { useState, type SyntheticEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/core/auth/AuthProvider';
import { QueryState } from '@/core/components/QueryState';
import { db, rpc, useDecisions, useInvalidatePh, useMatrix, type Decision } from './api';
import { phErrorMessage } from './phErrors';
import { ErrorBox, Labelled, When, btnCls, inputCls, primaryBtnCls } from './ui';

interface Approval { decision_id: string; spec_code: string; option_code: string; comment: string | null; approved_at: string; approved_by: string }

const PRIORITY_CLS: Record<string, string> = {
  critical: 'bg-red-600 text-white', high: 'bg-amber-500 text-stone-950', medium: 'bg-sky-200 text-sky-950', low: 'bg-stone-200 text-stone-800',
};
const STATE_CLS: Record<string, string> = {
  open: 'bg-red-50 text-red-900 border-red-300', proposed: 'bg-amber-50 text-amber-900 border-amber-300',
  decided: 'bg-green-50 text-green-900 border-green-300', demo_assumption: 'bg-yellow-200 text-yellow-950 border-yellow-500',
};

function RecordDecision({ d, onDone }: { d: Decision; onDone: () => void }) {
  const { t } = useTranslation();
  const matrix = useMatrix();
  const pending = (matrix.data?.cells ?? []).filter((c) => c.decision_code === d.code && c.state === 'pending_decision');
  const pendingRoles = [...new Set(pending.map((c) => c.spec_code))];
  const [option, setOption] = useState(d.decision_state === 'proposed' ? d.selected_option ?? '' : '');
  const [rationale, setRationale] = useState('');
  const [activate, setActivate] = useState<string[]>(d.decision_state === 'proposed' ? d.activate_roles : []);
  const [error, setError] = useState<string | null>(null);
  const proposed = d.decision_state === 'proposed';
  async function submit(e: SyntheticEvent) {
    e.preventDefault();
    setError(null);
    try { await rpc('ph_record_decision', { p_code: d.code, p_option: option, p_rationale: rationale, p_activate_roles: activate }); onDone(); }
    catch (err) { setError(phErrorMessage(t, err)); }
  }
  return (
    <form onSubmit={(e) => void submit(e)} className="mt-2 flex flex-col gap-2 rounded border border-brand/40 bg-brand-light/40 p-3">
      <p className="text-sm">{proposed ? t('ph.decisions.approveHint') : t('ph.decisions.recordHint')}</p>
      {d.options.length > 0 ? (
        <Labelled label={t('ph.decisions.option')} required>
          <select required disabled={proposed} className={inputCls} value={option} onChange={(e) => setOption(e.target.value)}>
            <option value="">—</option>
            {d.options.map((o) => <option key={o.code} value={o.code}>{o.code}: {o.en}</option>)}
          </select>
        </Labelled>
      ) : (
        <Labelled label={t('ph.decisions.decisionText')} required>
          <input required disabled={proposed} className={inputCls} value={option} onChange={(e) => setOption(e.target.value)} />
        </Labelled>
      )}
      {pendingRoles.length > 0 && (
        <fieldset className="text-sm">
          <legend className="font-medium">{t('ph.decisions.activate')}</legend>
          <div className="flex flex-wrap gap-3">
            {pendingRoles.map((r) => (
              <label key={r} className="flex items-center gap-1.5">
                <input type="checkbox" disabled={proposed} checked={activate.includes(r)}
                  onChange={(e) => setActivate(e.target.checked ? [...activate, r] : activate.filter((x) => x !== r))} />
                {r} — {[...new Set(pending.filter((c) => c.spec_code === r).map((c) => c.action_key))].join(', ')}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <Labelled label={t('ph.decisions.rationale')} required>
        <input required className={inputCls} value={rationale} onChange={(e) => setRationale(e.target.value)} />
      </Labelled>
      <ErrorBox message={error} />
      <div><button type="submit" className={primaryBtnCls}>{proposed ? t('ph.decisions.approve') : t('ph.decisions.record')}</button></div>
    </form>
  );
}

/** Open Decisions register (spec §13): owners, options, the spec's recommendation kept as a proposal, what each blocks. */
export default function DecisionsPage() {
  const { t, i18n } = useTranslation();
  const { access } = useAuth();
  const q = useDecisions();
  const invalidate = useInvalidatePh();
  const approvals = useQuery({
    queryKey: ['ph', 'decision_approvals'],
    queryFn: async () => {
      const { data, error } = await db().from('ph_decision_approvals').select('decision_id, spec_code, option_code, comment, approved_at, approved_by')
        .is('voided_at', null).returns<Approval[]>();
      if (error) throw error;
      return data ?? [];
    },
  });
  const myRoles = new Set((access?.grants ?? []).map((g) => g.roleCode).filter((c) => c.startsWith('ph_')).map((c) => c.slice(3).toUpperCase()));
  const [filter, setFilter] = useState<'all' | 'critical' | 'open' | 'mine'>('all');
  const [open, setOpen] = useState<string | null>(null);
  const [recording, setRecording] = useState<string | null>(null);
  const list = (q.data ?? []).filter((d) => filter === 'all' || (filter === 'critical' && d.priority === 'critical')
    || (filter === 'open' && d.decision_state !== 'decided') || (filter === 'mine' && d.owner_roles.some((r) => myRoles.has(r))));
  const counts = { open: (q.data ?? []).filter((d) => d.decision_state === 'open').length, decided: (q.data ?? []).filter((d) => d.decision_state === 'decided').length,
    demo: (q.data ?? []).filter((d) => d.decision_state === 'demo_assumption').length };

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h1 className="text-xl font-bold">{t('ph.decisions.title')}</h1>
        <p className="text-sm text-stone-700">{t('ph.decisions.intro')}</p>
      </div>
      <div className="flex flex-wrap gap-2 text-sm">
        <span className="rounded border border-red-300 bg-red-50 px-2 py-1">{t('ph.decisions.state.open')}: <bdi>{counts.open}</bdi></span>
        <span className="rounded border border-green-300 bg-green-50 px-2 py-1">{t('ph.decisions.state.decided')}: <bdi>{counts.decided}</bdi></span>
        {counts.demo > 0 && <span className="rounded border border-yellow-500 bg-yellow-200 px-2 py-1">{t('ph.decisions.state.demo_assumption')}: <bdi>{counts.demo}</bdi></span>}
        <span className="ms-auto flex gap-1" role="group" aria-label={t('ph.filters.title')}>
          {(['all', 'critical', 'open', 'mine'] as const).map((f) => (
            <button key={f} type="button" aria-pressed={filter === f} className={`${btnCls} ${filter === f ? '!bg-brand !text-white' : ''}`} onClick={() => setFilter(f)}>
              {t(`ph.decisions.filter.${f}`)}</button>
          ))}
        </span>
      </div>
      <QueryState isLoading={q.isLoading} error={q.error} isEmpty={list.length === 0} onRetry={() => void q.refetch()}>
        <ul className="flex flex-col gap-2">
          {list.map((d) => {
            const signs = (approvals.data ?? []).filter((a) => a.decision_id === d.id);
            const canSign = d.decision_state !== 'decided' && d.decision_state !== 'demo_assumption'
              && d.owner_roles.some((r) => myRoles.has(r) && !signs.some((s) => s.spec_code === r));
            return (
              <li key={d.id} className="rounded-lg border bg-white">
                <button type="button" className="flex w-full flex-wrap items-center gap-2 p-3 text-start" aria-expanded={open === d.id} onClick={() => setOpen(open === d.id ? null : d.id)}>
                  <span className="font-mono font-bold">{d.code}</span>
                  <span className={`rounded px-2 py-0.5 text-xs font-semibold ${PRIORITY_CLS[d.priority]}`}>{t(`ph.decisions.priority.${d.priority}`)}</span>
                  <span className="min-w-0 flex-1 font-medium">{i18n.language === 'en' ? d.title_en : d.title_ar}</span>
                  <span className={`rounded border px-2 py-0.5 text-xs font-semibold ${STATE_CLS[d.decision_state]}`}>
                    {t(`ph.decisions.state.${d.decision_state}`)}{d.selected_option && d.decision_state !== 'open' ? `: ${d.selected_option}` : ''}</span>
                  <span className="text-xs text-stone-500">{d.owner_text} · {d.needed_by}</span>
                </button>
                {open === d.id && (
                  <div className="border-t px-3 pb-3 pt-2 text-sm">
                    <p className="mb-1 text-xs text-stone-500">{t('ph.decisions.sourceText')}</p>
                    <dl className="grid gap-2 sm:grid-cols-[10rem_1fr]">
                      <dt className="font-semibold">{t('ph.decisions.why')}</dt><dd>{d.why_en}</dd>
                      <dt className="font-semibold">{t('ph.decisions.options')}</dt>
                      <dd>{d.options.length ? <ul className="list-inside list-disc">{d.options.map((o) => <li key={o.code}><b>{o.code}</b>: {o.en}</li>)}</ul> : '—'}</dd>
                      <dt className="font-semibold">{t('ph.decisions.recommendation')}</dt>
                      <dd>{d.recommendation_en ? <><span className="me-1 rounded bg-sky-100 px-1 text-xs font-semibold text-sky-900">P</span>{d.recommendation_en}</> : t('ph.decisions.noRecommendation')}</dd>
                      <dt className="font-semibold">{t('ph.decisions.blocks')}</dt><dd className="text-red-900">{i18n.language === 'en' ? d.blocks_en : d.blocks_ar}</dd>
                      <dt className="font-semibold">{t('ph.decisions.dependents')}</dt><dd className="font-mono text-xs"><bdi>{d.dependents.join(' · ')}</bdi></dd>
                      <dt className="font-semibold">{t('ph.decisions.owners')}</dt><dd>{d.owner_text} <span className="text-stone-500">({d.owner_roles.join(', ') || t('ph.decisions.noOwner')})</span></dd>
                      <dt className="font-semibold">{t('ph.decisions.sourceRef')}</dt><dd>{d.source}</dd>
                      {d.rationale && <><dt className="font-semibold">{t('ph.decisions.rationale')}</dt><dd>{d.rationale}</dd></>}
                      {d.activate_roles.length > 0 && <><dt className="font-semibold">{t('ph.decisions.activated')}</dt><dd>{d.activate_roles.join(', ')}</dd></>}
                      {d.effective_from && <><dt className="font-semibold">{t('ph.decisions.effective')}</dt><dd><When iso={d.effective_from} />{d.config_version ? ` · v${d.config_version}` : ''}</dd></>}
                    </dl>
                    <h3 className="mt-2 font-semibold">{t('ph.decisions.approvals')}</h3>
                    {signs.length === 0 ? <p className="text-stone-600">{t('ph.decisions.noApprovals')}</p> : (
                      <ul className="flex flex-col gap-1">{signs.map((s) => <li key={s.spec_code}>✍ <b>{s.spec_code}</b> · {s.option_code} · <When iso={s.approved_at} /> — {s.comment}</li>)}</ul>
                    )}
                    {d.decision_state === 'demo_assumption' && <p className="mt-2 rounded bg-yellow-100 px-2 py-1 text-yellow-950">{t('ph.decisions.demoNote')}</p>}
                    {canSign && (recording === d.id
                      ? <RecordDecision d={d} onDone={() => { setRecording(null); void invalidate(); }} />
                      : <button type="button" className={`${primaryBtnCls} mt-2`} onClick={() => setRecording(d.id)}>
                          {d.decision_state === 'proposed' ? t('ph.decisions.approve') : t('ph.decisions.record')}</button>)}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </QueryState>
    </section>
  );
}
