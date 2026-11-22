import { useEffect, useRef, useState } from 'react';
import { api, bumpLocalVersion, navigate, useApi } from '../api';
import { fmtDateTime, t, useLang } from '../i18n';
import { ActionButton, Empty, ErrorBox, Field, Loading, Select } from '../ui';
import { toDecodableImage } from '../import/ocr';
import { measureKey, type Issue, type RowVals } from '../../shared/rows';
import type { Review, ReviewedRow } from '../../worker/review';

interface BatchListRow { id: string; status: string; dataset: string; shift_date: string; file_name: string | null; created_at: string; received_rows: number; total_rows: number; facts_current: number; source: string }

export function ReviewList() {
  useLang();
  const r = useApi<{ batches: BatchListRow[] }>('/api/batches', { live: true });
  if (r.loading) return <Loading />;
  if (r.error) return <ErrorBox error={r.error} onRetry={r.reload} />;
  const all = r.data?.batches ?? [];
  const queue = all.filter((b) => b.status === 'staged' || b.status === 'receiving');
  const rest = all.filter((b) => !queue.includes(b));
  const row = (b: BatchListRow) => (
    <li key={b.id}><a href={`/review/${b.id}`} onClick={(e) => { e.preventDefault(); navigate(`/review/${b.id}`); }} data-testid={`batch-${b.id}`}>
      {t(`ds_${b.dataset}`) !== `ds_${b.dataset}` ? t(`ds_${b.dataset}`) : b.dataset} · {b.shift_date} · {b.file_name ?? b.source}</a>{' '}
      <span className="badge">{t(`b_${b.status}`)}</span> <span className="small muted">{fmtDateTime(b.created_at)}{b.status === 'approved' ? ` · ${b.facts_current}` : ''}</span></li>
  );
  return (
    <div>
      <h1>{t('review_title')}</h1>
      <div className="card"><h2>{t('queue')}</h2>{queue.length ? <ul>{queue.map(row)}</ul> : <Empty />}</div>
      <div className="card"><h2>{t('recent')}</h2>{rest.length ? <ul>{rest.map(row)}</ul> : <Empty />}</div>
    </div>
  );
}

function IssueLine({ i }: { i: Issue }) {
  return (
    <div className={`sev-${i.severity} small`} data-testid={`issue-${i.code}`}>
      ● {t(`i_${i.code}`)}{i.field ? ` · ${i.field}` : ''}{i.detail ? ` · ${i.detail}` : ''}
      {i.expected !== undefined && <> · {t('expected')}: <b className="ltr">{i.expected}</b></>}
      {i.reported !== undefined && <> · {t('reported')}: <b className="ltr">{i.reported}</b></>}
      {i.difference !== undefined && <> · {t('difference')}: <b className="ltr">{i.difference}</b></>}
      {i.source_ref && <> · {t('source')}: <span className="ltr">{i.source_ref}</span></>}
    </div>
  );
}

