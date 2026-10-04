import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { requireSupabase } from '@/core/supabase';
import { errorKey } from '@/core/errors';
import { QueryState } from '@/core/components/QueryState';
import { VerificationBadge, type VerificationStatus } from '@/core/components/VerificationBadge';

interface QueueRow {
  entity_type: string;
  id: string;
  code: string | null;
  name_ar: string | null;
  name_en: string | null;
  verification_status: VerificationStatus;
  source_note: string | null;
  version: number;
}

/** Administration → Verification Queue: unverified master data, verified only with a source note. */
export default function VerificationQueuePage() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ['verification_queue'],
    queryFn: async () => {
      const { data, error: e } = await requireSupabase()
        .from('verification_queue')
        .select('entity_type, id, code, name_ar, name_en, verification_status, source_note, version')
        .order('entity_type')
        .returns<QueueRow[]>();
      if (e) throw e;
      return data;
    },
  });

  const verify = useMutation({
    mutationFn: async (row: QueueRow) => {
      const { error: e } = await requireSupabase().rpc('set_verification_status', {
        p_entity_type: row.entity_type,
        p_id: row.id,
        p_status: 'verified',
        p_source_note: note,
        p_expected_version: row.version,
      });
      if (e) throw e;
    },
    onSuccess: () => {
      setOpenId(null);
      setNote('');
      setError(null);
      void qc.invalidateQueries({ queryKey: ['verification_queue'] });
    },
    onError: (e) => setError(errorKey(e)),
  });

  return (
    <section>
      <h1 className="mb-2 text-xl font-bold">{t('admin.verificationTitle')}</h1>
      <p className="mb-4 text-stone-700">{t('admin.verificationIntro')}</p>
      <QueryState isLoading={q.isLoading} error={q.error} isEmpty={q.data?.length === 0} onRetry={() => void q.refetch()}>
        <ul className="flex flex-col gap-2">
          {q.data?.map((r) => (
            <li key={`${r.entity_type}:${r.id}`} className="rounded-lg border bg-white p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="text-sm text-stone-600"><bdi>{r.entity_type}</bdi></span>{' '}
                  {r.code && <bdi className="font-mono">{r.code}</bdi>}{' '}
                  <span className="font-semibold">{(i18n.language === 'en' && r.name_en) || r.name_ar || t('common.none')}</span>
                  {r.source_note && <p className="text-sm text-stone-600">{r.source_note}</p>}
                </div>
                <div className="flex items-center gap-2">
                  <VerificationBadge status={r.verification_status} />
                  <button type="button" className="min-h-touch rounded border border-brand px-3 text-brand-dark"
                    onClick={() => { setOpenId(openId === r.id ? null : r.id); setNote(''); setError(null); }}>
                    {t('admin.verify')}
                  </button>
                </div>
              </div>
              {openId === r.id && (
                <form className="mt-3 flex flex-wrap items-end gap-2"
                  onSubmit={(e) => { e.preventDefault(); verify.mutate(r); }}>
                  <label className="flex flex-1 flex-col gap-1"><span>{t('admin.sourceNote')}</span>
                    <input required className="min-h-touch rounded border border-stone-300 px-3" value={note}
                      onChange={(e) => setNote(e.target.value)} /></label>
                  <button type="submit" disabled={verify.isPending || note.trim() === ''}
                    className="min-h-touch rounded bg-brand px-4 font-semibold text-white disabled:opacity-60">{t('common.save')}</button>
                  {error && <p role="alert" className="w-full text-red-700">{t(error)}</p>}
                </form>
              )}
            </li>
          ))}
        </ul>
      </QueryState>
    </section>
  );
}
