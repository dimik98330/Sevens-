"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState, type MouseEvent } from "react";
import { ApiError, api } from "@/features/shared/api-client";
import { useSession } from "@/features/shared/session";
import { loginHref } from "@/features/shared/navigation";
import { currentMockMode, mockStore } from "@/features/shared/mock";
import { ErrorNotice, Skeleton } from "@/components/ui/Feedback";
import { Icon } from "@/components/ui/Icon";
import { useAssistantPage } from "@/features/assistant/context";
import { useTranslation } from "@/features/i18n/provider";
import { notificationPresentation, notificationLabels } from "@/features/notifications/presentation";

interface Notif {
  id: string;
  ideaId: string;
  kind?: string;
  title: string;
  readAt: string | null;
  createdAt: string;
}

const PAGE_SIZE = 20;

function notificationDate(value: string, intlLocale = "ru-RU"): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Дата не указана";
  if (intlLocale.startsWith("kk")) {
    // Some browser ICU builds display an untranslated M09 for Kazakh months.
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Qyzylorda",
      day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
    const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
    const months = ["қаңтар", "ақпан", "наурыз", "сәуір", "мамыр", "маусым", "шілде", "тамыз", "қыркүйек", "қазан", "қараша", "желтоқсан"];
    return `${get("day")} ${months[Number(get("month")) - 1]} ${get("year")}, ${get("hour")}:${get("minute")}`;
  }
  return date.toLocaleString(intlLocale, {
    timeZone: "Asia/Qyzylorda", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function notificationUrl(unreadOnly: boolean, page: number) {
  const query = new URLSearchParams();
  if (unreadOnly) query.set("unread", "1");
  if (page > 1) query.set("page", String(page));
  return `/notifications${query.size ? `?${query}` : ""}`;
}

function NotificationsContent() {
  const { t: tr, intlLocale, locale } = useTranslation();
  const labels = notificationLabels[locale];
  const router = useRouter();
  const params = useSearchParams();
  const { user, checked, refresh } = useSession();
  const userId = user?.id;
  const [items, setItems] = useState<Notif[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [readError, setReadError] = useState<ApiError | null>(null);
  const unreadOnly = params.get("unread") === "1";
  const page = Math.min(1_000_000, Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1));
  const [total, setTotal] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const [reload, setReload] = useState(0);
  const [reading, setReading] = useState<string | null>(null);
  const mounted = useRef(false);
  const readingRef = useRef<string | null>(null);
  const mockReadIds = useRef(new Set<string>());

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (checked && !userId) router.replace(loginHref(window.location.pathname + window.location.search + window.location.hash));
  }, [checked, userId, router]);

  useEffect(() => {
    mockReadIds.current.clear();
  }, [userId]);

  useEffect(() => {
    if (!checked || !userId) return;
    let active = true;
    setItems(null);
    setError(null);
    const load = async () => {
      try {
        let list: Notif[];
        let listTotal: number;
        let unread: number;
        if (currentMockMode()) {
          const all = mockStore.notifications().map((item) => ({
            ...item,
            readAt: mockReadIds.current.has(item.id) ? item.readAt ?? new Date().toISOString() : item.readAt,
          }));
          const filtered = unreadOnly ? all.filter((item) => !item.readAt) : all;
          list = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
          listTotal = filtered.length;
          unread = all.filter((item) => !item.readAt).length;
        } else {
          const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
          if (unreadOnly) params.set("unreadOnly", "true");
          const result = await api.get<Notif[]>(`/api/v1/notifications?${params}`);
          list = result.data;
          listTotal = typeof result.meta.total === "number" ? result.meta.total : list.length;
          unread = typeof result.meta.unreadCount === "number" ? result.meta.unreadCount : list.filter((item) => !item.readAt).length;
        }
        if (!active) return;
        const lastPage = Math.max(1, Math.ceil(listTotal / PAGE_SIZE));
        if (page > lastPage) {
          router.replace(notificationUrl(unreadOnly, lastPage));
          return;
        }
        setItems(list);
        setTotal(listTotal);
        setUnreadCount(unread);
      } catch (err) {
        if (active) {
          setItems([]);
          setError(err as ApiError);
        }
      }
    };
    void load();
    return () => { active = false; };
  }, [checked, userId, unreadOnly, page, reload, router]);

  useAssistantPage({ page: "notifications", saving: reading !== null, errorCode: (error ?? readError)?.detail?.code, targets: [] });

  if (!checked || !user) return null;

  const markRead = async (notification: Notif) => {
    if (notification.readAt || readingRef.current) return;
    readingRef.current = notification.id;
    setReading(notification.id);
    setReadError(null);
    try {
      if (currentMockMode()) {
        mockReadIds.current.add(notification.id);
      } else {
        await api.post(`/api/v1/notifications/${notification.id}/read`, {});
      }
      if (mounted.current) {
        setItems((current) => current?.map((item) => item.id === notification.id
          ? { ...item, readAt: item.readAt ?? new Date().toISOString() } : item) ?? null);
        setReload((current) => current + 1);
      }
      void refresh();
    } catch (err) {
      if (mounted.current) setReadError(err as ApiError);
    } finally {
      readingRef.current = null;
      if (mounted.current) setReading(null);
    }
  };

  // The link owns navigation; the read request must not trigger a second
  // router.push or prevent opening an idea when recording the read fails.
  const onOpen = (event: MouseEvent<HTMLAnchorElement>, notification: Notif) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    void markRead(notification);
  };

  const filter = (onlyUnread: boolean) => {
    router.push(notificationUrl(onlyUnread, 1));
    setReadError(null);
  };
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const loading = items === null;
  const staff = user.role === "STAFF" || user.role === "ADMIN";
  const cabinetHref = staff ? "/staff" : "/my";

  return (
    <section className="notification-page" aria-labelledby="notifications-title">
      <div className="notification-heading page-heading">
        <div>
          <p className="eyebrow">{tr("Личный кабинет")}</p>
          <h1 id="notifications-title">{tr("Уведомления")}</h1>
          <p>{tr("Ответы, уточнения и изменения статуса — всё по вашим идеям.")}</p>
        </div>
        <span className="notification-heading-icon" aria-hidden="true"><Icon name="bell" size={29} /></span>
      </div>

      <div className="notification-toolbar">
        <div className="notification-filters" role="group" aria-label={tr("Показать уведомления")}>
          <button type="button" aria-pressed={!unreadOnly} onClick={() => filter(false)}>{tr("Все")}</button>
          <button type="button" aria-pressed={unreadOnly} onClick={() => filter(true)}>
            {tr(" Непрочитанные ")}{!error && !loading && unreadCount > 0 && <span className="notification-count">{unreadCount}</span>}
          </button>
        </div>
        <p className="notification-summary" role="status">
          {loading ? tr("Загружаем обновления…") : error ? tr("Не удалось загрузить обновления") : unreadCount > 0 ? tr("Непрочитанных: {0}", { "0": unreadCount }) : tr("Всё прочитано")}
        </p>
      </div>

      {error && <ErrorNotice error={error} onRetry={() => setReload((current) => current + 1)} />}
      {readError && <ErrorNotice error={readError} />}
      {loading && <div className="notification-loading"><Skeleton lines={3} /></div>}
      {!loading && !error && !items.length && (
        <div className="notification-empty">
          <span className="notification-icon" aria-hidden="true"><Icon name={unreadOnly ? "check" : "bell"} size={28} /></span>
          <h2>{unreadOnly ? tr("Все уведомления прочитаны") : tr("Пока без обновлений")}</h2>
          <p>{unreadOnly ? tr("Новые ответы и изменения статуса появятся здесь.") : tr("Когда по вашим идеям придёт ответ или изменится статус, мы покажем это здесь.")}</p>
          {unreadOnly ? (
            <button type="button" className="btn btn-secondary" onClick={() => filter(false)}>{tr("Показать все уведомления")}</button>
          ) : (
            <Link className="btn btn-secondary" href={cabinetHref}>{staff ? tr("В очередь идей") : tr("К моим идеям")}<Icon name="arrow" size={17} /></Link>
          )}
        </div>
      )}

      {!loading && !error && items.length > 0 && (
        <ul className="notification-list" aria-label={unreadOnly ? tr("Непрочитанные уведомления") : tr("Все уведомления")}>
          {items.map((notification) => {
            const presentation = notificationPresentation(notification, staff, locale);
            const showcase = notification.kind === "SHOWCASE_UPDATE";
            const href = `${showcase ? "/dashboard" : staff ? "/staff" : "/ideas"}/${encodeURIComponent(notification.ideaId)}?returnTo=${encodeURIComponent(notificationUrl(unreadOnly, page))}`;
            return (
              <li key={notification.id} className="notification-item" data-unread={!notification.readAt}>
                <span className="notification-icon" aria-hidden="true"><Icon name={presentation.icon} size={24} /></span>
                <div className="notification-copy">
                  <div className="notification-meta">
                    {!notification.readAt ? <span className="notification-unread">{labels.unread}</span>
                      : <span className="notification-read"><Icon name="check" size={15} />{labels.read}</span>}
                    {presentation.publicNumber && <span className="notification-number">{presentation.publicNumber}</span>}
                    <time dateTime={notification.createdAt}>{notificationDate(notification.createdAt, intlLocale)}</time>
                  </div>
                  <h2><Link className="notification-title" href={href} onClick={(event) => onOpen(event, notification)}>{presentation.title}</Link></h2>
                  {presentation.description && <p className="notification-description">{presentation.description}</p>}
                  <div className="notification-actions">
                    <Link className="notification-open" href={href} onClick={(event) => onOpen(event, notification)}>{presentation.action}<Icon name="arrow" size={18} /></Link>
                    {!notification.readAt && (
                      <button type="button" className="notification-mark-read" disabled={reading !== null} aria-busy={reading === notification.id} onClick={() => { void markRead(notification); }} aria-label={`${labels.mark}: ${presentation.title}`}>
                        <Icon name="check" size={18} />{reading === notification.id ? labels.marking : labels.mark}
                      </button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {!error && totalPages > 1 && (
        <nav className="notification-pagination" aria-label={tr("Страницы уведомлений")}>
          <button type="button" className="btn btn-secondary" disabled={loading || page === 1} onClick={() => router.push(notificationUrl(unreadOnly, page - 1))}>{tr("Назад")}</button>
          <span>{tr("Страница ")}{page} {tr(" из ")}{totalPages}</span>
          <button type="button" className="btn btn-secondary" disabled={loading || page === totalPages} onClick={() => router.push(notificationUrl(unreadOnly, page + 1))}>{tr("Далее")}</button>
        </nav>
      )}
    </section>
  );
}


export default function NotificationsPage() {
  return <Suspense fallback={<Skeleton lines={3} />}><NotificationsContent /></Suspense>;
}
