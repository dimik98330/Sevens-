"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { useTranslation } from "@/features/i18n/provider";
import { authHref } from "@/features/shared/navigation";

export function AuthShell({ mode, nextPath, children }: { mode: "login" | "register"; nextPath?: string | null; children: ReactNode }) {
  const { t: tr } = useTranslation();
  return (
    <div className="auth-stage" data-auth-mode={mode}>
      <aside className="auth-story" aria-labelledby="auth-story-title">
        <div className="auth-story-copy">
          <h2 id="auth-story-title">{tr("Ваш голос.")}<br /><span>{tr("Ваш регион.")}</span></h2>
        </div>
        <figure className="auth-conversation-art" aria-hidden="true">
          <picture>
            <source media="(min-width: 901px)" srcSet="/sevens/auth-conversation.png" />
            <img
              src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1' height='1'/%3E"
              width={1254}
              height={1254}
              fetchPriority="high"
              alt=""
              draggable={false}
            />
          </picture>
        </figure>
      </aside>
      <div className="auth-form-area">
        <section className="auth-form-card" aria-label={mode === "login" ? tr("Вход в кабинет") : tr("Регистрация жителя")}>
          <nav className="auth-mode-tabs" aria-label={tr("Вход и регистрация")}>
            <Link href={authHref("login", nextPath)} aria-current={mode === "login" ? "page" : undefined}>{tr("Вход")}</Link>
            <Link href={authHref("register", nextPath)} aria-current={mode === "register" ? "page" : undefined} data-assistant-target={mode === "login" ? "auth-register" : undefined}>{tr("Регистрация")}</Link>
          </nav>
          {children}
        </section>
      </div>
    </div>
  );
}
