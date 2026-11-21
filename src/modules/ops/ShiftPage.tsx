import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { QueryState } from '@/core/components/QueryState';
import {
  localName, newRequestId, opsErrorMessage, rpc, useInvalidateOps, useMyLineShifts, useOpenOrders, usePackFormats, useSheet,
  useTaskKinds, useWorkers, type Sheet,
} from './api';
import { btn, btnPrimary, Card, EmptyState, field, Num, Pill, SaveStatus, useFmt, type SaveState, Tabs } from './ui';

type Tab = 'output' | 'workers' | 'line';
const GRADES = ['premium', 'gr1', 'gr2'] as const;
/** Readiness items as worded in the roles draft (S-04 LS §2, §3, §4). */
const READINESS = ['hygiene_workwear', 'line_ready', 'packaging_inside', 'order_confirmed', 'discipline_briefed'] as const;

interface OutputDraft { who: 'worker' | 'team'; workerId: string; teamId: string; orderId: string; grade: string; packId: string; netKg: string;
  boxes: string; conforming: boolean }

export default function ShiftPage() {
  const { t, i18n } = useTranslation();
  const fmt = useFmt();
  const [sp, setSp] = useSearchParams();
  const mine = useMyLineShifts();
  const chosen = sp.get('ls') || mine.data?.find((m) => m.is_mine && !m.submitted_at)?.line_shift_id || mine.data?.[0]?.line_shift_id;
  const sheet = useSheet(chosen);
  const [tab, setTab] = useState<Tab>('output');
  const current = mine.data?.find((m) => m.line_shift_id === chosen);

  return (
    <div className="mx-auto max-w-3xl">
      <QueryState isLoading={mine.isLoading} error={mine.error} isEmpty={false} onRetry={() => void mine.refetch()}>
        {!chosen ? (
          <EmptyState>{t('ops.shift.noLine')}</EmptyState>
        ) : (
          <>
            <Card highlight className="mb-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs font-medium text-ops-muted">{t('ops.shift.myLine')}</div>
                  <h1 className="truncate text-xl font-bold">{current ? localName(i18n.language, current.line_name_ar, current.line_name_en) : sheet.data?.line_shift.line_code}</h1>
                  <div className="text-sm text-ops-muted">
                    <bdi>{sheet.data?.shift.code ?? current?.shift_code}</bdi> · {fmt.time(sheet.data?.shift.planned_start)}–{fmt.time(sheet.data?.shift.planned_end)}
                    {sheet.data?.shift.engineer_name && <> · {t('ops.overview.engineer')}: {sheet.data.shift.engineer_name}</>}
                  </div>
                </div>
                {sheet.data?.line_shift.submitted_at ? <Pill tone="good">{t('ops.lineStatus.submitted')}</Pill> : <Pill tone="info">{t('ops.lineStatus.open')}</Pill>}
              </div>
              {(mine.data?.length ?? 0) > 1 && (
                <label className="mt-3 block text-xs font-medium text-ops-muted">{t('ops.shift.switchLine')}
                  <select className={field} value={chosen} onChange={(e) => setSp({ ls: e.target.value }, { replace: true })}>
                    {mine.data?.map((m) => <option key={m.line_shift_id} value={m.line_shift_id}>{m.shift_code} · {localName(i18n.language, m.line_name_ar, m.line_name_en)}</option>)}
                  </select>
                </label>
              )}
            </Card>

            <Tabs label={t('ops.shift.sections')} value={tab} onChange={setTab} tabs={(['output', 'workers', 'line'] as Tab[]).map((k) => ({ key: k, label: t(`ops.shift.tab.${k}`) }))} />

            <QueryState isLoading={sheet.isLoading} error={sheet.error} isEmpty={!sheet.data} onRetry={() => void sheet.refetch()}>
              {sheet.data && (
                <>
                  {sheet.data.instructions.filter((i) => !i.acknowledged_at).map((i) => <Instruction key={i.id} item={i} />)}
                  {tab === 'output' && <OutputTab sheet={sheet.data} defaultOrder={current?.current_order_id ?? ''} />}
                  {tab === 'workers' && <WorkersTab sheet={sheet.data} />}
                  {tab === 'line' && <LineTab sheet={sheet.data} />}
                </>
              )}
            </QueryState>
          </>
        )}
      </QueryState>
    </div>
  );
}

