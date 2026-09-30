"use client";

import { useLayoutEffect, useRef, useState, type InputHTMLAttributes } from "react";
import { Icon } from "@/components/ui/Icon";
import { useTranslation } from "@/features/i18n/provider";

type PasswordFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange"> & {
  id: string;
  value: string;
  onChange: (value: string) => void;
};

export function PasswordField({ id, value, onChange, placeholder = "Введите пароль", ...props }: PasswordFieldProps) {
  const { t: tr, intlLocale } = useTranslation();
  const [visible, setVisible] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const selection = useRef<{ start: number; end: number; direction: "forward" | "backward" | "none" } | null>(null);

  useLayoutEffect(() => {
    const saved = selection.current;
    if (saved) input.current?.setSelectionRange(saved.start, saved.end, saved.direction);
    selection.current = null;
  }, [visible]);

  const toggle = () => {
    const field = input.current;
    if (field?.selectionStart !== null && field?.selectionStart !== undefined) {
      selection.current = { start: field.selectionStart, end: field.selectionEnd ?? field.selectionStart, direction: field.selectionDirection ?? "none" };
    }
    setVisible((current) => !current);
  };

  return (
    <div className="auth-input-wrap auth-password-wrap">
      <Icon name="lock" size={18} />
      <input {...props} ref={input} id={id} name={props.name ?? id} type={visible ? "text" : "password"} value={value} onChange={(event) => onChange(event.target.value)} placeholder={tr(placeholder)} autoCapitalize="none" spellCheck={false} />
      <button className="auth-password-toggle" type="button" aria-label={tr("Показывать пароль")} aria-pressed={visible} aria-controls={id} title={visible ? tr("Скрыть пароль") : tr("Показать пароль")} disabled={props.disabled} onClick={toggle}>
        <Icon name={visible ? "eye-off" : "eye"} size={21} />
      </button>
    </div>
  );
}
