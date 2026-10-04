import { useTranslation } from 'react-i18next';

export function LanguageToggle() {
  const { t, i18n } = useTranslation();
  return (
    <button type="button" onClick={() => void i18n.changeLanguage(i18n.language === 'ar' ? 'en' : 'ar')}
      className="min-h-touch rounded px-3 text-brand-dark underline">
      {t('common.language')}
    </button>
  );
}
