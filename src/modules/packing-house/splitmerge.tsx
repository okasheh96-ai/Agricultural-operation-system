import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { rpc, useFgPallets, useInvalidatePh, type FgChangeRow, type FgPalletRow } from './api';
import { Buttons, ResultChoice, useSubmit } from './forms';
import { ActionPanel, ErrorBox, Labelled, StatusPill, When, inputCls, primaryBtnCls } from './ui';

type Perms = Map<string, string> | undefined;

/**
 * FR-FG-04 split: the operator enters the new pallets (boxes and kg); they must add up to the pallet. Nothing changes until
 * the PHM approves; the approval creates the pallets, which keep the QC stamp, location and composition (pro rata).
 */
export function FgSplitForm({ fg, onDone, onCancel }: { fg: FgPalletRow; onDone: () => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const [children, setChildren] = useState([{ box_count: '', net_kg: '' }, { box_count: '', net_kg: '' }]);
  const [reason, setReason] = useState('');
  const boxes = children.reduce((a, c) => a + (Number(c.box_count) || 0), 0);
  const kg = Math.round(children.reduce((a, c) => a + (Number(c.net_kg) || 0), 0) * 100) / 100;
  const balanced = boxes === fg.box_count && kg === Number(fg.net_kg);
  const s = useSubmit((rid) => rpc('ph_request_fg_split', {
    p_fg: fg.id, p_children: children.map((c) => ({ box_count: Number(c.box_count), net_kg: Number(c.net_kg) })), p_reason: reason.trim(), p_request_id: rid,
  }), () => onDone());
  const setChild = (i: number, k: 'box_count' | 'net_kg', v: string) => setChildren(children.map((c, j) => (j === i ? { ...c, [k]: v } : c)));
  return (
    <form onSubmit={(e) => void s.submit(e)} className="flex flex-col gap-3">
      <p className="text-sm text-stone-700">{t('ph.split.hint', { boxes: fg.box_count, kg: fg.net_kg })}</p>
      <ol className="flex flex-col gap-2">
        {children.map((c, i) => (
          <li key={i} className="flex flex-wrap items-end gap-2">
            <span className="w-8 font-mono text-sm">#{i + 1}</span>
            <Labelled label={t('ph.fields.box_count')} required>
              <input required type="number" min={1} step="1" dir="ltr" className={`${inputCls} sm:w-28`} aria-label={`${t('ph.fields.box_count')} ${i + 1}`}
                value={c.box_count} onChange={(e) => setChild(i, 'box_count', e.target.value)} /></Labelled>
            <Labelled label={t('ph.fields.net_kg')} required>
              <input required type="number" min={0.01} step="0.01" dir="ltr" className={`${inputCls} sm:w-32`} aria-label={`${t('ph.fields.net_kg')} ${i + 1}`}
                value={c.net_kg} onChange={(e) => setChild(i, 'net_kg', e.target.value)} /></Labelled>
            {children.length > 2 && (
              <button type="button" className="min-h-touch px-2 text-sm underline" onClick={() => setChildren(children.filter((_, j) => j !== i))}>{t('ph.split.remove')}</button>
            )}
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <button type="button" className="min-h-touch underline" onClick={() => setChildren([...children, { box_count: '', net_kg: '' }])}>＋ {t('ph.split.add')}</button>
        <span role="status" className={balanced ? 'text-green-800' : 'text-amber-900'}>
          {t('ph.split.total', { boxes, kg, pboxes: fg.box_count, pkg: fg.net_kg })}
        </span>
      </div>
      <Labelled label={t('ph.fields.reason')} required><input required className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} /></Labelled>
      <ErrorBox message={s.error} />
      <Buttons busy={s.busy || !balanced} label={t('ph.split.request')} onCancel={onCancel} />
    </form>
  );
}

/** FR-FG-05 merge: pallets in storage from the same Job Card, crop, grade, customer and storage group (V-22; checked again on the server). */
export function FgMergeForm({ fg, onDone, onCancel }: { fg: FgPalletRow; onDone: () => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const all = useFgPallets();
  const candidates = (all.data ?? []).filter((x) => x.id !== fg.id && x.status === 'in_storage' && x.job_card_id === fg.job_card_id
    && x.grade === fg.grade && x.crop_id === fg.crop_id);
  const [picked, setPicked] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const s = useSubmit((rid) => rpc('ph_request_fg_merge', { p_fgs: [fg.id, ...picked], p_reason: reason.trim(), p_request_id: rid }), () => onDone());
  return (
    <form onSubmit={(e) => void s.submit(e)} className="flex flex-col gap-3">
      <p className="text-sm text-stone-700">{t('ph.merge.hint')}</p>
      {candidates.length === 0 ? <p className="text-sm text-amber-900">{t('ph.merge.none')}</p> : (
        <fieldset className="flex flex-col gap-1">
          <legend className="text-sm font-medium">{t('ph.merge.with')}</legend>
          {candidates.map((x) => (
            <label key={x.id} className="flex min-h-touch items-center gap-2 text-sm">
              <input type="checkbox" checked={picked.includes(x.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, x.id] : picked.filter((p) => p !== x.id))} />
              <bdi className="font-mono">{x.code}</bdi> · <bdi>{x.box_count} · {x.net_kg} kg · {x.location_code ?? '—'}</bdi>
            </label>
          ))}
        </fieldset>
      )}
      <Labelled label={t('ph.fields.reason')} required><input required className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} /></Labelled>
      <ErrorBox message={s.error} />
      <Buttons busy={s.busy || picked.length === 0} label={t('ph.merge.request')} onCancel={onCancel} />
    </form>
  );
}

function DecideChangeForm({ c, onDone, onCancel }: { c: FgChangeRow; onDone: () => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const [decision, setDecision] = useState('');
  const [reason, setReason] = useState('');
  const s = useSubmit(() => rpc('ph_decide_fg_change', { p_change: c.id, p_decision: decision, p_reason: reason.trim() || null }), () => onDone());
  return (
    <form onSubmit={(e) => void s.submit(e)} className="flex flex-col gap-3">
      <p className="text-sm text-stone-700">{t('ph.fgChange.decideHint')}</p>
      <ResultChoice value={decision} onChange={setDecision} options={[
        { key: 'approve', label: t('ph.fgChange.approve'), good: true }, { key: 'reject', label: t('ph.fgChange.reject'), good: false }]} />
      <Labelled label={t('ph.fields.reason')} required={decision === 'reject'}>
        <input required={decision === 'reject'} className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} /></Labelled>
      <ErrorBox message={s.error} />
      <Buttons busy={s.busy || !decision} label={t('ph.fgChange.decide')} onCancel={onCancel} />
    </form>
  );
}

/** One split or merge request: what it changes, who asked, and the PHM's decision (the requester never decides their own). */
export function FgChangePanel({ c, perms }: { c: FgChangeRow; perms: Perms }) {
  const { t } = useTranslation();
  const invalidate = useInvalidatePh();
  const [open, setOpen] = useState(false);
  const canDecide = c.status === 'requested' && !!perms?.has('fg_pallet.split_merge_approve');
  return (
    <article className="rounded-lg border border-s-4 border-stone-200 border-s-violet-500 bg-white p-3 shadow-sm" aria-label={c.code}>
      <header className="flex flex-wrap items-center gap-2">
        <h3 className="font-mono font-bold"># <bdi>{c.code}</bdi></h3>
        <span className="rounded bg-violet-100 px-2 text-sm text-violet-900">{t(`ph.fgChange.kind.${c.kind}`)}</span>
        {canDecide && !open && <button type="button" className={primaryBtnCls} onClick={() => setOpen(true)}>{t('ph.fgChange.decide')}</button>}
        <span className="ms-auto"><StatusPill status={c.status} workflow="ph_fg_change" /></span>
      </header>
      <div className="mt-2 grid gap-2 text-sm sm:grid-cols-3">
        <div>
          <div className="text-xs text-stone-500">{t('ph.fgChange.from')}</div>
          {c.parents.map((p) => <div key={p.id}><Link className="font-mono underline" to={`/office/packing-house/fg-pallets/${p.id}`}><bdi>{p.code}</bdi></Link> · <bdi>{p.box_count} · {p.net_kg} kg</bdi></div>)}
        </div>
        <div>
          <div className="text-xs text-stone-500">{t('ph.fgChange.into')}</div>
          {c.results.length > 0
            ? c.results.map((p) => <div key={p.id}><Link className="font-mono underline" to={`/office/packing-house/fg-pallets/${p.id}`}><bdi>{p.code}</bdi></Link> · <bdi>{p.box_count} · {p.net_kg} kg</bdi></div>)
            : c.kind === 'split'
              ? c.children.map((x, i) => <div key={i}><bdi>#{i + 1}: {x.box_count} · {x.net_kg} kg</bdi></div>)
              : <div>{t('ph.fgChange.onePallet')}</div>}
        </div>
        <div>
          <div className="text-xs text-stone-500">{t('ph.fgChange.requestedBy')}</div>
          <div>{c.requested_by_name ?? '—'} · <When iso={c.created_at} /></div>
          <div className="text-stone-700">“{c.reason}”</div>
          {c.decided_at && <div className="mt-1">{t('ph.fgChange.decidedBy', { by: c.decided_by_name ?? '—' })} · <When iso={c.decided_at} />{c.decision_reason ? ` — ${c.decision_reason}` : ''}</div>}
        </div>
      </div>
      {open && (
        <div className="mt-2">
          <ActionPanel title={t('ph.fgChange.decide')} onClose={() => setOpen(false)}>
            <DecideChangeForm c={c} onDone={() => { setOpen(false); void invalidate(); }} onCancel={() => setOpen(false)} />
          </ActionPanel>
        </div>
      )}
    </article>
  );
}