export function ReviewDetail({ id }: { id: string }) {
  useLang();
  const r = useApi<Review>(`/api/batches/${id}`);
  const [rv, setRv] = useState<Review | null>(null);
  useEffect(() => { if (r.data) setRv(r.data); }, [r.data]);
  const files = useApi<{ files: { id: string; name: string; mime: string; kind: string }[] }>('/api/files');
  const approved = useApi<{ batches: BatchListRow[] }>('/api/batches?status=approved');
  const edits = useApi<{ edits: { id: string; field: string; old_value: string | null; new_value: string | null; reason: string; at: string; actor: string }[] }>(`/api/batches/${id}/edits`);
  const [ack, setAck] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [done, setDone] = useState<{ facts: number } | null>(null);
  if (r.loading && !rv) return <Loading />;
  if (r.error && !rv) return <ErrorBox error={r.error} onRetry={r.reload} />;
  if (!rv) return null;
  const b = rv.batch;
  const file = files.data?.files.find((f) => f.id === b.file_id);
  const editable = b.status === 'staged';
  const after = (x: Review) => { setRv(x); edits.reload(); };
  return (
    <div data-testid="review">
      <button className="btn plain" onClick={() => navigate('/review')}>← {t('back')}</button>
      <h1>{t(`ds_${b.dataset}`) !== `ds_${b.dataset}` ? t(`ds_${b.dataset}`) : b.dataset} · {b.shift_date}</h1>
      <div className="card">
        <div className="spread"><span className="badge" data-testid="batch-status">{t(`b_${b.status}`)}</span><span className="small muted">{fmtDateTime(b.created_at)}</span></div>
        {file && <p className="small">{file.name} · <OriginalLink fileId={file.id} /></p>}
        <p className="small">{rv.counts.rows} {t('rows')} · {rv.counts.blocked} {t('blocking')} · {rv.counts.review} {t('needs_review')} · {rv.counts.warn} {t('warnings')} · {rv.counts.excluded} {t('excluded')} · {rv.counts.facts} {t('facts_published')}</p>
        {rv.batchIssues.length > 0 && <div className="notice warn" data-testid="batch-issues">{rv.batchIssues.map((i, k) => <IssueLine key={k} i={i} />)}</div>}
        {rv.lots.length > 0 && (
          <div className="tablewrap"><table data-testid="review-lots">
            <thead><tr><th>{t('lot')}</th><th className="num">{t('input')}</th><th className="num">{t('packed')}</th><th className="num">{t('waste')}</th><th className="num">{t('gap')}</th><th /></tr></thead>
            <tbody>{rv.lots.map((l) => (
              <tr key={l.lot} className={l.flagged ? 'blocked' : ''}><td>{l.lot} <span className="badge">{l.closed ? t('lot_closed') : t('lot_open')}</span></td>
                <td className="num ltr">{l.input === null ? '—' : l.input / 1000}</td><td className="num ltr">{l.packed === null ? '—' : l.packed / 1000}</td><td className="num ltr">{l.waste === null ? '—' : l.waste / 1000}</td><td className="num ltr" data-testid={`gap-${l.lot}`}>{l.gap === null ? '—' : l.gap / 1000}</td>
                <td>{editable && <ActionButton kind="plain" testId={`lot-toggle-${l.lot}`} onClick={async () => { await api(`/api/lots/${encodeURIComponent(l.lot)}`, { method: 'PUT', body: { closed: !l.closed } }); r.reload(); }}>{l.closed ? t('reopen_lot') : t('close_lot')}</ActionButton>}</td></tr>
            ))}</tbody>
          </table></div>
        )}
        {editable && b.dataset !== 'plan' && (
          <Field label={t('set_supersede')}>
            <Select value={b.supersedes_batch_id ?? ''} onChange={async (v) => after(await api<Review>(`/api/batches/${id}/supersede`, { body: { target_batch_id: v || null } }))}
              options={(approved.data?.batches ?? []).filter((x) => x.dataset === b.dataset && x.id !== id).map((x) => ({ value: x.id, label: `${x.shift_date} · ${x.file_name ?? x.id.slice(0, 8)} · ${fmtDateTime(x.created_at)}` }))} allowEmpty={t('none')} testId="review-supersede" />
          </Field>
        )}
        {rv.diff && (
          <div data-testid="diff"><h3>{t('compare_prev')}</h3>
            <p className="small">{t('added')} {rv.diff.added} · {t('changed')} {rv.diff.changed} · {t('removed_rows')} {rv.diff.removed} · {t('same')} {rv.diff.same}</p>
            <div className="tablewrap"><table className="small"><tbody>{rv.diff.changes.slice(0, 100).map((c) => <tr key={c.key}><td className="ltr">{c.key.split('|').filter(Boolean).join(' · ')}</td><td className="ltr">{c.before ?? '—'}</td><td>→</td><td className="ltr">{c.after ?? '—'}</td></tr>)}</tbody></table></div>
          </div>
        )}
      </div>
      {rv.rows.map((row) => <RowCard key={row.id} row={row} batchId={id} editable={editable} fileId={b.source === 'photo' ? b.file_id : null} onChange={after} />)}
      <div className="card">
        {done && <div className="notice" role="status" data-testid="approved-ok">✓ {t('approved_ok')} · {done.facts} {t('facts_published')}</div>}
        {editable && b.dataset === 'plan' && <ActionButton testId="to-plan" onClick={async () => { await api(`/api/batches/${id}/to-plan`, { body: {} }); navigate(`/plan?date=${b.shift_date}`); }}>{t('to_plan')}</ActionButton>}
        {editable && b.dataset !== 'plan' && (
          <>
            {rv.needsAck && <label className="check"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} data-testid="ack" /> {t('approve_ack')}</label>}
            <ActionButton testId="approve" disabled={!rv.canApprove || (rv.needsAck && !ack)} onClick={async () => {
              const res = await api<{ facts: number }>(`/api/batches/${id}/approve`, { body: { acknowledge: ack, expect_updated_at: b.updated_at } });
              setDone(res); bumpLocalVersion(); r.reload();
            }}>{t('approve')}</ActionButton>
          </>
        )}
        {(b.status === 'staged' || b.status === 'receiving') && (
          <div className="row" style={{ marginBlockStart: 10 }}>
            <input className="input" style={{ inlineSize: 240 }} placeholder={t('reason')} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
            <ActionButton kind="danger" disabled={!rejectReason.trim()} testId="reject" onClick={async () => { await api(`/api/batches/${id}/reject`, { body: { reason: rejectReason } }); r.reload(); }}>{t('reject')}</ActionButton>
          </div>
        )}
      </div>
      <div className="card" data-testid="edit-history">
        <h2>{t('edit_history')}</h2>
        {edits.data?.edits.length ? (
          <div className="tablewrap"><table className="small"><tbody>{edits.data.edits.map((e) => <tr key={e.id}><td>{fmtDateTime(e.at)}</td><td className="ltr">{e.field}</td><td className="ltr">{e.old_value ?? '—'}</td><td>→</td><td className="ltr">{e.new_value ?? '—'}</td><td>{e.reason}</td></tr>)}</tbody></table></div>
        ) : <Empty />}
      </div>
    </div>
  );
}

