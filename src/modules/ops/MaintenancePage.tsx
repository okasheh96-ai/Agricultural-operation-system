import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { requireSupabase } from '@/core/supabase';
import { localName, opsErrorMessage, rpc, useInvalidateOps, useMyPermissions } from './api';
import { btn, btnPrimary, Card, field, Loaded, Num, PageTitle, Pill, SaveStatus, useFmt, type SaveState } from './ui';

interface Plan { id: string; code: string; kind: 'maintenance' | 'cleaning'; machine_label: string; title_en: string; title_ar: string; role_code: string;
  state: 'pending_approval' | 'approved' | 'retired'; approved_at: string | null; approval_note: string | null; ups_installed_on: string | null;
  data: { rule_en?: string; rule_ar?: string; prohibited_en?: string; prohibited_ar?: string; footer_en?: string[]; after_en?: string; after_ar?: string } }
interface Item { item_id: string; plan_id: string; code: string; trigger_kind: string; interval_hours: string | null; interval_days: number | null; interval_months: number | null;
  title_en: string; title_ar: string; do_en: string; do_ar: string; sort_order: number; last_done_at: string | null; last_done_hours: string | null; open_task_id: string | null }

function useData() {
  return useQuery({ queryKey: ['ops', 'pm'], refetchInterval: 120_000, queryFn: async () => {
    const db = requireSupabase();
    const [p, i, m] = await Promise.all([
      db.from('ph_pm_plans').select('*').is('voided_at', null).order('code'),
      db.from('ph_pm_board').select('*').order('sort_order'),
      db.from('ph_pm_meter').select('hours, read_at').is('voided_at', null).order('read_at', { ascending: false }).limit(1),
    ]);
    if (p.error) throw p.error; if (i.error) throw i.error; if (m.error) throw m.error;
    return { plans: (p.data ?? []) as Plan[], items: (i.data ?? []) as Item[], meter: (m.data ?? [])[0] as { hours: string; read_at: string } | undefined };
  } });
}

/** AWETA preventive maintenance (S-08) and cleaning (S-09), as supplied. Work is generated onto the task board only once a
 *  schedule is approved (OD-44): hours or calendar, whichever comes first, from the running-hours readings. */
export default function MaintenancePage() {
  const { t } = useTranslation();
  const q = useData();
  return (
    <div>
      <PageTitle title={t('ops.pm.title')} sub={t('ops.pm.sub')} />
      <Loaded query={q}>{(d) => <Body d={d} />}</Loaded>
    </div>
  );
}

function Body({ d }: { d: { plans: Plan[]; items: Item[]; meter?: { hours: string; read_at: string } } }) {
  const { t } = useTranslation();
  const fmt = useFmt();
  const perms = useMyPermissions();
  const invalidate = useInvalidateOps();
  const [hours, setHours] = useState('');
  const [ups, setUps] = useState('');
  const [state, setState] = useState<SaveState>({ kind: 'idle' });
  const act = async (fn: () => Promise<unknown>) => {
    setState({ kind: 'pending' });
    try { await fn(); setState({ kind: 'saved', at: new Date().toISOString() }); setHours(''); await invalidate(); }
    catch (e) { setState({ kind: 'failed', message: opsErrorMessage(t, e) }); }
  };
  const machine = d.plans[0]?.machine_label ?? '';
  const anyApproved = d.plans.some((p) => p.state === 'approved');
  return (
    <div className="grid gap-4">
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_22rem]">
        <Card title={<bdi>{machine}</bdi>} sub={t('ops.pm.machineSub')}>
          <div className="flex flex-wrap items-end gap-6">
            <div><div className="text-sm text-ops-muted">{t('ops.pm.hours')}</div>
              <div className="text-3xl font-bold"><Num animate value={d.meter?.hours ?? null} digits={1} /> <span className="text-base font-normal text-ops-muted">{t('ops.units.h')}</span></div>
              <div className="text-xs text-ops-muted">{d.meter ? t('ops.pm.readAt', { when: fmt.dateTime(d.meter.read_at) }) : t('ops.pm.noReading')}</div></div>
          </div>
        </Card>
        {perms.data?.has('pm.meter') && (
          <Card title={t('ops.pm.record')}>
            <div className="grid gap-2">
              <label className="text-sm">{t('ops.pm.hoursNow')}<input className={field} dir="ltr" inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value.replace(',', '.'))} /></label>
              <button type="button" className={btnPrimary} disabled={!hours} onClick={() => act(() => rpc('ph_pm_meter_record', { p_hours: Number(hours) }))}>{t('ops.pm.save')}</button>
              <label className="text-sm">{t('ops.pm.upsDate')}<input type="date" className={field} dir="ltr" value={ups} onChange={(e) => setUps(e.target.value)} /></label>
              <button type="button" className={btn} disabled={!ups} onClick={() => act(() => rpc('ph_pm_meter_record', { p_hours: null, p_ups_installed_on: ups }))}>{t('ops.pm.saveUps')}</button>
              <SaveStatus state={state} />
            </div>
          </Card>
        )}
      </div>
      {d.plans.map((p) => <PlanCard key={p.id} plan={p} items={d.items.filter((i) => i.plan_id === p.id)} canApprove={!!perms.data?.has('pm.approve')} onAct={act} />)}
      {anyApproved && perms.data?.has('pm.preseason') && (
        <Card title={t('ops.pm.preseason')}>
          <p className="mb-2 text-sm text-ops-muted">{t('ops.pm.preseasonHelp')}</p>
          <button type="button" className={btn} onClick={() => act(() => rpc('ph_pm_start_preseason'))}>{t('ops.pm.startPreseason')}</button>
        </Card>
      )}
    </div>
  );
}

