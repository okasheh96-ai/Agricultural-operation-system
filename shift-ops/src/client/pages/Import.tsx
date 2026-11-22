import { useEffect, useMemo, useState } from 'react';
import { api, navigate, sha256File, todayLocal, useApi } from '../api';
import { fmtDateTime, t, useLang } from '../i18n';
import { ActionButton, ErrorBox, Field, Select } from '../ui';
import { buildRows, decodeText, inspect, parseCsv, parseXlsx, suggestMapping, type ColumnMap, type Grid, type Inspection, type MappingConfig } from '../import/parse';
import { ocrImage, toDecodableImage } from '../import/ocr';
import { DIM_FIELDS } from '../../shared/rows';

const DATASETS = ['production', 'labour', 'receiving', 'waste', 'carryover', 'downtime', 'order', 'dispatch', 'invoice', 'credit', 'mixed', 'plan', 'custom'];
const FIELD_OPTS = [...DIM_FIELDS, 'date', 'time', 'start_time', 'end_time', 'unit', 'measure', 'attr'] as const;

interface Uploaded { id: string; sha256: string; kind: 'sheet' | 'image'; previous: { file_id: string; name: string; batch_id: string | null; status: string | null }[] }
interface BatchConfig { shift_start: string; default_time?: string; ocr_threshold?: number; mapping: MappingConfig; sheet?: string; langs?: string }
interface SavedMapping { id: string; name: string; dataset: string; signature: string; config: string }

async function readGrids(file: File, onStatus: (s: string) => void, langs: string, onOcr?: (info: { blob: Blob; width: number; height: number }) => void): Promise<Grid[]> {
  if (/\.(xlsx|xlsm)$/i.test(file.name)) return parseXlsx(await file.arrayBuffer());
  if (/\.csv$/i.test(file.name) || file.type === 'text/csv') return [parseCsv(decodeText(await file.arrayBuffer()), 'CSV')];
  if (/^image\//.test(file.type) || /\.(heic|heif|jpe?g|png)$/i.test(file.name)) {
    if (/heic|heif/i.test(file.type + file.name)) onStatus(t('heic_converting'));
    const blob = await toDecodableImage(file);
    onStatus(t('ocr_running'));
    const r = await ocrImage(blob, langs, (p) => onStatus(`${t('ocr_running')} ${Math.round(p * 100)}%`));
    onOcr?.({ blob, width: r.width, height: r.height });
    return [r.grid];
  }
  throw new Error(t('unsupported'));
}