function OriginalLink({ fileId }: { fileId: string }) {
  return <button className="link" onClick={async () => { const blob = await api<Blob>(`/api/files/${fileId}`); window.open(URL.createObjectURL(blob), '_blank'); }} data-testid="open-original">{t('open_original')}</button>;
}

const imgCache = new Map<string, Promise<HTMLImageElement>>();
function loadImg(fileId: string): Promise<HTMLImageElement> {
  let p = imgCache.get(fileId);
  if (!p) {
    p = (async () => {
      const blob = await api<Blob>(`/api/files/${fileId}`);
      const dec = await toDecodableImage(new File([blob], 'x', { type: blob.type }));
      const im = new Image();
      im.src = URL.createObjectURL(dec);
      await im.decode();
      return im;
    })();
    imgCache.set(fileId, p);
  }
  return p;
}
function Crop({ fileId, bbox }: { fileId: string; bbox: number[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let alive = true;
    void loadImg(fileId).then((im) => {
      const c = ref.current;
      if (!alive || !c) return;
      const pad = 6;
      const [x0, y0, x1, y1] = bbox;
      const w = x1 - x0 + 2 * pad;
      const h = y1 - y0 + 2 * pad;
      const scale = Math.min(1, 220 / w);
      c.width = w * scale; c.height = h * scale;
      c.getContext('2d')!.drawImage(im, x0 - pad, y0 - pad, w, h, 0, 0, w * scale, h * scale);
    }).catch(() => undefined);
    return () => { alive = false; };
  }, [fileId, bbox.join(',')]);
  return <canvas className="crop" ref={ref} data-testid="crop" />;
}

