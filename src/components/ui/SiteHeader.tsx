"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useSession } from "@/features/shared/session";
import { currentMockMode } from "@/features/shared/mock";

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

export function SiteHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, unread, signOut } = useSession();
  const [open, setOpen] = useState(false);
  const [showMock, setShowMock] = useState(false);
  useEffect(() => {
    setShowMock(currentMockMode());
  }, []);

  const authed = user !== null;
  const citizen = user?.role === "CITIZEN";
  const staff = user?.role === "STAFF" || user?.role === "ADMIN";

  const logout = async () => {
    await signOut();
    router.push("/");
    router.refresh();
  };

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link className="brand" href="/" aria-label="Идеи для региона — на главную">
          <span className="brand-mark" aria-hidden="true">
            ◈
          </span>
          <span className="brand-text">
            <strong>Идеи для региона</strong>
            <small>Цифровые решения для области Абай</small>
          </span>
        </Link>
        <nav className="topnav" aria-label="Основная навигация">
          <Link href="/" aria-current={isActive(pathname, "/") && pathname === "/" ? "page" : undefined}>
            Главная
          </Link>
          <Link href="/how" aria-current={isActive(pathname, "/how") ? "page" : undefined}>
            Как работает
          </Link>
          {citizen && (
            <Link href="/my" aria-current={isActive(pathname, "/my") ? "page" : undefined}>
              Мои идеи
            </Link>
          )}
          {staff && (
            <Link href="/staff" aria-current={isActive(pathname, "/staff") ? "page" : undefined}>
              Очередь
            </Link>
          )}
          {authed && (
            <Link href="/notifications" aria-current={isActive(pathname, "/notifications") ? "page" : undefined}>
              Уведомления{" "}
              {unread > 0 && (
                <span className="bell-count" aria-label={`Непрочитанных: ${unread}`}>
                  {unread}
                </span>
              )}
            </Link>
          )}
        </nav>
        <div className="topbar-actions">
          {user && <span className="user-chip">{user.displayName}</span>}
          {!authed && (
            <Link className="btn btn-secondary btn-sm" href="/login">
              Войти
            </Link>
          )}
          {authed && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={logout}>
              Выйти
            </button>
          )}
        </div>
        <button
          type="button"
          className="menu-btn"
          aria-expanded={open}
          aria-controls="mobileNav"
          aria-label={open ? "Закрыть меню" : "Открыть меню"}
          onClick={() => setOpen((v) => !v)}
        >
          ☰
        </button>
      </div>
      <nav className="mobile-nav" id="mobileNav" aria-label="Мобильная навигация" hidden={!open}>
        <Link href="/" onClick={() => setOpen(false)}>
          Главная
        </Link>
        <Link href="/how" onClick={() => setOpen(false)}>
          Как работает
        </Link>
        {citizen && (
          <Link href="/my" onClick={() => setOpen(false)}>
            Мои идеи
          </Link>
        )}
        {staff && (
          <Link href="/staff" onClick={() => setOpen(false)}>
            Очередь сотрудника
          </Link>
        )}
        {authed && (
          <Link href="/notifications" onClick={() => setOpen(false)}>
            Уведомления{unread > 0 ? ` (${unread})` : ""}
          </Link>
        )}
        {!authed && (
          <Link href="/login" onClick={() => setOpen(false)}>
            Войти
          </Link>
        )}
      </nav>
      {showMock && (
        <p className="muted" style={{ maxWidth: 1200, margin: "0 auto", padding: "0 16px 6px" }}>
          Режим данных: демо-mock по контракту (разработка). <Link href="/settings">Настройка backend</Link>
        </p>
      )}
    </header>
  );
}
