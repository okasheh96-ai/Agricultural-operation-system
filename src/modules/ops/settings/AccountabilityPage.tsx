import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { requireSupabase } from '@/core/supabase';
import { farmToday, localName, opsErrorMessage, rpc, useInvalidateOps, useMyPermissions } from '../api';
import { btn, btnPrimary, Card, EmptyState, field, Loaded, PageTitle, Pill, SaveStatus, type SaveState, useFmt } from '../ui';

interface Policy { id: string; version_no: number; state: 'draft_inactive' | 'active' | 'retired'; scope_roles: string[]; warnings_before_hr: number;
  text_en: string; text_ar: string; source_ref: string; decided_at: string | null; decision_note: string | null }
interface Violation { id: string; person_name: string; occurred_on: string; description: string; sequence_no: number; outcome: 'verbal_warning' | 'hr_referred';
  hr_decision: string | null; hr_decided_at: string | null; recorded_by_name: string | null }
interface Person { id: string; full_name: string; roles: string[] }

const SCOPES = ['LL', 'PE'] as const;

/** Settings → Accountability. The process from S-04 p.4 / S-06 p.2 is held as a draft: the sources disagree on who it covers
 *  (C-02), so nothing can be recorded until the Owner decides the scope (OD-42). After N verbal warnings, HR decides. */
export default function AccountabilityPage() {
  const { t } = useTranslation();
  const perms = useMyPermissions();
  const q = useQuery({ queryKey: ['ops', 'acc-policy'], queryFn: async () => {
    const { data, error } = await requireSupabase().from('ph_acc_policy').select('*').is('voided_at', null).order('version_no', { ascending: false }).limit(1);
    if (error) throw error;
    return ((data ?? [])[0] ?? null) as Policy | null;
  } });
  const has = (k: string) => !!perms.data?.has(k);
  return (
    <div>
      <PageTitle title={t('ops.acc.title')} sub={t('ops.acc.sub')} />
      <Loaded query={q}>
        {(p) => !p ? <EmptyState>{t('ops.acc.none')}</EmptyState> : (
          <div className="grid gap-4">
            <PolicyCard p={p} canDecide={has('settings.authority')} />
            {p.state === 'active' && has('acc.record') && <RecordForm />}
            {(has('acc.view') || has('acc.hr_decide')) && <Register canDecide={has('acc.hr_decide')} />}
          </div>
        )}
      </Loaded>
    </div>
  );
}

function PolicyCard({ p, canDecide }: { p: Policy; canDecide: boolean }) {
  const { t, i18n } = useTranslation();
  const fmt = useFmt();
  const invalidate = useInvalidateOps();
  const [scope, setScope] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [state, setState] = useState<SaveState>({ kind: 'idle' });
  const decide = async () => {
    setState({ kind: 'pending' });
    try { await rpc('ph_acc_decide', { p_policy: p.id, p_scope: scope, p_note: note }); setState({ kind: 'saved', at: new Date().toISOString() }); await invalidate(); }
    catch (e) { setState({ kind: 'failed', message: opsErrorMessage(t, e) }); }
  };
  return (
    <Card title={t('ops.acc.policy', { v: p.version_no })} sub={p.source_ref} highlight={p.state === 'draft_inactive'}
      action={p.state === 'active' ? <Pill tone="good">{t('ops.acc.active')}</Pill> : <Pill tone="warn">{t('ops.acc.draft')}</Pill>}>
      <p className="whitespace-pre-line text-sm leading-relaxed">{localName(i18n.language, p.text_ar, p.text_en)}</p>
      <p className="mt-2 text-sm">{t('ops.acc.warnings', { n: p.warnings_before_hr })}</p>
      {p.state === 'active' ? (
        <p className="mt-2 text-sm text-ops-muted">{t('ops.acc.decided', { when: fmt.date(p.decided_at), scope: p.scope_roles.map((r) => t(`ops.acc.scope.${r}`)).join('، ') })}</p>
      ) : (
        <div className="mt-3 grid gap-2">
          <p className="rounded-ops-sm border border-ops-amberline bg-ops-amberbg p-3 text-sm text-ops-amber">{t('ops.acc.conflict')}</p>
          {canDecide && (
            <>
              <fieldset className="flex flex-wrap gap-3">
                <legend className="mb-1 text-sm font-medium">{t('ops.acc.appliesTo')}</legend>
                {SCOPES.map((s) => (
                  <label key={s} className="flex min-h-[44px] items-center gap-2 text-sm">
                    <input type="checkbox" className="h-5 w-5" checked={scope.includes(s)} onChange={(e) => setScope(e.target.checked ? [...scope, s] : scope.filter((x) => x !== s))} />
                    {t(`ops.acc.scope.${s}`)}
                  </label>
                ))}
              </fieldset>
              <label className="text-sm">{t('ops.acc.note')}<input className={field} value={note} onChange={(e) => setNote(e.target.value)} /></label>
              <button type="button" className={btnPrimary} disabled={scope.length === 0 || !note.trim()} onClick={decide}>{t('ops.acc.activate')}</button>
            </>
          )}
          <SaveStatus state={state} />
        </div>
      )}
    </Card>
  );
}

