"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "@/features/shared/api-client";
import { store } from "@/features/shared/data";
import { useSession } from "@/features/shared/session";
import { loginHref } from "@/features/shared/navigation";
import { EmptyState, ErrorNotice, Skeleton } from "@/components/ui/Feedback";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Icon, type IconName } from "@/components/ui/Icon";
import type { IdeaStatus } from "@/contracts";
import { useAssistantPage } from "@/features/assistant/context";
import { useTranslation, useUiMessages } from "@/features/i18n/provider";
import { TerritoryOptions } from '@/components/location/TerritoryOptions';
import "./staff-queue.css";

interface Row {
  id: string;
  title: string;
  publicNumber: string | null;
  status: IdeaStatus;
  effectiveCategoryCode: string | null;
  territoryCode?: string;
  assigneeDisplayName?: string | null;
  assignee?: { id: string; name: string } | null;
  updatedAt: string;
  publicationState?: "PRIVATE" | "PENDING" | "PUBLISHED" | "REJECTED";
}
interface Territory { code: string; nameRu: string }
interface Assignee { id: string; displayName?: string; name?: string }
type View = "all" | "new" | "review" | "mine" | "unassigned" | "publication";
const PAGE_SIZE = 20;
const VIEWS: Array<{ key: View; label: string; hint: string; icon: IconName }> = [
  { key: "all", label: "Все предложения", hint: "Общая очередь", icon: "grid" },
  { key: "new", label: "Получены", hint: "Начать рассмотрение", icon: "file" },
  { key: "review", label: "На рассмотрении", hint: "Проверить ход работы", icon: "clock" },
  { key: "mine", label: "Назначены мне", hint: "Ваши текущие предложения", icon: "user" },
  { key: "unassigned", label: "Без ответственного", hint: "Назначить специалиста", icon: "users" },
  { key: "publication", label: "На публикацию", hint: "Проверить публичный текст", icon: "globe" },
];
const SORTS = [
  ["submittedAt:desc", "Сначала новые"],
  ["updatedAt:desc", "Недавние изменения"],
  ["submittedAt:asc", "Сначала ранние"],
  ["title:asc", "По названию"],
] as const;
function selectedAssignee(params: URLSearchParams) {
  return ["1", "true"].includes(params.get("unassigned") ?? "") ? "unassigned" : params.get("assignee") ?? "";
}

