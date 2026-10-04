import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { requireSupabase } from '@/core/supabase';
import { LanguageToggle } from '@/core/components/LanguageToggle';

/** Real Supabase Auth sign-in (email + password, VR-C09). */
export function SignInPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFailed(false);
    const { error } = await requireSupabase().auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) setFailed(true);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-brand-dark">{t('app.title')}</h1>
        <LanguageToggle />
      </div>
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
        {failed && <p role="alert" className="text-red-700">{t('auth.failed')}</p>}
        <button type="submit" disabled={busy} className="min-h-touch rounded bg-brand px-4 font-semibold text-white disabled:opacity-60">
          {busy ? t('auth.signingIn') : t('auth.signIn')}
        </button>
      </form>
    </main>
  );
}
