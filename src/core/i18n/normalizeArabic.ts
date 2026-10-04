/**
 * Client mirror of app.normalize_ar() (Master Prompt §3.9): alef variants, ta marbuta/ha,
 * alef maqsura/ya, diacritics and tatweel compare as equal. Keep both implementations in sync.
 */
const DIACRITICS_AND_TATWEEL = /[ً-ْٰـ]/g;
const FOLD: Record<string, string> = { 'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ٱ': 'ا', 'ة': 'ه', 'ى': 'ي' };

export function normalizeArabic(input: string | null | undefined): string {
  return (input ?? '')
    .replace(DIACRITICS_AND_TATWEEL, '')
    .replace(/[أإآٱةى]/g, (ch) => FOLD[ch] ?? ch)
    .toLowerCase();
}

export function matchesSearch(haystack: string | null | undefined, query: string): boolean {
  const q = normalizeArabic(query.trim());
  return q === '' || normalizeArabic(haystack).includes(q);
}