function RecordForm() {
  const { t } = useTranslation();
  const invalidate = useInvalidateOps();
  const people = useQuery({ queryKey: ['ops', 'acc-people'], queryFn: () => rpc<Person[]>('ph_acc_people') });
  const [f, setF] = useState({ person: '', date: farmToday(), description: '' });
  const [state, setState] = useState<SaveState>({ kind: 'idle' });
  const save = async () => {
    setState({ kind: 'pending' });
    try {
      const r = await rpc<{ sequence_no: number; outcome: string }>('ph_acc_record', { p_person: f.person, p_occurred_on: f.date, p_description: f.description });
      setState({ kind: 'saved', at: new Date().toISOString(), text: t(`ops.acc.outcome.${r.outcome}`) + ` (#${r.sequence_no})` });
      setF({ ...f, description: '' });
      await invalidate();
    } catch (e) { setState({ kind: 'failed', message: opsErrorMessage(t, e) }); }
  };
  return (
    <Card title={t('ops.acc.record')}>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-sm">{t('ops.acc.person')}
          <select className={field} value={f.person} onChange={(e) => setF({ ...f, person: e.target.value })}>
            <option value="">—</option>
            {(people.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.full_name} ({p.roles.join(', ')})</option>)}
          </select></label>
        <label className="text-sm">{t('ops.acc.date')}<input type="date" dir="ltr" className={field} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
        <label className="text-sm sm:col-span-2">{t('ops.acc.description')}
          <textarea className={`${field} min-h-[88px] py-2`} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
      </div>
      <button type="button" className={`${btnPrimary} mt-3`} disabled={!f.person || !f.date || !f.description.trim()} onClick={save}>{t('ops.acc.save')}</button>
      <div className="mt-2"><SaveStatus state={state} /></div>
    </Card>
  );
}

function Register({ canDecide }: { canDecide: boolean }) {
  const { t } = useTranslation();
  const fmt = useFmt();
  const invalidate = useInvalidateOps();
  const q = useQuery({ queryKey: ['ops', 'acc-register'], queryFn: async () => {
    const { data, error } = await requireSupabase().from('ph_acc_register').select('*').order('occurred_on', { ascending: false }).limit(300);
    if (error) throw error;
    return (data ?? []) as Violation[];
  } });
  const [dec, setDec] = useState<Record<string, string>>({});
  const [state, setState] = useState<SaveState>({ kind: 'idle' });
  const decide = async (id: string) => {
    setState({ kind: 'pending' });
    try { await rpc('ph_acc_hr_decision', { p_violation: id, p_decision: dec[id] ?? '' }); setState({ kind: 'saved', at: new Date().toISOString() }); await Promise.all([invalidate(), q.refetch()]); }
    catch (e) { setState({ kind: 'failed', message: opsErrorMessage(t, e) }); }
  };
  return (
    <Card title={t('ops.acc.register')} sub={t('ops.acc.registerSub')}>
      {(q.data ?? []).length === 0 ? <EmptyState>{t('ops.acc.registerEmpty')}</EmptyState> : (
        <ul className="grid gap-2">
          {(q.data ?? []).map((v) => (
            <li key={v.id} className="rounded-ops-sm border border-ops-line p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{v.person_name}</span><span className="text-ops-muted">{fmt.date(v.occurred_on)}</span>
                <Pill tone={v.outcome === 'hr_referred' ? 'bad' : 'warn'}>{t(`ops.acc.outcome.${v.outcome}`)} · #{v.sequence_no}</Pill>
              </div>
              <p className="mt-1">{v.description}</p>
              {v.recorded_by_name && <p className="mt-1 text-xs text-ops-muted">{t('ops.acc.by', { name: v.recorded_by_name })}</p>}
              {v.hr_decision ? <p className="mt-2 rounded-ops-sm bg-ops-surface2 p-2">{t('ops.acc.hrDecision')}: {v.hr_decision} <span className="text-xs text-ops-muted">({fmt.date(v.hr_decided_at)})</span></p>
                : v.outcome === 'hr_referred' && canDecide ? (
                  <div className="mt-2 flex flex-wrap items-end gap-2">
                    <label className="min-w-[14rem] flex-1 text-xs">{t('ops.acc.hrDecision')}<input className={field} value={dec[v.id] ?? ''} onChange={(e) => setDec({ ...dec, [v.id]: e.target.value })} /></label>
                    <button type="button" className={btn} disabled={!(dec[v.id] ?? '').trim()} onClick={() => void decide(v.id)}>{t('ops.acc.saveDecision')}</button>
                  </div>
                ) : v.outcome === 'hr_referred' ? <p className="mt-2 text-xs text-ops-amber">{t('ops.acc.awaitingHr')}</p> : null}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2"><SaveStatus state={state} /></div>
    </Card>
  );
}
