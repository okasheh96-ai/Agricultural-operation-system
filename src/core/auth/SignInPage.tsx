import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { requireSupabase } from '@/core/supabase';
import { DEMO_ACCOUNTS, DEMO_PASSWORD, DEMO_PH_ACCOUNTS } from './demoSignIn';
import { signInErrorKey } from './signInError';
import { ActivateForm } from './ServerAccess';
import { AuthShell, authButton, authCard, authInput } from './AuthShell';

/** Real Supabase Auth sign-in (email + password, VR-C09); demo-stack builds add one-tap sign-in for the demo farm. */
export function SignInPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // Which control started the attempt ('form' or a demo email), so progress and errors show where the user is looking.
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ key: string; from: string } | null>(null);
  const [activating, setActivating] = useState(() => new URLSearchParams(window.location.search).get('setup') === '1');
  function showActivation(open: boolean) {
    const url = new URL(window.location.href);
    if (open) url.searchParams.set('setup', '1'); else url.searchParams.delete('setup');
    window.history.replaceState(window.history.state, '', url);
    setActivating(open);
  }

  async function signIn(credentials: { email: string; password: string }, from: string) {
    setBusy(from);
    setError(null);
    try {
      const {error: failure} = await requireSupabase().auth.signInWithPassword(credentials);
      if (failure) setError({key: signInErrorKey(failure), from});
    } catch { setError({key:'auth.unreachable', from}); }
    finally { setBusy(null); }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void signIn({ email, password }, 'form');
  }

  const alert = (shown: boolean) => shown && error && <p role="alert" className="ops-pop rounded-ops-sm border border-ops-redline bg-ops-redbg px-3 py-2 text-sm text-ops-red">{t(error.key)}</p>;

  const demoButton = (a: { email: string; labelKey: string }) => (
    <button key={a.email} type="button" disabled={busy !== null} onClick={() => void signIn({ email: a.email, password: DEMO_PASSWORD }, a.email)}
      className="ops-press flex min-h-touch flex-col items-start justify-center rounded-ops-sm border border-ops-line bg-ops-surface px-4 py-2 text-start hover:border-ops-accentline disabled:opacity-60">
      <span className="font-semibold">{busy === a.email ? t('auth.signingIn') : t(a.labelKey)}</span>
      <bdi className="text-xs text-ops-muted">{a.email}</bdi>
    </button>
  );

  return (
    <AuthShell>
      {__DEMO_SIGNIN__ && (
        <section aria-labelledby="demo-signin" className="flex flex-col gap-3 rounded-[18px] border border-ops-accentline bg-ops-soft p-4">
          <div>
            <h2 id="demo-signin" className="text-lg font-semibold text-ops-accent">{t('auth.demoTitle')}</h2>
            <p className="text-sm text-ops-muted">{t('auth.demoHint')}</p>
          </div>
          {alert(error?.from !== 'form')}
          <div className="flex flex-col gap-2" aria-busy={busy !== null && busy !== 'form'}>
            {DEMO_ACCOUNTS.map((a) => demoButton(a))}
          </div>
          <h3 className="font-semibold text-ops-accent">{t('auth.demoPhTitle')}</h3>
          <div className="grid grid-cols-2 gap-2" aria-busy={busy !== null && busy !== 'form'}>
            {DEMO_PH_ACCOUNTS.map((a) => demoButton(a))}
          </div>
        </section>
      )}
      {__PACKHOUSE_SERVER__ && activating ? <ActivateForm onDone={() => showActivation(false)} /> : (
      <form onSubmit={onSubmit} className={authCard}>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ops-ink">{t('auth.signInTitle')}</h1>
          <p className="mt-1 text-sm text-ops-muted">{t('auth.shell.signInSub')}</p>
        </div>
        <label className="flex flex-col gap-1.5 text-sm font-medium text-ops-ink">
          <span>{__PACKHOUSE_SERVER__ ? t('auth.server.usernameOrEmail') : t('auth.email')}</span>
          <input type={__PACKHOUSE_SERVER__ ? 'text' : 'email'} required dir="ltr" autoComplete="username" value={email}
            onChange={(e) => setEmail(e.target.value)} className={authInput} />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium text-ops-ink">
          <span>{t('auth.password')}</span>
          <input type="password" required dir="ltr" autoComplete="current-password" value={password}
            onChange={(e) => setPassword(e.target.value)} className={authInput} />
        </label>
        {alert(!__DEMO_SIGNIN__ || error?.from === 'form')}
        <button type="submit" disabled={busy !== null} className={authButton}>
          {busy === 'form' ? t('auth.signingIn') : t('auth.signIn')}
        </button>
      </form>
      )}
      {__PACKHOUSE_SERVER__ && (
        <button type="button" onClick={() => showActivation(!activating)}
          className="ops-press min-h-[48px] rounded-ops-sm border border-dashed border-ops-linestrong px-4 text-sm font-semibold text-ops-accent hover:border-ops-accent">
          {activating ? t('auth.server.backToSignIn') : t('auth.server.firstSignIn')}
        </button>
      )}
    </AuthShell>
  );
}