function every(t: (k: string, o?: Record<string, unknown>) => string, i: Item): string {
  const parts: string[] = [];
  if (i.interval_hours) parts.push(t('ops.pm.everyHours', { n: Number(i.interval_hours) }));
  if (i.interval_days) parts.push(t('ops.pm.everyDays', { n: i.interval_days }));
  if (i.interval_months) parts.push(t('ops.pm.everyMonths', { n: i.interval_months }));
  return parts.length ? parts.join(` ${t('ops.pm.or')} `) : t(`ops.pm.trigger.${i.trigger_kind}`);
}

function PlanCard({ plan, items, canApprove, onAct }: { plan: Plan; items: Item[]; canApprove: boolean; onAct: (fn: () => Promise<unknown>) => Promise<void> }) {
  const { t, i18n } = useTranslation();
  const fmt = useFmt();
  const [note, setNote] = useState('');
  const lang = i18n.language;
  return (
    <Card title={`${plan.code} · ${localName(lang, plan.title_ar, plan.title_en)}`} sub={t('ops.pm.team', { role: plan.role_code })}
      action={plan.state === 'approved' ? <Pill tone="good">{t('ops.pm.approved', { when: fmt.date(plan.approved_at) })}</Pill> : <Pill tone="warn">{t('ops.pm.pending')}</Pill>}>
      <p className="mb-3 rounded-ops-sm border border-ops-amberline bg-ops-amberbg p-3 text-sm text-ops-amber">
        {localName(lang, plan.data.rule_ar, plan.data.rule_en)}{plan.data.prohibited_en && <><br />{localName(lang, plan.data.prohibited_ar, plan.data.prohibited_en)}</>}
      </p>
      {plan.state === 'pending_approval' && (
        <div className="mb-3 grid gap-2">
          <p className="text-sm text-ops-muted">{t('ops.pm.pendingHelp')}</p>
          {(plan.data.footer_en ?? []).map((f) => <p key={f} className="text-xs text-ops-muted">• {f}</p>)}
          {canApprove && (
            <div className="flex flex-wrap items-end gap-2">
              <label className="min-w-[16rem] flex-1 text-sm">{t('ops.pm.approvalNote')}<input className={field} value={note} onChange={(e) => setNote(e.target.value)} /></label>
              <button type="button" className={btnPrimary} disabled={!note.trim()} onClick={() => void onAct(() => rpc('ph_pm_approve', { p_plan: plan.id, p_note: note }))}>{t('ops.pm.approve')}</button>
            </div>
          )}
        </div>
      )}
      <ul className="grid gap-2">
        {items.map((i) => (
          <li key={i.item_id} className="rounded-ops-sm border border-ops-line p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-semibold">{localName(lang, i.title_ar, i.title_en)}</div>
                <div className="text-xs text-ops-muted">{every(t, i)}</div>
              </div>
              <span className="flex flex-wrap gap-1">
                {i.open_task_id ? <Link to="/ops/tasks" className="inline-flex"><Pill tone="info">{t('ops.pm.openTask')}</Pill></Link> : null}
                {i.last_done_at ? <Pill tone="good">{t('ops.pm.lastDone', { when: fmt.dateTime(i.last_done_at) })}</Pill> : <Pill tone="neutral">{t('ops.pm.neverDone')}</Pill>}
              </span>
            </div>
            <p className="mt-2 text-sm">{localName(lang, i.do_ar, i.do_en)}</p>
          </li>
        ))}
      </ul>
      {plan.data.after_en && <p className="mt-3 text-sm text-ops-muted">{localName(lang, plan.data.after_ar, plan.data.after_en)}</p>}
    </Card>
  );
}
