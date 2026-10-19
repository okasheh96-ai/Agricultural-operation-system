import { readFileSync } from 'node:fs';
import i18next, { type TFunction } from 'i18next';
import ar from '@/locales/ar.json';
import en from '@/locales/en.json';
import { OFFICE_NAV, hasPhRole, phOnly, visibleNav } from '@/app/nav';
import type { Access } from '@/core/rbac/access';
import { phErrorMessage, phReason } from './phErrors';
import { PALLET_PATH, STAGES, STATUS_STYLE, formatDuration, minutesBetween, pathIndex } from './stages';

const lookup = (dict: unknown, key: string) => key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], dict);

async function translator(lng: 'ar' | 'en'): Promise<TFunction> {
  const inst = i18next.createInstance();
  await inst.init({ lng, resources: { ar: { translation: ar }, en: { translation: en } }, interpolation: { escapeValue: false } });
  return inst.t;
}

describe('packing-house stages', () => {
  it('names every stage in Arabic and English and marks unbuilt stages with their milestone', () => {
    for (const s of STAGES) {
      expect(typeof lookup(ar, `ph.stages.${s.key}`)).toBe('string');
      expect(typeof lookup(en, `ph.stages.${s.key}`)).toBe('string');
      if (!s.built) expect(s.milestone).toMatch(/^M[2-4]$/);
      if (s.kind === 'later') expect(typeof lookup(en, `ph.laterWhy.${s.key}`)).toBe('string');
    }
  });

  it('gives every pallet status an icon and a name in both languages (never colour alone)', () => {
    const statuses = Object.keys(lookup(en, 'ph.status.ph_incoming_pallet') as object);
    expect(statuses).toHaveLength(16);
    for (const s of statuses) {
      expect(STATUS_STYLE[s]?.icon).toBeTruthy();
      expect(typeof lookup(ar, `ph.status.ph_incoming_pallet.${s}`)).toBe('string');
    }
  });

  it('places a pallet on the stepper from its status and recorded facts', () => {
    const at = (status: string, g2: string | null = null, precool: string | null = null) =>
      pathIndex({ status, arrival_check_result: g2, precool_in_at: precool });
    expect(at('registered')).toBe(0);
    expect(at('registered', 'pass')).toBe(1);
    expect(at('pre_cooling', 'pass')).toBe(2);
    expect(at('awaiting_recheck', 'pass', '2026-10-19T08:00:00Z')).toBe(3);
    expect(at('released', 'pass', '2026-10-19T08:00:00Z')).toBe(PALLET_PATH.findIndex((s) => s.key === 'qc1_released'));
    expect(at('on_hold', 'pass', '2026-10-19T08:00:00Z')).toBe(2);
    expect(at('on_hold', 'pass')).toBe(1);
  });

  it('names every stepper step and every audited pallet column in both languages', () => {
    for (const s of PALLET_PATH) {
      expect(typeof lookup(ar, `ph.path.${s.key}`)).toBe('string');
      expect(typeof lookup(en, `ph.path.${s.key}`)).toBe('string');
    }
    const sql = readFileSync('supabase/migrations/20261019001200_ph_receiving.sql', 'utf8');
    const table = /create table public\.ph_incoming_pallets \(([\s\S]*?)\n\);/.exec(sql)?.[1] ?? '';
    const columns = [...table.matchAll(/^ {2}([a-z_0-9]+) /gm)].map((m) => m[1]).filter((c) => c !== 'check');
    expect(columns.length).toBeGreaterThan(30);
    for (const c of columns) expect([c, typeof lookup(ar, `ph.fields.${c}`)]).toEqual([c, 'string']);
  });

  it('formats durations for strips and tabs', () => {
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(42)).toBe('42 min');
    expect(formatDuration(65)).toBe('1:05 h');
    expect(formatDuration(52 * 60)).toBe('2 d 4 h');
    expect(minutesBetween('2026-10-19T08:00:00Z', '2026-10-19T08:31:00Z')).toBe(31);
    expect(minutesBetween(null)).toBeNull();
  });
});