function RowCard({ row, batchId, editable, fileId, onChange }: { row: ReviewedRow; batchId: string; editable: boolean; fileId: string | null; onChange: (r: Review) => void }) {
  const [edit, setEdit] = useState(false);
  const [vals, setVals] = useState<RowVals>(row.vals);
  const [reason, setReason] = useState('');
  const [exReason, setExReason] = useState('');
  useEffect(() => setVals(row.vals), [row.vals]);
  const cells = (row.raw as { cells?: Record<string, { ref: string; text: string; conf?: number; bbox?: number[] }> } | null)?.cells ?? {};
  const blocked = row.issues.some((i) => i.severity === 'block');
  const overlap = row.issues.find((i) => i.code === 'conflicts_with_approved' || i.code === 'already_approved');
  const flaggedFields = [...new Set(row.issues.filter((i) => ['uncertain_ocr', 'ambiguous_number', 'ambiguous_date'].includes(i.code)).map((i) => i.field!))];
  const patch = async (body: Record<string, unknown>) => onChange(await api<Review>(`/api/batches/${batchId}/rows/${row.id}`, { method: 'PATCH', body }));
  const dimKeys = Object.keys(vals.dims);
  return (
    <div className={`card ${row.excluded ? 'muted' : ''}`} data-testid={`row-${row.idx}`}>
      <div className="spread">
        <b>#{row.idx + 1} <span className="ltr small muted">{row.source_ref}</span></b>
        <span className="row">{row.excluded && <span className="badge">{t('excluded')}</span>}{blocked && !row.excluded && <span className="badge st-behind">{t('blocking')}</span>}</span>
      </div>
      {!edit && (
        <div className="small">
          {dimKeys.filter((k) => vals.dims[k as keyof RowVals['dims']]).map((k) => <span key={k}>{t(`f_${k}`)}: <b>{vals.dims[k as keyof RowVals['dims']]}</b> · </span>)}
          {(['date', 'time', 'start_time', 'end_time'] as const).filter((k) => vals[k]).map((k) => <span key={k}>{t(`f_${k}`)}: <b className="ltr">{vals[k]}</b> · </span>)}
          {vals.measures.map((m) => {
            const key = measureKey(m);
            const c = cells[key];
            return (
              <div key={key} className="row">
                <span>{m.dataset ? `${t(`ds_${m.dataset}`)} · ` : ''}{m.metric} ({t(`role_${m.role}`)}): <b className="ltr" data-testid={`val-${key}`}>{m.value || '∅'}</b> {m.unit ?? vals.unit ?? ''}</span>
                {c && <span className="ltr muted">{c.ref}{c.conf !== undefined ? ` · ${Math.round(c.conf)}%` : ''}</span>}
                {fileId && c?.bbox && <Crop fileId={fileId} bbox={c.bbox} />}
              </div>
            );
          })}
        </div>
      )}
      {row.issues.map((i, k) => <IssueLine key={k} i={i} />)}
      {editable && flaggedFields.length > 0 && !edit && (
        <div className="row">{flaggedFields.map((f) => (
          <ActionButton key={f} kind="plain" testId={`confirm-${f}`} onClick={() => patch({ vals: { ...vals, confirmed: [...new Set([...(vals.confirmed ?? []), f])] }, reason: 'confirmed by owner' })}>{t('confirm_value')} · {f}</ActionButton>
        ))}</div>
      )}
      {editable && overlap && overlap.code === 'conflicts_with_approved' && (
        <div className="row">
          <ActionButton kind="plain" testId={`res-supersede-${row.idx}`} onClick={() => patch({ resolution: 'supersede', reason: 'owner chose to supersede' })}>{t('res_supersede')}</ActionButton>
          <ActionButton kind="plain" onClick={() => patch({ resolution: 'keep_both', reason: 'owner kept both' })}>{t('res_keep_both')}</ActionButton>
        </div>
      )}
      {editable && edit && (
        <div data-testid={`edit-${row.idx}`}>
          <div className="fields">
            {dimKeys.map((k) => <Field key={k} label={t(`f_${k}`)}><input className="input" value={vals.dims[k as keyof RowVals['dims']] ?? ''} onChange={(e) => setVals({ ...vals, dims: { ...vals.dims, [k]: e.target.value } })} /></Field>)}
            {(['date', 'time', 'start_time', 'end_time'] as const).filter((k) => vals[k] !== undefined).map((k) => <Field key={k} label={t(`f_${k}`)}><input className="input ltr" value={vals[k] ?? ''} onChange={(e) => setVals({ ...vals, [k]: e.target.value })} /></Field>)}
            {vals.measures.map((m, mi) => (
              <Field key={measureKey(m)} label={`${m.dataset ? `${t(`ds_${m.dataset}`)} · ` : ''}${m.metric}`}>
                <input className="input ltr" inputMode="decimal" value={m.value} onChange={(e) => setVals({ ...vals, measures: vals.measures.map((x, z) => (z === mi ? { ...x, value: e.target.value } : x)) })} data-testid={`edit-${row.idx}-${measureKey(m)}`} />
              </Field>
            ))}
          </div>
          <Field label={t('reason')}><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} data-testid={`edit-${row.idx}-reason`} /></Field>
          <div className="row">
            <ActionButton testId={`edit-${row.idx}-save`} disabled={!reason.trim()} onClick={async () => { await patch({ vals, reason }); setEdit(false); setReason(''); }}>{t('save')}</ActionButton>
            <button className="btn plain" onClick={() => { setVals(row.vals); setEdit(false); }}>{t('cancel')}</button>
          </div>
        </div>
      )}
      {editable && !edit && (
        <div className="row" style={{ marginBlockStart: 6 }}>
          <button className="btn plain" onClick={() => setEdit(true)} data-testid={`edit-${row.idx}-open`}>{t('edit')}</button>
          {row.excluded ? (
            <ActionButton kind="plain" onClick={() => patch({ excluded: false, reason: 'included again' })}>{t('include')}</ActionButton>
          ) : (
            <span className="row">
              <input className="input" style={{ inlineSize: 180 }} placeholder={t('reason')} value={exReason} onChange={(e) => setExReason(e.target.value)} data-testid={`exclude-${row.idx}-reason`} />
              <ActionButton kind="plain" disabled={!exReason.trim()} testId={`exclude-${row.idx}`} onClick={() => patch({ excluded: true, exclude_reason: exReason, reason: exReason })}>{t('exclude')}</ActionButton>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
