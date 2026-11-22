import { useState } from 'react';
import { api } from '../api';
import { t, useLang } from '../i18n';
import { ActionButton, Field } from '../ui';
import { localToUtcMs } from '../../shared/time';

const SECTIONS = ['summary', 'today', 'production', 'productivity', 'waste', 'downtime', 'orders', 'sales', 'data'];

export function SnapshotCreate({ filters, onClose }: { filters: object; onClose: () => void }) {
  useLang();
  const [title, setTitle] = useState('');
  const [sections, setSections] = useState<string[]>(SECTIONS);
  const [expires, setExpires] = useState(() => new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10));
  const [recipients, setRecipients] = useState('');
  const [workers, setWorkers] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  return (
    <div data-testid="snapshot-form">
      <h2>{t('make_snapshot')}</h2>
      <p className="small muted">{t('snap_note')}</p>
      <Field label={t('snap_title')}><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} data-testid="snap-title" /></Field>
      <Field label={t('snap_sections')}>
        <div className="row">{SECTIONS.map((s) => (
          <label key={s} className="check"><input type="checkbox" checked={sections.includes(s)} onChange={(e) => setSections((p) => (e.target.checked ? [...p, s] : p.filter((x) => x !== s)))} /> {t(`sec_${s}`)}</label>
        ))}</div>
      </Field>
      <div className="fields">
        <Field label={t('snap_expires')}><input className="input" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} /></Field>
        <Field label={t('snap_recipients')}><input className="input ltr" value={recipients} onChange={(e) => setRecipients(e.target.value)} placeholder="a@x.com, b@y.com" /></Field>
      </div>
      <label className="check"><input type="checkbox" checked={workers} onChange={(e) => setWorkers(e.target.checked)} /> {t('snap_workers')}</label>
      <div className="row">
        <ActionButton testId="snap-create" disabled={!title.trim() || !sections.length} onClick={async () => {
          const r = await api<{ path: string }>('/api/snapshots', { body: { title, filters, sections, expires_at: new Date(localToUtcMs(expires, '23:59')).toISOString(), recipients: recipients.split(/[,\s]+/).filter(Boolean), include_workers: workers } });
          setLink(location.origin + r.path);
        }}>{t('snap_create')}</ActionButton>
        <button className="btn plain" onClick={onClose}>{t('close')}</button>
      </div>
      {link && (
        <div className="notice" data-testid="snap-link">
          {t('snap_link')}: <a className="ltr" href={link}>{link}</a>{' '}
          <button className="link" onClick={() => navigator.clipboard?.writeText(link)}>{t('snap_copy')}</button>
        </div>
      )}
    </div>
  );
}
