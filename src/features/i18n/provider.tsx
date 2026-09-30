"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { isLocale, LOCALE_COOKIE, LOCALE_STORAGE, INTL_LOCALES, type Locale } from "./locale";
import { translate } from "./translations";
import baseMessages from "@/locales/ru.json";
const LanguageContext = createContext<{ locale: Locale; setLocale: (locale: Locale) => void }>({ locale: "ru", setLocale: () => {} });
export function LanguageProvider({ initialLocale, children }: { initialLocale: Locale; children: ReactNode }) {
  const [locale, updateLocale] = useState(initialLocale);
  const setLocale = useCallback((next: Locale) => {
    if (!isLocale(next)) return;
    updateLocale(next);
    try { localStorage.setItem(LOCALE_STORAGE, next); } catch { /* Preference works without storage. */ }
    document.cookie = `${LOCALE_COOKIE}=${next}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
  }, []);
  useEffect(() => {
    try { const saved = localStorage.getItem(LOCALE_STORAGE); if (isLocale(saved) && saved !== initialLocale) setLocale(saved); } catch { /* Storage may be disabled. */ }
    const sync = (event: StorageEvent) => { if (event.key === LOCALE_STORAGE && isLocale(event.newValue)) setLocale(event.newValue); };
    window.addEventListener("storage", sync); return () => window.removeEventListener("storage", sync);
  }, [initialLocale, setLocale]);
  useEffect(() => { document.documentElement.lang = locale; document.title = translate("Sevens — идеи для области Абай", locale); }, [locale]);
  const value = useMemo(() => ({ locale, setLocale }), [locale, setLocale]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}
export function useTranslation() {
  const { locale, setLocale } = useContext(LanguageContext);
  const t = useCallback((source: string | null | undefined, params?: Record<string, unknown>) => translate(source, locale, params), [locale]);
  return { locale, setLocale, t, intlLocale: INTL_LOCALES[locale] };
}
export function T({ children }: { children: string }) { const { t } = useTranslation(); return t(children); }
export function useUiMessages(): typeof baseMessages {
  const { t } = useTranslation();
  return useMemo(() => {
    const map = (value: unknown): unknown => typeof value === "string" ? t(value) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, map(item)])) : value;
    return map(baseMessages) as typeof baseMessages;
  }, [t]);
}
