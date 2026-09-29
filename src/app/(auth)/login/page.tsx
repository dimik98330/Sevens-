"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError } from "@/features/shared/api-client";
import { store } from "@/features/shared/data";
import { useSession } from "@/features/shared/session";
import { ErrorNotice, InfoNotice } from "@/components/ui/Feedback";
import { currentMockMode } from "@/features/shared/mock";

export default function LoginPage() {
  const router = useRouter();
  const { refresh } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await store.login({ email: email.trim(), password });
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
        <h1>Вход</h1>
        {error && <ErrorNotice error={error} id="login-error" />}
        <form onSubmit={submit} noValidate>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={error ? "true" : undefined}
              aria-describedby={error ? "email-h login-error" : "email-h"}
            />
            <p className="hint" id="email-h">
              Ошибки входа не уточняют, существует ли такой email.
            </p>
          </div>
          <div className="field">
            <label htmlFor="password">Пароль</label>
            <input
              id="password"
              type={show ? "text" : "password"}
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <p>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                aria-pressed={show}
                onClick={() => setShow((v) => !v)}
              >
                {show ? "Скрыть пароль" : "Показать пароль"}
              </button>
            </p>
          </div>
          <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
            {busy ? "Входим…" : "Войти"}
          </button>
        </form>
        <p>
          Нет аккаунта? <Link href="/register">Зарегистрироваться как житель</Link>
        </p>
        {currentMockMode() && (
          <InfoNotice>
            Демо-режим: житель <code>citizen1@example.test</code>, сотрудник{" "}
            <code>transport@example.test</code>, администратор <code>admin@example.test</code>. На боевом стенде —
            только выданные seed-учётные данные.
          </InfoNotice>
        )}
      </div>
    </div>
  );
}
