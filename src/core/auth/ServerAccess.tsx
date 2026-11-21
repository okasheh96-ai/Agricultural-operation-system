import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { requireSupabase } from '@/core/supabase';
import { LanguageToggle } from '@/core/components/LanguageToggle';

const inputCls = 'min-h-[44px] rounded border border-stone-300 px-3';

/** First sign-in with the one-time code from the Owner or a manager: the person chooses their own password (packhouse server). */
export function ActivateForm({ onDone }: { onDone: (username: string) => void }) {
  const { t } = useTranslation();
  const [f, setF] = useState({ username: '', code: '', password: '', confirm: '' });
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (f.password !== f.confirm) { setMsg(t('auth.server.mismatch')); return; }
    setBusy(true); setMsg(null);
    try {
      const r = await fetch('/api/activate', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: f.username, code: f.code, new_password: f.password }) });
      const j = (await r.json()) as { ok: boolean; error?: string };
      if (!j.ok) { setMsg(t(j.error === 'weak_password' ? 'auth.server.weak' : 'auth.server.badCode')); return; }
      const { error } = await requireSupabase().auth.signInWithPassword({ email: f.username, password: f.password });
      if (error) setMsg(t('auth.server.badCode')); else onDone(f.username);
    } catch {
      setMsg(t('auth.unreachable'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-lg bg-white p-6 shadow" aria-labelledby="activate-title">
      <h2 id="activate-title" className="text-lg font-semibold">{t('auth.server.activateTitle')}</h2>
      <p className="text-sm text-stone-600">{t('auth.server.activateHint')}</p>
      <label className="flex flex-col gap-1">{t('auth.server.username')}
        <input required dir="ltr" autoComplete="username" className={inputCls} value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} /></label>
      <label className="flex flex-col gap-1">{t('auth.server.code')}
        <input required dir="ltr" autoComplete="one-time-code" className={inputCls} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.trim() })} /></label>
      <label className="flex flex-col gap-1">{t('auth.server.newPassword')}
        <input required type="password" dir="ltr" autoComplete="new-password" className={inputCls} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></label>
      <label className="flex flex-col gap-1">{t('auth.server.confirm')}
        <input required type="password" dir="ltr" autoComplete="new-password" className={inputCls} value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} /></label>
      <p className="text-xs text-stone-600">{t('auth.server.rule')}</p>
      {msg && <p role="alert" className="text-red-700">{msg}</p>}
      <button type="submit" disabled={busy} className="min-h-[44px] rounded bg-brand px-4 font-semibold text-white disabled:opacity-60">{t('auth.server.activate')}</button>
    </form>
  );
}

/** Required password change on first use (temporary password) — nothing else works until it is done (server pre-request check). */
export function ChangePasswordPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [f, setF] = useState({ old: '', password: '', confirm: '' });
  const [msg, setMsg] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (f.password !== f.confirm) { setMsg(t('auth.server.mismatch')); return; }
    const { error } = await requireSupabase().rpc('po_change_password', { p_old: f.old, p_new: f.password });
    if (error) { setMsg(t(error.code === 'P0403' ? 'auth.server.wrongCurrent' : 'auth.server.weak')); return; }
    await qc.invalidateQueries();
  }
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-6">
      <div className="flex justify-end"><LanguageToggle /></div>
      <form onSubmit={submit} className="flex flex-col gap-3 rounded-lg bg-white p-6 shadow" aria-labelledby="change-title">
        <h1 id="change-title" className="text-lg font-semibold">{t('auth.server.changeTitle')}</h1>
        <p className="text-sm text-stone-600">{t('auth.server.changeHint')}</p>
        <label className="flex flex-col gap-1">{t('auth.server.current')}
          <input required type="password" dir="ltr" autoComplete="current-password" className={inputCls} value={f.old} onChange={(e) => setF({ ...f, old: e.target.value })} /></label>
        <label className="flex flex-col gap-1">{t('auth.server.newPassword')}
          <input required type="password" dir="ltr" autoComplete="new-password" className={inputCls} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></label>
        <label className="flex flex-col gap-1">{t('auth.server.confirm')}
          <input required type="password" dir="ltr" autoComplete="new-password" className={inputCls} value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} /></label>
        <p className="text-xs text-stone-600">{t('auth.server.rule')}</p>
        {msg && <p role="alert" className="text-red-700">{msg}</p>}
        <button type="submit" className="min-h-[44px] rounded bg-brand px-4 font-semibold text-white">{t('auth.server.change')}</button>
      </form>
    </main>
  );
}
