import { useEffect, useState } from 'react';
import { api, bumpLocalVersion, navigate, useApi } from '../api';
import { fmtDateTime, fmtQ, t, useLang } from '../i18n';
import { ActionButton, Empty, ErrorBox, Field, Loading, Select } from '../ui';

const TABS = ['ref', 'conv', 'general', 'rules', 'lots', 'mappings', 'access', 'snapshots', 'backup', 'audit'] as const;
const KINDS = ['line', 'product', 'grade', 'unit', 'customer', 'downtime_reason', 'currency'];

interface SettingsData {
  settings: Record<string, unknown>;
  ref: { id: string; kind: string; code: string; name_ar: string; name_en: string; active: number }[];
  conversions: { id: string; product: string | null; grade: string | null; from_unit: string; to_unit: string; factor: number; note: string; active: number }[];
  metric_rules: { dataset: string; metric: string; kind: string; aggregation: string; label_ar: string; label_en: string }[];
  lots: { lot: string; closed_at: string | null; note: string; updated_at: string }[];
  mappings: { id: string; name: string; dataset: string; updated_at: string }[];
  units: string[];
}

export function SettingsPage({ tab }: { tab: string }) {
  useLang();
  const cur = (TABS as readonly string[]).includes(tab) ? tab : 'ref';
  const s = useApi<SettingsData>('/api/settings');
  return (
    <div>
      <h1>{t('settings_title')}</h1>
      <div className="chips" role="tablist">
        {TABS.map((x) => <button key={x} role="tab" aria-selected={x === cur} className={x === cur ? 'on' : ''} onClick={() => navigate(`/settings/${x}`)} data-testid={`tab-${x}`}>{t(`tab_${x}`)}</button>)}
      </div>
      {['ref', 'conv', 'general', 'rules', 'lots', 'mappings'].includes(cur) && s.loading && <Loading />}
      {s.error && <ErrorBox error={s.error} onRetry={s.reload} />}
      {s.data && cur === 'ref' && <RefTab d={s.data} reload={s.reload} />}
      {s.data && cur === 'conv' && <ConvTab d={s.data} reload={s.reload} />}
      {s.data && cur === 'general' && <GeneralTab d={s.data} reload={s.reload} />}
      {s.data && cur === 'rules' && <RulesTab d={s.data} />}
      {s.data && cur === 'lots' && <LotsTab d={s.data} reload={s.reload} />}
      {s.data && cur === 'mappings' && <div className="card">{s.data.mappings.length ? <ul>{s.data.mappings.map((m) => <li key={m.id}>{m.name} · {t(`ds_${m.dataset}`) !== `ds_${m.dataset}` ? t(`ds_${m.dataset}`) : m.dataset} · <span className="small muted">{fmtDateTime(m.updated_at)}</span></li>)}</ul> : <Empty />}</div>}
      {cur === 'access' && <AccessTab />}
      {cur === 'snapshots' && <SnapshotsTab />}
      {cur === 'backup' && <BackupTab />}
      {cur === 'audit' && <AuditTab />}
    </div>
  );
}

function RefTab({ d, reload }: { d: SettingsData; reload: () => void }) {
  const [kind, setKind] = useState('line');
  const [code, setCode] = useState('');
  const [ar, setAr] = useState('');
  const [en, setEn] = useState('');
  const items = d.ref.filter((r) => r.kind === kind);
  return (
    <div className="card">
      <div className="chips">{KINDS.map((k) => <button key={k} className={k === kind ? 'on' : ''} onClick={() => setKind(k)} data-testid={`kind-${k}`}>{t(`k_${k}`)}</button>)}</div>
      <div className="fields">
        <Field label={t('code')}><input className="input ltr" value={code} onChange={(e) => setCode(e.target.value)} data-testid="ref-code" /></Field>
        <Field label={t('name_ar')}><input className="input" value={ar} onChange={(e) => setAr(e.target.value)} data-testid="ref-ar" /></Field>
        <Field label={t('name_en')}><input className="input" value={en} onChange={(e) => setEn(e.target.value)} /></Field>
      </div>
      <ActionButton testId="ref-add" disabled={!code.trim()} onClick={async () => { await api('/api/ref', { body: { kind, code, name_ar: ar, name_en: en } }); setCode(''); setAr(''); setEn(''); reload(); }}>{t('add')}</ActionButton>
      {items.length ? (
        <div className="tablewrap"><table><thead><tr><th>{t('code')}</th><th>{t('name_ar')}</th><th>{t('name_en')}</th><th>{t('status')}</th><th /></tr></thead>
          <tbody>{items.map((r) => (
            <tr key={r.id}><td className="ltr">{r.code}</td><td>{r.name_ar}</td><td>{r.name_en}</td><td>{r.active ? t('active') : t('inactive')}</td>
              <td><ActionButton kind="plain" onClick={async () => { await api(`/api/ref/${r.id}`, { method: 'PATCH', body: { active: !r.active } }); reload(); }}>{r.active ? t('deactivate') : t('activate')}</ActionButton></td></tr>
          ))}</tbody></table></div>
      ) : <Empty />}
    </div>
  );
}

