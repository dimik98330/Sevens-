"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { useSession } from "@/features/shared/session";
import { currentMockMode } from "@/features/shared/mock";
import { Icon, type IconName } from "./Icon";
import { SevensLogo } from "./SevensLogo";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { useNavigationCheck } from "./NavigationSafety";
import { useTranslation } from "@/features/i18n/provider";

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

function getInitials(displayName: string): string {
  const words = displayName.trim().split(/\s+/u).filter(Boolean);
  const firstWord = words[0];
  if (!firstWord) return "S";
  const lastWord = words.length > 1 ? words.at(-1) : undefined;
  const first = Array.from(firstWord)[0] ?? "S";
  const last = lastWord ? Array.from(lastWord)[0] ?? "" : "";
  return (first + last).toLocaleUpperCase("ru");
}

type HeaderLink = { href: string; label: string; icon: IconName };
type OpenPanel = "account" | "mobile" | null;

export function SiteHeader() {
  const { t: tr, intlLocale } = useTranslation();
  const pathname = usePathname();
  const router = useRouter();
  const { user, checked, unread, signOut } = useSession();
  const canLeave = useNavigationCheck();
  const [openPanel, setOpenPanel] = useState<OpenPanel>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [showMock, setShowMock] = useState(false);
  const accountId = useId();
  const mobileId = useId();
  const accountRef = useRef<HTMLDivElement>(null);
  const accountBtnRef = useRef<HTMLButtonElement>(null);
  const mobileBtnRef = useRef<HTMLButtonElement>(null);
  const mobilePanelRef = useRef<HTMLElement>(null);
  const signingOutRef = useRef(false);

  useEffect(() => {
    setOpenPanel(null);
    setShowMock(process.env.NODE_ENV !== "production" && currentMockMode());
  }, [pathname]);

  useEffect(() => {
    setOpenPanel(null);
  }, [user?.id]);

  useEffect(() => {
    const breakpoint = window.matchMedia("(max-width: 1400px)");
    const closeOnResize = () => setOpenPanel(null);
    breakpoint.addEventListener("change", closeOnResize);
    return () => breakpoint.removeEventListener("change", closeOnResize);
  }, []);

  useEffect(() => {
    if (openPanel === null) return;

    const isInsideOpenPanel = (target: EventTarget | null) => {
      if (!(target instanceof Node)) return false;
      if (openPanel === "account") return Boolean(accountRef.current?.contains(target));
      return Boolean(
        mobileBtnRef.current?.contains(target) || mobilePanelRef.current?.contains(target),
      );
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpenPanel(null);
      if (openPanel === "account") accountBtnRef.current?.focus();
      else mobileBtnRef.current?.focus();
    };
    const onOutsideInteraction = (event: Event) => {
      // Keep the mobile drawer in place until the outside link has received
      // its click. Closing it on mouse focus moves that link before mouseup.
      if (openPanel === "mobile" && event.type === "focusin") return;
      if (!isInsideOpenPanel(event.target)) setOpenPanel(null);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("click", onOutsideInteraction);
    document.addEventListener("focusin", onOutsideInteraction);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("click", onOutsideInteraction);
      document.removeEventListener("focusin", onOutsideInteraction);
    };
  }, [openPanel]);

  const authed = user !== null;
  const citizen = user?.role === "CITIZEN";
  const staff = user?.role === "STAFF" || user?.role === "ADMIN";
  const cabinetHref = citizen ? "/my" : "/staff";
  const roleLabel = user?.role === "ADMIN" ? "Администратор" : staff ? "Специалист" : "Житель";
  const accountOpen = openPanel === "account";
  const mobileOpen = openPanel === "mobile";
  const notificationLabel = unread > 0 ? tr("Уведомления, непрочитанных: {0}", {0: unread}) : tr("Уведомления");
  const unreadDisplay = unread > 99 ? "99+" : unread;
  const navigationLinks: HeaderLink[] = [
    { href: "/", label: "Главная", icon: "home" },
    { href: "/dashboard", label: "Идеи региона", icon: "grid" },
    { href: "/how", label: "О платформе", icon: "layers" },
  ];

  const closePanels = () => setOpenPanel(null);

  const logout = async () => {
    if (signingOutRef.current || !canLeave()) return;
    signingOutRef.current = true;
    setSigningOut(true);
    try {
      await signOut();
      closePanels();
      router.push("/");
      router.refresh();
    } finally {
      signingOutRef.current = false;
      setSigningOut(false);
    }
  };

  return (
    <header className="topbar sevens-header" data-page={pathname === "/" ? "home" : "inner"}>
      <div className="sevens-header-inner">
        <div className="sevens-brand-group">
          <Link className="sevens-brand" href="/" aria-label={tr("Sevens — на главную")} onClick={closePanels}>
            <SevensLogo className="sevens-wordmark" />
          </Link>
          <span className="sevens-region"><Icon name="pin" size={16} />{tr("Область Абай")}</span>
        </div>
        <nav className="sevens-header-nav" aria-label={tr("Основная навигация")}>
          {navigationLinks.map((link) => (
            <Link
              className="sevens-nav-link"
              key={link.href}
              href={link.href}
              aria-current={isActive(pathname, link.href) ? "page" : undefined}
              onClick={closePanels}
            >
              <Icon name={link.icon} size={18} /><span>{tr(link.label)}</span>
            </Link>
          ))}
        </nav>
        <div className="sevens-header-actions">
          <LanguageSwitcher />
          {authed && (
            <>
              <Link className="sevens-cabinet-link" href={cabinetHref} onClick={closePanels} aria-label={staff ? tr("Кабинет специалиста") : tr("Мой кабинет")}><Icon name="user" size={18} /><span>{tr("Мой кабинет")}</span></Link>
              <Link
                className="sevens-notification"
                href="/notifications"
                aria-label={notificationLabel}
                title={notificationLabel}
                aria-current={isActive(pathname, "/notifications") ? "page" : undefined}
                onClick={closePanels}
              >
                <Icon name="bell" size={22} />
                {unread > 0 && <span className="sevens-unread" aria-hidden="true">{unreadDisplay}</span>}
              </Link>
              <div className="sevens-account" ref={accountRef}>
                <button
                  type="button"
                  className="sevens-account-trigger"
                  ref={accountBtnRef}
                  aria-label={`${staff ? tr("Кабинет специалиста") : tr("Мой кабинет")}: ${user.displayName}`}
                  aria-expanded={accountOpen}
                  aria-controls={accountId}
                  onClick={() => setOpenPanel((panel) => panel === "account" ? null : "account")}
                >
                  <span className="sevens-avatar" aria-hidden="true">{getInitials(user.displayName)}</span>
                  <span className="sevens-account-copy"><strong>{user.displayName}</strong><small>{tr(roleLabel)}</small></span>
                  <Icon name="chevron" size={17} />
                </button>
                <div className="sevens-account-panel" id={accountId} hidden={!accountOpen}>
                  <div className="sevens-account-identity"><strong>{user.displayName}</strong><span>{tr(roleLabel)}</span></div>
                  <Link className="sevens-account-link" href={cabinetHref} onClick={closePanels}>
                    <Icon name="user" size={19} /><span>{tr("Открыть кабинет")}</span>
                  </Link>
                  <button
                    type="button"
                    className="sevens-account-signout"
                    disabled={signingOut}
                    aria-busy={signingOut}
                    onClick={logout}
                  >
                    <Icon name="logout" size={19} /><span>{signingOut ? tr("Выходим…") : tr("Выйти")}</span>
                  </button>
                </div>
              </div>
            </>
          )}
          {!authed && checked && (
            <Link className="sevens-login" href="/login" onClick={closePanels}>
              <Icon name="user" size={19} /><span>{tr("Войти")}</span><Icon name="arrow" size={17} />
            </Link>
          )}
          {!authed && !checked && <span className="sevens-session-loading" aria-hidden="true" />}
          <button
            type="button"
            ref={mobileBtnRef}
            className="sevens-menu-trigger"
            aria-expanded={mobileOpen}
            aria-controls={mobileId}
            aria-label={mobileOpen ? tr("Закрыть меню") : tr("Открыть меню")}
            onClick={() => setOpenPanel((panel) => panel === "mobile" ? null : "mobile")}
          >
            <Icon name={mobileOpen ? "close" : "menu"} size={22} />
          </button>
        </div>
      </div>
      <nav
        className="sevens-mobile-panel"
        ref={mobilePanelRef}
        id={mobileId}
        aria-label={tr("Мобильная навигация")}
        hidden={!mobileOpen}
      >
        <p className="sevens-mobile-region"><Icon name="pin" size={17} />{tr("Область Абай")}</p>
        <LanguageSwitcher inline />
        {navigationLinks.map((link) => (
          <Link
            className="sevens-mobile-link"
            key={link.href}
            href={link.href}
            onClick={closePanels}
            aria-current={isActive(pathname, link.href) ? "page" : undefined}
          >
            <Icon name={link.icon} size={20} /><span>{tr(link.label)}</span>
          </Link>
        ))}
        {authed && (
          <>
          <Link className="sevens-mobile-link" href={cabinetHref} onClick={closePanels}><Icon name={staff ? "grid" : "bulb"} size={20} /><span>{staff ? tr("Кабинет специалиста") : tr("Мой кабинет")}</span></Link>
          <Link
            className="sevens-mobile-link"
            href="/notifications"
            aria-label={notificationLabel}
            aria-current={isActive(pathname, "/notifications") ? "page" : undefined}
            onClick={closePanels}
          >
            <Icon name="bell" size={20} /><span>{tr("Уведомления")}</span>
            {unread > 0 && <span className="sevens-unread" aria-hidden="true">{unreadDisplay}</span>}
          </Link>
          <button type="button" className="sevens-mobile-link sevens-mobile-signout" disabled={signingOut} onClick={logout}><Icon name="logout" size={20} /><span>{signingOut ? tr("Выходим…") : tr("Выйти")}</span></button>
          </>
        )}
      </nav>
      {showMock && <p className="sevens-demo-note">{tr("Демонстрационный режим")}</p>}
    </header>
  );
}
