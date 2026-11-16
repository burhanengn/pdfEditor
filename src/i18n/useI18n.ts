import { create } from 'zustand';
import {
  dictionaries,
  type SupportedLocale,
  type TranslationKey,
} from './dictionaries';

const LOCALE_STORAGE_KEY = 'gp_locale';

export function detectInitialLocale(): SupportedLocale {
  try {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem(LOCALE_STORAGE_KEY);
      if (saved === 'en' || saved === 'tr') return saved;
    }
  } catch {
    // Ignore storage unavailability
  }
  if (typeof navigator !== 'undefined' && typeof navigator.language === 'string') {
    if (navigator.language.toLowerCase().startsWith('tr')) {
      return 'tr';
    }
  }
  return 'en';
}

export function syncHtmlLangAttribute(locale: SupportedLocale): void {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale;
  }
}

interface I18nState {
  locale: SupportedLocale;
  setLocale: (locale: SupportedLocale) => void;
}

const initialLocale = detectInitialLocale();
syncHtmlLangAttribute(initialLocale);

export const useI18nStore = create<I18nState>((set) => ({
  locale: initialLocale,
  setLocale: (locale) => {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(LOCALE_STORAGE_KEY, locale);
      }
    } catch {
      // Ignore storage error
    }
    syncHtmlLangAttribute(locale);
    set({ locale });
  },
}));

export function translate(
  locale: SupportedLocale,
  key: TranslationKey,
  params?: Record<string, string | number>,
): string {
  const dict = dictionaries[locale] ?? dictionaries.en;
  let text = dict[key] ?? dictionaries.en[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(`{${k}}`, String(v));
    }
  }
  return text;
}

export function useI18n() {
  const locale = useI18nStore((s) => s.locale);
  const setLocale = useI18nStore((s) => s.setLocale);
  const t = (key: TranslationKey, params?: Record<string, string | number>) =>
    translate(locale, key, params);
  return { locale, setLocale, t };
}
