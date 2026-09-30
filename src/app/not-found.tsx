"use client";
import Link from "next/link";
import { useSession } from "@/features/shared/session";
import { useTranslation } from "@/features/i18n/provider";
import { Icon } from "@/components/ui/Icon";

export default function NotFound() {
  const { user } = useSession();
  const { t } = useTranslation();
  const cabinet = user?.role === "STAFF" || user?.role === "ADMIN" ? "/staff" : user ? "/my" : "/login";
  return <section className="navigation-not-found" aria-labelledby="not-found-title"><span className="navigation-not-found-icon"><Icon name="pin" size={32} /></span><p className="eyebrow">404</p><h1 id="not-found-title">{t("Страница не найдена")}</h1><p>{t("Возможно, адрес изменился или ссылка устарела. Вы можете вернуться на главную или открыть свой кабинет.")}</p><div className="btn-row"><Link className="btn btn-primary" href="/">{t("На главную")}<Icon name="home" size={18} /></Link><Link className="btn btn-secondary" href={cabinet}>{user ? t("Мой кабинет") : t("Войти")}<Icon name="user" size={18} /></Link></div></section>;
}
