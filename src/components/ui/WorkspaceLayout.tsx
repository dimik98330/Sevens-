"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useSession } from "@/features/shared/session";
import { Icon } from "./Icon";
import { SevensLogo } from "./SevensLogo";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { useNavigationCheck } from "./NavigationSafety";
import { useTranslation } from "@/features/i18n/provider";

export function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const { t: tr } = useTranslation();
  const path = usePathname();
  const { user, unread, signOut } = useSession();
  const canLeave = useNavigationCheck();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const signOutPending = useRef(false);
  const workspace = /^\/(my|ideas|staff|notifications|settings)(\/|$)/.test(path);
  const auth = /^\/(login|register)(\/|$)/.test(path);
  if (!workspace) return <div data-page={auth ? "auth" : path === "/" ? "home" : "public"}>{children}</div>;
  const staff = user?.role === "STAFF" || user?.role === "ADMIN";
  const ideasHref = staff ? "/staff" : "/my";
  const ideasActive = path.startsWith(ideasHref) || (!staff && path.startsWith("/ideas"));
  const initials = user?.displayName.trim().split(/\s+/u).slice(0, 2).map((word) => Array.from(word)[0]).join("").toLocaleUpperCase("ru") || "S";
  const role = user?.role === "ADMIN" ? "Администратор" : staff ? "Специалист" : "Житель области Абай";
  const logout = async () => {
    if (signOutPending.current || !canLeave()) return;
    signOutPending.current = true; setSigningOut(true);
    try { await signOut(); router.push("/"); router.refresh(); }
    finally { signOutPending.current = false; setSigningOut(false); }
  };
  return (
    <div className="workspace">
      <aside className="workspace-nav" aria-label={tr("Личный кабинет")}>
        <div className="workspace-sidebar-heading">
          <Link href="/" className="workspace-brand" aria-label={tr("Sevens — на главную")}><SevensLogo className="workspace-wordmark" /></Link>
          <p className="workspace-region"><Icon name="pin" size={14} />{tr("Область Абай")}</p>
        </div>
        {!staff && <Link className="workspace-create" href="/ideas/new"><Icon name="plus" size={19} /> {tr(" Предложить идею")}</Link>}
        <nav className="workspace-links" aria-label={tr("Разделы кабинета")}>
          <Link href="/"><span className="workspace-link-icon"><Icon name="home" size={20} /></span><span className="workspace-link-label">{tr("Главная")}</span></Link>
          <Link href="/dashboard"><span className="workspace-link-icon"><Icon name="globe" size={20} /></span><span className="workspace-link-label">{tr("Идеи региона")}</span></Link>
          <Link href={ideasHref} aria-current={ideasActive ? "page" : undefined}><span className="workspace-link-icon"><Icon name={staff ? "grid" : "bulb"} size={20} /></span><span className="workspace-link-label">{staff ? tr("Очередь идей") : tr("Мои идеи")}</span></Link>
          <Link href="/notifications" aria-current={path === "/notifications" ? "page" : undefined}><span className="workspace-link-icon"><Icon name="bell" size={20} /></span><span className="workspace-link-label">{tr("Уведомления")}</span>{unread > 0 && <span className="nav-counter" aria-label={tr("Непрочитанных: {0}", { "0": unread })}>{unread > 99 ? "99+" : unread}</span>}</Link>
          <Link href="/how"><span className="workspace-link-icon"><Icon name="layers" size={20} /></span><span className="workspace-link-label">{tr("О платформе")}</span></Link>
        </nav>
        <div className="workspace-sidebar-bottom">
          <div className="workspace-account"><span className="workspace-avatar" aria-hidden="true">{initials}</span><div className="workspace-account-copy"><strong title={user?.displayName}>{user?.displayName || tr("Ваш кабинет")}</strong><small>{tr(role)}</small></div></div>
          <div className="workspace-utilities">
            <div className="workspace-language"><LanguageSwitcher showName /></div>
            <button type="button" className="workspace-logout" onClick={logout} disabled={signingOut} aria-label={signingOut ? tr("Выходим из кабинета…") : tr("Выйти из кабинета")}><Icon name="logout" size={17} /><span>{signingOut ? tr("Выходим…") : tr("Выйти")}</span></button>
          </div>
        </div>
      </aside>
      <div className="workspace-body">
        <nav className="workspace-mobile-nav" aria-label={tr("Разделы кабинета")}>
          <Link href="/dashboard"><Icon name="globe" /><span>{tr("Идеи региона")}</span></Link>
          <Link href="/"><Icon name="home" /><span>{tr("Главная")}</span></Link>
          <Link href={ideasHref} aria-current={ideasActive ? "page" : undefined}><Icon name={staff ? "grid" : "bulb"} /><span>{staff ? tr("Очередь") : tr("Мои идеи")}</span></Link>
          <Link className="workspace-mobile-notifications" href="/notifications" aria-label={tr("Уведомления")} title={tr("Уведомления")} aria-current={path === "/notifications" ? "page" : undefined}><Icon name="bell" /><span className="workspace-mobile-notification-label">{tr("Уведомления")}</span>{unread > 0 && <span className="nav-counter">{unread > 99 ? "99+" : unread}</span>}</Link>
          {!staff && <Link className="workspace-mobile-create" href="/ideas/new" aria-label={tr("Предложить новую идею")}><Icon name="plus" /></Link>}
        </nav>
        <div className="workspace-content">{children}</div>
      </div>
    </div>
  );
}
