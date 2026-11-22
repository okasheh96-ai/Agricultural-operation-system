import { useState } from 'react';
import { api, navigate, useApi } from '../api';
import { t, useLang } from '../i18n';
import { ErrorBox, Field, Select, errText } from '../ui';
import type { Review } from '../../worker/review';

function nowHHMM() {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Amman', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
}

export function QuickUpdate({ date, onDone }: { date: string; onDone: () => void }) {
  useLang();
  const ref = useApi<{ ref: { kind: string; code: string; active: number }[]; units: string[] }>('/api/ref');
  const plan = useApi<{ versions: { status: string; data: { shift_start: string; jobs: { line: string; product: string; grade?: string | null }[] } }[] }>(`/api/plans?date=${date}`);
  const pub = plan.data?.versions.filter((v) => v.status === 'published').pop();
  const [ds, setDs] = useState('production');
  const [f, setF] = useState<Record<string, string>>({ time: nowHHMM(), unit: 'kg', mode: 'interval' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [review, setReview] = useState<Review | null>(null);
  const set = (k: string) => (v: string) => setF((p) => ({ ...p, [k]: v }));
  const codes = (kind: string) => [...new Set([...(ref.data?.ref ?? []).filter((r) => r.kind === kind && r.active).map((r) => r.code), ...(pub?.data.jobs ?? []).map((j) => (kind === 'line' ? j.line : kind === 'product' ? j.product : j.grade ?? '')).filter(Boolean)])].map((c) => ({ value: c, label: c }));
  const units = (ref.data?.units ?? ['kg']).map((u) => ({ value: u, label: u }));
  const submit = async (approve: boolean) => {
    setBusy(true); setErr(null);
    try {
      const metric = ds === 'labour' ? 'crew' : ds === 'downtime' ? 'minutes' : 'qty';
      const unit = ds === 'labour' ? 'person' : ds === 'downtime' ? 'minute' : f.unit;
      const measures = f.qty ? [{ metric, value: f.qty, unit }] : [];
      const r = await api<Review>('/api/quick', { body: {
        shift_date: date, dataset: ds, mode: f.mode, time: f.time, shift_start: pub?.data.shift_start ?? '00:00', start_time: f.start_time, end_time: f.end_time,
        dims: { line: f.line, product: f.product, grade: f.grade, lot: f.lot, reason: f.reason, customer: f.customer, order_ref: f.order_ref }, measures,
      } });
      setReview(r);
      if (approve && r.canApprove && !r.needsAck) { await api(`/api/batches/${r.batch.id}/approve`, { body: {} }); onDone(); }
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  return (
    <div data-testid="quick-form">
      <h2>{t('quick_title')}</h2>
      <div className="fields">
        <Field label={t('dataset')}><Select value={ds} onChange={setDs} options={['production', 'labour', 'waste', 'downtime', 'dispatch'].map((x) => ({ value: x, label: t(`ds_${x}`) }))} testId="q-dataset" /></Field>
        {ds !== 'dispatch' && <Field label={t('f_line')}><Select value={f.line ?? ''} onChange={set('line')} options={codes('line')} allowEmpty="—" testId="q-line" /></Field>}
        {['production', 'waste', 'dispatch'].includes(ds) && <Field label={t('f_product')}><Select value={f.product ?? ''} onChange={set('product')} options={codes('product')} allowEmpty="—" testId="q-product" /></Field>}
        {ds === 'production' && <Field label={t('f_grade')}><Select value={f.grade ?? ''} onChange={set('grade')} options={codes('grade')} allowEmpty="—" /></Field>}
        {['production', 'waste'].includes(ds) && <Field label={t('f_lot')}><input className="input" value={f.lot ?? ''} onChange={(e) => set('lot')(e.target.value)} /></Field>}
        {ds === 'downtime' && <Field label={t('f_reason')}><Select value={f.reason ?? ''} onChange={set('reason')} options={codes('downtime_reason')} allowEmpty="—" /></Field>}
        {ds === 'dispatch' && <><Field label={t('f_customer')}><Select value={f.customer ?? ''} onChange={set('customer')} options={codes('customer')} allowEmpty="—" /></Field><Field label={t('f_order_ref')}><input className="input" value={f.order_ref ?? ''} onChange={(e) => set('order_ref')(e.target.value)} /></Field></>}
        <Field label={ds === 'labour' ? t('crew') : ds === 'downtime' ? t('downtime_min') : t('qty')}><input className="input" inputMode="decimal" value={f.qty ?? ''} onChange={(e) => set('qty')(e.target.value)} data-testid="q-qty" /></Field>
        {['production', 'waste', 'dispatch'].includes(ds) && <Field label={t('unit')}><Select value={f.unit} onChange={set('unit')} options={units} testId="q-unit" /></Field>}
        {['labour', 'downtime'].includes(ds) ? (
          <><Field label={t('start')}><input className="input" type="time" value={f.start_time ?? ''} onChange={(e) => set('start_time')(e.target.value)} data-testid="q-start" /></Field>
            <Field label={t('end')}><input className="input" type="time" value={f.end_time ?? ''} onChange={(e) => set('end_time')(e.target.value)} data-testid="q-end" /></Field></>
        ) : <Field label={t('reading_time')}><input className="input" type="time" value={f.time} onChange={(e) => set('time')(e.target.value)} data-testid="q-time" /></Field>}
      </div>
      {ds === 'production' && (
        <fieldset className="row" style={{ border: 0, padding: 0 }}>
          <label className="check"><input type="radio" name="mode" checked={f.mode === 'interval'} onChange={() => set('mode')('interval')} /> {t('mode_interval')}</label>
          <label className="check"><input type="radio" name="mode" checked={f.mode === 'cumulative'} onChange={() => set('mode')('cumulative')} data-testid="q-cumulative" /> {t('mode_cumulative')}</label>
        </fieldset>
      )}
      {err ? <ErrorBox error={err} /> : null}
      {review && (review.rows[0]?.issues.length || review.batchIssues.length) ? (
        <div className="notice warn" data-testid="quick-issues">
          {[...review.batchIssues, ...(review.rows[0]?.issues ?? [])].map((i, k) => <div key={k} className={`sev-${i.severity}`}>{t(`i_${i.code}`)} {i.field ? `· ${i.field}` : ''} {i.expected ? `· ${t('expected')} ${i.expected}` : ''} {i.reported ? `· ${t('reported')} ${i.reported}` : ''}</div>)}
          <button className="link" onClick={() => navigate(`/review/${review.batch.id}`)}>{t('review_title')}</button>
        </div>
      ) : null}
      <div className="row">
        <button className="btn primary" disabled={busy} onClick={() => submit(true)} data-testid="q-approve">{busy ? t('saving') : t('save_approve')}</button>
        <button className="btn" disabled={busy} onClick={() => submit(false)}>{t('staged_only')}</button>
      </div>
      {busy ? null : err ? <p className="small">{errText(err)}</p> : null}
    </div>
  );
}