function Instruction({ item }: { item: Sheet['instructions'][number] }) {
  const { t } = useTranslation();
  const inv = useInvalidateOps();
  const [err, setErr] = useState('');
  return (
    <div role="alert" className="mb-3 rounded-ops-sm border border-ops-accentline bg-ops-soft p-3 text-sm">
      <div className="font-semibold text-ops-accent">ℹ {t('ops.shift.instruction')} <bdi>{item.code}</bdi></div>
      <p className="my-1">{item.description}</p>
      <button type="button" className={btn} onClick={() => rpc('ph_issue_step', { p_issue: item.id, p_step: 'acknowledge' }).then(inv).catch((e) => setErr(opsErrorMessage(t, e)))}>
        {t('ops.shift.acknowledge')}
      </button>
      {err && <p className="mt-1 text-ops-red">{err}</p>}
    </div>
  );
}

function OutputTab({ sheet, defaultOrder }: { sheet: Sheet; defaultOrder: string }) {
  const { t, i18n } = useTranslation();
  const fmt = useFmt();
  const inv = useInvalidateOps();
  const packs = usePackFormats();
  const orders = useOpenOrders();
  const workers = useWorkers();
  const working = sheet.open.filter((o) => !o.team_session_id);
  const openTeams = sheet.teams.filter((tm) => !tm.ended_at);
  const [d, setD] = useState<OutputDraft>({ who: 'worker', workerId: '', teamId: '', orderId: defaultOrder, grade: 'gr1', packId: '', netKg: '', boxes: '', conforming: true });
  const [state, setState] = useState<SaveState>({ kind: 'idle' });
  const [requestId, setRequestId] = useState(newRequestId);
  const pack = packs.data?.find((p) => p.id === d.packId);
  useEffect(() => { if (!d.packId && packs.data?.[0]) setD((x) => ({ ...x, packId: packs.data[0]?.id ?? '', netKg: packs.data[0]?.nominal_net_kg ?? '' })); }, [packs.data, d.packId]);
  useEffect(() => { if (!d.orderId && defaultOrder) setD((x) => ({ ...x, orderId: defaultOrder })); }, [defaultOrder, d.orderId]);
  const boxes = Number(d.boxes);
  const net = Number(d.netKg || pack?.nominal_net_kg || 0);
  const kg = boxes > 0 && net > 0 ? boxes * net : null;
  const firstPackDone = sheet.first_pack_checks.some((c) => c.pack_format_id === d.packId && (c.order_line_id ?? '') === (d.orderId || ''));
  const disabled = !sheet.line_shift.can_record || !!sheet.line_shift.submitted_at;
  const ready = boxes > 0 && Number.isInteger(boxes) && !!d.packId && (d.who === 'worker' ? !!d.workerId : !!d.teamId) && net > 0;

  const save = async () => {
    setState({ kind: 'pending' });
    try {
      const res = await rpc<{ kg: number; recorded_at: string; repeated?: boolean }>('ph_record_output', {
        p: {
          line_shift_id: sheet.line_shift.id, worker_id: d.who === 'worker' ? d.workerId : null, team_session_id: d.who === 'team' ? d.teamId : null,
          order_line_id: d.orderId || null, grade: d.grade, pack_format_id: d.packId, net_kg_per_box: d.netKg || null, boxes,
          conforming: d.conforming,
        },
        p_request_id: requestId,
      });
      setState({ kind: 'saved', at: res.recorded_at ?? new Date().toISOString(), text: t('ops.shift.savedKg', { kg: fmt.num(Number(res.kg), 1) }) });
      setD((x) => ({ ...x, boxes: '' }));
      setRequestId(newRequestId());
      void inv();
    } catch (e) {
      // The entered values stay; the same request id is reused, so a retry after a lost answer never saves twice.
      setState({ kind: 'failed', message: opsErrorMessage(t, e) });
    }
  };

  const step = (n: number) => setD((x) => ({ ...x, boxes: String(Math.max(0, (Number(x.boxes) || 0) + n)) }));

  return (
    <div className="pb-24">
      <Card title={t('ops.shift.recordOutput')}>
        {disabled && <p className="mb-2 text-sm text-ops-amber">! {sheet.line_shift.submitted_at ? t('ops.shift.submittedLocked') : t('ops.shift.noRecordPermission')}</p>}
        <div className="mb-3 grid grid-cols-2 gap-1 rounded-ops-sm bg-ops-grey p-1" role="radiogroup" aria-label={t('ops.shift.who')}>
          {(['worker', 'team'] as const).map((w) => (
            <button key={w} type="button" role="radio" aria-checked={d.who === w} onClick={() => setD({ ...d, who: w })}
              className={`min-h-[44px] rounded-ops-sm text-sm font-semibold ${d.who === w ? 'bg-ops-surface text-ops-accent shadow-ops' : 'text-ops-muted'}`}>{t(`ops.shift.whoOpt.${w}`)}</button>
          ))}
        </div>
        {d.who === 'worker' ? (
          <label className="mb-3 block text-sm font-medium">{t('ops.shift.worker')}
            <select className={field} value={d.workerId} onChange={(e) => setD({ ...d, workerId: e.target.value })}>
              <option value="">{t('ops.shift.choose')}</option>
              {working.length > 0 && <optgroup label={t('ops.shift.onLineNow')}>
                {working.map((w) => <option key={w.id} value={w.worker_id}>{w.worker_code} · {w.worker_name}</option>)}
              </optgroup>}
              <optgroup label={t('ops.shift.allWorkers')}>
                {workers.data?.filter((w) => !working.some((x) => x.worker_id === w.id)).map((w) => (
                  <option key={w.id} value={w.id}>{w.code} · {localName(i18n.language, w.full_name, w.full_name_en)}</option>
                ))}
              </optgroup>
            </select>
          </label>
        ) : (
          <label className="mb-3 block text-sm font-medium">{t('ops.shift.team')}
            <select className={field} value={d.teamId} onChange={(e) => setD({ ...d, teamId: e.target.value })}>
              <option value="">{t('ops.shift.choose')}</option>
              {openTeams.map((tm) => <option key={tm.id} value={tm.id}>{tm.label ?? tm.task_code} · {t('ops.shift.members', { n: tm.members })}</option>)}
            </select>
            {d.teamId && <span className="mt-1 block text-xs text-ops-muted">{t('ops.shift.teamPeriod', {
              from: fmt.time(openTeams.find((x) => x.id === d.teamId)?.last_period_end ?? openTeams.find((x) => x.id === d.teamId)?.started_at) })}</span>}
          </label>
        )}
        <label className="mb-3 block text-sm font-medium">{t('ops.shift.order')}
          <select className={field} value={d.orderId} onChange={(e) => setD({ ...d, orderId: e.target.value })}>
            <option value="">{t('ops.shift.noOrder')}</option>
            {orders.data?.map((o) => <option key={o.id} value={o.id}>{o.code} · {o.customer_name}</option>)}
          </select>
        </label>
        <fieldset className="mb-3">
          <legend className="text-sm font-medium">{t('ops.filters.grade')}</legend>
          <div className="mt-1 grid grid-cols-3 gap-2">
            {GRADES.map((g) => (
              <button key={g} type="button" aria-pressed={d.grade === g} onClick={() => setD({ ...d, grade: g })}
                className={`min-h-[48px] rounded-ops-sm border text-sm font-semibold ${d.grade === g ? 'border-ops-accent bg-ops-soft text-ops-accent' : 'border-ops-line bg-ops-surface'}`}>
                {t(`ops.grades.${g}`)}
              </button>
            ))}
          </div>
        </fieldset>
        <div className="mb-3 grid grid-cols-2 gap-3">
          <label className="text-sm font-medium">{t('ops.shift.pack')}
            <select className={field} value={d.packId} onChange={(e) => {
              const p = packs.data?.find((x) => x.id === e.target.value);
              setD({ ...d, packId: e.target.value, netKg: p?.nominal_net_kg ?? '' });
            }}>
              {packs.data?.map((p) => <option key={p.id} value={p.id}>{p.code} · {fmt.num(Number(p.nominal_net_kg), 3)} {t('ops.units.kg')}</option>)}
            </select>
          </label>
          <label className="text-sm font-medium">{t('ops.shift.netKg')}
            <input className={`${field} ops-num`} inputMode="decimal" value={d.netKg} onChange={(e) => setD({ ...d, netKg: e.target.value.replace(',', '.') })}
              aria-describedby="netkg-help" />
            <span id="netkg-help" className="text-xs text-ops-muted">{t('ops.shift.netKgHelp')}</span>
          </label>
        </div>
        {!firstPackDone && d.packId && <p className="mb-3 rounded-ops-sm bg-ops-amberbg p-2 text-sm text-ops-amber">! {t('ops.shift.firstPackMissing')}</p>}
        <label className="block text-sm font-medium" htmlFor="ops-boxes">{t('ops.shift.boxes')}</label>
        <div className="mt-1 flex items-stretch gap-2">
          <button type="button" className={`${btn} text-xl`} onClick={() => step(-1)} aria-label={t('ops.shift.minusOne')}>−</button>
          <input id="ops-boxes" className="ops-num min-h-[64px] w-full min-w-0 rounded-ops-sm border-2 border-ops-accent bg-ops-surface px-3 text-center text-4xl font-bold"
            inputMode="numeric" pattern="[0-9]*" value={d.boxes} onChange={(e) => setD({ ...d, boxes: e.target.value.replace(/[^0-9]/g, '') })} />
          <button type="button" className={`${btn} text-xl`} onClick={() => step(1)} aria-label={t('ops.shift.plusOne')}>+</button>
          <button type="button" className={btn} onClick={() => step(5)}>+5</button>
        </div>
        <label className="mt-3 flex min-h-[44px] items-center gap-2 text-sm">
          <input type="checkbox" className="h-5 w-5" checked={!d.conforming} onChange={(e) => setD({ ...d, conforming: !e.target.checked })} />
          {t('ops.shift.nonConforming')}
        </label>
        <div className="mt-3 rounded-ops-sm bg-ops-grey p-3 text-center" aria-live="polite">
          <div className="text-xs text-ops-muted">{t('ops.shift.review')}</div>
          <div className="text-lg font-semibold">
            {kg !== null ? <><Num value={boxes} unit="boxes" digits={0} /> × <Num value={net} unit="kg" digits={3} /> = <Num value={kg} unit="kg" digits={1} /></> : t('ops.shift.reviewEmpty')}
          </div>
          <div className="text-xs text-ops-muted">{t('ops.shift.sheetTotal')}: <Num value={sheet.totals.boxes} unit="boxes" digits={0} /> · <Num value={sheet.totals.kg} unit="kg" digits={0} /></div>
        </div>
        <div className="mt-3"><SaveStatus state={state} onRetry={() => void save()} /></div>
      </Card>

      <Card className="mt-3" title={t('ops.shift.recent')}>
        <RecentOutput sheet={sheet} />
      </Card>

      {/* Thumb-reachable save, above the bottom navigation. */}
      <div className="ops-noprint fixed inset-x-0 bottom-[57px] z-30 border-t border-ops-line bg-ops-surface/95 p-3 backdrop-blur lg:bottom-0 lg:static lg:mt-3 lg:border-0 lg:bg-transparent lg:p-0">
        <div className="mx-auto max-w-3xl">
          <button type="button" className={`${btnPrimary} w-full`} disabled={!ready || disabled || state.kind === 'pending'} onClick={() => void save()}>
            {state.kind === 'pending' ? t('ops.save.pending') : kg !== null ? t('ops.shift.saveKg', { kg: fmt.num(kg, 1) }) : t('ops.shift.save')}
          </button>
        </div>
      </div>
    </div>
  );
}

