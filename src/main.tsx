import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import '@/core/i18n';
import './index.css';
import { supabase } from '@/core/supabase';
import { AuthProvider } from '@/core/auth/AuthProvider';
import { LanguageToggle } from '@/core/components/LanguageToggle';
import { App } from '@/app/App';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });

function NotConfigured() {
  const { t } = useTranslation();
  return (
    <main className="mx-auto max-w-lg p-6">
      <div className="mb-4 flex justify-end"><LanguageToggle /></div>
      <h1 className="mb-2 text-xl font-bold">{t('config.missingTitle')}</h1>
      <p>{t('config.missingBody')}</p>
    </main>
  );
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    {supabase ? (
      <QueryClientProvider client={queryClient}>
        <AuthProvider><App /></AuthProvider>
      </QueryClientProvider>
    ) : (
      <NotConfigured />
    )}
  </StrictMode>,
);
