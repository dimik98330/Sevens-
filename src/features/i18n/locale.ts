export const LOCALES = ["ru", "kk", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const LOCALE_COOKIE = "sevens_locale";
export const LOCALE_STORAGE = "sevens.locale.v1";
export const LOCALE_NAMES: Record<Locale, string> = { ru: "Русский", kk: "Қазақша", en: "English" };
export const LOCALE_CODES: Record<Locale, string> = { ru: "RU", kk: "ҚАЗ", en: "EN" };
export const INTL_LOCALES: Record<Locale, string> = { ru: "ru-RU", kk: "kk-KZ", en: "en-GB" };
export function isLocale(value: unknown): value is Locale { return typeof value === "string" && LOCALES.includes(value as Locale); }