function ConvTab({ d, reload }: { d: SettingsData; reload: () => void }) {
  const [f, setF] = useState({ product: '', grade: '', from_unit: 'box', to_unit: 'kg', factor: '', note: '' });
  const set = (k: keyof typeof f) => (v: string) => setF((p) => ({ ...p, [k]: v }));
  const codes = (k: string) => d.ref.filter((r) => r.kind === k && r.active).map((r) => ({ value: r.code, label: r.code }));
  const units = d.units.map((u) => ({ value: u, label: u }));
  return (
    <div className="card">
      <div className="fields">
        <Field label={t('job_product')}><Select value={f.product} onChange={set('product')} options={codes('product')} allowEmpty={t('conv_any')} testId="conv-product" /></Field>
        <Field label={t('job_grade')}><Select value={f.grade} onChange={set('grade')} options={codes('grade')} allowEmpty={t('all')} /></Field>
        <Field label={t('conv_from')}><Select value={f.from_unit} onChange={set('from_unit')} options={units} testId="conv-from" /></Field>
        <Field label={t('conv_to')}><Select value={f.to_unit} onChange={set('to_unit')} options={units} testId="conv-to" /></Field>
        <Field label={t('conv_factor')}><input className="input ltr" inputMode="decimal" value={f.factor} onChange={(e) => set('factor')(e.target.value)} data-testid="conv-factor" /></Field>
        <Field label={t('conv_note')}><input className="input" value={f.note} onChange={(e) => set('note')(e.target.value)} data-testid="conv-note" /></Field>
      </div>
      <ActionButton testId="conv-add" disabled={!f.factor || !f.note.trim()} onClick={async () => { await api('/api/conversions', { body: f }); setF({ ...f, factor: '', note: '' }); reload(); bumpLocalVersion(); }}>{t('add')}</ActionButton>
      {d.conversions.length ? (
        <div className="tablewrap"><table><tbody>{d.conversions.map((c) => (
          <tr key={c.id} className={c.active ? '' : 'excluded'}><td>{c.product ?? t('conv_any')}{c.grade ? ` · ${c.grade}` : ''}</td><td className="ltr">1 {c.from_unit} = {fmtQ(c.factor)} {c.to_unit}</td><td>{c.note}</td>
            <td><ActionButton kind="plain" onClick={async () => { await api(`/api/conversions/${c.id}`, { method: 'PATCH', body: { active: !c.active } }); reload(); }}>{c.active ? t('deactivate') : t('activate')}</ActionButton></td></tr>
        ))}</tbody></table></div>
      ) : <Empty />}
    </div>
  );
}

