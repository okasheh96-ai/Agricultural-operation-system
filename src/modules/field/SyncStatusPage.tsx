import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fieldDb } from '@/core/offline/fieldDb';
import { replay } from '@/core/offline/outbox';
import { supabaseSender } from '@/core/offline/supabaseSender';
import { requireSupabase } from '@/core/supabase';
import { useOnline } from '@/core/components/useOnline';
import { formatDateTime, type Locale } from '@/core/i18n';

/** Visible sync indicator (§3.7): online state, pending count, conflicts with reasons, last sync. */
export default function SyncStatusPage() {
  const { t, i18n } = useTranslation();
  const online = useOnline();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const q = useQuery({
    queryKey: ['outbox'],
    queryFn: async () => ({
      pending: await fieldDb.outbox.where('state').equals('pending').count(),
      conflicts: await fieldDb.outbox.where('state').equals('conflict').toArray(),
      lastSynced: (await fieldDb.meta.get('lastSyncedAt'))?.value ?? null,
    }),
  });

  async function syncNow() {
    setBusy(true);
    try {
      await replay(fieldDb, supabaseSender(requireSupabase()));
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
          <bdi>{c.kind === 'transition' ? `${c.entityType} → ${c.payload.toStatus}` : c.table}</bdi>: {c.conflictReason}
        </p>
      ))}
      <p className={card}>
        {t('field.lastSynced', {
          time: q.data?.lastSynced ? formatDateTime(q.data.lastSynced, i18n.language as Locale) : t('field.never'),
        })}
      </p>
      <button type="button" onClick={() => void syncNow()} disabled={!online || busy}
        className="min-h-[56px] rounded bg-brand px-4 text-lg font-semibold text-white disabled:opacity-60">
        {t('field.syncNow')}
      </button>
    </section>
  );
}
