import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { requireSupabase } from '@/core/supabase';
import { LanguageToggle } from '@/core/components/LanguageToggle';
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from './demoSignIn';
import { signInErrorKey } from './signInError';

/** Real Supabase Auth sign-in (email + password, VR-C09); demo-stack builds add one-tap sign-in for the demo farm. */
export function SignInPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // Which control started the attempt ('form' or a demo email), so progress and errors show where the user is looking.
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ key: string; from: string } | null>(null);

  async function signIn(credentials: { email: string; password: string }, from: string) {
    setBusy(from);
    setError(null);
    const { error: failure } = await requireSupabase().auth.signInWithPassword(credentials);
    setBusy(null);
    if (failure) setError({ key: signInErrorKey(failure), from });
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void signIn({ email, password }, 'form');
  }

  const alert = (shown: boolean) => shown && error && <p role="alert" className="text-red-700">{t(error.key)}</p>;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-xl font-bold text-brand-dark">
          <span aria-hidden="true" className="text-2xl">🌾</span>
          {t('app.title')}
        </h1>
        <LanguageToggle />
      </div>
      {__DEMO_SIGNIN__ && (
        <section aria-labelledby="demo-signin" className="flex flex-col gap-3 rounded-lg border-2 border-brand bg-brand-light p-4">
          <div>
            <h2 id="demo-signin" className="text-lg font-semibold text-brand-dark">{t('auth.demoTitle')}</h2>
            <p className="text-sm text-stone-700">{t('auth.demoHint')}</p>
          </div>
          {alert(error?.from !== 'form')}
          <div className="flex flex-col gap-2" aria-busy={busy !== null && busy !== 'form'}>
            {DEMO_ACCOUNTS.map((a) => (
              <button key={a.email} type="button" disabled={busy !== null} onClick={() => void signIn({ email: a.email, password: DEMO_PASSWORD }, a.email)}
                className="flex min-h-touch flex-col items-start justify-center rounded bg-white px-4 py-2 text-start shadow-sm hover:bg-stone-50 disabled:opacity-60">
                <span className="font-semibold">{busy === a.email ? t('auth.signingIn') : t(a.labelKey)}</span>
                <bdi className="text-xs text-stone-500">{a.email}</bdi>
              </button>
            ))}
          </div>
        </section>
      )}
      <form onSubmit={onSubmit} className="flex flex-col gap-4 rounded-lg bg-white p-6 shadow">
        <h2 className="text-lg font-semibold">{t('auth.signInTitle')}</h2>
        <label className="flex flex-col gap-1">
          <span>{t('auth.email')}</span>
          <input type="email" required dir="ltr" autoComplete="username" value={email}
            onChange={(e) => setEmail(e.target.value)} className="min-h-touch rounded border border-stone-300 px-3" />
        </label>
        <label className="flex flex-col gap-1">
          <span>{t('auth.password')}</span>
          <input type="password" required dir="ltr" autoComplete="current-password" value={password}
            onChange={(e) => setPassword(e.target.value)} className="min-h-touch rounded border border-stone-300 px-3" />
        </label>
        {alert(!__DEMO_SIGNIN__ || error?.from === 'form')}
        <button type="submit" disabled={busy !== null} className="min-h-touch rounded bg-brand px-4 font-semibold text-white disabled:opacity-60">
          {busy === 'form' ? t('auth.signingIn') : t('auth.signIn')}
        </button>
      </form>
    </main>
  );
}