function GeneralTab({ d, reload }: { d: SettingsData; reload: () => void }) {
  const s = d.settings;
  const [v, setV] = useState({
    timezone: String(s.timezone ?? 'Asia/Amman'), default_shift_start: String(s.default_shift_start ?? '06:00'),
    lot_tol_abs_kg: String(Number(s.lot_tol_abs_kg ?? 0) / 1000), lot_tol_pct: String(s.lot_tol_pct ?? 0), pace_tol_pct: String(s.pace_tol_pct ?? 0), rate_tol_pct: String(s.rate_tol_pct ?? 0),
    ocr_threshold: String(s.ocr_threshold ?? 80), ai_enabled: s.ai_enabled === true, ai_monthly_call_limit: String(s.ai_monthly_call_limit ?? 0), show_workers_to_viewers: s.show_workers_to_viewers === true,
  });
  const num = (x: string) => Number(x.replace(',', '.'));
  return (
    <div className="card">
      <div className="fields">
        <Field label={t('timezone')}><input className="input ltr" value={v.timezone} onChange={(e) => setV({ ...v, timezone: e.target.value })} /></Field>
        <Field label={t('default_shift_start')}><input className="input" type="time" value={v.default_shift_start} onChange={(e) => setV({ ...v, default_shift_start: e.target.value })} /></Field>
        <Field label={t('lot_tol_abs')}><input className="input ltr" inputMode="decimal" value={v.lot_tol_abs_kg} onChange={(e) => setV({ ...v, lot_tol_abs_kg: e.target.value })} data-testid="tol-abs" /></Field>
        <Field label={t('lot_tol_pct')}><input className="input ltr" inputMode="decimal" value={v.lot_tol_pct} onChange={(e) => setV({ ...v, lot_tol_pct: e.target.value })} /></Field>
        <Field label={t('pace_tol')}><input className="input ltr" inputMode="decimal" value={v.pace_tol_pct} onChange={(e) => setV({ ...v, pace_tol_pct: e.target.value })} /></Field>
        <Field label={t('rate_tol')}><input className="input ltr" inputMode="decimal" value={v.rate_tol_pct} onChange={(e) => setV({ ...v, rate_tol_pct: e.target.value })} /></Field>
        <Field label={t('ocr_threshold')}><input className="input ltr" inputMode="numeric" value={v.ocr_threshold} onChange={(e) => setV({ ...v, ocr_threshold: e.target.value })} /></Field>
      </div>
      <p className="small muted">{t('tol_note')}</p>
      <label className="check"><input type="checkbox" checked={v.show_workers_to_viewers} onChange={(e) => setV({ ...v, show_workers_to_viewers: e.target.checked })} /> {t('show_workers_all')}</label>
      <div className="notice">
        <label className="check"><input type="checkbox" checked={v.ai_enabled} onChange={(e) => setV({ ...v, ai_enabled: e.target.checked })} data-testid="ai-enabled" /> {t('ai_enabled')}</label>
        <Field label={t('ai_limit')}><input className="input ltr" inputMode="numeric" value={v.ai_monthly_call_limit} onChange={(e) => setV({ ...v, ai_monthly_call_limit: e.target.value })} /></Field>
        <p className="small">{t('ai_note')}</p>
      </div>
      <ActionButton testId="general-save" onClick={async () => {
        await api('/api/settings', { method: 'PUT', body: {
          timezone: v.timezone, default_shift_start: v.default_shift_start, lot_tol_abs_kg: Math.round(num(v.lot_tol_abs_kg) * 1000), lot_tol_pct: num(v.lot_tol_pct), pace_tol_pct: num(v.pace_tol_pct),
          rate_tol_pct: num(v.rate_tol_pct), ocr_threshold: num(v.ocr_threshold), ai_enabled: v.ai_enabled, ai_monthly_call_limit: Math.round(num(v.ai_monthly_call_limit)), show_workers_to_viewers: v.show_workers_to_viewers,
        } });
        reload(); bumpLocalVersion();
      }}>{t('save')}</ActionButton>
    </div>
  );
}

function RulesTab({ d }: { d: SettingsData }) {
  return (
    <div className="card">
      {d.metric_rules.length ? (
        <table><thead><tr><th>{t('rule_dataset')}</th><th>{t('rule_metric')}</th><th>{t('rule_kind')}</th><th>{t('rule_agg')}</th></tr></thead>
          <tbody>{d.metric_rules.map((r) => <tr key={`${r.dataset}/${r.metric}`}><td className="ltr">{r.dataset}</td><td>{r.label_ar || r.metric}</td><td>{t(`kind_${r.kind}`)}</td><td>{t(`agg_${r.aggregation}`)}</td></tr>)}</tbody></table>
      ) : <Empty />}
      <p className="small muted">{t('unconfirmed_rule')} → {t('nav_today')} · {t('sec_data')}</p>
    </div>
  );
}

function LotsTab({ d, reload }: { d: SettingsData; reload: () => void }) {
  const [lot, setLot] = useState('');
  return (
    <div className="card">
      <div className="row"><input className="input" style={{ inlineSize: 200 }} placeholder={t('lot')} value={lot} onChange={(e) => setLot(e.target.value)} data-testid="lot-code" />
        <ActionButton disabled={!lot.trim()} testId="lot-close" onClick={async () => { await api(`/api/lots/${encodeURIComponent(lot.trim())}`, { method: 'PUT', body: { closed: true } }); setLot(''); reload(); bumpLocalVersion(); }}>{t('close_lot')}</ActionButton></div>
      {d.lots.length ? <table><tbody>{d.lots.map((l) => (
        <tr key={l.lot}><td>{l.lot}</td><td>{l.closed_at ? `${t('lot_closed')} · ${fmtDateTime(l.closed_at)}` : t('lot_open')}</td>
          <td><ActionButton kind="plain" onClick={async () => { await api(`/api/lots/${encodeURIComponent(l.lot)}`, { method: 'PUT', body: { closed: !l.closed_at } }); reload(); bumpLocalVersion(); }}>{l.closed_at ? t('reopen_lot') : t('close_lot')}</ActionButton></td></tr>
      ))}</tbody></table> : <Empty />}
    </div>
  );
}

