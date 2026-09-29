"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError } from "@/features/shared/api-client";
import { store } from "@/features/shared/data";
import { useSession } from "@/features/shared/session";
import { ErrorNotice } from "@/components/ui/Feedback";

export default function RegisterPage() {
  const router = useRouter();
  const { refresh } = useSession();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await store.register({ displayName: name, email: email.trim(), password, consentAccepted: consent });
      await refresh();
      router.push("/my");
      router.refresh();
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="narrow">
      <div className="card">
        <h1>Регистрация жителя</h1>
        {error && <ErrorNotice error={error} id="register-error" />}
        <form onSubmit={submit} noValidate>
          <div className="field">
            <label htmlFor="name">Имя</label>
            <input id="name" type="text" autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} aria-invalid={error ? "true" : undefined} aria-describedby={error ? "register-error" : undefined} />
          </div>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={error ? "true" : undefined}
              aria-describedby={error ? "register-error" : undefined}
            />
          </div>
          <div className="field">
            <label htmlFor="password">Пароль</label>
            <input
              id="password"
              type="password"
              autoComplete="new-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-describedby="pw-h"
            />
            <p className="hint" id="pw-h">
              12–128 символов, разрешены пробелы и Unicode.
            </p>
          </div>
          <div className="field">
            <label htmlFor="consent" className="check-row">
              <input id="consent" type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} aria-invalid={error ? "true" : undefined} aria-describedby={error ? "register-error" : undefined} />
              <span>Соглашаюсь на обработку данных в рамках демонстрационного сервиса</span>
            </label>
          </div>
          <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
            {busy ? "Регистрируем…" : "Зарегистрироваться"}
          </button>
        </form>
        <p className="muted">
          Регистрируемся только как житель. Сотрудники создаются через seed/служебный CLI. Email в MVP не
          подтверждается и не выдаёт пользователя за идентифицированного государством.
        </p>
        <p>
          Уже есть аккаунт? <Link href="/login">Войти</Link>
        </p>
      </div>
    </div>
  );
}
