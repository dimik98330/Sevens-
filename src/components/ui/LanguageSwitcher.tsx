"use client";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "@/features/i18n/provider";
import { LOCALES, LOCALE_NAMES, LOCALE_CODES } from "@/features/i18n/locale";
import { Icon } from "./Icon";
export function LanguageSwitcher({ inline = false, showName = false }: { inline?: boolean; showName?: boolean }) {
  const { locale, setLocale, t } = useTranslation();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const outside = (e: Event) => { if (e.target instanceof Node && !root.current?.contains(e.target)) setOpen(false); };
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener("pointerdown", outside); document.addEventListener("focusin", outside); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("focusin", outside); document.removeEventListener("keydown", escape); };
  }, [open]);
  const choices = LOCALES.map(code => <button key={code} type="button" lang={code} aria-pressed={locale === code} onClick={() => { setLocale(code); setOpen(false); }}>{inline ? LOCALE_CODES[code] : LOCALE_NAMES[code]}{!inline && locale === code && <Icon name="check" size={16} />}</button>);
  return <div className={`sevens-language${inline ? " sevens-language-inline" : ""}`} ref={root}>{inline ? <><span>{t("Язык")}</span><div>{choices}</div></> : <><button className="sevens-language-trigger" type="button" ref={trigger} aria-label={t("Выбрать язык")} aria-expanded={open} aria-controls={id} title={LOCALE_NAMES[locale]} onClick={() => setOpen(v => !v)}><Icon name="globe" size={19} /><span lang={showName ? locale : undefined}>{showName ? LOCALE_NAMES[locale] : LOCALE_CODES[locale]}</span><Icon name="chevron" size={14} /></button><div className="sevens-language-panel" id={id} hidden={!open}>{choices}</div></>}</div>;
}
