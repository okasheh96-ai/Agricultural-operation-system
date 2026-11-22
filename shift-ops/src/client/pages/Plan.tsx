import { useEffect, useMemo, useState } from 'react';
import { api, bumpLocalVersion, todayLocal, useApi, useQueryParams } from '../api';
import { fmtDateTime, fmtQ, t, useLang } from '../i18n';
import { ActionButton, Empty, ErrorBox, Field, Loading, Select } from '../ui';
import { formatMilli, mulDiv, parseQuantity } from '../../shared/num';
import { localParts, localToUtcMs, shiftTimeToUtcMs } from '../../shared/time';
import { convert, plannedWorkerHours } from '../../shared/calc';
import { validatePlan } from '../../shared/plan';
import type { Conversion, PlanData, PlanJob, SalesTarget } from '../../shared/types';

interface Version { id: string; n: number; status: 'draft' | 'published' | 'discarded'; data: PlanData; effective_at: string | null; reason: string | null; published_at: string | null; updated_at: string }

const hhmm = (iso: string) => localParts(Date.parse(iso)).time;
const rid = () => crypto.randomUUID();

/** Editable string form of a job; converted to exact integers on save. */
interface JobForm { id: string; line: string; product: string; grade: string; customer: string; order_ref: string; start: string; end: string; target: string; unit: string; crew: string; rate: string;
  breaks: { start: string; end: string; kind: 'break' | 'changeover' }[]; changes: { at: string; crew: string }[]; milestones: { at: string; cum: string }[] }
interface SalesForm { id: string; period: SalesTarget['period']; period_start: string; customer: string; product: string; order_ref: string; basis: SalesTarget['basis']; measure: SalesTarget['measure']; unit: string; target: string; price: string; due_date: string; milestones: { at: string; cum: string }[] }

function toForm(j: PlanJob): JobForm {
  return {
    id: j.id, line: j.line, product: j.product, grade: j.grade ?? '', customer: j.customer ?? '', order_ref: j.order_ref ?? '', start: hhmm(j.start), end: hhmm(j.end),
    target: formatMilli(j.target), unit: j.unit, crew: String(j.crew), rate: j.rate_target ? formatMilli(j.rate_target) : '',
    breaks: (j.breaks ?? []).map((b) => ({ start: hhmm(b.start), end: hhmm(b.end), kind: b.kind })), changes: (j.crew_changes ?? []).map((c) => ({ at: hhmm(c.at), crew: String(c.crew) })),
    milestones: (j.milestones ?? []).map((m) => ({ at: hhmm(m.at), cum: formatMilli(m.cumulative) })),
  };
}
function salesToForm(s: SalesTarget, tzDate: (iso: string) => string): SalesForm {
  return { id: s.id, period: s.period, period_start: s.period_start, customer: s.customer ?? '', product: s.product ?? '', order_ref: s.order_ref ?? '', basis: s.basis, measure: s.measure, unit: s.unit, target: formatMilli(s.target), price: s.price ? formatMilli(s.price) : '', due_date: s.due_date ?? '', milestones: (s.milestones ?? []).map((m) => ({ at: tzDate(m.at), cum: formatMilli(m.cumulative) })) };
}
const q = (s: string) => { const p = parseQuantity(s); return p.milli; };