function AccessTab() {
  const a = useApi<{ grants: { email: string; display_name: string; show_workers: number; granted_at: string; revoked_at: string | null }[]; owner: string }>('/api/access');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [workers, setWorkers] = useState(false);
  if (a.loading) return <Loading />;
  if (a.error) return <ErrorBox error={a.error} onRetry={a.reload} />;
  return (
    <div className="card" data-testid="access">
      <p className="small">{t('access_owner')}: <span className="ltr">{a.data!.owner}</span></p>
      <p className="small muted">{t('access_note')}</p>
      <div className="fields">
        <Field label={t('email')}><input className="input ltr" type="email" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="grant-email" /></Field>
        <Field label={t('display_name')}><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
      </div>
      <label className="check"><input type="checkbox" checked={workers} onChange={(e) => setWorkers(e.target.checked)} /> {t('show_workers')}</label>
      <ActionButton testId="grant" disabled={!email.includes('@')} onClick={async () => { await api('/api/access', { body: { email, display_name: name, show_workers: workers } }); setEmail(''); setName(''); a.reload(); }}>{t('grant')}</ActionButton>
      {a.data!.grants.length ? (
        <div className="tablewrap"><table><tbody>{a.data!.grants.map((g) => (
          <tr key={g.email} className={g.revoked_at ? 'excluded' : ''} data-testid={`grant-${g.email}`}><td className="ltr">{g.email}</td><td>{g.display_name}</td><td className="small">{g.revoked_at ? `${t('revoked')} ${fmtDateTime(g.revoked_at)}` : `${t('granted')} ${fmtDateTime(g.granted_at)}`}</td>
            <td>{g.show_workers ? t('show_workers') : ''}</td>
            <td>{!g.revoked_at && <ActionButton kind="danger" testId={`revoke-${g.email}`} onClick={async () => { await api(`/api/access/${encodeURIComponent(g.email)}`, { method: 'PATCH', body: { revoke: true } }); a.reload(); }}>{t('revoke')}</ActionButton>}</td></tr>
        ))}</tbody></table></div>
      ) : <Empty />}
    </div>
  );
}

function SnapshotsTab() {
  const s = useApi<{ snapshots: { id: string; title: string; recipients: string; created_at: string; expires_at: string; revoked_at: string | null }[] }>('/api/snapshots');
  if (s.loading) return <Loading />;
  if (s.error) return <ErrorBox error={s.error} onRetry={s.reload} />;
  return (
    <div className="card">
      <p className="small muted">{t('snap_note')}</p>
      {s.data!.snapshots.length ? <table><tbody>{s.data!.snapshots.map((x) => {
        const st = x.revoked_at ? 'snap_revoked' : Date.parse(x.expires_at) <= Date.now() ? 'snap_expired' : 'snap_active';
        return (
          <tr key={x.id} data-testid={`snap-${x.title}`}><td>{x.title}</td><td className="small">{fmtDateTime(x.created_at)} → {fmtDateTime(x.expires_at)}</td><td className="ltr small">{(JSON.parse(x.recipients) as string[]).join(', ')}</td><td><span className="badge">{t(st)}</span></td>
            <td>{st === 'snap_active' && <ActionButton kind="danger" testId={`snap-revoke-${x.title}`} onClick={async () => { await api(`/api/snapshots/${x.id}/revoke`, { body: {} }); s.reload(); }}>{t('snap_revoke')}</ActionButton>}</td></tr>
        );
      })}</tbody></table> : <Empty />}
    </div>
  );
}

