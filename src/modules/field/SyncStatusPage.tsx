import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fieldDb } from '@/core/offline/fieldDb';
import { replay } from '@/core/offline/outbox';
import { supabaseSender } from '@/core/offline/supabaseSender';
import { requireSupabase } from '@/core/supabase';
import { useOnline } from '@/core/components/useOnline';
import { useAuth } from '@/core/auth/AuthProvider';
import { SignOutButton } from '@/core/auth/SignOutButton';
import { ConflictMessage } from '@/core/offline/ConflictMessage';
import { useOthersOutbox } from '@/core/offline/useOutbox';
import { formatDateTime, type Locale } from '@/core/i18n';

/** Visible sync indicator (§3.7): online state, pending count, conflicts with reasons, last sync. */
export default function SyncStatusPage() {
  const { t, i18n } = useTranslation();
  const online = useOnline();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const { session } = useAuth();
  const userId = session?.user.id;
  const others = useOthersOutbox();
  const q = useQuery({
    queryKey: ['outbox', userId, 'status'],
    networkMode: 'always',
    queryFn: async () => {
      const mine = (await fieldDb.outbox.toArray()).filter((i) => i.userId === userId);
      return {
        pending: mine.filter((i) => i.state === 'pending').length,
        conflicts: mine.filter((i) => i.state === 'conflict'),
        lastSynced: (await fieldDb.meta.get('lastSyncedAt'))?.value ?? null,
      };
    },
  });

  async function syncNow() {
    setBusy(true);
    try {
      if (userId) await replay(fieldDb, supabaseSender(requireSupabase()), userId);
    } finally {
      setBusy(false);
      void qc.invalidateQueries({ queryKey: ['outbox'] });
    }
  }

  const card = 'rounded-lg border bg-white p-4 text-lg';
  return (
    <section className="flex flex-col gap-3">
      <h1 className="text-xl font-bold">{t('field.syncTitle')}</h1>
      <p className={card}><span aria-hidden="true">{online ? '● ' : '○ '}</span>{online ? t('field.online') : t('field.offlineShort')}</p>
      <p className={card}>{t('field.pending', { count: q.data?.pending ?? 0 })}</p>
      <p className={card}>{t('field.conflicts', { count: q.data?.conflicts.length ?? 0 })}</p>
      {q.data?.conflicts.map((c) => (
        <p key={c.idempotencyKey} className="rounded border border-red-300 bg-red-50 p-3 text-red-900">
          <ConflictMessage code={c.conflictCode} reason={c.conflictReason} />
        </p>
      ))}
      <p className={card}>
        {t('field.lastSynced', {
          time: q.data?.lastSynced ? formatDateTime(q.data.lastSynced, i18n.language as Locale) : t('field.never'),
        })}
      </p>
      {(others.data ?? 0) > 0 && <p className={card}>{t('signout.othersPending', { count: others.data })}</p>}
      <button type="button" onClick={() => void syncNow()} disabled={!online || busy}
        className="min-h-[56px] rounded bg-brand px-4 text-lg font-semibold text-white disabled:opacity-60">
        {t('field.syncNow')}
      </button>
      <div className="mt-4 border-t pt-4"><SignOutButton /></div>
    </section>
  );
}