function RecentOutput({ sheet }: { sheet: Sheet }) {
  const { t } = useTranslation();
  const fmt = useFmt();
  const inv = useInvalidateOps();
  const [err, setErr] = useState('');
  const canFix = (sheet.line_shift.can_record && !sheet.line_shift.submitted_at) || sheet.line_shift.can_correct;
  if (sheet.output.length === 0) return <EmptyState>{t('ops.shift.noOutputYet')}</EmptyState>;
  const voidRow = async (id: string) => {
    const reason = window.prompt(t('ops.shift.voidReason'));
    if (!reason) return;
    try { await rpc('ph_void_labour_record', { p_table: 'ph_output_entries', p_id: id, p_reason: reason }); setErr(''); void inv(); }
    catch (e) { setErr(opsErrorMessage(t, e)); }
  };
  return (
    <>
      {err && <p role="alert" className="mb-2 text-sm text-ops-red">{err}</p>}
      <ul className="divide-y divide-ops-line">
        {sheet.output.slice(0, 12).map((o) => (
          <li key={o.id} className="flex items-center justify-between gap-2 py-2 text-sm">
            <div className="min-w-0">
              <div className="truncate font-medium">{o.worker_code ? <bdi>{o.worker_code}</bdi> : `👥 ${o.team_label ?? ''}`} · {t(`ops.grades.${o.grade}`)} · <bdi>{o.pack_code}</bdi></div>
              <div className="text-xs text-ops-muted">{fmt.time(o.created_at)}{o.order_code && <> · <bdi>{o.order_code}</bdi></>}{!o.conforming && <> · {t('ops.shift.nonConformingShort')}</>}</div>
            </div>
            <div className="text-end">
              <div className="font-semibold"><Num value={o.boxes} unit="boxes" digits={0} /></div>
              <div className="text-xs text-ops-muted"><Num value={o.kg} unit="kg" digits={1} /></div>
            </div>
            {canFix && <button type="button" className={btn} onClick={() => void voidRow(o.id)} aria-label={t('ops.shift.voidEntry')}>✕</button>}
          </li>
        ))}
      </ul>
    </>
  );
}

