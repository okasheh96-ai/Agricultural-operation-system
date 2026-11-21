import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/core/auth/AuthProvider';
import { requireSupabase } from '@/core/supabase';
import { errorKey } from '@/core/errors';
import { rpc } from '../api';
import { btn, Card, field, Loaded } from '../ui';

const limits = {po_lockout_attempts:20, po_lockout_minutes:1440, po_session_hours:168, po_activation_hours:720};
interface Setting {key:keyof typeof limits; value:number; version:number}

export function AccountPolicy() {
  const {t} = useTranslation();
  const farm = useAuth().access?.farmId ?? '';
  const query = useQuery({queryKey:['ops','account-policy',farm], enabled:!!farm, queryFn: async () => {
    const {data, error} = await requireSupabase().from('settings').select('key,value,version').eq('farm_id',farm)
      .is('voided_at',null).in('key',Object.keys(limits)).order('key').returns<Setting[]>();
    if (error) throw error;
    return data;
  }});
  return <Card title={t('policy.title')} className="mt-4">
    <Loaded query={query}>{rows => <div className="grid gap-4 sm:grid-cols-2">
      {rows.map(row => <PolicyField key={row.key} row={row} farm={farm} refresh={() => query.refetch()} />)}
    </div>}</Loaded>
  </Card>;
}

function PolicyField({row, farm, refresh}: {row:Setting; farm:string; refresh:() => Promise<unknown>}) {
  const {t} = useTranslation();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [draft, setDraft] = useState<{version:number; value:string} | null>(null);
  const value = draft?.version === row.version ? draft.value : String(row.value);
  async function save(e: FormEvent) {
    e.preventDefault(); setBusy(true); setMessage('');
    try {
      await rpc('ph_set_account_policy',{p_farm:farm,p_key:row.key,p_version:row.version,p_value:Number(value)});
      setMessage('common.saved');
    } catch (err) { setMessage(errorKey(err)); }
    finally { await refresh(); setBusy(false); }
  }
  return <form onSubmit={save} className="rounded-ops-sm border border-ops-line bg-ops-surface2 p-3">
    <label className="text-sm font-medium" htmlFor={row.key}>{t('policy.' + row.key)}</label>
    <div className="mt-2 flex gap-2"><input id={row.key} className={field} type="number" min={1} max={limits[row.key]} step={1} required
      value={value} onChange={e => { setMessage(''); setDraft({version:row.version, value:e.target.value}); }} />
      <button className={btn} disabled={busy || value === String(row.value)}>{t('common.save')}</button></div>
    {message && <p role="status" className="mt-2 text-sm">{t(message)}</p>}
  </form>;
}
