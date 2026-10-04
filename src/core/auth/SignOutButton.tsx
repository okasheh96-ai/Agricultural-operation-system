import { useState } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { requireSupabase } from '@/core/supabase';
import { fieldDb } from '@/core/offline/fieldDb';
import { useOutbox } from '@/core/offline/useOutbox';
import { syncNow } from '@/core/offline/sync';

/**
 * Sign-out on a shared crew phone (audit C3): the next person must not see this user's data, and this user's
 * unsent changes must never be sent under someone else's name. Device copies (cached tasks, roles, lookups)
 * are cleared; unsent changes stay on the device, tagged with their author, and are sent only when that
 * person signs in again.
 */
export async function signOutAndClear(qc: QueryClient): Promise<void> {
  const keys = (await fieldDb.meta.toCollection().primaryKeys()) as string[];
  await fieldDb.meta.bulkDelete(keys.filter((k) => k.startsWith('cache:') || k.startsWith('workflow:')));
  qc.clear();
  // scope 'local': works with no signal (the default first calls the server and keeps the session if that fails).
  await requireSupabase().auth.signOut({ scope: 'local' });
}

export function SignOutButton({ className = '' }: { className?: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const outbox = useOutbox();
  const [confirming, setConfirming] = useState(false);
  const pending = (outbox.data ?? []).filter((o) => o.state === 'pending').length;

  if (!confirming) {
    return (
      <button type="button" className={`min-h-touch rounded px-3 underline ${className}`}
        onClick={() => (pending > 0 ? setConfirming(true) : void signOutAndClear(qc))}>
        {t('common.signOut')}
      </button>
    );
  }
  return (
    <div role="alertdialog" aria-label={t('common.signOut')} className="flex flex-col gap-2 rounded border border-amber-400 bg-amber-50 p-3 text-amber-950">
      <p>{t('signout.pendingWarning', { count: pending })}</p>
      <div className="flex flex-wrap gap-2">
        {navigator.onLine && (
          <button type="button" className="min-h-touch rounded bg-brand px-3 font-semibold text-white" onClick={() => void syncNow(qc).then(() => setConfirming(false))}>
            {t('field.syncNow')}
          </button>
        )}
        <button type="button" className="min-h-touch rounded border border-amber-700 px-3" onClick={() => void signOutAndClear(qc)}>{t('signout.anyway')}</button>
        <button type="button" className="min-h-touch rounded border px-3" onClick={() => setConfirming(false)}>{t('common.cancel')}</button>
      </div>
    </div>
  );
}
