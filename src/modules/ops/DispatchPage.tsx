import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { QueryState } from '@/core/components/QueryState';
import { requireSupabase } from '@/core/supabase';
import { newRequestId, opsErrorMessage, rpc, useCustomers, useInvalidateOps, useOpenOrders } from './api';
import { btn, btnPrimary, Card, EmptyState, field, Num, PageTitle, Pill, SaveStatus, useFmt, type SaveState, type Tone } from './ui';

interface LoadPallet { fg_pallet_id: string; code: string; status: string; grade: string; net_kg: string; boxes: number; picked_at: string | null;
  loaded_at: string | null; product_temp_c: string | null; fifo_reason: string | null; removed_at: string | null; removed_reason: string | null }
interface LoadRow { id: string; code: string; status: string; customer: string; destination: string | null; planned_loading_at: string | null;
  vehicle_plate: string | null; vehicle_temp_c: string | null; outside_window: boolean | null; seal_number: string | null; departed_at: string | null;
  order_lines: { id: string; code: string; grade: string; quantity: string }[]; pallets: LoadPallet[]; allocated_kg: string;
  packing_list: { total_kg: number; total_boxes: number } | null; created_at: string }
interface Fifo { fg_pallet_id: string; code: string; net_kg: string; box_count: number; location_code: string | null; age_hours: string | null; qc_age_hours: string | null; rank: number }

const LOAD_TONE: Record<string, Tone> = { planned: 'neutral', vehicle_arrived: 'info', waiting_for_temp: 'warn', vehicle_rejected: 'bad', loading: 'info',
  sealed: 'info', packing_list_final: 'info', departed: 'good', cancelled: 'neutral' };

function useLoads() {
  return useQuery({
    queryKey: ['ops', 'loads'],
    queryFn: async () => {
      const { data, error } = await requireSupabase().from('ph_load_board').select('*').order('created_at', { ascending: false }).limit(50);
      if (error) throw error;
      return (data ?? []) as LoadRow[];
    },
  });
}

/** Dispatch (ST-13 / ST-14, SM-LD): create a load from accepted order lines, allocate FIFO pallets, check the vehicle (G8),
 *  scan pallets on, seal, finalise the packing list and depart. Held stock never reaches a load. */
export default function DispatchPage() {
  const { t } = useTranslation();
  const loads = useLoads();
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div>
      <PageTitle title={t('ops.dispatch.title')} sub={t('ops.dispatch.sub')} />
      <NewLoad onCreated={setOpen} />
      <QueryState isLoading={loads.isLoading} error={loads.error} isEmpty={(loads.data?.length ?? 0) === 0} emptyText={t('ops.dispatch.none')} onRetry={() => void loads.refetch()}>
        <ul className="mt-4 space-y-3">
          {loads.data?.map((l) => <LoadCard key={l.id} load={l} open={open === l.id} onToggle={() => setOpen(open === l.id ? null : l.id)} />)}
        </ul>
      </QueryState>
    </div>
  );
}