function fromForm(date: string, shiftStart: string, jobs: JobForm[], sales: SalesForm[]): { data: PlanData; errors: string[] } {
  const errors: string[] = [];
  const at = (hm: string, after?: number) => {
    if (!/^\d{2}:\d{2}$/.test(hm)) return NaN;
    let ms = shiftTimeToUtcMs(date, hm, shiftStart);
    if (after !== undefined && ms <= after) ms += 86400000;
    return ms;
  };
  const out: PlanJob[] = jobs.map((j, i) => {
    const s = at(j.start);
    const e = at(j.end, s);
    const target = q(j.target);
    const crew = Number(j.crew);
    if (Number.isNaN(s) || Number.isNaN(e)) errors.push(`${t('jobs')} ${i + 1}: ${t('start')}/${t('end')}`);
    if (target === null) errors.push(`${t('jobs')} ${i + 1}: ${t('target')}`);
    if (!Number.isInteger(crew) || crew < 0) errors.push(`${t('jobs')} ${i + 1}: ${t('crew')}`);
    const within = (hm: string) => { let v = at(hm); if (v < s) v += 86400000; return v; };
    return {
      id: j.id, line: j.line, product: j.product, grade: j.grade || null, customer: j.customer || null, order_ref: j.order_ref || null,
      start: new Date(s || 0).toISOString(), end: new Date(e || 0).toISOString(), target: target ?? 0, unit: j.unit, crew: Number.isInteger(crew) ? crew : 0,
      rate_target: j.rate ? q(j.rate) : null,
      breaks: j.breaks.map((b) => { const bs = within(b.start); let be = within(b.end); if (be <= bs) be += 86400000; return { start: new Date(bs).toISOString(), end: new Date(be).toISOString(), kind: b.kind }; }),
      crew_changes: j.changes.map((c) => ({ at: new Date(within(c.at)).toISOString(), crew: Number(c.crew) || 0 })),
      milestones: j.milestones.map((m) => ({ at: new Date(within(m.at)).toISOString(), cumulative: q(m.cum) ?? 0 })),
    };
  });
  const so: SalesTarget[] = sales.map((s, i) => {
    const target = q(s.target);
    if (target === null) errors.push(`${t('sales_targets')} ${i + 1}: ${t('target')}`);
    return {
      id: s.id, period: s.period, period_start: s.period_start, customer: s.customer || null, product: s.product || null, order_ref: s.order_ref || null, basis: s.basis,
      measure: s.basis === 'invoiced' ? 'value' : s.measure, unit: s.unit, target: target ?? 0, price: s.price ? q(s.price) : null, due_date: s.due_date || null,
      milestones: s.milestones.map((m) => ({ at: new Date(localToUtcMs(m.at.slice(0, 10), m.at.slice(11, 16) || '00:00')).toISOString(), cumulative: q(m.cum) ?? 0 })),
    };
  });
  return { data: { shift_start: shiftStart, jobs: out, sales: so }, errors };
}

export function PlanPage() {
  useLang();
  const [params, setParams] = useQueryParams();
  const date = params.get('date') || todayLocal();
  const res = useApi<{ plan: unknown; versions: Version[] }>(`/api/plans?date=${date}`);
  const settings = useApi<{ ref: { kind: string; code: string; active: number }[]; conversions: (Conversion & { active: number })[]; units: string[]; settings: Record<string, unknown> }>('/api/settings');
  const versions = res.data?.versions ?? [];
  const draft = versions.find((v) => v.status === 'draft');
  const published = versions.filter((v) => v.status === 'published');
  const [srcDate, setSrcDate] = useState('');
  const [cmp, setCmp] = useState<[string, string] | null>(null);
  const create = async (from: 'empty' | 'current' | 'date') => { await api('/api/plans/draft', { body: { date, from, source_date: from === 'date' ? srcDate : undefined } }); res.reload(); };
  return (
    <div>
      <h1>{t('plan_title')}</h1>
      <div className="fields">
        <Field label={t('shift_date')}><input className="input" type="date" value={date} onChange={(e) => setParams({ date: e.target.value })} data-testid="plan-date" /></Field>
      </div>
      {res.loading && <Loading />}
      {res.error && <ErrorBox error={res.error} onRetry={res.reload} />}
      {res.data && (
        <>
          <div className="card">
            <h2>{t('plan_versions')}</h2>
            {!versions.length && <Empty />}
            <ul>
              {versions.map((v) => (
                <li key={v.id} data-testid={`version-${v.n}`}>
                  #{v.n} · {t(`v_${v.status}`)}{v.status === 'published' ? ` · ${v.n === published[0]?.n ? t('v_baseline') : t('v_revision')}` : ''}
                  {v.published_at && <span className="muted small"> · {fmtDateTime(v.published_at)}</span>}
                  {v.effective_at && <span className="small"> · {t('effective_at')}: {fmtDateTime(v.effective_at)} · {v.reason}</span>}
                </li>
              ))}
            </ul>
            {published.length > 1 && (
              <button className="btn plain" onClick={() => setCmp([published[0].id, published[published.length - 1].id])} data-testid="plan-compare">{t('compare_versions')}</button>
            )}
            {!draft && (
              <div className="row" style={{ marginBlockStart: 8 }}>
                {!published.length && <ActionButton testId="plan-new-empty" onClick={() => create('empty')}>{t('from_empty')}</ActionButton>}
                {published.length > 0 && <ActionButton testId="plan-revise" onClick={() => create('current')}>{t('revise_current')}</ActionButton>}
                {!published.length && (
                  <span className="row">
                    <input className="input" style={{ inlineSize: 170 }} type="date" value={srcDate} onChange={(e) => setSrcDate(e.target.value)} aria-label={t('source_date')} data-testid="plan-src-date" />
                    <ActionButton kind="plain" disabled={!srcDate} onClick={() => create('date')} testId="plan-copy">{t('from_previous')}</ActionButton>
                  </span>
                )}
              </div>
            )}
          </div>
          {cmp && <Compare a={versions.find((v) => v.id === cmp[0])!} b={versions.find((v) => v.id === cmp[1])!} onClose={() => setCmp(null)} />}
          {draft && settings.data && <Editor key={draft.id} date={date} v={draft} isRevision={published.length > 0} refData={settings.data} onChanged={res.reload} />}
          {!draft && published.length > 0 && <ReadOnly v={published[published.length - 1]} />}
        </>
      )}
    </div>
  );
}

