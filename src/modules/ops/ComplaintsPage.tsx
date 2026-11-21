import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { QueryState } from '@/core/components/QueryState';
import { requireSupabase } from '@/core/supabase';
import { newRequestId, opsErrorMessage, rpc, useCustomers, useInvalidateOps } from './api';
import { btn, btnPrimary, Card, field, PageTitle, Pill, SaveStatus, useFmt, type SaveState, type Tone } from './ui';

interface ComplaintRow { id: string; code: string; status: string; customer: string; received_at: string; late_flag: boolean; load_code: string | null;
  description: string; validity_note: string | null; investigation: string | null; root_cause: string | null; corrective_action: string | null; fg_pallets: string[] }
const TONE: Record<string, Tone> = { received: 'warn', investigating: 'info', confirmed: 'info', closed: 'good', invalid: 'neutral' };

/** Complaints (FR-TR-01/05): Sales records, QC/QA judge validity and investigate with the trace, PHM confirms the corrective action, QAM closes. */
export default function ComplaintsPage() {
  const { t } = useTranslation();
  const fmt = useFmt();
  const inv = useInvalidateOps();
  const customers = useCustomers();
  const list = useQuery({ queryKey: ['ops', 'complaints'], queryFn: async () => {
    const { data, error } = await requireSupabase().from('ph_complaint_board').select('*').order('received_at', { ascending: false }).limit(50);
    if (error) throw error;
    return (data ?? []) as ComplaintRow[];
  } });
  const [f, setF] = useState({ customer: '', load: '', text: '' });
  const [state, setState] = useState<SaveState>({ kind: 'idle' });
  const [req, setReq] = useState(newRequestId);
  const create = async () => {
    setState({ kind: 'pending' });
    try {
      await rpc('ph_create_complaint', { p: { customer_id: f.customer || null, customer_text: f.customer ? null : 'n/a', load: f.load || null, description: f.text }, p_request_id: req });
      setState({ kind: 'saved', at: new Date().toISOString() }); setF({ customer: '', load: '', text: '' }); setReq(newRequestId()); void inv();
    } catch (e) { setState({ kind: 'failed', message: opsErrorMessage(t, e) }); }
  };
  return (
    <div className="mx-auto max-w-5xl">
      <PageTitle title={t('ops.complaints.title')} sub={t('ops.complaints.sub')} />
      <Card title={t('ops.complaints.new')}>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <select className={field} value={f.customer} onChange={(e) => setF({ ...f, customer: e.target.value })} aria-label={t('ops.filters.customer')}>
            <option value="">{t('ops.filters.customer')}</option>{customers.data?.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}
          </select>
          <input className={field} dir="ltr" placeholder="LD-…" aria-label={t('ops.complaints.load')} value={f.load} onChange={(e) => setF({ ...f, load: e.target.value })} />
        </div>
        <textarea className={`${field} mt-2 min-h-[72px] py-2`} value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} aria-label={t('ops.complaints.description')} placeholder={t('ops.complaints.description')} />
        <div className="mt-2 flex flex-wrap items-center gap-3"><button type="button" className={btnPrimary} disabled={!f.text.trim() || !f.customer} onClick={() => void create()}>{t('ops.complaints.record')}</button><SaveStatus state={state} onRetry={() => void create()} /></div>
      </Card>
      <QueryState isLoading={list.isLoading} error={list.error} isEmpty={(list.data?.length ?? 0) === 0} emptyText={t('ops.complaints.none')}>
        <ul className="mt-4 space-y-3">{list.data?.map((c) => <ComplaintCard key={c.id} c={c} when={fmt.dateTime(c.received_at)} />)}</ul>
      </QueryState>
    </div>
  );
}

function ComplaintCard({ c, when }: { c: ComplaintRow; when: string }) {
  const { t } = useTranslation();
  const inv = useInvalidateOps();
  const [note, setNote] = useState('');
  const [state, setState] = useState<SaveState>({ kind: 'idle' });
  const step = async (s: string, p: Record<string, unknown>) => {
    setState({ kind: 'pending' });
    try { await rpc('ph_complaint_step', { p_complaint: c.id, p_step: s, p }); setState({ kind: 'saved', at: new Date().toISOString() }); setNote(''); void inv(); }
    catch (e) { setState({ kind: 'failed', message: opsErrorMessage(t, e) }); }
  };
  return (
    <li className="ops-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold"><bdi>{c.code}</bdi> · <bdi>{c.customer}</bdi>{c.load_code && <> · <bdi>{c.load_code}</bdi></>}</span>
        <Pill tone={TONE[c.status] ?? 'neutral'}>{t(`ops.complaintStatus.${c.status}`)}</Pill></div>
      <p className="text-xs text-ops-muted">{when}{c.late_flag && <> · <span className="text-ops-amber">! {t('ops.complaints.late')}</span></>}</p>
      <p className="my-1 text-sm">{c.description}</p>
      {c.root_cause && <p className="text-sm"><strong>{t('ops.complaints.rootCause')}:</strong> {c.root_cause}</p>}
      {c.corrective_action && <p className="text-sm"><strong>{t('ops.complaints.capa')}:</strong> {c.corrective_action}</p>}
      {c.status !== 'closed' && c.status !== 'invalid' && (
        <div className="mt-2 flex flex-wrap gap-2">
          <input className={`${field} flex-1`} value={note} onChange={(e) => setNote(e.target.value)} aria-label={t('ops.complaints.note')} placeholder={t('ops.complaints.note')} />
          {c.status === 'received' && <>
            <button type="button" className={btn} onClick={() => void step('valid', { note })}>{t('ops.complaints.valid')}</button>
            <button type="button" className={btn} disabled={!note.trim()} onClick={() => void step('invalid', { note })}>{t('ops.complaints.invalid')}</button></>}
          {c.status === 'investigating' && <>
            <button type="button" className={btn} onClick={() => void step('investigate', { investigation: note, root_cause: note })}>{t('ops.complaints.investigate')}</button>
            <button type="button" className={btnPrimary} disabled={!note.trim()} onClick={() => void step('confirm', { corrective_action: note })}>{t('ops.complaints.confirm')}</button></>}
          {c.status === 'confirmed' && <button type="button" className={btnPrimary} onClick={() => void step('close', { note })}>{t('ops.complaints.close')}</button>}
        </div>
      )}
      <div className="mt-1"><SaveStatus state={state} /></div>
    </li>
  );
}
