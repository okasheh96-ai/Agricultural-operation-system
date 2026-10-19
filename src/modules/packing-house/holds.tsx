import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { db, useInvalidatePh } from './api';
import { HoldStepForm } from './forms';
import { ActionPanel, StatusPill, When, btnCls, primaryBtnCls } from './ui';

interface HoldRow {
  id: string; code: string; status: string; hold_type: string; type_basis: string; reason: string; disposition: string | null;
  disposition_note: string | null; execution_note: string | null; created_at: string;
  ph_hold_items: { pallet_id: string; outcome: string | null; ph_incoming_pallets: { code: string } | null }[];
}

/** Which SM-NC step comes next and which matrix action authorises it (the database re-checks). */
const NEXT: Record<string, { step: string; perms: string[] }[]> = {
  open: [{ step: 'assign', perms: ['hold.assign'] }, { step: 'cancel', perms: ['hold.cancel'] }],
  under_assessment: [{ step: 'decide', perms: ['hold.decide_quality', 'hold.decide_food_safety'] }],
  disposition_decided: [{ step: 'execute', perms: ['hold.execute'] }],
  disposition_executed: [{ step: 'verify', perms: ['hold.verify'] }],
  verified: [{ step: 'close', perms: ['hold.close'] }],
};

export function useHolds() {
  return useQuery({
    queryKey: ['ph', 'holds'],
    queryFn: async () => {
      const { data, error } = await db().from('ph_holds')
        .select('id, code, status, hold_type, type_basis, reason, disposition, disposition_note, execution_note, created_at, ph_hold_items(pallet_id, outcome, ph_incoming_pallets(code))')
        .is('voided_at', null).order('created_at', { ascending: false }).returns<HoldRow[]>();
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function HoldsList({ perms, showClosed = false }: { perms: Map<string, string> | undefined; showClosed?: boolean }) {
  const { t } = useTranslation();
  const q = useHolds();
  const invalidate = useInvalidatePh();
  const [open, setOpen] = useState<{ id: string; step: string } | null>(null);
  const holds = (q.data ?? []).filter((h) => showClosed || !['closed', 'cancelled'].includes(h.status));
  if (holds.length === 0) return <p className="text-sm text-stone-600">{t('ph.holds.none')}</p>;
  return (
    <ul className="flex flex-col gap-2">
      {holds.map((h) => {
        const next = (NEXT[h.status] ?? []).filter((n) => n.perms.some((p) => perms?.has(p)));
        return (
          <li key={h.id} className={`rounded-lg border border-s-4 bg-white p-3 ${h.hold_type === 'food_safety' ? 'border-s-red-600' : 'border-s-amber-500'}`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono font-bold"><bdi>{h.code}</bdi></span>
              <span className="rounded border px-2 py-0.5 text-xs">{t(`ph.holdType.${h.hold_type}`)}</span>
              <StatusPill status={h.status} workflow="ph_hold" />
              {next.map((n) => (
                <button key={n.step} type="button" className={n.step === 'cancel' ? btnCls : primaryBtnCls} onClick={() => setOpen({ id: h.id, step: n.step })}>
                  {t(`ph.holdStep.${n.step}`)}</button>
              ))}
              <span className="ms-auto text-xs text-stone-500"><When iso={h.created_at} /></span>
            </div>
            <p className="mt-1 text-sm">{h.reason}</p>
            <p className="text-xs text-stone-500">{h.type_basis}</p>
            {h.disposition && <p className="text-sm">{t('ph.fields.disposition')}: <strong>{t(`ph.disposition.${h.disposition}`)}</strong> — {h.disposition_note}</p>}
            <div className="mt-1 flex flex-wrap gap-1 text-sm">
              {h.ph_hold_items.map((i) => (
                <Link key={i.pallet_id} className="rounded bg-stone-100 px-2 py-0.5 font-mono underline" to={`/office/packing-house/pallets/${i.pallet_id}`}>
                  <bdi>{i.ph_incoming_pallets?.code}</bdi>{i.outcome ? ` · ${t(`ph.holdOutcome.${i.outcome}`)}` : ''}
                </Link>
              ))}
            </div>
            {open?.id === h.id && (
              <div className="mt-2">
                <ActionPanel title={t(`ph.holdStep.${open.step}`)} onClose={() => setOpen(null)}>
                  <HoldStepForm holdId={h.id} step={open.step} holdType={h.hold_type} onCancel={() => setOpen(null)}
                    onDone={() => { setOpen(null); void invalidate(); }} />
                </ActionPanel>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
