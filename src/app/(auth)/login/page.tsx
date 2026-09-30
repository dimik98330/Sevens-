"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { ApiError } from "@/features/shared/api-client";
import { store } from "@/features/shared/data";
import { postLoginPath, useSession } from "@/features/shared/session";
import { ErrorNotice, InfoNotice } from "@/components/ui/Feedback";
import { currentMockMode } from "@/features/shared/mock";
import { useAssistantPage } from "@/features/assistant/context";
import { AuthShell } from "@/components/auth/AuthShell";
import { PasswordField } from "@/components/auth/PasswordField";
import { DemoLogin } from "@/components/auth/DemoLogin";
import { Icon } from "@/components/ui/Icon";
import { useTranslation } from "@/features/i18n/provider";
import { safeNextPath } from "@/features/shared/navigation";

export default function LoginPage() {
  return <Suspense><LoginForm /></Suspense>;
}

function LoginForm() {
  const { t: tr, intlLocale } = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = safeNextPath(searchParams.get("next"));
  const { user, refresh, checked } = useSession();
  const navigating = useRef(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [demoRole, setDemoRole] = useState<"CITIZEN" | "STAFF" | null>(null);
  useAssistantPage({ page: "login", saving: busy, navigationBlocked: busy, errorCode: error?.detail?.code, targets: ["auth-email", "auth-password", "auth-register"] });

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
      const { data } = await store.login({ email: email.trim(), password });
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

  const signInDemo = async (role: "CITIZEN" | "STAFF") => {
    if (busy || !checked || navigating.current) return;
    setBusy(true);
    setDemoRole(role);
    setError(null);
    try {
      const { data } = await store.demoLogin(role);
      await refresh();
      navigating.current = true;
      router.replace(safeNextPath(nextPath, data.role) ?? postLoginPath(data.role));
      router.refresh();
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
      setDemoRole(null);
    }
  };

  return (
    <AuthShell mode="login" nextPath={nextPath}>
      <h1>{tr("Войти в Sevens")}</h1>
      {error && <ErrorNotice error={error} id="login-error" />}
      <DemoLogin busy={busy || !checked} activeRole={demoRole} onSignIn={signInDemo} />
      <form className="auth-form" onSubmit={submit} noValidate>
        <div className="auth-field field" data-assistant-target="auth-email">
          <label htmlFor="email">{tr("Электронная почта")}</label>
          <div className="auth-input-wrap">
            <Icon name="mail" size={18} />
            <input
              id="email"
              type="email"
              autoComplete="username"
              placeholder="name@example.com"
              required
              disabled={busy}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={error ? "true" : undefined}
              aria-describedby={error ? "login-error" : undefined}
            />
          </div>
        </div>
        <div className="auth-field field" data-assistant-target="auth-password">
          <label htmlFor="password">{tr("Пароль")}</label>
          <PasswordField
            id="password"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
            required
            disabled={busy}
          />
        </div>
        <button className="auth-submit" type="submit" disabled={busy || !checked} aria-busy={busy}>
          <span>{busy ? tr("Входим…") : tr("Войти")}</span>
          <span className="auth-submit-icon" aria-hidden="true"><Icon name="arrow" size={20} /></span>
        </button>
      </form>
      {process.env.NODE_ENV !== "production" && currentMockMode() && (
        <InfoNotice>
          {tr(" Демо-вход: житель ")}<code>citizen1@example.test</code>{tr(", специалист")}{" "}
          <code>transport@example.test</code>{tr(", администратор ")}<code>admin@example.test</code>.
        </InfoNotice>
      )}
    </AuthShell>
  );
}
