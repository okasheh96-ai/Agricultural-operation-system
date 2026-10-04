import { Component, type ReactNode } from 'react';
import i18n from '@/core/i18n';

/** A failure (e.g. a screen that could not load) shows a readable message, never a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main role="alert" className="mx-auto flex max-w-md flex-col gap-3 p-6">
        <h1 className="text-xl font-bold">{i18n.t('app.screenFailed')}</h1>
        <p>{i18n.t('app.screenFailedBody')}</p>
        <button type="button" onClick={() => window.location.reload()} className="min-h-touch rounded bg-brand px-4 font-semibold text-white">
          {i18n.t('app.reloadNow')}
        </button>
      </main>
    );
  }
}
