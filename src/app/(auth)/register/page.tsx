"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { ApiError } from "@/features/shared/api-client";
import { store } from "@/features/shared/data";
import { postLoginPath, useSession } from "@/features/shared/session";
import { ErrorNotice } from "@/components/ui/Feedback";
import { useAssistantPage } from "@/features/assistant/context";
import { AuthShell } from "@/components/auth/AuthShell";
import { PasswordField } from "@/components/auth/PasswordField";
import { Icon } from "@/components/ui/Icon";
import { useTranslation } from "@/features/i18n/provider";
import { safeNextPath } from "@/features/shared/navigation";

export default function RegisterPage() {
  return <Suspense><RegisterForm /></Suspense>;
}

function RegisterForm() {
  const { t: tr, intlLocale } = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = safeNextPath(searchParams.get("next"));
  const { user, checked, refresh } = useSession();
  const navigating = useRef(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  useAssistantPage({ page: "register", saving: busy, navigationBlocked: busy, errorCode: error?.detail?.code, targets: ["auth-register", "auth-email", "auth-password"] });

  useEffect(() => {
    if (!checked || !user || busy || navigating.current) return;
    navigating.current = true;
    router.replace(safeNextPath(nextPath, user.role) ?? postLoginPath(user.role));
    router.refresh();
  }, [busy, checked, nextPath, router, user]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !checked || navigating.current) return;
    setBusy(true);
    setError(null);
    try {
      const { data } = await store.register({ displayName: name, email: email.trim(), password, consentAccepted: false });
      await refresh();
      navigating.current = true;
      const role = (data as { role?: string }).role ?? "CITIZEN";
      router.replace(safeNextPath(nextPath, role) ?? postLoginPath(role));
      router.refresh();
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell mode="register" nextPath={nextPath}>
      <h1>{tr("Создать аккаунт")}</h1>

      {error && <ErrorNotice error={error} id="register-error" />}
      <form className="auth-form" onSubmit={submit} noValidate data-assistant-target="auth-register">
        <div className="auth-field field">
          <label htmlFor="name">{tr("Имя и фамилия")}</label>
          <div className="auth-input-wrap">
            <Icon name="user" size={18} />
            <input
              id="name"
              type="text"
              autoComplete="name"
              placeholder={tr("Имя Фамилия")}
              required
              disabled={busy}
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={error ? "true" : undefined}
              aria-describedby={error ? "register-error" : undefined}
            />
          </div>
        </div>
        <div className="auth-field field" data-assistant-target="auth-email">
          <label htmlFor="email">{tr("Электронная почта")}</label>
          <div className="auth-input-wrap">
            <Icon name="mail" size={18} />
            <input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="name@example.com"
              required
              disabled={busy}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={error ? "true" : undefined}
              aria-describedby={error ? "register-error" : undefined}
            />
          </div>
        </div>
        <div className="auth-field field" data-assistant-target="auth-password">
          <label htmlFor="password">{tr("Пароль")}</label>
          <PasswordField
            id="password"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            required
            disabled={busy}
          />
        </div>
        <button className="auth-submit" type="submit" disabled={busy || !checked} aria-busy={busy}>
          <span>{busy ? tr("Регистрируем…") : tr("Зарегистрироваться")}</span>
          <span className="auth-submit-icon" aria-hidden="true"><Icon name="arrow" size={20} /></span>
        </button>
      </form>
      <p className="auth-account-note">{tr("Доступ специалистам предоставляет администратор платформы.")}</p>
    </AuthShell>
  );
}