describe('packing-house reasons', () => {
  const err = (detail: object, code = 'P0403') => ({ code, message: 'x', details: JSON.stringify(detail) });

  it('reads the machine reason the database attaches, and ignores anything else', () => {
    expect(phReason(err({ key: 'ph.v02' }))?.key).toBe('ph.v02');
    expect(phReason({ code: 'P0403', details: 'plain text' })).toBeNull();
    expect(phReason({ code: 'P0403', details: '{not json' })).toBeNull();
    expect(phReason(null)).toBeNull();
  });

  it('explains a denial with the action name and the roles that hold it', async () => {
    const t = await translator('en');
    const msg = phErrorMessage(t, err({ key: 'ph.denied.noRole', action: 'arrival.create', roles: ['DEC', 'WHM'] }));
    expect(msg).toContain('Create / edit / submit arrival');
    expect(msg).toContain('DEC، WHM');
  });

  it('names missing fields in the user language', async () => {
    const t = await translator('ar');
    expect(phErrorMessage(t, err({ key: 'ph.v01', missing: ['harvest_supervisor'] }, 'P0422'))).toContain('مشرف الحصاد');
  });

  it('explains an open-decision block and a segregation-of-duties refusal', async () => {
    const t = await translator('en');
    expect(phErrorMessage(t, err({ key: 'ph.blocked.open', decision: 'OD-17' }, 'P0428'))).toContain('OD-17');
    expect(phErrorMessage(t, err({ key: 'ph.sod', column: 'created_by' }, 'P0423'))).toContain('creator');
    expect(phErrorMessage(t, { code: 'P0428', message: 'blocked' })).toContain('Blocked');
  });

  it('has a sentence for every reason key the database raises', () => {
    const keys = ['afterQa', 'blocked_open', 'blocked_otherOption', 'boxes', 'calibration', 'cell_notOwner', 'decision_alreadySigned',
      'decision_noOwner', 'decision_notOwner', 'denied_disabled', 'denied_noRole', 'denied_pendingDecision', 'denied_proposed', 'fileSize',
      'fileType', 'g1_notPassed', 'g1_vehicle', 'g2_destination', 'g2_notPassed', 'g4_state', 'groupChangeReason', 'hold_dispositionLater',
      'hold_state', 'hold_typeRole', 'later', 'move_purpose', 'move_state', 'noLocation', 'notApproved', 'regrade_otherEngineer',
      'reprintReason', 'rma_mixed', 'sod', 'trace_notFound', 'unknownPallet', 'v01', 'v02', 'v03', 'v04', 'v07', 'v08', 'v21', 'v23', 'v26',
      'voidAfterCheck'];
    for (const k of keys) {
      expect(typeof lookup(ar, `ph.reasons.${k}`)).toBe('string');
      expect(typeof lookup(en, `ph.reasons.${k}`)).toBe('string');
    }
  });
});

describe('packing-house navigation', () => {
  const access = (...roles: string[]): Access => ({
    userId: 'u', farmId: 'f', grants: roles.map((roleCode) => ({ roleCode, departmentId: null, locationId: null, permissions: [] })),
  });

  it('shows the packing house only to people with a packing-house role', () => {
    expect(visibleNav(OFFICE_NAV, access('operations_manager')).map((i) => i.key)).not.toContain('packingHouse');
    expect(visibleNav(OFFICE_NAV, access('ph_qci')).map((i) => i.key)).toContain('packingHouse');
    expect(hasPhRole(access('system_admin', 'ph_adm'))).toBe(true);
  });

  it('starts someone who holds only packing-house roles in the packing house', () => {
    expect(phOnly(access('ph_dec'))).toBe(true);
    expect(phOnly(access('ph_dec', 'supervisor'))).toBe(false);
    expect(phOnly(access())).toBe(false);
  });
});