function BackupTab() {
  const b = useApi<{ runs: { id: string; started_at: string; finished_at: string | null; status: string; trigger: string; manifest: string | null; error: string | null }[]; tests: { id: string; backup_id: string; started_at: string; status: string; report: string | null }[]; last_success: { started_at: string; finished_at: string } | null }>('/api/backups');
  const [result, setResult] = useState<{ passed: boolean; report: { tables: { name: string; rows: number; restored: number; hashOk: boolean }[]; files: { sha256: string; ok: boolean }[]; error?: string } } | null>(null);
  const download = async (originals: boolean) => {
    const blob = await api<Blob>(`/api/export.zip${originals ? '?originals=1' : ''}`);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `shift-ops-export-${new Date().toISOString().slice(0, 10)}.zip`;
    a.click();
  };
  if (b.loading) return <Loading />;
  if (b.error) return <ErrorBox error={b.error} onRetry={b.reload} />;
  const last = b.data!.last_success;
  return (
    <div>
      <div className="card" data-testid="backup">
        <h2>{t('backup_last')}</h2>
        <p data-testid="backup-last">{last ? fmtDateTime(last.finished_at ?? last.started_at) : t('backup_never')}</p>
        <p className="small muted">{t('backup_auto')}</p>
        <div className="row">
          <ActionButton testId="backup-run" onClick={async () => { await api('/api/backups/run', { body: {} }); b.reload(); }}>{t('backup_run')}</ActionButton>
          <ActionButton kind="plain" testId="export" onClick={() => download(false)}>{t('export_data')}</ActionButton>
          <ActionButton kind="plain" onClick={() => download(true)}>{t('export_all')}</ActionButton>
        </div>
      </div>
      <div className="card">
        <h2>{t('recovery_title')}</h2>
        <p>{t('recovery_1')}</p><p>{t('recovery_2')}</p><p>{t('recovery_3')}</p>
        {last && <ActionButton testId="rehearse" onClick={async () => { const id = b.data!.runs.find((r) => r.status === 'succeeded')!.id; setResult(await api(`/api/backups/${id}/rehearse`, { body: {} })); b.reload(); }}>{t('rehearse')}</ActionButton>}
        {result && (
          <div className={`notice ${result.passed ? '' : 'bad'}`} data-testid="rehearse-result">
            <b>{result.passed ? t('rehearse_passed') : t('rehearse_failed')}</b>
            {result.report.error && <div className="ltr small">{result.report.error}</div>}
            <table className="small"><tbody>{result.report.tables.filter((x) => x.rows > 0).map((x) => <tr key={x.name}><td className="ltr">{x.name}</td><td className="num">{x.rows}</td><td className="num">{x.restored}</td><td>{x.hashOk ? '✓' : '✗'}</td></tr>)}</tbody></table>
            <p className="small">{t('files')}: {result.report.files.filter((f) => f.ok).length}/{result.report.files.length} ✓</p>
          </div>
        )}
      </div>
      <div className="card">
        <table className="small"><thead><tr><th>{t('started')}</th><th>{t('status')}</th><th>{t('tables')}</th><th /></tr></thead>
          <tbody>{b.data!.runs.map((r) => {
            const m = r.manifest ? JSON.parse(r.manifest) as { tables: { rows: number }[]; originals: number } : null;
            return <tr key={r.id}><td>{fmtDateTime(r.started_at)} · {r.trigger}</td><td>{t(r.status === 'succeeded' ? 'run_ok' : r.status === 'failed' ? 'run_failed' : 'run_running')}</td><td>{m ? `${m.tables.reduce((s, x) => s + x.rows, 0)} · ${t('files')} ${m.originals}` : r.error ?? ''}</td><td /></tr>;
          })}</tbody></table>
        {b.data!.tests.length > 0 && <p className="small">{t('rehearse')}: {b.data!.tests.map((x) => `${fmtDateTime(x.started_at)} ${x.status}`).join(' · ')}</p>}
      </div>
    </div>
  );
}

function AuditTab() {
  const [before, setBefore] = useState<number | null>(null);
  const [all, setAll] = useState<{ id: number; at: string; actor: string; action: string; entity: string; entity_id: string | null; detail: string }[]>([]);
  const a = useApi<{ entries: typeof all }>(`/api/audit${before ? `?before=${before}` : ''}`);
  useEffect(() => { if (a.data) setAll((p) => [...p.filter((x) => !a.data!.entries.some((y) => y.id === x.id)), ...a.data!.entries].sort((x, y) => y.id - x.id)); }, [a.data]);
  return (
    <div className="card" data-testid="audit">
      {a.error && <ErrorBox error={a.error} onRetry={a.reload} />}
      <div className="tablewrap"><table className="small">
        <thead><tr><th>{t('audit_at')}</th><th>{t('audit_actor')}</th><th>{t('audit_action')}</th><th>{t('audit_entity')}</th></tr></thead>
        <tbody>{all.map((e) => <tr key={e.id}><td>{fmtDateTime(e.at)}</td><td className="ltr">{e.actor}</td><td>{e.action}</td><td className="ltr">{e.entity}{e.entity_id ? ` · ${e.entity_id.slice(0, 18)}` : ''}</td></tr>)}</tbody>
      </table></div>
      {a.loading && <Loading />}
      {a.data && a.data.entries.length === 100 && <button className="btn plain" onClick={() => setBefore(all[all.length - 1].id)}>{t('older')}</button>}
    </div>
  );
}