function Queue() {
  const messages = useUiMessages();
  const { t: tr, intlLocale } = useTranslation();
  const categories = messages.categories as Record<string, string>;
  const statuses = messages.statuses as Record<string, string>;
  const router = useRouter();
  const params = useSearchParams();
  const signature = params.toString();
  const applied = new URLSearchParams(signature);
  const { user, checked } = useSession();
  const isAdmin = user?.role === "ADMIN";
  const [rows, setRows] = useState<Row[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<ApiError | null>(null);
  const [q, setQ] = useState(applied.get("q") ?? "");
  const [category, setCategory] = useState(applied.get("category") ?? "");
  const [status, setStatus] = useState(applied.get("status") ?? "");
  const [territory, setTerritory] = useState(applied.get("territory") ?? "");
  const [assignee, setAssignee] = useState(selectedAssignee(applied));
  const [orgId, setOrgId] = useState(applied.get("organizationId") ?? "");
  const [territories, setTerritories] = useState<Territory[]>([]);
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [orgs, setOrgs] = useState<Array<{ id: string; name: string }>>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const previousApplied = useRef(new URLSearchParams(signature));
  const sequence = useRef(0);
  const page = Math.max(1, Number.parseInt(applied.get("page") ?? "1", 10) || 1);
  const activeOrg = applied.get("organizationId") ?? "";
  const appliedAssignee = selectedAssignee(applied);
  const activeStatus = applied.get("status") ?? "";

  useEffect(() => {
    if (checked && user?.role === "ADMIN" && !activeOrg) setFiltersOpen(true);
  }, [checked, user?.role, activeOrg]);

  useEffect(() => {
    const current = new URLSearchParams(signature);
    const before = previousApplied.current;
    // A view/page/sort change must not erase text typed before navigation commits.
    if ((current.get("q") ?? "") !== (before.get("q") ?? "")) setQ(current.get("q") ?? "");
    if ((current.get("category") ?? "") !== (before.get("category") ?? "")) setCategory(current.get("category") ?? "");
    if ((current.get("status") ?? "") !== (before.get("status") ?? "")) setStatus(current.get("status") ?? "");
    if ((current.get("territory") ?? "") !== (before.get("territory") ?? "")) setTerritory(current.get("territory") ?? "");
    if (selectedAssignee(current) !== selectedAssignee(before)) setAssignee(selectedAssignee(current));
    if ((current.get("organizationId") ?? "") !== (before.get("organizationId") ?? "")) setOrgId(current.get("organizationId") ?? "");
    previousApplied.current = current;
  }, [signature]);

  const load = useCallback(async () => {
    if (!user || user.role === "CITIZEN") return;
    const request = ++sequence.current;
    const current = new URLSearchParams(signature);
    const organizationId = current.get("organizationId") ?? (user.role === "STAFF" ? user.organizationId ?? "" : "");
    setRows(null); setError(null);
    if (user.role === "ADMIN" && !organizationId) { setRows([]); setTotal(0); return; }
    const query: Record<string, string> = {
      q: current.get("q") ?? "", category: current.get("category") ?? "",
      status: current.get("status") ?? "", territory: current.get("territory") ?? "",
      assignee: selectedAssignee(current), organizationId,
      page: String(Math.max(1, Number.parseInt(current.get("page") ?? "1", 10) || 1)), pageSize: String(PAGE_SIZE),
    };
    for (const key of ["sort", "dir", "dateFrom", "dateTo", "publication"]) { const value = current.get(key); if (value) query[key] = value; }
    try {
      const { data, meta } = await store.staffList(query);
      if (request !== sequence.current) return;
      setRows(data as Row[]);
      setTotal((meta as { total?: number }).total ?? (data as Row[]).length);
    } catch (err) {
      if (request !== sequence.current) return;
      setRows([]); setTotal(0); setError(err as ApiError);
    }
  }, [signature, user]);

  useEffect(() => { if (checked && user?.role !== "CITIZEN") void load(); }, [checked, user, load]);
  useEffect(() => {
    if (!checked || !user || user.role === "CITIZEN") return;
    let cancelled = false;
    store.catalogs().then(({ data }) => { if (!cancelled) setTerritories((data as { territories: Territory[] }).territories ?? []); }).catch(() => {});
    if (user.role === "ADMIN") store.adminOrganizations().then(({ data }) => { if (!cancelled) setOrgs(data as Array<{ id: string; name: string }>); }).catch(() => {});
    return () => { cancelled = true; };
  }, [checked, user]);
  useEffect(() => {
    if (!checked || !user || user.role === "CITIZEN") return;
    const organizationId = user.role === "ADMIN" ? orgId : user.organizationId ?? "";
    if (!organizationId) { setAssignees([]); return; }
    let cancelled = false;
    setAssignees([]);
    store.assignees(organizationId).then(({ data }) => { if (!cancelled) setAssignees(data as Assignee[]); }).catch(() => {});
    return () => { cancelled = true; };
  }, [checked, user, orgId]);
  useEffect(() => {
    if (!checked) return;
    if (!user) router.replace(loginHref(window.location.pathname + window.location.search + window.location.hash)); else if (user.role === "CITIZEN") router.replace("/my");
  }, [checked, user, router]);
  useAssistantPage({ page: "staff", errorCode: error?.detail?.code, targets: checked && user && user.role !== "CITIZEN" ? ["staff-filters"] : [] });
  if (!checked || !user || user.role === "CITIZEN") return null;

  const navigate = (next: URLSearchParams) => router.push(`/staff${next.size ? `?${next}` : ""}`, { scroll: false });
  const apply = (event: React.FormEvent) => {
    event.preventDefault();
    const next = new URLSearchParams(signature);
    for (const key of ["q", "category", "status", "territory", "assignee", "unassigned", "organizationId", "page"]) next.delete(key);
    for (const [key, value] of Object.entries({ q: q.trim(), category, status, territory, assignee, organizationId: isAdmin ? orgId : "" })) if (value) next.set(key, value);
    navigate(next);
  };
  const reset = () => {
    const next = new URLSearchParams();
    if (isAdmin && activeOrg) next.set("organizationId", activeOrg);
    setQ(""); setCategory(""); setStatus(""); setTerritory(""); setAssignee(""); setOrgId(activeOrg);
    navigate(next);
  };
  const switchView = (view: View) => {
    const next = new URLSearchParams(signature);
    for (const key of ["status", "assignee", "unassigned", "page", "publication"]) next.delete(key);
    if (view === "new") next.set("status", "RECEIVED");
    if (view === "review") next.set("status", "UNDER_REVIEW");
    if (view === "mine") next.set("assignee", user.id);
    if (view === "unassigned") next.set("assignee", "unassigned");
    if (view === "publication") next.set("publication", "pending");
    navigate(next);
  };
  const currentView: View | null = applied.get("publication") === "pending" ? "publication" : !activeStatus && !appliedAssignee ? "all"
    : activeStatus === "RECEIVED" && !appliedAssignee ? "new"
    : activeStatus === "UNDER_REVIEW" && !appliedAssignee ? "review"
    : !activeStatus && appliedAssignee === user.id ? "mine"
    : !activeStatus && appliedAssignee === "unassigned" ? "unassigned" : null;
  const dirty = q !== (applied.get("q") ?? "") || category !== (applied.get("category") ?? "") || status !== activeStatus || territory !== (applied.get("territory") ?? "") || assignee !== appliedAssignee || orgId !== activeOrg;
  const chips: Array<{ key: string; text: string }> = [];
  if (applied.get("publication") === "pending") chips.push({ key: "publication", text: tr("На публикацию") });
  if (applied.get("q")) chips.push({ key: "q", text: `${tr("Поиск")}: ${applied.get("q")}` });
  if (applied.get("category")) chips.push({ key: "category", text: categories[applied.get("category")!] ?? tr("Категория") });
  if (activeStatus) chips.push({ key: "status", text: statuses[activeStatus] ?? tr("Статус") });
  if (applied.get("territory")) chips.push({ key: "territory", text: territories.find(item => item.code === applied.get("territory"))?.nameRu ?? tr("Территория") });
  if (appliedAssignee) chips.push({ key: "assignee", text: appliedAssignee === "unassigned" ? tr("Без ответственного") : appliedAssignee === user.id ? tr("Назначены мне") : assignees.find(item => item.id === appliedAssignee)?.displayName ?? tr("Выбранный сотрудник") });
  const removeFilter = (key: string) => { const next = new URLSearchParams(signature); next.delete(key); if (key === "assignee") next.delete("unassigned"); next.delete("page"); navigate(next); };
  const sorting = `${applied.get("sort") ?? "submittedAt"}:${applied.get("dir") ?? "desc"}`;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const returnPath = `/staff${signature ? `?${signature}` : ""}`;
  const detailUrl = (row: Row) => `/staff/${row.id}?returnTo=${encodeURIComponent(returnPath)}`;
  const ownerName = (row: Row) => row.assigneeDisplayName ?? row.assignee?.name ?? "";
  const territoryName = (row: Row) => territories.find(item => item.code === row.territoryCode)?.nameRu ?? "";
  const formatDate = (value: string) => new Date(value).toLocaleDateString(intlLocale, { day: "2-digit", month: "short", year: "numeric" });
  const assignLink = (row: Row) => <Link className="staff-assign-link" href={`${detailUrl(row)}#staff-actions`} aria-label={`${tr("Назначить")}: ${row.publicNumber ?? row.title}`}><Icon name="plus" size={16} />{tr("Назначить")}</Link>;
  const openLink = (row: Row) => <Link className="staff-open-link" href={detailUrl(row)} aria-label={`${tr("Открыть")}: ${row.publicNumber ?? row.title}`}>{tr("Открыть")}<Icon name="arrow" size={17} /></Link>;
  const publicationLink = (row: Row) => row.publicationState === "PENDING" ? <Link className="staff-publication-link" href={`${detailUrl(row)}#idea-publication`}><Icon name="globe" size={15} />{tr("Проверить публикацию")}</Link> : null;
  const owner = (row: Row) => ownerName(row) ? <div className="staff-assignee"><span className="staff-assignee-avatar" aria-hidden="true">{ownerName(row).trim().split(/\s+/).slice(0, 2).map(part => part[0]).join("")}</span><span>{ownerName(row)}</span></div>
    : <div className="staff-unassigned"><span>{tr("Не назначен")}</span>{assignLink(row)}</div>;

  return <div className="staff-queue">
    <header className="staff-queue-heading"><div><p className="staff-queue-kicker">{tr("Рабочая очередь")}</p><h1>{tr("Очередь предложений")}</h1><p className="staff-queue-description">{tr("Находите идеи, назначайте ответственных и поддерживайте диалог с жителями.")}</p></div><button className="staff-queue-refresh btn btn-secondary" type="button" onClick={() => void load()} disabled={rows === null || (isAdmin && !activeOrg)}><Icon name="refresh" size={18} />{tr("Обновить очередь")}</button></header>
    <nav className="staff-queue-views" aria-label={tr("Быстрые выборки")}>
      {VIEWS.filter(view => !isAdmin || view.key !== "mine").map(view => <button className="staff-queue-view" type="button" key={view.key} aria-pressed={currentView === view.key} onClick={() => switchView(view.key)}><span className="staff-view-icon"><Icon name={view.icon} size={23} /></span><span className="staff-view-copy"><strong>{tr(view.label)}</strong><span>{tr(view.hint)}</span></span></button>)}
    </nav>
    <section className="staff-filter-panel" aria-labelledby="staff-filter-heading" data-expanded={filtersOpen}>
      <div className="staff-filter-heading"><h2 id="staff-filter-heading">{tr("Поиск и фильтры")}</h2><p>{tr("Найдите предложение по номеру, названию или описанию.")}</p><button className="staff-filter-toggle" type="button" onClick={() => setFiltersOpen(value => !value)} aria-expanded={filtersOpen} aria-controls="staff-filter-form">{tr(filtersOpen ? "Скрыть фильтры" : "Показать фильтры")}<Icon name="chevron" size={18} /></button></div>
      <form id="staff-filter-form" onSubmit={apply} className="staff-filter-form" role="search" aria-label={tr("Фильтры очереди")} data-assistant-target="staff-filters">
        <div className="staff-filter-grid">
          <label className="staff-filter-field staff-filter-search"><span>{tr("Поиск по номеру или тексту")}</span><span><Icon name="search" size={18} /><input type="search" value={q} maxLength={100} onChange={event => setQ(event.target.value)} placeholder={tr("Номер или текст предложения")} /></span></label>
          <label className="staff-filter-field"><span>{tr("Категория")}</span><select value={category} onChange={event => setCategory(event.target.value)}><option value="">{tr("Все категории")}</option>{Object.entries(categories).map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select></label>
          <label className="staff-filter-field"><span>{tr("Статус")}</span><select value={status} onChange={event => setStatus(event.target.value)}><option value="">{tr("Все статусы")}</option>{Object.entries(statuses).filter(([code]) => code !== "DRAFT").map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select></label>
          <label className="staff-filter-field"><span>{tr("Территория")}</span><select value={territory} onChange={event => setTerritory(event.target.value)}><option value="">{tr("Все территории")}</option><TerritoryOptions territories={territories} selected={territory} useCode /></select></label>
          <label className="staff-filter-field"><span>{tr("Ответственный")}</span><select value={assignee} onChange={event => setAssignee(event.target.value)}><option value="">{tr("Все ответственные")}</option><option value="unassigned">{tr("Без ответственного")}</option>{!isAdmin && <option value={user.id}>{tr("Назначены мне")}</option>}{assignees.filter(item => isAdmin || item.id !== user.id).map(item => <option key={item.id} value={item.id}>{item.displayName ?? item.name}</option>)}{assignee && assignee !== "unassigned" && assignee !== user.id && !assignees.some(item => item.id === assignee) && <option value={assignee}>{tr("Выбранный сотрудник")}</option>}</select></label>
          {isAdmin && <label className="staff-filter-field"><span>{tr("Организация")}</span><select value={orgId} onChange={event => { setOrgId(event.target.value); setAssignee(""); }} required><option value="">{tr("— выберите организацию —")}</option>{orgs.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>}
        </div>
        <div className="staff-filter-actions"><button className="btn btn-primary" type="submit">{tr("Применить фильтры")}<Icon name="arrow" size={17} /></button><button className="btn btn-secondary" type="button" onClick={reset}>{tr("Сбросить")}</button>{dirty && <span className="staff-filter-dirty" role="status">{tr("Есть неприменённые изменения")}</span>}</div>
      </form>
      {chips.length > 0 && <div className="staff-active-filters">{chips.map(chip => <button className="staff-filter-chip" type="button" key={chip.key} aria-label={`${tr("Убрать фильтр")}: ${chip.text}`} onClick={() => removeFilter(chip.key)}>{chip.text}<Icon name="close" size={14} /></button>)}</div>}
    </section>
    <section className="staff-results-panel" aria-labelledby="staff-results-heading" aria-busy={rows === null}>
      <div className="staff-results-heading"><div><h2 id="staff-results-heading">{tr("Предложения")}<span className="staff-result-count">{rows === null ? "…" : total.toLocaleString(intlLocale)}</span></h2><p className="staff-results-caption">{tr("Выберите предложение, чтобы открыть материалы и историю.")}</p></div><label className="staff-results-sort"><span>{tr("Сортировка")}</span><select value={sorting} onChange={event => { const [sort, dir] = event.target.value.split(":"); const next = new URLSearchParams(signature); next.set("sort", sort ?? "submittedAt"); next.set("dir", dir ?? "desc"); next.delete("page"); navigate(next); }}>{SORTS.map(([value, label]) => <option key={value} value={value}>{tr(label)}</option>)}{!SORTS.some(([value]) => value === sorting) && <option value={sorting}>{tr("Сортировка")}</option>}</select></label></div>
      <div className="staff-results-content" aria-live="polite">
        {isAdmin && !activeOrg && <p className="staff-queue-empty">{tr("Выберите организацию, чтобы увидеть её очередь.")}</p>}
        {error && <ErrorNotice error={error} onRetry={() => void load()} />}
        {rows === null && <Skeleton lines={4} />}
        {rows !== null && rows.length === 0 && !error && !(isAdmin && !activeOrg) && <EmptyState title={tr("Ничего не найдено")} text={chips.length ? messages.emptyFilter : messages.emptyQueue} action={chips.length ? <button type="button" className="btn btn-secondary" onClick={reset}>{tr("Сбросить фильтры")}</button> : undefined} />}
        {rows !== null && rows.length > 0 && <>
          <div className="staff-table-scroll"><table className="staff-results-table"><thead><tr><th>{tr("Предложения")}</th><th>{tr("Категория")}</th><th>{tr("Статус")}</th><th>{tr("Ответственный")}</th><th>{tr("Обновлено")}</th><th><span className="sr-only">{tr("Открыть")}</span></th></tr></thead><tbody>{rows.map(row => <tr key={row.id}><td className="staff-proposal"><Link className="staff-proposal-title" href={detailUrl(row)}>{row.title}</Link><div className="staff-proposal-meta"><span>{row.publicNumber}</span>{territoryName(row) && <span><Icon name="pin" size={13} />{territoryName(row)}</span>}{publicationLink(row)}</div></td><td>{row.effectiveCategoryCode ? categories[row.effectiveCategoryCode] ?? tr("Не указана") : tr("Не указана")}</td><td><StatusBadge status={row.status} /></td><td>{owner(row)}</td><td><time dateTime={row.updatedAt}>{formatDate(row.updatedAt)}</time></td><td>{openLink(row)}</td></tr>)}</tbody></table></div>
          <ul className="staff-mobile-list">{rows.map(row => <li className="staff-mobile-card" key={row.id}><div className="staff-mobile-card-top"><span>{row.publicNumber}</span><StatusBadge status={row.status} /></div><h3><Link href={detailUrl(row)}>{row.title}</Link></h3><div className="staff-mobile-meta"><span>{row.effectiveCategoryCode ? categories[row.effectiveCategoryCode] ?? tr("Не указана") : tr("Не указана")}</span>{territoryName(row) && <span><Icon name="pin" size={14} />{territoryName(row)}</span>}</div>{publicationLink(row)}<div className="staff-mobile-owner"><span>{tr("Ответственный")}</span>{owner(row)}</div><div className="staff-mobile-footer"><time dateTime={row.updatedAt}>{tr("Обновлено")}: {formatDate(row.updatedAt)}</time>{openLink(row)}</div></li>)}</ul>
        </>}
      </div>
      {rows !== null && total > 0 && <div className="staff-pagination"><span>{tr("Показаны")} {rows.length ? (page - 1) * PAGE_SIZE + 1 : 0}–{rows.length ? Math.min(total, (page - 1) * PAGE_SIZE + rows.length) : 0} {tr("из")} {total.toLocaleString(intlLocale)}</span>{pages > 1 && <div><button type="button" className="btn btn-secondary" disabled={page <= 1} onClick={() => { const next = new URLSearchParams(signature); next.set("page", String(page - 1)); navigate(next); }}>{tr("Назад")}</button><span>{page} / {pages}</span><button type="button" className="btn btn-secondary" disabled={page >= pages} onClick={() => { const next = new URLSearchParams(signature); next.set("page", String(page + 1)); navigate(next); }}>{tr("Дальше")}</button></div>}</div>}
    </section>
  </div>;
}
export default function StaffQueuePage() { return <Suspense><Queue /></Suspense>; }
