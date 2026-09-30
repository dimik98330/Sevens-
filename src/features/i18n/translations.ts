import type { Locale } from "./locale";
import messages from "@/locales/ui.json";
const dictionary = messages as Record<string, { en: string; kk: string }>;
export function translate(input: string | null | undefined, locale: Locale, params?: Record<string, unknown>): string {
  const source = input ?? "";
  const key = source.trim();
  let result = locale === "ru" ? key : dictionary[key]?.[locale] ?? key;
  if (params) result = result.replace(/\{(\w+)\}/g, (match, name: string) => String(params[name] ?? match));
  return (source.match(/^\s*/)?.[0] ?? "") + result + (source.match(/\s*$/)?.[0] ?? "");
}
