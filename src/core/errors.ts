/** Maps database error codes raised by RLS and server functions to i18n keys. */
const KNOWN = new Set(['P0403', 'P0404', 'P0409', 'P0422', 'P0423', '23505', '23P01', '42501']);

export function errorKey(error: unknown): string {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : '';
  return KNOWN.has(code) ? `errors.${code}` : 'errors.unknown';
}