export function ImportPage() {
  useLang();
  const [file, setFile] = useState<File | null>(null);
  const [up, setUp] = useState<Uploaded | null>(null);
  const [grids, setGrids] = useState<Grid[] | null>(null);
  const [sheet, setSheet] = useState(0);
  const [status, setStatus] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const [img, setImg] = useState<{ url: string; width: number; height: number } | null>(null);
  const [langs, setLangs] = useState('ara+eng');
  const [resumeBatch, setResumeBatch] = useState<{ id: string; file_sha256: string; config: BatchConfig; sheet: string | null; dataset: string } | null>(null);
  const pending = useApi<{ batches: { id: string; status: string; dataset: string; file_name: string | null; file_sha256: string; received_rows: number; total_rows: number; created_at: string; config: string; sheet: string | null }[] }>('/api/batches?status=receiving');

  const pick = async (f: File) => {
    setFile(f); setErr(null); setGrids(null); setUp(null); setImg(null);
    try {
      setStatus(t('uploading'));
      const sha = await sha256File(f);
      if (resumeBatch && resumeBatch.file_sha256 !== sha) throw new Error(t('resume_wrong_file'));
      const type = f.type || (/\.csv$/i.test(f.name) ? 'text/csv' : /\.heic$/i.test(f.name) ? 'image/heic' : 'application/octet-stream');
      const u = await api<Uploaded>('/api/files', { raw: f, headers: { 'content-type': type, 'x-file-name': encodeURIComponent(f.name), 'x-sha256': sha } });
      setUp(u);
      setStatus(t('inspecting'));
      const gs = await readGrids(f, setStatus, resumeBatch?.config.langs ?? langs, ({ blob, width, height }) => setImg({ url: URL.createObjectURL(blob), width, height }));
      setGrids(gs);
      const si = resumeBatch?.sheet ? Math.max(0, gs.findIndex((g) => g.name === resumeBatch.sheet)) : Math.max(0, gs.findIndex((g) => g.rows.some((r) => r.some(Boolean))));
      setSheet(si);
      setStatus(u.kind === 'image' ? t('ocr_done') : '');
      if (resumeBatch) await resume(resumeBatch, gs[si], u);
    } catch (e) { setErr(e); setStatus(''); }
  };

  const resume = async (b: NonNullable<typeof resumeBatch>, g: Grid, u: Uploaded) => {
    setStatus(t('sending_rows'));
    const ins = inspect(g, b.config.mapping.headerRow, b.config.mapping.firstDataRow);
    const rows = buildRows(g, ins, b.config.mapping, u.id);
    const { missing } = await api<{ missing: number[] }>(`/api/batches/${b.id}/missing`);
    const todo = rows.filter((r) => missing.includes(r.idx));
    for (let i = 0; i < todo.length; i += 200) {
      await api(`/api/batches/${b.id}/rows`, { body: { rows: todo.slice(i, i + 200) } });
      setStatus(`${t('sending_rows')} ${Math.min(i + 200, todo.length)}/${todo.length}`);
    }
    navigate(`/review/${b.id}`);
  };

  return (
    <div>
      <h1>{t('import_title')}</h1>
      {(pending.data?.batches.length ?? 0) > 0 && (
        <div className="card" data-testid="interrupted">
          <h2>{t('interrupted')}</h2>
          {pending.data!.batches.map((b) => (
            <div className="spread" key={b.id}>
              <span>{b.file_name ?? b.dataset} · {b.received_rows}/{b.total_rows} · <span className="small muted">{fmtDateTime(b.created_at)}</span></span>
              <button className="btn" data-testid="resume" onClick={() => setResumeBatch({ id: b.id, file_sha256: b.file_sha256, config: JSON.parse(b.config), sheet: b.sheet, dataset: b.dataset })}>{t('resume')}</button>
            </div>
          ))}
          {resumeBatch && <div className="notice">{t('resume_pick')}</div>}
        </div>
      )}
      <div className="card">
        <Field label={t('choose_file')} hint={t('file_types')}>
          <input className="input" type="file" accept=".xlsx,.xlsm,.csv,text/csv,image/jpeg,image/png,image/heic,image/heif,.heic,.heif" onChange={(e) => e.target.files?.[0] && pick(e.target.files[0])} data-testid="file-input" />
        </Field>
        <Field label={t('ocr_lang')}><Select value={langs} onChange={setLangs} options={[{ value: 'ara+eng', label: 'العربية + English' }, { value: 'ara', label: 'العربية' }, { value: 'eng', label: 'English' }]} /></Field>
        {status && <div className="state loading" role="status">{status}</div>}
        {err ? <ErrorBox error={err} /> : null}
        {up && up.previous.length > 0 && (
          <div className="notice warn" data-testid="dup-file">{t('duplicate_file_warn')}: {up.previous.map((p) => `${t('renamed_dup')} «${p.name}»${p.status ? ` (${t(`b_${p.status}`)})` : ''}`).join(' · ')}</div>
        )}
      </div>
      {file && up && grids && !resumeBatch && (
        <Mapper key={`${up.id}-${sheet}`} file={file} up={up} grids={grids} sheet={sheet} setSheet={setSheet} img={img} langs={langs} />
      )}
    </div>
  );
}