function ReadOnly({ v }: { v: Version }) {
  return (
    <div className="card">
      <p className="small muted">{t('published_frozen')}</p>
      <div className="tablewrap"><table>
        <thead><tr><th>{t('job_line')}</th><th>{t('job_product')}</th><th>{t('start')}</th><th>{t('end')}</th><th className="num">{t('target')}</th><th className="num">{t('crew')}</th><th className="num">{t('planned_wh')}</th></tr></thead>
        <tbody>{v.data.jobs.map((j) => <tr key={j.id}><td>{j.line}</td><td>{j.product}{j.grade ? ` · ${j.grade}` : ''}</td><td>{hhmm(j.start)}</td><td>{hhmm(j.end)}</td><td className="num">{fmtQ(j.target)} {j.unit}</td><td className="num">{j.crew}</td><td className="num">{fmtQ(plannedWorkerHours(j))}</td></tr>)}</tbody>
      </table></div>
      {v.data.sales.length > 0 && <p className="small">{t('sales_targets')}: {v.data.sales.map((s) => `${t(`basis_${s.basis}`)} ${fmtQ(s.target)} ${s.unit}`).join(' · ')}</p>}
    </div>
  );
}

function Compare({ a, b, onClose }: { a: Version; b: Version; onClose: () => void }) {
  const ids = [...new Set([...a.data.jobs.map((j) => j.id), ...b.data.jobs.map((j) => j.id)])];
  return (
    <div className="card" data-testid="plan-compare-table">
      <div className="spread"><h2>{t('compare_versions')} #{a.n} ↔ #{b.n}</h2><button className="btn plain" onClick={onClose}>{t('close')}</button></div>
      <div className="tablewrap"><table>
        <thead><tr><th>{t('jobs')}</th><th className="num">#{a.n} {t('target')}</th><th className="num">#{b.n} {t('target')}</th><th>#{a.n}</th><th>#{b.n}</th></tr></thead>
        <tbody>{ids.map((id) => {
          const x = a.data.jobs.find((j) => j.id === id);
          const y = b.data.jobs.find((j) => j.id === id);
          const j = (y ?? x)!;
          return <tr key={id}><td>{j.line} · {j.product}{j.grade ? ` · ${j.grade}` : ''}</td><td className="num">{x ? `${fmtQ(x.target)} ${x.unit}` : '—'}</td><td className="num">{y ? `${fmtQ(y.target)} ${y.unit}` : '—'}</td>
            <td>{x ? `${hhmm(x.start)}–${hhmm(x.end)} · ${x.crew}` : '—'}</td><td>{y ? `${hhmm(y.start)}–${hhmm(y.end)} · ${y.crew}` : '—'}</td></tr>;
        })}</tbody>
      </table></div>
    </div>
  );
}

