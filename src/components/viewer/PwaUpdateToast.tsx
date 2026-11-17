import { RefreshCw, X } from 'lucide-react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useI18n } from '@/i18n/useI18n';

export function PwaUpdateToast() {
  const { t } = useI18n();
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  if (!needRefresh) return null;

  return (
    <div
      data-testid="pwa-update-toast"
      role="status"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-[75] flex max-w-sm items-center gap-3 rounded-xl border border-slate-700 bg-slate-900/95 px-4 py-3 text-sm text-white shadow-2xl backdrop-blur"
    >
      <RefreshCw className="h-4 w-4 shrink-0 text-blue-400" />
      <span className="flex-1 text-xs font-medium">{t('pwa.updateAvailable')}</span>
      <button
        type="button"
        data-testid="pwa-update-reload-btn"
        onClick={() => void updateServiceWorker(true)}
        className="min-h-[44px] rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white hover:bg-blue-500 sm:min-h-[36px]"
      >
        {t('pwa.reload')}
      </button>
      <button
        type="button"
        data-testid="pwa-update-later-btn"
        onClick={() => setNeedRefresh(false)}
        aria-label={t('pwa.later')}
        className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white sm:min-h-[36px] sm:min-w-[36px]"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
