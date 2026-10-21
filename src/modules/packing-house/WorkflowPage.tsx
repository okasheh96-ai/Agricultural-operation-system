import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { QueryState } from '@/core/components/QueryState';
import {
  localizedName, useArrivals, useDecisions, useFgChanges, useFgPallets, useJobCards, useMyPhPermissions, useOrders, usePallets, useStageCounts,
  useWasteBoard, type PalletRow,
} from './api';
import { CreateArrivalForm, PrecoolScanBar } from './forms';
import { HoldsList } from './holds';
import { CreateOrderLineForm, OrderPanel } from './orders';
import { ArrivalPanel, PalletPanel } from './panels';
import { CreateJobCardForm, FgPalletPanel, JobCardPanel } from './production';
import { FgChangePanel } from './splitmerge';
import { STAGES, type StageKey } from './stages';
import { ActionPanel, btnCls, inputCls, primaryBtnCls } from './ui';
import { CreateWasteForm, WastePanel } from './waste';

/**
 * Packing-house workflow dashboard (the agreed AutoScore-style layout): the stage bar is the primary navigation; each tab
 * shows a live count from the database and an attention count; below it, wide record panels with their responsibility
 * strips. Unbuilt stages stay in the bar, labelled with their milestone, without invented counts.
 */
export default function WorkflowPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const stage = (params.get('stage') as StageKey | null) ?? 'arrivals';
  const def = STAGES.find((s) => s.key === stage) ?? STAGES.find((s) => s.key === 'arrivals') as (typeof STAGES)[number];
  const counts = useStageCounts();
  const pallets = usePallets();
  const arrivals = useArrivals();
  const perms = useMyPhPermissions();
  const decisions = useDecisions();
  const waste = useWasteBoard();
  const jobCards = useJobCards();
  const fgPallets = useFgPallets();
  const orders = useOrders();
  const fgChanges = useFgChanges();
  const [creating, setCreating] = useState(false);
  const [creatingJc, setCreatingJc] = useState(false);
  const [creatingOrder, setCreatingOrder] = useState(false);
  const [creatingWaste, setCreatingWaste] = useState(false);
  const [search, setSearch] = useState('');
  const [crop, setCrop] = useState('');
  const [source, setSource] = useState('');
  const [date, setDate] = useState('');
  const [attentionOnly, setAttentionOnly] = useState(false);

  const count = (k: string) => counts.data?.find((c) => c.stage === k);
  const select = (k: StageKey) => { const next = new URLSearchParams(params); next.set('stage', k); setParams(next); };
  const blocking = (decisions.data ?? []).filter((d) => d.priority === 'critical' && d.decision_state !== 'decided');
  const demoAssumptions = (decisions.data ?? []).filter((d) => d.decision_state === 'demo_assumption').length;

  const all = useMemo(() => pallets.data ?? [], [pallets.data]);
  const crops = [...new Map(all.map((p) => [p.crop_code, p])).values()];
  const sources = [...new Map(all.map((p) => [p.source_code, p])).values()];
  const matches = (p: PalletRow) => (!crop || p.crop_code === crop) && (!source || p.source_code === source)
    && (!date || p.received_at.slice(0, 10) === date)
    && (!attentionOnly || p.dwell_exceeded || p.grading_overdue || ['qa_rejected', 'on_hold', 'arrival_rejected'].includes(p.status));
  const rows = all.filter((p) => p.stage === stage && matches(p));
  const openArrivals = (arrivals.data ?? []).filter((a) => ['draft', 'vehicle_hold', 'submitted'].includes(a.status)
    && (!source || a.source_code === source) && (!date || a.arrived_at.slice(0, 10) === date));
  // Job Cards and finished pallets per tab: the same status sets ph_stage_counts counts.
  const jcStatuses = stage === 'qc2' ? ['in_progress'] : ['draft', 'planned', 'ready', 'line_check_failed', 'in_progress', 'paused', 'completed', 'reconciled'];
  const jcRows = (jobCards.data ?? []).filter((j) => jcStatuses.includes(j.status) && (!crop || j.crop_code === crop) && (!date || j.planned_date === date)
    && (!attentionOnly || ['line_check_failed', 'paused'].includes(j.status) || j.qc2_result === 'fail'));
  const fgStatuses = stage === 'fg_storage' ? ['in_storage'] : ['created', 'qc_approved'];
  const fgRows = (fgPallets.data ?? []).filter((f) => fgStatuses.includes(f.status) && (!crop || f.crop_code === crop) && (!date || f.created_at.slice(0, 10) === date)
    && (!attentionOnly || f.calibration_flag || f.label_print_count === 0 || (!!f.qc_valid_until && Date.parse(f.qc_valid_until) < Date.now())));

  const orderRows = (orders.data ?? []).filter((o) => ['pending_acceptance', 'accepted'].includes(o.status) && (!crop || o.crop_code === crop)
    && (!date || o.required_date === date) && (!attentionOnly || o.status === 'pending_acceptance' || (o.shortage_in_window === false)));
  const wasteRows = (waste.data ?? []).filter((w) => !['disposed', 'returned_to_line'].includes(w.status) && (!crop || w.crop_code === crop)
    && (!date || w.created_at.slice(0, 10) === date) && (!attentionOnly || w.top_mgmt_overdue || w.status === 'weighed'));
  const openChanges = (fgChanges.data ?? []).filter((c) => c.status === 'requested');

  function find(e: FormEvent) {
    e.preventDefault();
    const q = search.trim().toUpperCase();
    const hit = all.find((p) => p.code.toUpperCase() === q) ?? all.find((p) => p.code.toUpperCase().includes(q));
    const jc = (jobCards.data ?? []).find((j) => j.code.toUpperCase() === q);
    const fg = (fgPallets.data ?? []).find((f) => f.code.toUpperCase() === q);
    const wr = (waste.data ?? []).find((w) => w.code.toUpperCase() === q);
    if (jc) navigate(`/office/packing-house/job-cards/${jc.id}`);
    else if (wr) navigate(`/office/packing-house/waste/${wr.id}`);
    else if (fg) navigate(`/office/packing-house/fg-pallets/${fg.id}`);
    else if (hit) navigate(`/office/packing-house/pallets/${hit.id}`);
    else if (q) navigate(`/office/packing-house/trace?ref=${encodeURIComponent(search.trim())}`);
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">{t('ph.title')}</h1>
          <p className="text-sm text-stone-600">{t('ph.subtitle')}</p>
        </div>
        <form onSubmit={find} className="flex min-w-0 flex-1 items-center gap-2 sm:max-w-md" role="search">
          <input aria-label={t('ph.search')} placeholder={t('ph.search')} dir="ltr" className={`${inputCls} font-mono`} value={search} onChange={(e) => setSearch(e.target.value)} />
          <button type="submit" className={btnCls}>🔍</button>
        </form>
        {perms.data?.has('arrival.create') && (
          <button type="button" className={primaryBtnCls} onClick={() => { select('arrivals'); setCreating(true); }}>＋ {t('ph.newArrival')}</button>
        )}
      </div>

      {blocking.length > 0 && (
        <Link to="/office/packing-house/decisions" className="flex flex-wrap items-center gap-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          <span aria-hidden="true">⚖</span>
          <span>{t('ph.criticalOpen', { n: blocking.length })}</span>
          {demoAssumptions > 0 && <span className="rounded bg-yellow-300 px-2 font-semibold">{t('ph.demoAssumptions', { n: demoAssumptions })}</span>}
          <span className="underline">{t('ph.seeDecisions')}</span>
        </Link>
      )}

      <nav aria-label={t('ph.stageBar')} className="rounded-lg border border-stone-200 bg-white">
        <ul className="flex overflow-x-auto">
          {STAGES.map((s) => {
            const c = count(s.key);
            const active = s.key === stage;
            return (
              <li key={s.key} className="shrink-0 border-e border-stone-100 last:border-e-0">
                <button type="button" onClick={() => select(s.key)} aria-current={active ? 'page' : undefined}
                  className={`flex min-h-[3.5rem] flex-col items-start justify-center gap-0.5 px-3 py-1.5 text-start ${active
                    ? 'border-b-4 border-brand bg-brand-light' : 'border-b-4 border-transparent hover:bg-stone-50'} ${s.built ? '' : 'text-stone-400'}`}>
                  <span className="flex items-center gap-1.5 whitespace-nowrap text-sm font-semibold">
                    {t(`ph.stages.${s.key}`)}
                    {s.built && (
                      <span className={`rounded px-1.5 text-xs font-bold ${active ? 'bg-brand text-white' : 'bg-stone-700 text-white'}`}>
                        <bdi>{s.key === 'arrivals' ? openArrivals.length : (c?.total ?? 0)}</bdi>
                      </span>
                    )}
                    {(c?.attention ?? 0) > 0 && (
                      <span className="rounded bg-red-600 px-1.5 text-xs font-bold text-white" title={t('ph.attention')}>! <bdi>{c?.attention}</bdi></span>
                    )}
                  </span>
                  <span className="whitespace-nowrap text-[11px] text-stone-500">{s.spec}{s.gate ? ` · ${s.gate}` : ''}{s.built ? '' : ` · ${t('labels.laterPhase')}`}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-sm"><span>{t('ph.filters.date')}</span>
          <input type="date" dir="ltr" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="flex flex-col gap-1 text-sm"><span>{t('ph.filters.crop')}</span>
          <select className={inputCls} value={crop} onChange={(e) => setCrop(e.target.value)}>
            <option value="">{t('ph.filters.all')}</option>
            {crops.map((p) => <option key={p.crop_code} value={p.crop_code}>{localizedName(i18n.language, p.crop_name_ar, p.crop_name_en)}</option>)}
          </select></label>
        <label className="flex flex-col gap-1 text-sm"><span>{t('ph.filters.source')}</span>
          <select className={inputCls} value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">{t('ph.filters.all')}</option>
            {sources.map((p) => <option key={p.source_code} value={p.source_code}>{p.source_code}</option>)}
          </select></label>
        <label className="flex min-h-touch items-center gap-2 text-sm">
          <input type="checkbox" checked={attentionOnly} onChange={(e) => setAttentionOnly(e.target.checked)} /> {t('ph.filters.attention')}</label>
        <button type="button" className={btnCls} onClick={() => { setCrop(''); setSource(''); setDate(''); setAttentionOnly(false); }}>{t('ph.filters.clear')}</button>
        <span className="ms-auto text-xs text-stone-500">{t('ph.owner', { roles: def.owner })}</span>
      </div>

      {!def.built ? (
        <section className="rounded-lg border border-dashed border-stone-300 bg-stone-50 p-4">
          <h2 className="font-semibold">{t(`ph.stages.${def.key}`)} · {def.spec}</h2>
          <p className="mt-1 text-stone-700">{t('ph.laterStage', { milestone: def.milestone })}</p>
          <p className="mt-1 text-sm text-stone-600">{t(`ph.laterWhy.${def.key}`)}</p>
        </section>
      ) : def.kind === 'orders' ? (
        <QueryState isLoading={orders.isLoading} error={orders.error} isEmpty={false} onRetry={() => void orders.refetch()}>
          <div className="flex flex-wrap items-center gap-2">
            {perms.data?.has('customer_order.create') && !creatingOrder && (
              <button type="button" className={primaryBtnCls} onClick={() => setCreatingOrder(true)}>＋ {t('ph.order.new')}</button>
            )}
            <Link to="/office/packing-house/plan" className={btnCls}>📅 {t('ph.plan.title')}</Link>
          </div>
          {creatingOrder && (
            <ActionPanel title={t('ph.order.new')} onClose={() => setCreatingOrder(false)}>
              <CreateOrderLineForm onDone={() => setCreatingOrder(false)} onCancel={() => setCreatingOrder(false)} />
            </ActionPanel>
          )}
          {orderRows.length === 0 && <p className="p-4 text-stone-600">{t('ph.empty.orders')}</p>}
          <div className="flex flex-col gap-3">
            {orderRows.map((o) => <OrderPanel key={o.id} o={o} perms={perms.data} />)}
          </div>
        </QueryState>
      ) : def.kind === 'arrivals' ? (
        <QueryState isLoading={arrivals.isLoading} error={arrivals.error} isEmpty={false} onRetry={() => void arrivals.refetch()}>
          {creating && (
            <ActionPanel title={t('ph.newArrival')} onClose={() => setCreating(false)}>
              <CreateArrivalForm onDone={() => setCreating(false)} onCancel={() => setCreating(false)} />
            </ActionPanel>
          )}
          {openArrivals.length === 0 && <p className="p-4 text-stone-600">{t('ph.empty.arrivals')}</p>}
          <div className="flex flex-col gap-3">
            {openArrivals.map((a) => <ArrivalPanel key={a.id} a={a} pallets={all} perms={perms.data} />)}
          </div>
        </QueryState>
      ) : def.kind === 'jobcards' ? (
        <QueryState isLoading={jobCards.isLoading} error={jobCards.error} isEmpty={false} onRetry={() => void jobCards.refetch()}>
          {stage === 'production' && perms.data?.has('job_card.create') && !creatingJc && (
            <div><button type="button" className={primaryBtnCls} onClick={() => setCreatingJc(true)}>＋ {t('ph.jc.new')}</button></div>
          )}
          {stage === 'production' && creatingJc && (
            <ActionPanel title={t('ph.jc.new')} onClose={() => setCreatingJc(false)}>
              <CreateJobCardForm onDone={(id) => { setCreatingJc(false); navigate(`/office/packing-house/job-cards/${id}`); }} onCancel={() => setCreatingJc(false)} />
            </ActionPanel>
          )}
          {stage === 'qc2' && <p className="rounded border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-950">{t('ph.jc.qc2Queue')}</p>}
          {jcRows.length === 0 && <p className="p-4 text-stone-600">{t('ph.empty.jobCards')}</p>}
          <div className="flex flex-col gap-3">
            {jcRows.map((j) => <JobCardPanel key={j.id} j={j} perms={perms.data} />)}
          </div>
        </QueryState>
      ) : def.kind === 'fg' ? (
        <QueryState isLoading={fgPallets.isLoading} error={fgPallets.error} isEmpty={false} onRetry={() => void fgPallets.refetch()}>
          {stage === 'fg_storage' && openChanges.length > 0 && (
            <section className="flex flex-col gap-2" aria-label={t('ph.fgChange.open')}>
              <h2 className="font-semibold">{t('ph.fgChange.open')}</h2>
              {openChanges.map((c) => <FgChangePanel key={c.id} c={c} perms={perms.data} />)}
            </section>
          )}
          {fgRows.length === 0 && <p className="p-4 text-stone-600">{t(stage === 'fg_storage' ? 'ph.empty.fgStorage' : 'ph.empty.fgPallets')}</p>}
          <div className="flex flex-col gap-3">
            {fgRows.map((f) => <FgPalletPanel key={f.id} f={f} perms={perms.data} />)}
          </div>
        </QueryState>
      ) : def.kind === 'waste' ? (
        <QueryState isLoading={waste.isLoading} error={waste.error} isEmpty={false} onRetry={() => void waste.refetch()}>
          {perms.data?.has('waste.create') && !creatingWaste && (
            <div><button type="button" className={primaryBtnCls} onClick={() => setCreatingWaste(true)}>＋ {t('ph.waste.new')}</button></div>
          )}
          {creatingWaste && (
            <ActionPanel title={t('ph.waste.new')} onClose={() => setCreatingWaste(false)}>
              <CreateWasteForm onDone={() => setCreatingWaste(false)} onCancel={() => setCreatingWaste(false)} />
            </ActionPanel>
          )}
          <p className="rounded border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-950">{t('ph.wasteNote')}</p>
          {wasteRows.length === 0 && <p className="p-4 text-stone-600">{t('ph.empty.waste')}</p>}
          <div className="flex flex-col gap-3">
            {wasteRows.map((w) => <WastePanel key={w.id} w={w} perms={perms.data} />)}
          </div>
        </QueryState>
      ) : (
        <QueryState isLoading={pallets.isLoading} error={pallets.error} isEmpty={false} onRetry={() => void pallets.refetch()}>
          {stage === 'precooling' && perms.data?.has('precool.record') && <PrecoolScanBar />}
          {stage === 'exceptions' && (
            <section className="flex flex-col gap-2">
              <h2 className="font-semibold">{t('ph.holds.title')}</h2>
              <HoldsList perms={perms.data} />
              <Link to="/office/packing-house/exceptions" className="text-sm underline">{t('ph.exceptionBoardLink')}</Link>
              <h2 className="mt-2 font-semibold">{t('ph.exceptionPallets')}</h2>
            </section>
          )}
          {rows.length === 0 && <p className="p-4 text-stone-600">{t('ph.empty.stage')}</p>}
          <div className="flex flex-col gap-3">
            {rows.map((p) => <PalletPanel key={p.id} p={p} all={all} arrivals={arrivals.data ?? []} perms={perms.data} />)}
          </div>
        </QueryState>
      )}
    </section>
  );
}
