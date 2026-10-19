import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { QueryState } from '@/core/components/QueryState';
import { VerificationBadge, type VerificationStatus } from '@/core/components/VerificationBadge';
import { localizedName, rpc, useInvalidatePh, useLookup } from './api';
import { phErrorMessage } from './phErrors';
import { ErrorBox, btnCls, inputCls } from './ui';

interface Occupancy { id: string; code: string; name_ar: string; name_en: string | null; purpose: string; capacity_pallets: number | null;
  storage_group_id: string | null; storage_group_code: string | null; verification_status: VerificationStatus; sort_order: number; occupancy: number }
interface Group { id: string; code: string; name_ar: string; name_en: string | null }

/** Location board (FR-ST-05) with fridge storage-group assignment (FR-ST-06): occupancy is counted from the pallets themselves. */
export function LocationBoard({ mayAssign }: { mayAssign: boolean }) {
  const { t, i18n } = useTranslation();
  const invalidate = useInvalidatePh();
  const q = useLookup<Occupancy>('occupancy', 'ph_location_occupancy', '*', undefined, false);
  const groups = useLookup<Group>('storage_groups', 'ph_storage_groups', 'id, code, name_ar, name_en');
  const [editing, setEditing] = useState<string | null>(null);
  const [group, setGroup] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function save(l: Occupancy) {
    setError(null);
    try {
      await rpc('ph_set_location_group', { p_location: l.id, p_group: group || null, p_reason: reason || null });
      setEditing(null);
      await invalidate();
    } catch (e) { setError(phErrorMessage(t, e)); }
  }

  const rows = (q.data ?? []).slice().sort((a, b) => a.sort_order - b.sort_order || a.code.localeCompare(b.code));
  return (
    <section className="flex flex-col gap-2 rounded-lg border bg-white p-3">
      <h2 className="font-semibold">{t('ph.locations.title')}</h2>
      <p className="text-sm text-stone-700">{t('ph.locations.intro')}</p>
      <QueryState isLoading={q.isLoading} error={q.error} isEmpty={rows.length === 0} emptyText={t('ph.md.empty')}>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {rows.map((l) => {
            const full = l.capacity_pallets !== null && l.occupancy >= l.capacity_pallets;
            return (
              <article key={l.id} aria-label={l.code} className={`flex flex-col gap-1 rounded border border-s-4 p-2 text-sm ${full ? 'border-s-red-600' : l.occupancy > 0 ? 'border-s-sky-500' : 'border-s-stone-300'}`}>
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold"><bdi>{l.code}</bdi></span>
                  <span className="text-stone-600">{localizedName(i18n.language, l.name_ar, l.name_en)}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded px-1.5 font-semibold ${full ? 'bg-red-100 text-red-900' : 'bg-stone-100'}`}>
                    <bdi>{l.occupancy} / {l.capacity_pallets ?? '—'}</bdi> {t('ph.locations.pallets')}
                  </span>
                  <span className="text-xs text-stone-500">{t(`ph.locations.purpose.${l.purpose}`, { defaultValue: l.purpose })}</span>
                  <VerificationBadge status={l.verification_status} />
                </div>
                <div className="text-xs">{t('ph.md.col.storage_group_id')}: <b><bdi>{l.storage_group_code ?? t('ph.forms.noGroup')}</bdi></b></div>
                {l.capacity_pallets === null && <div className="text-xs text-amber-800">{t('ph.locations.noCapacity')}</div>}
                {mayAssign && editing !== l.id && (
                  <button type="button" className={`${btnCls} self-start`} onClick={() => { setEditing(l.id); setGroup(l.storage_group_id ?? ''); setReason(''); setError(null); }}>
                    {t('ph.locations.changeGroup')}</button>
                )}
                {editing === l.id && (
                  <div className="flex flex-col gap-1">
                    <select aria-label={t('ph.md.col.storage_group_id')} className={inputCls} value={group} onChange={(e) => setGroup(e.target.value)}>
                      <option value="">{t('ph.forms.noGroup')}</option>
                      {groups.data?.map((g) => <option key={g.id} value={g.id}>{g.code} — {localizedName(i18n.language, g.name_ar, g.name_en)}</option>)}
                    </select>
                    <input aria-label={t('ph.fields.reason')} placeholder={l.occupancy > 0 ? t('ph.locations.reasonNeeded') : t('ph.fields.reason')}
                      className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} />
                    <ErrorBox message={error} />
                    <div className="flex gap-2">
                      <button type="button" className={btnCls} onClick={() => void save(l)}>{t('common.save')}</button>
                      <button type="button" className={btnCls} onClick={() => setEditing(null)}>{t('common.cancel')}</button>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </QueryState>
    </section>
  );
}