function NewLoad({ onCreated }: { onCreated: (id: string) => void }) {
  const { t } = useTranslation();
  const inv = useInvalidateOps();
  const customers = useCustomers();
  const orders = useOpenOrders();
  const [f, setF] = useState({ customer: '', destination: '', plate: '', lines: [] as string[] });
  const [state, setState] = useState<SaveState>({ kind: 'idle' });
  const [req, setReq] = useState(newRequestId);
  const create = async () => {
    setState({ kind: 'pending' });
    try {
      const r = await rpc<{ id: string; code: string }>('ph_create_load', { p: { customer_id: f.customer || null, customer_text: f.customer ? null : orders.data?.find((o) => o.id === f.lines[0])?.customer_name,
        destination: f.destination, vehicle_plate: f.plate, order_line_ids: f.lines }, p_request_id: req });
      setState({ kind: 'saved', at: new Date().toISOString(), text: r.code }); setReq(newRequestId()); setF({ customer: '', destination: '', plate: '', lines: [] });
      onCreated(r.id); void inv();
    } catch (e) { setState({ kind: 'failed', message: opsErrorMessage(t, e) }); }
  };
  return (
    <Card title={t('ops.dispatch.newLoad')}>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <label className="text-sm">{t('ops.filters.customer')}
          <select className={field} value={f.customer} onChange={(e) => setF({ ...f, customer: e.target.value })}>
            <option value="">{t('ops.dispatch.fromOrder')}</option>
            {customers.data?.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}
          </select></label>
        <label className="text-sm">{t('ops.dispatch.destination')}<input className={field} value={f.destination} onChange={(e) => setF({ ...f, destination: e.target.value })} /></label>
        <label className="text-sm">{t('ops.dispatch.plate')}<input className={field} dir="ltr" value={f.plate} onChange={(e) => setF({ ...f, plate: e.target.value })} /></label>
      </div>
      <fieldset className="mt-2"><legend className="text-sm font-medium">{t('ops.dispatch.orderLines')}</legend>
        <div className="mt-1 grid grid-cols-1 gap-1 sm:grid-cols-2">
          {orders.data?.map((o) => (
            <label key={o.id} className="flex min-h-[44px] items-center gap-2 rounded-ops-sm border border-ops-line px-2 text-sm">
              <input type="checkbox" className="h-5 w-5" checked={f.lines.includes(o.id)} onChange={(e) => setF({ ...f, lines: e.target.checked ? [...f.lines, o.id] : f.lines.filter((x) => x !== o.id) })} />
              <bdi>{o.code}</bdi> · <bdi>{o.customer_name}</bdi> · {t(`ops.grades.${o.grade}`)}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button type="button" className={btnPrimary} disabled={f.lines.length === 0 || state.kind === 'pending'} onClick={() => void create()}>{t('ops.dispatch.create')}</button>
        <SaveStatus state={state} onRetry={() => void create()} />
      </div>
    </Card>
  );
}

function LoadCard({ load, open, onToggle }: { load: LoadRow; open: boolean; onToggle: () => void }) {
  const { t } = useTranslation();
  const fmt = useFmt();
  const inv = useInvalidateOps();
  const [state, setState] = useState<SaveState>({ kind: 'idle' });
  const [scan, setScan] = useState('');
  const [seal, setSeal] = useState({ seal: '', logger: '' });
  const [check, setCheck] = useState({ clean: false, no_smell: false, no_contamination: false, lockable: false, temperature_ok: false, temp: '' });
  const run = async (fn: () => Promise<unknown>, after?: () => void) => {
    setState({ kind: 'pending' });
    try { await fn(); setState({ kind: 'saved', at: new Date().toISOString() }); after?.(); void inv(); }
    catch (e) { setState({ kind: 'failed', message: opsErrorMessage(t, e) }); }
  };
  const step = (s: string, p: Record<string, unknown> = {}) => run(() => rpc('ph_load_step', { p_load: load.id, p_step: s, p }));
  const active = load.pallets.filter((p) => !p.removed_at);
  return (
    <li className="ops-card p-4">
      <button type="button" className="flex w-full flex-wrap items-center justify-between gap-2 text-start" onClick={onToggle} aria-expanded={open}>
        <span className="font-semibold"><bdi>{load.code}</bdi> · <bdi>{load.customer}</bdi>{load.destination && <> · {load.destination}</>}</span>
        <span className="flex items-center gap-2"><Num value={load.allocated_kg} unit="kg" digits={0} /><Pill tone={LOAD_TONE[load.status] ?? 'neutral'}>{t(`ops.loadStatus.${load.status}`)}</Pill></span>
      </button>
      {open && (
        <div className="mt-3 space-y-3 border-t border-ops-line pt-3">
          <div className="text-sm text-ops-muted">{t('ops.dispatch.lines')}: {load.order_lines.map((o) => o.code).join('، ')} · {t('ops.dispatch.plate')}: <bdi>{load.vehicle_plate ?? '—'}</bdi>
            {load.outside_window && <> · <span className="text-ops-amber">! {t('ops.dispatch.outsideWindow')}</span></>}</div>
          {load.order_lines.map((o) => ['planned', 'vehicle_arrived', 'waiting_for_temp', 'loading'].includes(load.status) && (
            <Allocation key={o.id} loadId={load.id} orderLineId={o.id} orderCode={o.code} onRun={run} />
          ))}
          <div>
            <h3 className="mb-1 text-sm font-semibold">{t('ops.dispatch.pallets')} ({active.length})</h3>
            {load.pallets.length === 0 ? <EmptyState>{t('ops.dispatch.noPallets')}</EmptyState> : (
              <ul className="divide-y divide-ops-line text-sm">{load.pallets.map((p) => (
                <li key={p.fg_pallet_id} className={`flex flex-wrap items-center justify-between gap-2 py-1.5 ${p.removed_at ? 'opacity-60' : ''}`}>
                  <span><bdi className="font-medium">{p.code}</bdi> · {t(`ops.grades.${p.grade}`)} · <Num value={p.net_kg} unit="kg" digits={0} /> · <Num value={p.boxes} unit="boxes" digits={0} />
                    {p.removed_at && <> · {t('ops.dispatch.removed')}: {p.removed_reason}</>}</span>
                  <Pill tone={p.status === 'loaded' || p.status === 'dispatched' ? 'good' : p.status === 'reinspection_required' || p.status === 'on_hold' ? 'warn' : 'neutral'}>{t(`ph.status.ph_fg_pallet.${p.status}`, { defaultValue: p.status })}</Pill>
                </li>
              ))}</ul>
            )}
          </div>
          {['planned', 'vehicle_arrived', 'waiting_for_temp', 'loading'].includes(load.status) && (
            <div className="flex flex-wrap gap-2">
              <input className={`${field} max-w-xs`} dir="ltr" placeholder={t('ops.dispatch.scanPlaceholder')} aria-label={t('ops.dispatch.scan')} value={scan} onChange={(e) => setScan(e.target.value)} />
              <button type="button" className={btn} disabled={!scan.trim()} onClick={() => void run(() => rpc('ph_load_scan', { p_load: load.id, p_fg: scan.trim() }), () => setScan(''))}>{t('ops.dispatch.scan')}</button>
            </div>
          )}
          {load.status === 'planned' && <button type="button" className={btn} onClick={() => void step('arrive')}>{t('ops.dispatch.vehicleArrived')}</button>}
          {(load.status === 'vehicle_arrived' || load.status === 'waiting_for_temp') && (
            <fieldset className="rounded-ops-sm border border-ops-line p-3">
              <legend className="px-1 text-sm font-semibold">{t('ops.dispatch.vehicleCheck')}</legend>
              <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                {(['clean', 'no_smell', 'no_contamination', 'lockable', 'temperature_ok'] as const).map((k) => (
                  <label key={k} className="flex min-h-[44px] items-center gap-2 text-sm">
                    <input type="checkbox" className="h-5 w-5" checked={check[k]} onChange={(e) => setCheck({ ...check, [k]: e.target.checked })} />{t(`ops.dispatch.check.${k}`)}
                  </label>
                ))}
              </div>
              <input className={`${field} mt-2 max-w-[160px]`} inputMode="decimal" placeholder="°C" aria-label={t('ops.dispatch.vehicleTemp')} value={check.temp}
                onChange={(e) => setCheck({ ...check, temp: e.target.value.replace(',', '.') })} />
              <button type="button" className={`${btnPrimary} mt-2`} onClick={() => void step('inspect', { items: check, temp_c: check.temp || null })}>{t('ops.dispatch.recordCheck')}</button>
            </fieldset>
          )}
          {load.status === 'loading' && (
            <div className="flex flex-wrap gap-2">
              <input className={`${field} max-w-[200px]`} dir="ltr" placeholder={t('ops.dispatch.seal')} aria-label={t('ops.dispatch.seal')} value={seal.seal} onChange={(e) => setSeal({ ...seal, seal: e.target.value })} />
              <input className={`${field} max-w-[200px]`} dir="ltr" placeholder={t('ops.dispatch.logger')} aria-label={t('ops.dispatch.logger')} value={seal.logger} onChange={(e) => setSeal({ ...seal, logger: e.target.value })} />
              <button type="button" className={btnPrimary} onClick={() => void step('seal', { seal_number: seal.seal, logger_ids: seal.logger ? [seal.logger] : [] })}>{t('ops.dispatch.sealLoad')}</button>
            </div>
          )}
          {load.status === 'sealed' && <button type="button" className={btnPrimary} onClick={() => void step('finalise')}>{t('ops.dispatch.finalise')}</button>}
          {load.status === 'packing_list_final' && (
            <div className="space-y-2">
              <p className="text-sm">{t('ops.dispatch.packingList', { kg: load.packing_list?.total_kg ?? 0, boxes: load.packing_list?.total_boxes ?? 0 })}</p>
              <button type="button" className={btnPrimary} onClick={() => void step('depart')}>{t('ops.dispatch.depart')}</button>
            </div>
          )}
          {load.departed_at && <p className="text-sm text-ops-green">✓ {t('ops.dispatch.departedAt', { time: fmt.dateTime(load.departed_at) })} · {t('ops.dispatch.seal')}: <bdi>{load.seal_number}</bdi></p>}
          <SaveStatus state={state} />
        </div>
      )}
    </li>
  );
}

function Allocation({ loadId, orderLineId, orderCode, onRun }: { loadId: string; orderLineId: string; orderCode: string; onRun: (fn: () => Promise<unknown>) => Promise<void> }) {
  const { t } = useTranslation();
  const fifo = useQuery({ queryKey: ['ops', 'fifo', orderLineId], queryFn: () => rpc<Fifo[]>('ph_fifo_proposal', { p_order_line: orderLineId }) });
  return (
    <div className="rounded-ops-sm border border-ops-line p-3">
      <h3 className="mb-1 text-sm font-semibold">{t('ops.dispatch.fifoFor', { order: orderCode })}</h3>
      <p className="mb-2 text-xs text-ops-muted">{t('ops.dispatch.fifoHelp')}</p>
      {(fifo.data?.length ?? 0) === 0 ? <EmptyState>{t('ops.dispatch.noStock')}</EmptyState> : (
        <ul className="space-y-1 text-sm">{fifo.data?.slice(0, 8).map((p) => (
          <li key={p.fg_pallet_id} className="flex flex-wrap items-center justify-between gap-2">
            <span>#{p.rank} <bdi className="font-medium">{p.code}</bdi> · <Num value={p.net_kg} unit="kg" digits={0} /> · {p.location_code} · {t('ops.dispatch.age', { h: p.age_hours ?? '?' })}</span>
            <button type="button" className={btn} onClick={() => void onRun(async () => {
              const reason = p.rank > 1 ? window.prompt(t('ops.dispatch.fifoReason')) ?? '' : '';
              await rpc('ph_allocate_pallet', { p_load: loadId, p_fg: p.code, p_order_line: orderLineId, p_reason: reason || null });
            })}>{t('ops.dispatch.allocate')}</button>
          </li>
        ))}</ul>
      )}
    </div>
  );
}
