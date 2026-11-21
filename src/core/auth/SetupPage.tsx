import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { requireSupabase } from '@/core/supabase';
import { AuthShell, authButton, authCard, authInput } from './AuthShell';

const labelCls = 'flex flex-col gap-1.5 text-sm font-medium text-ops-ink';

/** One-time Super Admin setup (/setup). Works only while the first Owner account is pending, with the one-time setup code
 *  that is visible only in the hosting dashboard; the person chooses their own username and password. Then it is closed. */
export function SetupPage() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<'loading' | 'open' | 'closed' | 'error'>('loading');
  const [f, setF] = useState({ code: '', username: '', name: '', password: '', confirm: '' });
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fetch('/api/setup').then((r) => r.json()).then((j: { pending: boolean }) => setStatus(j.pending ? 'open' : 'closed')).catch(() => setStatus('error'));
  }, []);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (f.password !== f.confirm) { setMsg(t('auth.server.mismatch')); return; }
    setBusy(true); setMsg(null);
    try {
      const r = await fetch('/api/setup', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: f.code, username: f.username, full_name: f.name, password: f.password }) });
      const j = (await r.json()) as { ok: boolean; error?: string; username?: string };
      if (!j.ok) { setMsg(t(`auth.setup.err.${j.error ?? 'failed'}`, { defaultValue: t('auth.setup.err.failed') })); return; }
      const { error } = await requireSupabase().auth.signInWithPassword({ email: j.username ?? f.username, password: f.password });
      if (error) { setMsg(t('auth.setup.err.failed')); return; }
      window.location.assign('/ops/settings');
    } catch {
      setMsg(t('auth.unreachable'));
    } finally { setBusy(false); }
  }
  return (
    <AuthShell>
      {status === 'open' ? (
        <form onSubmit={submit} className={authCard} aria-labelledby="setup-title">
          <div>
            <h1 id="setup-title" className="text-2xl font-bold tracking-tight">{t('auth.setup.title')}</h1>
            <p className="mt-1 text-sm text-ops-muted">{t('auth.setup.hint')}</p>
          </div>
          <label className={labelCls}>{t('auth.setup.code')}
            <input required dir="ltr" autoComplete="one-time-code" className={authInput} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.trim() })} /></label>
          <div className="flex flex-col gap-1.5">
            <label className={labelCls}>{t('auth.setup.username')}
              <input required dir="ltr" autoComplete="username" aria-describedby="setup-username-rule" className={authInput} value={f.username}
                onChange={(e) => setF({ ...f, username: e.target.value.toLowerCase() })} /></label>
            <span id="setup-username-rule" className="text-xs text-ops-muted">{t('auth.setup.usernameRule')}</span>
          </div>
          <label className={labelCls}>{t('auth.setup.name')}
            <input required autoComplete="name" className={authInput} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
          <label className={labelCls}>{t('auth.server.newPassword')}
            <input required type="password" dir="ltr" autoComplete="new-password" className={authInput} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></label>
          <label className={labelCls}>{t('auth.server.confirm')}
            <input required type="password" dir="ltr" autoComplete="new-password" className={authInput} value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} /></label>
          <p className="text-xs text-ops-muted">{t('auth.server.rule')}</p>
          {msg && <p role="alert" className="ops-pop rounded-ops-sm border border-ops-redline bg-ops-redbg px-3 py-2 text-sm text-ops-red">{msg}</p>}
          <button type="submit" disabled={busy} className={authButton}>{t('auth.setup.submit')}</button>
        </form>
      ) : (
        <div className={authCard}>
          <h1 className="text-2xl font-bold tracking-tight">{t('auth.setup.title')}</h1>
          <p role="status" className="text-sm text-ops-muted">{status === 'loading' ? t('common.loading') : status === 'closed' ? t('auth.setup.closed') : t('auth.unreachable')}</p>
          <a href="/" className={`${authButton} grid place-items-center`}>{t('auth.setup.toSignIn')}</a>
        </div>
      )}
    </AuthShell>
  );
}
