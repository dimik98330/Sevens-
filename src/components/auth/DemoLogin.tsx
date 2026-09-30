"use client";

import { useEffect, useState } from "react";
import { api } from "@/features/shared/api-client";
import { useTranslation } from "@/features/i18n/provider";
import { Icon } from "@/components/ui/Icon";

type DemoRole = "CITIZEN" | "STAFF";
const messages = {
  ru: {
    citizen: "Житель", staff: "Представитель акимата", entering: "Входим…" },
  kk: {
    citizen: "Тұрғын", staff: "Әкімдік өкілі", entering: "Кіру…" },
  en: {
    citizen: "Resident", staff: "Akimat representative", entering: "Signing in…" },
};

export function DemoLogin({ busy, activeRole, onSignIn }: {
  busy: boolean; activeRole: DemoRole | null; onSignIn: (role: DemoRole) => void;
}) {
  const { locale } = useTranslation();
  const text = messages[locale];
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let cancelled = false;
    api.get<{ enabled: boolean }>("/api/v1/auth/demo")
      .then(({ data }) => { if (!cancelled) setEnabled(data.enabled === true); })
      .catch(() => { /* Regular sign-in remains available. */ });
    return () => { cancelled = true; };
  }, []);
  if (!enabled) return null;
  return (
    <div className="auth-demo">
      <div className="auth-demo-actions">
        {(["CITIZEN", "STAFF"] as const).map((role) => (
          <button key={role} type="button" className="auth-demo-button" disabled={busy}
            aria-busy={busy && activeRole === role} onClick={() => onSignIn(role)}>
            <span>{busy && activeRole === role ? text.entering : role === "CITIZEN" ? text.citizen : text.staff}</span>
            <Icon name="arrow" size={18} />
          </button>
        ))}
      </div>
    </div>
  );
}
