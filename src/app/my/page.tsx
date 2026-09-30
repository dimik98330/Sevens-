"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "@/features/shared/api-client";
import { store, territoryNameForDisplay } from "@/features/shared/data";
import { useSession } from "@/features/shared/session";
import { loginHref } from "@/features/shared/navigation";
import { ErrorNotice, Skeleton } from "@/components/ui/Feedback";
import { StatusBadge, orgName } from "@/components/ui/StatusBadge";
import { IdeaStatus, type ListMeta } from "@/contracts";
import { Icon, type IconName } from "@/components/ui/Icon";
import { useAssistantPage } from "@/features/assistant/context";
import { useTranslation, useUiMessages } from "@/features/i18n/provider";
import { getIdeaGuidance, getIdeaRoutingContext, type IdeaRoutingDisplay } from "@/features/shared/idea-guidance";

interface Row extends IdeaRoutingDisplay {
  id: string; title: string; publicNumber: string | null; status: IdeaStatus;
  effectiveCategoryCode: string | null; updatedAt: string; territoryName?: string | null;
}
interface Preview extends IdeaRoutingDisplay {
  title: string; status: IdeaStatus; publicNumber: string | null; locationText?: string | null;
  resolutionType?: string | null;
  timeline?: Array<{ text: string; at: string; body?: string; visibility?: string }>;
}
const CATEGORY_ICONS: Record<string, IconName> = { TRANSPORT: "bus", ECOLOGY: "leaf", SAFETY: "shield", UTILITIES: "home", EDUCATION: "users", HEALTH: "users", TOURISM: "pin", ACCESSIBILITY: "users" };
const date = (value: string, intlLocale = "ru-RU") => new Date(value).toLocaleDateString(intlLocale, { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Almaty" });
const validStatus = (value: string | null) => IdeaStatus.find((status) => status === value) ?? "";

function MyIdeas() {
  const ru = useUiMessages();
  const categories = ru.categories as Record<string, string>;
  const resultTypes = ru.resultTypes as Record<string, string>;
  const { t: tr, intlLocale } = useTranslation();
  const router = useRouter();
  const params = useSearchParams();
  const { user, checked } = useSession();
  const appliedQ = (params.get("q") ?? "").slice(0, 100);
  const appliedStatus = validStatus(params.get("status"));
  const page = Math.min(1_000_000, Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1));
  const [rows, setRows] = useState<Row[] | null>(null);
  const [meta, setMeta] = useState<Pick<ListMeta, "total" | "pageSize"> | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [q, setQ] = useState(appliedQ);
  const [status, setStatus] = useState(appliedStatus);
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState(false);
  const request = useRef(0);
  const selectedIdea = rows?.find((row) => row.id === selected) ?? rows?.[0];
  const selectedId = selectedIdea?.id;
  useEffect(() => { setQ(appliedQ); setStatus(appliedStatus); }, [appliedQ, appliedStatus]);
  useEffect(() => {
    if (checked && !user) router.replace(loginHref(window.location.pathname + window.location.search + window.location.hash));
    else if (checked && user?.role !== "CITIZEN") router.replace("/staff");
  }, [checked, user, router]);
  const load = useCallback(async (qq: string, ss: string, currentPage: number) => {
    const token = ++request.current;
    setError(null); setRows(null); setMeta(null);
    try {
      const result = await store.mine({ q: qq || undefined, status: ss || undefined, page: currentPage, pageSize: 12 });
      if (request.current !== token) return;
      setRows(result.data as Row[]);
      const listMeta = result.meta as unknown as ListMeta;
      setMeta({ total: listMeta.total, pageSize: listMeta.pageSize });
    } catch (err) { if (request.current === token) { setRows([]); setError(err as ApiError); } }
  }, []);
  useEffect(() => {
    if (checked && user?.role === "CITIZEN") void load(appliedQ, appliedStatus, page);
    return () => { request.current++; };
  }, [checked, user, appliedQ, appliedStatus, page, load]);
  useEffect(() => {
    setPreview(null); setPreviewError(false);
    if (!selectedId) return;
    let active = true;
    store.get(selectedId).then(({ data }) => { if (active) setPreview(data as Preview); }).catch(() => { if (active) setPreviewError(true); });
    return () => { active = false; };
  }, [selectedId]);
  useAssistantPage({ page: "my", errorCode: error?.detail?.code, targets: checked && user ? ["citizen-filters"] : [] });
  const hrefFor = (search: string, filter: string, currentPage = 1) => {
    const query = new URLSearchParams();
    if (search.trim()) query.set("q", search.trim());
    if (filter) query.set("status", filter);
    if (currentPage > 1) query.set("page", String(currentPage));
    return `/my${query.size ? `?${query}` : ""}`;
  };
  const apply = (event: React.FormEvent) => {
    event.preventDefault();
    const search = q.trim();
    if (search === appliedQ && status === appliedStatus && page === 1) void load(search, status, 1);
    else router.push(hrefFor(search, status));
  };
  const reset = () => { setQ(""); setStatus(""); router.push("/my"); };
  const ideaHref = (ideaId: string | undefined, draft = false) => {
    const returnPath = hrefFor(appliedQ, appliedStatus, page);
    if (!ideaId) return returnPath;
    const query = new URLSearchParams({ returnTo: returnPath });
    if (draft) query.set("draft", ideaId);
    return draft ? `/ideas/new?${query}` : `/ideas/${encodeURIComponent(ideaId)}?${query}`;
  };
  if (checked && (!user || user.role !== "CITIZEN")) return null;
  const filtered = Boolean(appliedQ || appliedStatus);
  const publicTimeline = (preview?.timeline ?? []).filter((item) => item.visibility !== "INTERNAL");
  const latestReply = [...publicTimeline].reverse().find((item) => item.visibility === "PUBLIC" && item.text === "Публичный ответ специалиста" && item.body);
  const latestQuestion = [...publicTimeline].reverse().find((item) => item.visibility === "PUBLIC" && item.text === "Запрошен ответ жителя" && item.body);
  const latestMessage = preview?.status === "NEEDS_INFO" ? latestQuestion : latestReply;
  const previewGuidance = preview ? getIdeaGuidance(preview.status) : null;
  const previewContext = preview ? getIdeaRoutingContext(preview) : null;
  const actorLabel = (status: IdeaStatus) => {
    const guidance = getIdeaGuidance(status);
    return guidance.actor === "AUTHOR" ? tr("Вы, автор идеи") : tr(guidance.actorLabel);
  };
  const destinationLabel = (idea: IdeaRoutingDisplay & { status: IdeaStatus }) => {
    if (idea.status === "DRAFT") return tr("Появится после отправки");
    const { organizationCode } = getIdeaRoutingContext(idea);
    return organizationCode ? tr(orgName(organizationCode)) : tr("Направление пока не указано");
  };
  const totalPages = meta ? Math.ceil(meta.total / meta.pageSize) : 1;
  return (
    <div className="card citizen-dashboard">
      <div className="cabinet-heading page-heading">
        <div><p className="cabinet-breadcrumb">{tr("Личный кабинет ")}<span>/</span> {tr(" Мои идеи")}</p><h1>{tr("Мои идеи")}</h1><p>{tr("Ваши предложения, ход рассмотрения и ответы — в одном месте.")}</p></div>
        <Link className="btn btn-primary cabinet-primary" href="/ideas/new"><span>{tr("Предложить идею")}</span><span className="cabinet-button-icon"><Icon name="plus" size={19} /></span></Link>
      </div>
      <div className="cabinet-guide"><span className="cabinet-guide-icon"><Icon name="bulb" size={23} /></span><div><strong>{tr("Каждая перемена начинается с идеи")}</strong><p>{tr("Опишите предложение, укажите место и отправьте. Здесь вы сможете следить за статусом и отвечать специалисту.")}</p></div><Link href="/how">{tr("Как это работает ")}<Icon name="arrow" size={18} /></Link></div>
      <div className="cabinet-list-toolbar">
        <nav className="cabinet-status-tabs" aria-label={tr("Быстрые фильтры идей")}>{[{ label: tr("Все идеи"), value: "" }, { label: tr("Черновики"), value: "DRAFT" }, { label: tr("Нужны уточнения"), value: "NEEDS_INFO" }].map((tab) => <Link key={tab.value} href={hrefFor(appliedQ, tab.value)} aria-current={appliedStatus === tab.value ? "page" : undefined}>{tab.label}</Link>)}</nav>
        {meta && <span className="cabinet-total">{tr("Найдено: ")}{meta.total}</span>}
      </div>
      <form onSubmit={apply} className="cabinet-filters" role="search" aria-label={tr("Поиск по своим идеям")} data-assistant-target="citizen-filters">
        <div className="cabinet-search"><label className="sr-only" htmlFor="idea-search">{tr("Номер или название идеи")}</label><Icon name="file" size={19} /><input id="idea-search" type="search" value={q} maxLength={100} onChange={(event) => setQ(event.target.value)} placeholder={tr("Номер или название идеи")} /></div>
        <div className="cabinet-status-filter"><label className="sr-only" htmlFor="idea-status">{tr("Статус идеи")}</label><select id="idea-status" value={status} onChange={(event) => setStatus(validStatus(event.target.value))}><option value="">{tr("Все статусы")}</option>{IdeaStatus.map((value) => <option key={value} value={value}>{ru.statuses[value]}</option>)}</select></div>
        <button className="btn btn-secondary" type="submit">{tr("Найти")}</button>
      </form>
      {filtered && <div className="cabinet-filter-summary"><span>{appliedQ && tr("Поиск: «{0}»", { "0": appliedQ })}{appliedQ && appliedStatus && " · "}{appliedStatus && ru.statuses[appliedStatus]}</span><button type="button" onClick={reset}>{tr("Сбросить ")}<Icon name="close" size={15} /></button></div>}
      <div className={rows?.length ? "my-list-layout cabinet-results" : "cabinet-results"}>
        <div className="cabinet-idea-list" aria-live="polite" aria-busy={rows === null}>
          {error && <ErrorNotice error={error} onRetry={() => load(appliedQ, appliedStatus, page)} />}
          {rows === null && <div className="cabinet-loading"><Skeleton lines={4} /></div>}
          {rows !== null && !rows.length && !error && <div className="cabinet-empty"><span className="cabinet-empty-icon"><Icon name={filtered ? "file" : "bulb"} size={32} /></span><p className="cabinet-empty-kicker">{filtered ? tr("Поиск по идеям") : tr("Ваш следующий шаг")}</p><h2>{filtered ? tr("Подходящих идей пока нет") : page > 1 ? tr("На этой странице нет идей") : tr("Что можно улучшить рядом с вами?")}</h2><p>{filtered ? tr("Попробуйте другое название или выберите другой статус.") : page > 1 ? tr("Вернитесь к первой странице, чтобы посмотреть ваши предложения.") : tr("Дорогу у дома, освещение во дворе или новое место для отдыха. Создайте идею — черновик можно заполнить и отправить позже.")}</p>{filtered || page > 1 ? <button type="button" className="btn btn-secondary" onClick={reset}>{tr("Показать все идеи")}</button> : <Link className="btn btn-primary" href="/ideas/new">{tr("Предложить первую идею ")}<Icon name="plus" size={19} /></Link>}<Link className="cabinet-empty-help" href="/how">{tr("Как проходит рассмотрение ")}<Icon name="arrow" size={16} /></Link></div>}
          {rows?.map((idea) => {
            const guidance = getIdeaGuidance(idea.status);
            const context = getIdeaRoutingContext(idea);
            return <article key={idea.id} className="cabinet-idea" data-selected={selectedId === idea.id} data-status={idea.status} data-responsibility={guidance.actor.toLowerCase()}>
              <div className="cabinet-idea-top"><span className="cabinet-category"><Icon name={CATEGORY_ICONS[idea.effectiveCategoryCode ?? ""] ?? "bulb"} size={17} />{idea.effectiveCategoryCode ? categories[idea.effectiveCategoryCode] ?? tr(idea.effectiveCategoryCode) : tr("Категория определится после отправки")}</span><StatusBadge status={idea.status} /></div>
              <h2><Link href={ideaHref(idea.id, idea.status === "DRAFT")}>{idea.title || tr("Идея без названия")}</Link></h2>
              <dl className="cabinet-idea-responsibility">
                <div><dt>{tr("Кто действует сейчас")}</dt><dd>{actorLabel(idea.status)}</dd></div>
                <div><dt>{tr("Куда направлена")}</dt><dd>{destinationLabel(idea)}</dd></div>
                {idea.status !== "DRAFT" && context.assigneeName && <div><dt>{tr("Ответственный сотрудник")}</dt><dd>{context.assigneeName}</dd></div>}
              </dl>
              <p className="cabinet-idea-next"><strong>{tr("Ваш следующий шаг")}: </strong>{tr(guidance.citizenNextStep)}</p>
              <div className="cabinet-idea-meta">{idea.publicNumber && <span className="cabinet-idea-number">{idea.publicNumber}</span>}{idea.territoryName && <span><Icon name="pin" size={15} />{territoryNameForDisplay(idea.territoryName)}</span>}<span><Icon name="clock" size={15} />{tr("Обновлена ")}<time dateTime={idea.updatedAt}>{date(idea.updatedAt, intlLocale)}</time></span></div>
              <div className="cabinet-idea-footer"><button type="button" className="cabinet-preview-trigger" onClick={() => setSelected(idea.id)} aria-label={tr("Краткий обзор идеи «{0}»", { "0": idea.title || tr("Идея без названия") })} aria-controls="idea-preview-panel" aria-pressed={selectedId === idea.id}>{tr("Краткий обзор ")}<Icon name="arrow" size={16} /></button><Link className={`btn btn-sm ${guidance.actor === "AUTHOR" ? "btn-primary" : "btn-secondary"}`} href={ideaHref(idea.id, idea.status === "DRAFT")}>{tr(guidance.citizenActionLabel)}<Icon name="arrow" size={17} /></Link></div>
            </article>;
          })}
          {rows !== null && totalPages > 1 && <nav className="cabinet-pagination" aria-label={tr("Страницы ваших идей")}>{page > 1 ? <Link className="btn btn-secondary" href={hrefFor(appliedQ, appliedStatus, page - 1)}>{tr("Назад")}</Link> : <span />}<span>{tr("Страница ")}{page} {tr(" из ")}{totalPages}</span>{page < totalPages ? <Link className="btn btn-secondary" href={hrefFor(appliedQ, appliedStatus, page + 1)}>{tr("Далее")}</Link> : <span />}</nav>}
        </div>
        {Boolean(rows?.length) && <aside className="cabinet-preview" id="idea-preview-panel" aria-label={tr("Краткая карточка выбранной идеи")} aria-live="polite" aria-busy={!preview && !previewError}>
          <div className="cabinet-preview-label"><Icon name="file" size={17} /> {tr(" Краткий обзор")}</div>
          {preview && previewGuidance && previewContext ? <>
            <p className="cabinet-preview-number">{preview.publicNumber ?? tr("Идея ещё не отправлена")}</p>
            <h2>{preview.title || tr("Идея без названия")}</h2>
            <StatusBadge status={preview.status} />
            {preview.locationText && <p className="cabinet-preview-location"><Icon name="pin" size={17} />{preview.locationText}</p>}
            <dl className="cabinet-preview-responsibility">
              <div><dt>{tr("Кто действует сейчас")}</dt><dd>{actorLabel(preview.status)}</dd></div>
              <div><dt>{tr("Куда направлена")}</dt><dd>{destinationLabel(preview)}</dd></div>
              {preview.status !== "DRAFT" && previewContext.assigneeName && <div><dt>{tr("Ответственный сотрудник")}</dt><dd>{previewContext.assigneeName}</dd></div>}
            </dl>
            <div className="cabinet-next-step" data-status={preview.status} data-responsibility={previewGuidance.actor.toLowerCase()}>
              <strong>{tr("Ваш следующий шаг")}</strong><p>{tr(previewGuidance.citizenNextStep)}</p>
            </div>
            {preview.status !== "DRAFT" && <>
              <section className="cabinet-preview-route" aria-labelledby="idea-preview-route-heading">
                <h3 id="idea-preview-route-heading">{tr("Почему это направление?")}</h3>
                <p>{previewContext.explanation ? tr(previewContext.explanation.replace(/Демо:\s*/g, "")) : tr("Объяснение направления пока не указано.")}</p>
                {preview.routing?.mode === "TRIAGE" && <p>{tr("Направление требует уточнения. Специалист рассмотрит идею.")}</p>}
              </section>
              {previewGuidance.actor === "DONE" && preview.resolutionType && resultTypes[preview.resolutionType] && <div className="cabinet-next-step"><strong>{tr("Итог рассмотрения")}</strong><p>{resultTypes[preview.resolutionType]}</p></div>}
              <h3>{tr("Последние события")}</h3>
              {publicTimeline.length ? <ol className="cabinet-preview-history">{publicTimeline.filter((item) => !item.text.includes("Прикреплён")).slice(-3).map((item, index) => <li key={`${item.at}-${index}`}><span className="cabinet-history-dot" aria-hidden="true" /><div><strong>{tr(item.text)}</strong><time dateTime={item.at}>{date(item.at, intlLocale)}</time></div></li>)}</ol> : <p className="muted">{tr("Новые события появятся здесь.")}</p>}
              <h3>{preview.status === "NEEDS_INFO" ? tr("Вопрос специалиста") : tr("Ответ специалиста")}</h3>
              <div className="cabinet-preview-reply">
                {latestMessage ? <><span><Icon name="mail" size={17} />{preview.status === "NEEDS_INFO" ? tr("Запрос уточнений") : tr("Публичный ответ")}</span><p>{latestMessage.body}</p><time dateTime={latestMessage.at}>{date(latestMessage.at, intlLocale)}</time></> : <p>{preview.status === "NEEDS_INFO" ? tr("Откройте идею, чтобы прочитать запрос уточнений и ответить.") : previewGuidance.actor === "DONE" ? tr("Откройте полную карточку, чтобы прочитать итог рассмотрения.") : tr("Ответ пока не поступил. О новом сообщении вы узнаете в уведомлениях.")}</p>}
              </div>
            </>}
            <Link className={`btn ${previewGuidance.actor === "AUTHOR" ? "btn-primary" : "btn-secondary"} cabinet-preview-open`} href={ideaHref(selectedId, preview.status === "DRAFT")}>{tr(previewGuidance.citizenActionLabel)}<Icon name="arrow" size={17} /></Link>
          </> : previewError ? <div className="cabinet-preview-error"><p>{tr("Не удалось загрузить обзор. Вашу идею можно открыть напрямую.")}</p><Link className="btn btn-secondary" href={ideaHref(selectedId, selectedIdea?.status === "DRAFT")}>{tr("Открыть идею ")}<Icon name="arrow" size={16} /></Link></div> : <Skeleton lines={5} />}
        </aside>}
      </div>
    </div>
  );
}
export default function MyPage() {
  const ru = useUiMessages(); return <Suspense fallback={<Skeleton lines={4} />}><MyIdeas /></Suspense>; }
