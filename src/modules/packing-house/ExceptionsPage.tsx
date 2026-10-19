import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { QueryState } from '@/core/components/QueryState';
import { db, useMyPhPermissions } from './api';
import { HoldsList } from './holds';
import { When } from './ui';

interface ExceptionItem { rule: string; entity_type: string; entity_id: string; code: string; since: string | null; severity: string; params: Record<string, unknown> }

const RULE_ORDER = ['E-02', 'E-05', 'E-06', 'E-03', 'E-04', 'X-01', 'OD-05', 'V-03', 'FR-MD-06'];

/** Exception board (FR-RP-02, M1 scope): every open exception links to its record. */
export default function ExceptionsPage() {
  const { t } = useTranslation();
  const perms = useMyPhPermissions();
  const q = useQuery({
    queryKey: ['ph', 'exceptions'],
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await db().from('ph_exception_items').select('*').returns<ExceptionItem[]>();
      if (error) throw error;
      return data ?? [];
    },
  });
  const groups = RULE_ORDER.map((rule) => ({ rule, items: (q.data ?? []).filter((i) => i.rule === rule) })).filter((g) => g.items.length > 0);
  const link = (i: ExceptionItem) => (i.entity_type === 'ph_incoming_pallets' ? `/office/packing-house/pallets/${i.entity_id}`
    : i.entity_type === 'ph_arrivals' ? '/office/packing-house?stage=arrivals' : '/office/packing-house?stage=exceptions');
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h1 className="text-xl font-bold">{t('ph.exceptions.title')}</h1>
        <p className="text-sm text-stone-700">{t('ph.exceptions.intro')}</p>
      </div>
      <QueryState isLoading={q.isLoading} error={q.error} isEmpty={groups.length === 0} emptyText={t('ph.exceptions.none')} onRetry={() => void q.refetch()}>
        <div className="grid gap-3 md:grid-cols-2">
          {groups.map((g) => (
            <section key={g.rule} className={`rounded-lg border border-s-4 bg-white p-3 ${g.items[0]?.severity === 'high' ? 'border-s-red-600' : g.items[0]?.severity === 'medium' ? 'border-s-amber-500' : 'border-s-stone-400'}`}>
              <h2 className="flex items-center gap-2 font-semibold"><span className="rounded bg-stone-800 px-1.5 font-mono text-xs text-white">{g.rule}</span>
                {t(`ph.exceptions.rules.${g.rule.replace(/-/g, '_')}`)} <span className="ms-auto rounded bg-stone-100 px-2 text-sm"><bdi>{g.items.length}</bdi></span></h2>
              <ul className="mt-1 flex flex-col gap-1 text-sm">
                {g.items.slice(0, 12).map((i) => (
                  <li key={`${i.entity_id}-${i.rule}`} className="flex flex-wrap gap-2">
                    <Link className="font-mono underline" to={link(i)}><bdi>{i.code}</bdi></Link>
                    <span className="text-stone-500"><When iso={i.since} /></span>
                    {typeof i.params.minutes !== 'undefined' && <span>{t('ph.exceptions.minutes', { n: i.params.minutes })}</span>}
                    {typeof i.params.hours !== 'undefined' && <span>{t('ph.exceptions.hours', { n: i.params.hours })}</span>}
                  </li>
                ))}
                {g.items.length > 12 && <li className="text-stone-500">{t('ph.exceptions.more', { n: g.items.length - 12 })}</li>}
              </ul>
            </section>
          ))}
        </div>
      </QueryState>
      <h2 className="text-lg font-semibold">{t('ph.holds.title')}</h2>
      <HoldsList perms={perms.data} showClosed />
    </section>
  );
}
