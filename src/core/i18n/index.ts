import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import ar from '@/locales/ar.json';
import en from '@/locales/en.json';

export type Locale = 'ar' | 'en';
const STORAGE_KEY = 'agri.locale';

function readStoredLocale(): Locale {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'en' ? 'en' : 'ar';
  } catch {
    return 'ar';
  }
}

/** Sets lang/dir on <html> so the whole document flips; components use logical CSS only. */
export function applyDocumentDirection(locale: Locale): void {
  document.documentElement.lang = locale;
  document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
}

void i18n.use(initReactI18next).init({
  resources: { ar: { translation: ar }, en: { translation: en } },
  lng: readStoredLocale(),
  fallbackLng: 'ar',
  interpolation: { escapeValue: false },
});
applyDocumentDirection(i18n.language as Locale);

i18n.on('languageChanged', (lng) => {
  applyDocumentDirection(lng as Locale);
  try {
    localStorage.setItem(STORAGE_KEY, lng);
  } catch {
    /* preference only; not operational data */
  }
});

/** Locale-aware formatting. Western Arabic numerals by default (settings.numerals, VR-C08). */
export function formatDateTime(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-JO-u-nu-latn' : 'en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Amman',
  }).format(new Date(iso));
}

export default i18n;