function Mapper({ file, up, grids, sheet, setSheet, img, langs }: { file: File; up: Uploaded; grids: Grid[]; sheet: number; setSheet: (n: number) => void; img: { url: string; width: number; height: number } | null; langs: string }) {
  const g = grids[sheet];
  const saved = useApi<{ mappings: SavedMapping[] }>('/api/mappings');
  const settings = useApi<{ settings: Record<string, unknown>; units: string[]; ref: unknown[] }>('/api/settings');
  const approved = useApi<{ batches: { id: string; dataset: string; file_name: string | null; created_at: string; shift_date: string }[] }>('/api/batches?status=approved');
  const [dataset, setDataset] = useState('production');
  const [customKey, setCustomKey] = useState('');
  const [hdr, setHdr] = useState<number | undefined>(undefined);
  const [fdr, setFdr] = useState<number | undefined>(undefined);
  const ins: Inspection = useMemo(() => inspect(g, hdr, fdr), [g, hdr, fdr]);
  const [cols, setCols] = useState<ColumnMap[]>(() => suggestMapping(g, inspect(g), 'production').columns);
  const [matched, setMatched] = useState<string | null>(null);
  const [shiftDate, setShiftDate] = useState(todayLocal());
  const [shiftStart, setShiftStart] = useState('06:00');
  const [defaultTime, setDefaultTime] = useState('');
  const [mode, setMode] = useState<'interval' | 'cumulative'>('interval');
  const [supersedes, setSupersedes] = useState('');
  const [mapName, setMapName] = useState('');
  const [progress, setProgress] = useState('');
  const [aiText, setAiText] = useState<string | null>(null);
  const ds = dataset === 'custom' ? `custom:${customKey}` : dataset;
  useEffect(() => { if (settings.data?.settings.default_shift_start) setShiftStart(String(settings.data.settings.default_shift_start)); }, [settings.data]);
  // apply a saved mapping when the headers match
  useEffect(() => {
    const m = saved.data?.mappings.find((x) => x.signature === ins.signature);
    if (m && matched !== m.id) {
      const cfg = JSON.parse(m.config) as MappingConfig & { readingMode?: 'interval' | 'cumulative' };
      setCols(cfg.columns); setHdr(cfg.headerRow); setFdr(cfg.firstDataRow); setMatched(m.id); setMapName(m.name);
      if (m.dataset.startsWith('custom:')) { setDataset('custom'); setCustomKey(m.dataset.slice(7)); } else setDataset(m.dataset);
      if (cfg.readingMode) setMode(cfg.readingMode);
    }
  }, [saved.data, ins.signature]);
  const units = (settings.data?.units ?? ['kg']).map((u) => ({ value: u, label: u }));
  const mapping: MappingConfig = { headerRow: ins.headerRow, firstDataRow: ins.firstDataRow, columns: cols };
  const rows = useMemo(() => buildRows(g, ins, mapping, up.id), [g, ins, cols]);
  const hasValue = cols.some((c) => c.field === 'measure' && (c.role === 'actual' || c.role === 'plan'));
  const setCol = (i: number, p: Partial<ColumnMap>) => setCols((cs) => cs.map((c) => (c.col === i ? { ...c, ...p } : c)));

  const stage = async () => {
    const config: BatchConfig & { readingMode: string } = { shift_start: shiftStart, default_time: defaultTime || undefined, ocr_threshold: Number(settings.data?.settings.ocr_threshold ?? 80), mapping, sheet: g.name, langs, readingMode: mode };
    let mappingId = matched ?? undefined;
    if (mapName.trim()) {
      const r = await api<{ id: string }>('/api/mappings', { body: { id: matched ?? undefined, name: mapName.trim(), dataset: ds, signature: ins.signature, config: { ...mapping, readingMode: mode } } });
      mappingId = r.id;
    }
    const b = await api<{ id: string }>('/api/batches', { body: { source: up.kind === 'image' ? 'photo' : 'sheet', file_id: up.id, mapping_id: mappingId, sheet: g.name, dataset: ds, shift_date: shiftDate, total_rows: rows.length, reading_mode: mode, config, supersedes_batch_id: supersedes || undefined } });
    for (let i = 0; i < rows.length; i += 200) {
      setProgress(`${t('sending_rows')} ${Math.min(i + 200, rows.length)}/${rows.length}`);
      await api(`/api/batches/${b.id}/rows`, { body: { rows: rows.slice(i, i + 200) } });
    }
    navigate(`/review/${b.id}`);
  };

  return (
    <>
      {grids.length > 1 && (
        <div className="card"><h2>{t('sheets')}</h2>
          <div className="chips">{grids.map((x, i) => <button key={x.name} className={i === sheet ? 'on' : ''} onClick={() => setSheet(i)} data-testid={`sheet-${i}`}>{x.name} ({x.rows.length})</button>)}</div>
        </div>
      )}
      <div className="card" data-testid="inspection">
        <h2>{g.name}</h2>
        <p className="small">{ins.dataRows.length} {t('sheet_rows')} · {ins.subtotalRows.length} {t('subtotal_rows')} · {ins.blankRows} {t('blank_rows')} · {ins.merged} {t('merged')}</p>
        <div className="fields">
          <Field label={t('header_row')}><input className="input" type="number" min={1} value={ins.headerRow + 1} onChange={(e) => setHdr(Number(e.target.value) - 1)} data-testid="header-row" /></Field>
          <Field label={t('first_data_row')}><input className="input" type="number" min={1} value={ins.firstDataRow + 1} onChange={(e) => setFdr(Number(e.target.value) - 1)} /></Field>
        </div>
        {img && <PhotoPreview img={img} grid={g} />}
        <h3>{t('preview')}</h3>
        <div className="tablewrap"><table className="small">
          <tbody>{g.rows.slice(0, 25).map((r, ri) => (
            <tr key={ri} className={ins.subtotalRows.includes(ri) ? 'excluded' : ''} style={ri === ins.headerRow ? { fontWeight: 700 } : undefined}>
              <td className="muted">{ri + 1}</td>
              {Array.from({ length: ins.columns }, (_, ci) => { const c = r[ci]; return <td key={ci} className={c?.conf !== undefined && c.conf < 80 ? (c.text ? 'cell-low' : 'cell-none') : ''}>{c?.text ?? ''}</td>; })}
            </tr>
          ))}</tbody>
        </table></div>
        {up.kind === 'image' && <AiPass fileId={up.id} enabled={settings.data?.settings.ai_enabled === true} text={aiText} setText={setAiText} />}
      </div>
      <div className="card" data-testid="mapping">
        <h2>{t('columns')}</h2>
        {matched && <div className="notice">{t('mapping_matched')}: {mapName}</div>}
        <div className="fields">
          <Field label={t('dataset')}><Select value={dataset} onChange={(v) => { setDataset(v); if (!matched) setCols(suggestMapping(g, ins, v === 'custom' ? 'custom:x' : v).columns); }} options={DATASETS.map((d) => ({ value: d, label: t(`ds_${d}`) }))} testId="dataset" /></Field>
          {dataset === 'custom' && <Field label={t('custom_key')}><input className="input ltr" value={customKey} onChange={(e) => setCustomKey(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))} data-testid="custom-key" /></Field>}
        </div>
        <div className="mapgrid">
          {cols.map((c) => (
            <div className="mapcol" key={c.col} data-testid={`col-${c.col}`}>
              <div className="spread"><b>{c.header}</b><span className="sample">{ins.dataRows.slice(0, 3).map((r) => g.rows[r][c.col]?.text ?? '').join(' · ')}</span></div>
              <div className="fields">
                <Field label={t('col_role')}><Select value={c.role} onChange={(v) => setCol(c.col, { role: v as ColumnMap['role'], field: v === 'ignore' ? '' : v === 'reference' ? (c.field === 'measure' ? 'attr' : c.field || 'attr') : 'measure' })} options={['actual', 'plan', 'reference', 'ignore'].map((r) => ({ value: r, label: t(`role_${r}`) }))} testId={`col-${c.col}-role`} /></Field>
                {c.role !== 'ignore' && <Field label={t('col_field')}><Select value={c.field} onChange={(v) => setCol(c.col, { field: v as ColumnMap['field'] })} options={FIELD_OPTS.map((f) => ({ value: f, label: t(`f_${f}`) !== `f_${f}` ? t(`f_${f}`) : f }))} testId={`col-${c.col}-field`} /></Field>}
                {c.field === 'measure' && (
                  <>
                    <Field label={t('col_metric')}><input className="input ltr" value={c.metric ?? ''} onChange={(e) => setCol(c.col, { metric: e.target.value.replace(/[^a-z0-9_]/gi, '').toLowerCase() })} data-testid={`col-${c.col}-metric`} /></Field>
                    <Field label={t('col_unit')}><Select value={c.unit ?? ''} onChange={(v) => setCol(c.col, { unit: v || undefined })} options={units} allowEmpty="—" testId={`col-${c.col}-unit`} /></Field>
                    {dataset === 'mixed' && <Field label={t('col_dataset')}><Select value={c.dataset ?? ''} onChange={(v) => setCol(c.col, { dataset: v || undefined })} options={['production', 'receiving', 'waste', 'carryover', 'labour', 'dispatch'].map((d) => ({ value: d, label: t(`ds_${d}`) }))} allowEmpty="—" testId={`col-${c.col}-dataset`} /></Field>}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="card">
        <div className="fields">
          <Field label={t('shift_date')}><input className="input" type="date" value={shiftDate} onChange={(e) => setShiftDate(e.target.value)} data-testid="shift-date" /></Field>
          <Field label={t('shift_start')}><input className="input" type="time" value={shiftStart} onChange={(e) => setShiftStart(e.target.value)} /></Field>
          <Field label={t('default_time')}><input className="input" type="time" value={defaultTime} onChange={(e) => setDefaultTime(e.target.value)} data-testid="default-time" /></Field>
          <Field label={t('reading_mode')}><Select value={mode} onChange={(v) => setMode(v as 'interval')} options={[{ value: 'interval', label: t('mode_interval') }, { value: 'cumulative', label: t('mode_cumulative') }]} testId="reading-mode" /></Field>
          <Field label={t('set_supersede')}><Select value={supersedes} onChange={setSupersedes} options={(approved.data?.batches ?? []).filter((b) => b.dataset === ds).map((b) => ({ value: b.id, label: `${b.shift_date} · ${b.file_name ?? b.id.slice(0, 8)} · ${fmtDateTime(b.created_at)}` }))} allowEmpty={t('none')} testId="supersedes" /></Field>
          <Field label={t('mapping_name')}><input className="input" value={mapName} onChange={(e) => setMapName(e.target.value)} placeholder={t('save_mapping')} data-testid="mapping-name" /></Field>
        </div>
        {!hasValue && <div className="notice warn">{t('mapping_needed')}</div>}
        <div className="row">
          <ActionButton testId="stage" disabled={!hasValue || !rows.length || (dataset === 'custom' && !customKey)} onClick={stage}>{t('stage_import')} ({rows.length})</ActionButton>
          {progress && <span className="small" role="status">{progress}</span>}
        </div>
        <p className="small muted">{file.name}</p>
      </div>
    </>
  );
}

function PhotoPreview({ img, grid }: { img: { url: string; width: number; height: number }; grid: Grid }) {
  const boxes = grid.rows.flatMap((r) => r.filter((c) => c?.bbox && (c.conf ?? 100) < 80)) as { bbox: [number, number, number, number] }[];
  return (
    <div className="imgbox" data-testid="photo-preview">
      <img src={img.url} alt="" />
      {boxes.map((c, i) => (
        <span key={i} className="bbox" style={{ insetInlineStart: `${(c.bbox[0] / img.width) * 100}%`, insetBlockStart: `${(c.bbox[1] / img.height) * 100}%`, inlineSize: `${((c.bbox[2] - c.bbox[0]) / img.width) * 100}%`, blockSize: `${((c.bbox[3] - c.bbox[1]) / img.height) * 100}%` }} />
      ))}
    </div>
  );
}

function AiPass({ fileId, enabled, text, setText }: { fileId: string; enabled: boolean; text: string | null; setText: (s: string) => void }) {
  if (!enabled) return <p className="small muted">{t('ai_off')}</p>;
  return (
    <div>
      <ActionButton kind="plain" onClick={async () => { const r = await api<{ text: string }>('/api/ai/transcribe', { body: { file_id: fileId } }); setText(r.text); }}>{t('ai_second_pass')}</ActionButton>
      {text !== null && <pre className="small" style={{ whiteSpace: 'pre-wrap' }}>{text}</pre>}
    </div>
  );
}
