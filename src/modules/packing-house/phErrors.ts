import type { TFunction } from 'i18next';
import { errorKey } from '@/core/errors';

export interface PhReason { key: string; [k: string]: unknown }

/** Machine-readable reason the database attaches to packing-house errors (PostgREST `details`). */
export function phReason(error: unknown): PhReason | null {
  if (typeof error !== 'object' || error === null) return null;
  const details = (error as { details?: unknown }).details;
  if (typeof details !== 'string' || !details.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(details) as PhReason;
    return typeof parsed.key === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

function asList(v: unknown): string {
  return Array.isArray(v) ? v.join('، ') : String(v ?? '');
}

/** One sentence in the user's language explaining a reason (also used for "why is this unavailable"). */
export function reasonText(t: TFunction, reason: PhReason): string {
  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(reason)) params[k] = Array.isArray(v) ? asList(v) : String(v ?? '');
  if ((reason.key === 'ph.v01' || reason.key === 'ph.v09') && Array.isArray(reason.missing)) {
    params.missing = (reason.missing as string[]).map((f) => t(`ph.fields.${f}`, { defaultValue: f })).join('، ');
  }
  if (reason.key === 'ph.sod' && typeof reason.column === 'string') {
    params.column = t(`ph.sodColumns.${reason.column}`, { defaultValue: reason.column });
  }
  if (typeof reason.action === 'string') params.action = t(`ph.actions.${reason.action.replace('.', '_')}`, { defaultValue: reason.action });
  const key = `ph.reasons.${reason.key.replace(/^ph\./, '').replace(/\./g, '_')}`;
  return t(key, { ...params, defaultValue: t('errors.unknown') });
}

/** Error from a packing-house call → message: the specific reason when the database gave one, else the generic code text. */
export function phErrorMessage(t: TFunction, error: unknown): string {
  const reason = phReason(error);
  if (reason) return reasonText(t, reason);
  const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : '';
  if (code === 'P0428') return t('ph.reasons.blocked_open', { decision: '' });
  return t(errorKey(error));
}