function Editor({ date, v, isRevision, refData, onChanged }: { date: string; v: Version; isRevision: boolean; refData: { ref: { kind: string; code: string; active: number }[]; conversions: (Conversion & { active: number })[]; units: string[] }; onChanged: () => void }) {
  const [shiftStart, setShiftStart] = useState(v.data.shift_start);
  const [jobs, setJobs] = useState<JobForm[]>(v.data.jobs.map(toForm));
  const [sales, setSales] = useState<SalesForm[]>(v.data.sales.map((s) => salesToForm(s, (iso) => localParts(Date.parse(iso)).date + 'T' + localParts(Date.parse(iso)).time)));
  const [updatedAt, setUpdatedAt] = useState(v.updated_at);
  const [eff, setEff] = useState(() => { const p = localParts(Date.now()); return `${p.date}T${p.time}`; });
  const [reason, setReason] = useState('');
  const [dirty, setDirty] = useState(false);
  useEffect(() => setDirty(true), [jobs, sales, shiftStart]);
  useEffect(() => setDirty(false), []);
  const codes = (k: string) => refData.ref.filter((r) => r.kind === k && r.active).map((r) => ({ value: r.code, label: r.code }));
  const units = refData.units.map((u) => ({ value: u, label: u }));
  const convs = refData.conversions.filter((c) => c.active);
  const built = useMemo(() => fromForm(date, shiftStart, jobs, sales), [date, shiftStart, jobs, sales]);
  const issues = validatePlan(built.data, true, new Set(refData.units));
  const upd = (i: number, p: Partial<JobForm>) => setJobs((js) => js.map((j, k) => (k === i ? { ...j, ...p } : j)));
  const updS = (i: number, p: Partial<SalesForm>) => setSales((ss) => ss.map((s, k) => (k === i ? { ...s, ...p } : s)));
  const save = async () => {
    if (built.errors.length) throw new Error(built.errors.join(', '));
    const r = await api<{ updated_at: string }>(`/api/plans/versions/${v.id}`, { method: 'PUT', body: { data: built.data, updated_at: updatedAt } });
    setUpdatedAt(r.updated_at);
    setDirty(false);
  };
  return (
    <div className="card" data-testid="plan-editor">
      <h2>{t('v_draft')} #{v.n}</h2>
      <div className="fields"><Field label={t('shift_start')}><input className="input" type="time" value={shiftStart} onChange={(e) => setShiftStart(e.target.value)} data-testid="plan-shift-start" /></Field></div>
      <h3>{t('jobs')}</h3>
      {jobs.map((j, i) => {
        const pj = built.data.jobs[i];
        const wh = pj ? plannedWorkerHours(pj) : 0;
        const kg = pj ? convert(pj.target, pj.unit, 'kg', convs, pj.product, pj.grade) : null;
        const derived = kg !== null && wh ? mulDiv(kg, 1000, wh) : null;
        const entered = pj?.rate_target ?? null;
        const capacity = entered !== null ? mulDiv(entered, wh, 1000) : null;
        const inconsistent = capacity !== null && kg !== null && capacity !== kg;
        return (
          <div className="card" key={j.id} data-testid={`job-${i}`}>
            <div className="fields">
              <Field label={t('job_line')}><Select value={j.line} onChange={(x) => upd(i, { line: x })} options={codes('line')} allowEmpty="—" testId={`job-${i}-line`} /></Field>
              <Field label={t('job_product')}><Select value={j.product} onChange={(x) => upd(i, { product: x })} options={codes('product')} allowEmpty="—" testId={`job-${i}-product`} /></Field>
              <Field label={t('job_grade')}><Select value={j.grade} onChange={(x) => upd(i, { grade: x })} options={codes('grade')} allowEmpty="—" testId={`job-${i}-grade`} /></Field>
              <Field label={t('job_customer')}><Select value={j.customer} onChange={(x) => upd(i, { customer: x })} options={codes('customer')} allowEmpty="—" /></Field>
              <Field label={t('job_order')}><input className="input" value={j.order_ref} onChange={(e) => upd(i, { order_ref: e.target.value })} /></Field>
              <Field label={t('start')}><input className="input" type="time" value={j.start} onChange={(e) => upd(i, { start: e.target.value })} data-testid={`job-${i}-start`} /></Field>
              <Field label={t('end')} hint={pj && Date.parse(pj.end) - Date.parse(pj.start) > 0 && j.end < j.start ? t('next_day') : undefined}><input className="input" type="time" value={j.end} onChange={(e) => upd(i, { end: e.target.value })} data-testid={`job-${i}-end`} /></Field>
              <Field label={t('target')}><input className="input" inputMode="decimal" value={j.target} onChange={(e) => upd(i, { target: e.target.value })} data-testid={`job-${i}-target`} /></Field>
              <Field label={t('unit')}><Select value={j.unit} onChange={(x) => upd(i, { unit: x })} options={units} testId={`job-${i}-unit`} /></Field>
              <Field label={t('crew')}><input className="input" inputMode="numeric" value={j.crew} onChange={(e) => upd(i, { crew: e.target.value })} data-testid={`job-${i}-crew`} /></Field>
              <Field label={t('rate_target')}><input className="input" inputMode="decimal" value={j.rate} onChange={(e) => upd(i, { rate: e.target.value })} /></Field>
            </div>
            <details>
              <summary>{t('breaks')} ({j.breaks.length}) · {t('crew_changes')} ({j.changes.length}) · {t('milestones')} ({j.milestones.length})</summary>
              {j.breaks.map((b, k) => (
                <div className="row" key={k}>
                  <Select value={b.kind} onChange={(x) => upd(i, { breaks: j.breaks.map((y, z) => (z === k ? { ...y, kind: x as 'break' } : y)) })} options={[{ value: 'break', label: t('kind_break') }, { value: 'changeover', label: t('kind_changeover') }]} />
                  <input className="input" style={{ inlineSize: 120 }} type="time" value={b.start} onChange={(e) => upd(i, { breaks: j.breaks.map((y, z) => (z === k ? { ...y, start: e.target.value } : y)) })} />
                  <input className="input" style={{ inlineSize: 120 }} type="time" value={b.end} onChange={(e) => upd(i, { breaks: j.breaks.map((y, z) => (z === k ? { ...y, end: e.target.value } : y)) })} />
                  <button className="btn plain" onClick={() => upd(i, { breaks: j.breaks.filter((_, z) => z !== k) })}>{t('remove')}</button>
                </div>
              ))}
              <button className="btn plain" onClick={() => upd(i, { breaks: [...j.breaks, { start: j.start, end: j.start, kind: 'break' }] })}>{t('add_break')}</button>
              {j.changes.map((c, k) => (
                <div className="row" key={k}>
                  <span>{t('at_time')}</span><input className="input" style={{ inlineSize: 120 }} type="time" value={c.at} onChange={(e) => upd(i, { changes: j.changes.map((y, z) => (z === k ? { ...y, at: e.target.value } : y)) })} />
                  <span>{t('crew')}</span><input className="input" style={{ inlineSize: 90 }} inputMode="numeric" value={c.crew} onChange={(e) => upd(i, { changes: j.changes.map((y, z) => (z === k ? { ...y, crew: e.target.value } : y)) })} />
                  <button className="btn plain" onClick={() => upd(i, { changes: j.changes.filter((_, z) => z !== k) })}>{t('remove')}</button>
                </div>
              ))}
              <button className="btn plain" onClick={() => upd(i, { changes: [...j.changes, { at: j.start, crew: j.crew }] })}>{t('add_crew_change')}</button>
              {j.milestones.map((m, k) => (
                <div className="row" key={k}>
                  <span>{t('at_time')}</span><input className="input" style={{ inlineSize: 120 }} type="time" value={m.at} onChange={(e) => upd(i, { milestones: j.milestones.map((y, z) => (z === k ? { ...y, at: e.target.value } : y)) })} />
                  <span>{t('cumulative')}</span><input className="input" style={{ inlineSize: 110 }} inputMode="decimal" value={m.cum} onChange={(e) => upd(i, { milestones: j.milestones.map((y, z) => (z === k ? { ...y, cum: e.target.value } : y)) })} />
                  <button className="btn plain" onClick={() => upd(i, { milestones: j.milestones.filter((_, z) => z !== k) })}>{t('remove')}</button>
                </div>
              ))}
              <button className="btn plain" onClick={() => upd(i, { milestones: [...j.milestones, { at: j.end, cum: j.target }] })}>{t('add_milestone')}</button>
            </details>
            <p className="small" data-testid={`job-${i}-calc`}>
              {t('planned_wh')}: <b>{fmtQ(wh)}</b> · {t('derived_rate')}: <b>{derived === null ? t('missing_conversion') : `${fmtQ(derived, 2)} ${t('kg_per_wh')}`}</b>
              {capacity !== null && <> · {t('capacity')}: <b>{fmtQ(capacity)} {t('kg')}</b></>}
            </p>
            {inconsistent && <p className="small sev-review" data-testid={`job-${i}-inconsistent`}>{t('inconsistent_target')}</p>}
            <button className="btn danger" onClick={() => setJobs((js) => js.filter((_, k) => k !== i))}>{t('delete_job')}</button>
          </div>
        );
      })}
      <button className="btn" data-testid="add-job" onClick={() => {
        const last = jobs[jobs.length - 1];
        setJobs([...jobs, { id: rid(), line: last?.line ?? '', product: last?.product ?? '', grade: '', customer: '', order_ref: '', start: last?.end ?? shiftStart, end: last?.end ?? shiftStart, target: '', unit: last?.unit ?? 'kg', crew: last?.crew ?? '', rate: '', breaks: [], changes: [], milestones: [] }]);
      }}>＋ {t('add_job')}</button>

      <h3 style={{ marginBlockStart: 16 }}>{t('sales_targets')}</h3>
      {sales.map((s, i) => (
        <div className="card" key={s.id} data-testid={`sales-${i}`}>
          <div className="fields">
            <Field label={t('basis')}><Select value={s.basis} onChange={(x) => updS(i, { basis: x as SalesForm['basis'], measure: x === 'invoiced' ? 'value' : s.measure })} options={['orders', 'dispatch', 'invoiced'].map((b) => ({ value: b, label: t(`basis_${b}`) }))} testId={`sales-${i}-basis`} /></Field>
            <Field label={t('period')}><Select value={s.period} onChange={(x) => updS(i, { period: x as SalesForm['period'] })} options={['day', 'week', 'month'].map((p) => ({ value: p, label: t(`period_${p}`) }))} /></Field>
            <Field label={t('period_start')}><input className="input" type="date" value={s.period_start} onChange={(e) => updS(i, { period_start: e.target.value })} /></Field>
            {s.basis !== 'invoiced' && <Field label={t('measure')}><Select value={s.measure} onChange={(x) => updS(i, { measure: x as SalesForm['measure'] })} options={[{ value: 'qty', label: t('m_qty') }, { value: 'value', label: t('m_value') }]} /></Field>}
            <Field label={t('unit')}><Select value={s.unit} onChange={(x) => updS(i, { unit: x })} options={units} testId={`sales-${i}-unit`} /></Field>
            <Field label={t('target')}><input className="input" inputMode="decimal" value={s.target} onChange={(e) => updS(i, { target: e.target.value })} data-testid={`sales-${i}-target`} /></Field>
            <Field label={t('job_customer')}><Select value={s.customer} onChange={(x) => updS(i, { customer: x })} options={codes('customer')} allowEmpty={t('all')} /></Field>
            <Field label={t('job_product')}><Select value={s.product} onChange={(x) => updS(i, { product: x })} options={codes('product')} allowEmpty={t('all')} /></Field>
            <Field label={t('job_order')}><input className="input" value={s.order_ref} onChange={(e) => updS(i, { order_ref: e.target.value })} /></Field>
            <Field label={t('price')}><input className="input" inputMode="decimal" value={s.price} onChange={(e) => updS(i, { price: e.target.value })} /></Field>
            <Field label={t('due_date')}><input className="input" type="date" value={s.due_date} onChange={(e) => updS(i, { due_date: e.target.value })} /></Field>
          </div>
          <div>{t('milestones')}</div>
          {s.milestones.map((m, k) => (
            <div className="row" key={k}>
              <input className="input" style={{ inlineSize: 220 }} type="datetime-local" value={m.at} onChange={(e) => updS(i, { milestones: s.milestones.map((y, z) => (z === k ? { ...y, at: e.target.value } : y)) })} data-testid={`sales-${i}-ms-${k}-at`} />
              <input className="input" style={{ inlineSize: 110 }} inputMode="decimal" value={m.cum} onChange={(e) => updS(i, { milestones: s.milestones.map((y, z) => (z === k ? { ...y, cum: e.target.value } : y)) })} data-testid={`sales-${i}-ms-${k}-cum`} />
              <button className="btn plain" onClick={() => updS(i, { milestones: s.milestones.filter((_, z) => z !== k) })}>{t('remove')}</button>
            </div>
          ))}
          <div className="row">
            <button className="btn plain" data-testid={`sales-${i}-add-ms`} onClick={() => updS(i, { milestones: [...s.milestones, { at: `${date}T12:00`, cum: '' }] })}>{t('add_milestone')}</button>
            <button className="btn danger" onClick={() => setSales((ss) => ss.filter((_, k) => k !== i))}>{t('remove')}</button>
          </div>
        </div>
      ))}
      <button className="btn" data-testid="add-sales" onClick={() => setSales([...sales, { id: rid(), period: 'day', period_start: date, customer: '', product: '', order_ref: '', basis: 'dispatch', measure: 'qty', unit: 'pallet', target: '', price: '', due_date: '', milestones: [] }])}>＋ {t('add_sales')}</button>

      {(issues.length > 0 || built.errors.length > 0) && (
        <div className="notice warn" data-testid="plan-issues"><b>{t('plan_issues')}</b>
          <ul>{built.errors.map((e) => <li key={e}>{e}</li>)}{issues.map((x, k) => <li key={k} className={`sev-${x.severity}`}>{x.where}: {x.code}</li>)}</ul>
        </div>
      )}
      <div className="row" style={{ marginBlockStart: 12 }}>
        <ActionButton testId="plan-save" onClick={save} kind="plain">{t('save_draft')}</ActionButton>
        {isRevision && (
          <>
            <Field label={t('effective_at')}><input className="input" type="datetime-local" value={eff} onChange={(e) => setEff(e.target.value)} data-testid="plan-eff" /></Field>
            <Field label={t('reason')}><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} data-testid="plan-reason" /></Field>
          </>
        )}
        <ActionButton testId="plan-publish" disabled={issues.some((x) => x.severity === 'block') || built.errors.length > 0 || (isRevision && !reason.trim())} onClick={async () => {
          await save();
          await api(`/api/plans/versions/${v.id}/publish`, { body: isRevision ? { effective_at: new Date(localToUtcMs(eff.slice(0, 10), eff.slice(11, 16))).toISOString(), reason } : {} });
          bumpLocalVersion();
          onChanged();
        }}>{isRevision ? t('publish_revision') : t('publish')}</ActionButton>
        <ActionButton kind="danger" confirmText={t('discard')} onClick={async () => { await api(`/api/plans/versions/${v.id}/discard`, { body: {} }); onChanged(); }}>{t('discard')}</ActionButton>
        {dirty && <span className="small muted">●</span>}
      </div>
    </div>
  );
}