function WorkersTab({ sheet }: { sheet: Sheet }) {
  const { t, i18n } = useTranslation();
  const fmt = useFmt();
  const inv = useInvalidateOps();
  const workers = useWorkers();
  const kinds = useTaskKinds();
  const [pick, setPick] = useState<string[]>([]);
  const [task, setTask] = useState('');
  const [label, setLabel] = useState('');
  const [state, setState] = useState<SaveState>({ kind: 'idle' });
  const [requestId, setRequestId] = useState(newRequestId);
  const busy = new Set(sheet.open.map((o) => o.worker_id));
  const free = (workers.data ?? []).filter((w) => !busy.has(w.id));
  const kind = kinds.data?.find((k) => k.id === task);
  const disabled = !sheet.line_shift.can_record || !!sheet.line_shift.submitted_at;
  useEffect(() => { if (!task && kinds.data?.[0]) setTask(kinds.data[0].id); }, [kinds.data, task]);

  const run = async (fn: () => Promise<unknown>, done?: () => void) => {
    setState({ kind: 'pending' });
    try { await fn(); setState({ kind: 'saved', at: new Date().toISOString() }); done?.(); setRequestId(newRequestId()); void inv(); }
    catch (e) { setState({ kind: 'failed', message: opsErrorMessage(t, e) }); }
  };
  const start = () => run(() => kind?.is_shared
    ? rpc('ph_team_start', { p_line_shift: sheet.line_shift.id, p_task_kind: task, p_workers: pick, p_label: label || null, p_request_id: requestId })
    : rpc('ph_labour_start', { p_line_shift: sheet.line_shift.id, p_workers: pick, p_task_kind: task, p_request_id: requestId }), () => setPick([]));

  return (
    <div className="space-y-3 pb-6">
      <Card title={t('ops.shift.onLineNow')} action={<Pill tone="info">{sheet.open.length}</Pill>}>
        {sheet.open.length === 0 ? <EmptyState>{t('ops.shift.nobodyWorking')}</EmptyState> : (
          <ul className="divide-y divide-ops-line">
            {sheet.open.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <div className="min-w-0">
                  <div className="font-medium"><bdi>{o.worker_code}</bdi> · {o.worker_name}</div>
                  <div className="text-xs text-ops-muted">{localName(i18n.language, o.task_ar, o.task_en)} · {t('ops.shift.since', { time: fmt.time(o.started_at) })}
                    {o.team_session_id && <> · 👥</>}</div>
                </div>
                {!disabled && (
                  <div className="flex gap-2">
                    <button type="button" className={btn} onClick={() => void run(() => rpc('ph_labour_end', { p_interval: o.id }))}>{t('ops.shift.end')}</button>
                    {!o.team_session_id && kinds.data?.filter((k) => !k.is_shared && k.code !== o.task_code).slice(0, 1).map((k) => (
                      <button key={k.id} type="button" className={btn}
                        onClick={() => void run(() => rpc('ph_labour_move', { p_interval: o.id, p_to_line_shift: sheet.line_shift.id, p_task_kind: k.id }))}>
                        → {localName(i18n.language, k.name_ar, k.name_en)}
                      </button>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {sheet.teams.filter((tm) => !tm.ended_at).map((tm) => (
        <Card key={tm.id} title={`👥 ${tm.label ?? tm.task_code}`} action={<Pill tone="info">{t('ops.shift.members', { n: tm.members })}</Pill>}>
          <p className="mb-2 text-xs text-ops-muted">{t('ops.shift.teamRule')}</p>
          <TeamJoin sheet={sheet} teamId={tm.id} free={free.map((w) => ({ id: w.id, label: `${w.code} · ${localName(i18n.language, w.full_name, w.full_name_en)}` }))}
            onRun={run} disabled={disabled} />
        </Card>
      ))}

      {!disabled && (
        <Card title={t('ops.shift.startWork')}>
          <label className="mb-2 block text-sm font-medium">{t('ops.shift.task')}
            <select className={field} value={task} onChange={(e) => setTask(e.target.value)}>
              {kinds.data?.map((k) => <option key={k.id} value={k.id}>{localName(i18n.language, k.name_ar, k.name_en)}{k.is_shared ? ` (${t('ops.shift.shared')})` : ''}</option>)}
            </select>
          </label>
          {kind?.is_shared && (
            <label className="mb-2 block text-sm font-medium">{t('ops.shift.teamLabel')}
              <input className={field} value={label} onChange={(e) => setLabel(e.target.value)} />
            </label>
          )}
          <fieldset>
            <legend className="text-sm font-medium">{t('ops.shift.pickWorkers', { n: pick.length })}</legend>
            <div className="mt-1 grid max-h-72 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2">
              {free.map((w) => (
                <label key={w.id} className="flex min-h-[44px] items-center gap-2 rounded-ops-sm border border-ops-line px-2 text-sm">
                  <input type="checkbox" className="h-5 w-5" checked={pick.includes(w.id)}
                    onChange={(e) => setPick(e.target.checked ? [...pick, w.id] : pick.filter((x) => x !== w.id))} />
                  <bdi>{w.code}</bdi> · {localName(i18n.language, w.full_name, w.full_name_en)}
                </label>
              ))}
            </div>
          </fieldset>
          <button type="button" className={`${btnPrimary} mt-3 w-full`} disabled={pick.length === 0 || !task || state.kind === 'pending'} onClick={() => void start()}>
            {kind?.is_shared ? t('ops.shift.startTeam', { n: pick.length }) : t('ops.shift.startWorkers', { n: pick.length })}
          </button>
        </Card>
      )}
      <SaveStatus state={state} />
    </div>
  );
}

function TeamJoin({ sheet, teamId, free, onRun, disabled }: {
  sheet: Sheet; teamId: string; free: { id: string; label: string }[]; disabled: boolean;
  onRun: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [w, setW] = useState('');
  const members = sheet.open.filter((o) => o.team_session_id === teamId);
  if (disabled) return null;
  return (
    <div className="space-y-2">
      <ul className="text-sm">{members.map((m) => (
        <li key={m.id} className="flex items-center justify-between gap-2 py-1"><span><bdi>{m.worker_code}</bdi> · {m.worker_name}</span>
          <button type="button" className={btn} onClick={() => void onRun(() => rpc('ph_labour_end', { p_interval: m.id, p_reason: 'left team' }))}>{t('ops.shift.leave')}</button></li>
      ))}</ul>
      <div className="flex gap-2">
        <select className={field} value={w} onChange={(e) => setW(e.target.value)} aria-label={t('ops.shift.join')}>
          <option value="">{t('ops.shift.choose')}</option>
          {free.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
        </select>
        <button type="button" className={btn} disabled={!w}
          onClick={() => void onRun(() => rpc('ph_labour_start', { p_line_shift: sheet.line_shift.id, p_workers: [w], p_task_kind: null, p_team_session: teamId }))}>
          {t('ops.shift.join')}
        </button>
      </div>
      <button type="button" className={btn} onClick={() => void onRun(() => rpc('ph_team_end', { p_team: teamId }))}>{t('ops.shift.endTeam')}</button>
    </div>
  );
}

function LineTab({ sheet }: { sheet: Sheet }) {
  const { t } = useTranslation();
  const inv = useInvalidateOps();
  const packs = usePackFormats();
  const orders = useOpenOrders();
  const [ready, setReady] = useState<Record<string, string>>(() => sheet.line_shift.readiness ?? {});
  const [fp, setFp] = useState({ packId: '', orderId: '', kg: '' });
  const [stop, setStop] = useState('');
  const [issue, setIssue] = useState({ kind: 'fault', text: '' });
  const [rec, setRec] = useState({ full: '', partial: '' });
  const [state, setState] = useState<SaveState>({ kind: 'idle' });
  const disabled = !sheet.line_shift.can_record || !!sheet.line_shift.submitted_at;
  const run = async (fn: () => Promise<unknown>, done?: () => void) => {
    setState({ kind: 'pending' });
    try { await fn(); setState({ kind: 'saved', at: new Date().toISOString() }); done?.(); void inv(); }
    catch (e) { setState({ kind: 'failed', message: opsErrorMessage(t, e) }); }
  };
  return (
    <div className="space-y-3 pb-6">
      <SaveStatus state={state} />
      <Card title={t('ops.shift.readiness')} action={sheet.line_shift.readiness_at ? <Pill tone="good">{t('ops.shift.readinessDone')}</Pill> : <Pill tone="warn">{t('ops.shift.readinessDue')}</Pill>}>
        <p className="mb-2 text-xs text-ops-muted">{t('ops.shift.readinessSource')}</p>
        {READINESS.map((k) => (
          <fieldset key={k} className="mb-2 flex flex-wrap items-center justify-between gap-2 border-b border-ops-line pb-2">
            <legend className="sr-only">{t(`ops.readiness.${k}`)}</legend>
            <span className="min-w-0 flex-1 text-sm">{t(`ops.readiness.${k}`)}</span>
            <div className="flex gap-1">
              {(['ok', 'no'] as const).map((v) => (
                <button key={v} type="button" aria-pressed={ready[k] === v} disabled={disabled} onClick={() => setReady({ ...ready, [k]: v })}
                  className={`min-h-[44px] min-w-[64px] rounded-ops-sm border text-sm font-semibold ${ready[k] === v ? (v === 'ok' ? 'border-ops-green bg-ops-greenbg text-ops-green' : 'border-ops-red bg-ops-redbg text-ops-red') : 'border-ops-line'}`}>
                  {v === 'ok' ? `✓ ${t('ops.yes')}` : `✕ ${t('ops.no')}`}
                </button>
              ))}
            </div>
          </fieldset>
        ))}
        <button type="button" className={btnPrimary} disabled={disabled || READINESS.some((k) => !ready[k])}
          onClick={() => void run(() => rpc('ph_record_readiness', { p_line_shift: sheet.line_shift.id, p_items: ready }))}>{t('ops.shift.saveReadiness')}</button>
      </Card>

      <Card title={t('ops.shift.firstPack')}>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <select className={field} value={fp.packId} onChange={(e) => setFp({ ...fp, packId: e.target.value })} aria-label={t('ops.shift.pack')}>
            <option value="">{t('ops.shift.pack')}</option>
            {packs.data?.map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}
          </select>
          <select className={field} value={fp.orderId} onChange={(e) => setFp({ ...fp, orderId: e.target.value })} aria-label={t('ops.shift.order')}>
            <option value="">{t('ops.shift.noOrder')}</option>
            {orders.data?.map((o) => <option key={o.id} value={o.id}>{o.code}</option>)}
          </select>
          <input className={`${field} ops-num`} inputMode="decimal" placeholder={t('ops.shift.measuredKg')} aria-label={t('ops.shift.measuredKg')}
            value={fp.kg} onChange={(e) => setFp({ ...fp, kg: e.target.value.replace(',', '.') })} />
        </div>
        <button type="button" className={`${btn} mt-2`} disabled={disabled || !fp.packId || !fp.kg}
          onClick={() => void run(() => rpc('ph_first_pack_check', { p: { line_shift_id: sheet.line_shift.id, pack_format_id: fp.packId, order_line_id: fp.orderId || null,
            measured_kg: Number(fp.kg), machine_setting_ok: true }, p_request_id: newRequestId() }), () => setFp({ packId: '', orderId: '', kg: '' }))}>
          {t('ops.shift.saveFirstPack')}
        </button>
      </Card>

      <Card title={t('ops.shift.reportStop')}>
        <textarea className={`${field} min-h-[88px] py-2`} value={stop} onChange={(e) => setStop(e.target.value)} placeholder={t('ops.shift.observedFault')} aria-label={t('ops.shift.observedFault')} />
        <button type="button" className={`${btn} mt-2 border-ops-red text-ops-red`} disabled={!stop.trim()}
          onClick={() => void run(() => rpc('ph_report_stop', { p: { line_ids: [sheet.line_shift.line_id], observed_fault: stop }, p_request_id: newRequestId() }), () => setStop(''))}>
          ■ {t('ops.shift.stopNow')}
        </button>
      </Card>

      <Card title={t('ops.shift.reportIssue')}>
        <select className={field} value={issue.kind} onChange={(e) => setIssue({ ...issue, kind: e.target.value })} aria-label={t('ops.shift.issueKind')}>
          {['fault', 'weight_discrepancy', 'packing_error', 'worker_issue', 'shortage', 'waste_collection', 'other'].map((k) => <option key={k} value={k}>{t(`ops.issueKind.${k}`)}</option>)}
        </select>
        <textarea className={`${field} mt-2 min-h-[72px] py-2`} value={issue.text} onChange={(e) => setIssue({ ...issue, text: e.target.value })} aria-label={t('ops.shift.issueText')} />
        <button type="button" className={`${btn} mt-2`} disabled={!issue.text.trim()}
          onClick={() => void run(() => rpc('ph_report_issue', { p: { line_shift_id: sheet.line_shift.id, kind: issue.kind, description: issue.text }, p_request_id: newRequestId() }),
            () => setIssue({ kind: 'fault', text: '' }))}>{t('ops.shift.sendToEngineer')}</button>
      </Card>

      <Card title={t('ops.shift.submitSheet')}>
        <p className="mb-2 text-sm text-ops-muted">{t('ops.shift.submitHelp', { boxes: sheet.totals.boxes })}</p>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-sm">{t('ops.shift.fullPallets')}<input className={`${field} ops-num`} inputMode="numeric" value={rec.full} onChange={(e) => setRec({ ...rec, full: e.target.value.replace(/[^0-9]/g, '') })} /></label>
          <label className="text-sm">{t('ops.shift.partialPallets')}<input className={`${field} ops-num`} inputMode="numeric" value={rec.partial} onChange={(e) => setRec({ ...rec, partial: e.target.value.replace(/[^0-9]/g, '') })} /></label>
        </div>
        <button type="button" className={`${btnPrimary} mt-3 w-full`} disabled={!sheet.line_shift.can_submit || !!sheet.line_shift.submitted_at}
          onClick={() => void run(() => rpc('ph_submit_line_shift', { p_line_shift: sheet.line_shift.id,
            p_reconciliation: { full_pallets: rec.full === '' ? null : Number(rec.full), partial_pallets: rec.partial === '' ? null : Number(rec.partial) } }))}>
          {sheet.line_shift.submitted_at ? t('ops.lineStatus.submitted') : t('ops.shift.submit')}
        </button>
      </Card>
    </div>
  );
}
