"use client";
import { PublicationPanel } from "@/components/showcase/PublicationPanel";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, use, useCallback, useEffect, useState } from "react";
import { ApiError, api } from "@/features/shared/api-client";
import { store, type ThreadComment } from "@/features/shared/data";
import { MessageOrigin, MessageThread } from "@/components/communication/MessageThread";
import { useSession } from "@/features/shared/session";
import { loginHref, safeNextPath } from "@/features/shared/navigation";
import { ErrorNotice, Skeleton, Timeline } from "@/components/ui/Feedback";
import { RouteCard, type RouteInfo } from "@/components/ui/RouteCard";
import { StatusBadge, orgName } from "@/components/ui/StatusBadge";
import { Icon, type IconName } from "@/components/ui/Icon";
import ru from "@/locales/ru.json";
import type { IdeaStatus } from "@/contracts";
import { useAssistantPage } from "@/features/assistant/context";
import Link from "next/link";
import {
  LocationMap,
  type LocationGeometry,
} from "@/components/location/LocationMap";
import { useTranslation, useUiMessages } from "@/features/i18n/provider";

interface Detail {
  authorDisplayName?: string | null;
  id: string;
  publicNumber: string | null;
  version: number;
  title: string;
  problem: string;
  solution: string;
  expectedBenefit?: string | null;
  locationText?: string | null;
  locationGeometry?: LocationGeometry | null;
  status: IdeaStatus;
  organizationCode: string | null;
  assignee: { id: string; name: string } | null;
  assigneeDisplayName?: string | null;
  resolutionType: string | null;
  attachments: Array<{ id: string; originalName: string }>;
  routing: RouteInfo | null;
  timeline: Array<{ id: string; at: string; actor: string; text: string }>;
  comments: ThreadComment[];
}

const RESULT_TYPES = ru.resultTypes as Record<string, string>;
const NEXT_STEPS: Record<IdeaStatus, { title: string; text: string; icon: IconName }> = {
  DRAFT: { title: "Идея ещё не отправлена", text: "Дополните черновик, проверьте данные и отправьте идею на рассмотрение.", icon: "file" },
  RECEIVED: { title: "Идея получена", text: "Следите за рассмотрением здесь. Обновления статуса и ответы также появятся в уведомлениях.", icon: "check" },
  UNDER_REVIEW: { title: "Идею рассматривают", text: "Ожидайте ответа специалиста. Если понадобятся подробности, здесь появится вопрос.", icon: "clock" },
  NEEDS_INFO: { title: "Нужен ваш ответ", text: "Специалист запросил уточнение. Прочитайте вопрос и ответьте в диалоге ниже.", icon: "mail" },
  IN_PROGRESS: { title: "Идея в работе", text: "Следите за изменениями статуса и сообщениями специалиста в этой карточке.", icon: "layers" },
  COMPLETED: { title: "Рассмотрение завершено", text: "Ознакомьтесь с итогом и ответом специалиста в диалоге.", icon: "check" },
  REJECTED: { title: "Идея отклонена", text: "Причина решения указана в ответе специалиста. Откройте диалог, чтобы прочитать его.", icon: "file" },
};

function IdeaDetailPageContent({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ru = useUiMessages();
  const { t: tr } = useTranslation();
  const { id } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawReturnTo = searchParams.get("returnTo");
  const requestedReturn = safeNextPath(rawReturnTo);
  const returnTo = requestedReturn === "/my" || requestedReturn?.startsWith("/my?") || requestedReturn === "/notifications" || requestedReturn?.startsWith("/notifications?")
    ? requestedReturn : "/my";
  const { user, checked } = useSession();
  const [idea, setIdea] = useState<Detail | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<ApiError | null>(null);
  const load = useCallback(async () => {
    setError(null);
    try {
      const { data } = await store.get(id);
      setIdea(data as Detail);
    } catch (err) {
      setIdea(null);
      setError(err as ApiError);
    }
  }, [id]);

  useEffect(() => {
    if (checked && user?.role === "CITIZEN") load();
  }, [checked, user, load]);

  useEffect(() => {
    if (!checked) return;
    if (!user) {
      router.replace(loginHref(window.location.pathname + window.location.search + window.location.hash));
    } else if (user.role !== "CITIZEN") {
      const staffReturn = rawReturnTo === "/staff" || rawReturnTo?.startsWith("/staff?")
        ? safeNextPath(rawReturnTo, user.role) ?? "/staff" : "/staff";
      router.replace(`/staff/${encodeURIComponent(id)}${staffReturn === "/staff" ? "" : `?returnTo=${encodeURIComponent(staffReturn)}`}`);
    }
  }, [checked, user, router, id, rawReturnTo]);

  const needsInfo = idea?.status === "NEEDS_INFO";
  const isDraft = idea?.status === "DRAFT";
  useAssistantPage({
    page: "idea-detail",
    status: idea?.status,
    saving: busy,
    navigationBlocked: busy || Boolean(answer.trim()),
    errorCode: formError?.detail?.code ?? error?.detail?.code,
    targets: checked && user?.role === "CITIZEN" && idea ? ["idea-dialog", "idea-history", ...(idea.locationGeometry ? ["idea-location-map"] : []), ...(needsInfo ? ["citizen-clarification"] : [])] : [],
  });

  if (!checked || user?.role !== "CITIZEN") return null;

  const lastQ = idea
    ? [...idea.comments].reverse().find((c) => c.visibility === "PUBLIC" && c.kind === "CLARIFICATION_QUESTION")
    : undefined;

  const sendAnswer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!idea) return;
    if (answer.trim().length < 10) {
      setFormError(
        new ApiError({
          http: 400,
          code: "VALIDATION_ERROR",
          message: "Ответ — минимум 10 символов",
          fields: {},
        }),
      );
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      await store.clarify(
        id,
        { body: answer, expectedVersion: idea.version },
        api.key(),
      );
      setAnswer("");
      load();
    } catch (err) {
      setFormError(err as ApiError);
      if ((err as ApiError).detail?.code === "VERSION_CONFLICT") await load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="citizen-detail-page">
      <Link className="back-link" href={returnTo}>{tr(returnTo.startsWith("/notifications") ? "← Уведомления" : "← Мои идеи")}</Link>
      <div>
        {error && <ErrorNotice error={error} onRetry={load} />}
        {!error && !idea && <Skeleton lines={4} />}
        {idea && (
          <>
            <header className="citizen-detail-heading">
              <p className="eyebrow">{idea.publicNumber ?? (isDraft ? tr("Черновик идеи") : tr("Ваша идея"))}</p>
              <h1>{idea.title.trim() || (isDraft ? tr("Черновик без названия") : tr("Идея без названия"))}</h1>
              <div className="citizen-detail-badges">
                <StatusBadge status={idea.status} />
                {idea.resolutionType && (
                  <span className="tag">{RESULT_TYPES[idea.resolutionType] ?? idea.resolutionType}</span>
                )}
              </div>
            </header>
            <section className="citizen-detail-next-step" data-status={idea.status} aria-labelledby="idea-next-step">
              <span className="citizen-detail-next-step-icon" aria-hidden="true"><Icon name={NEXT_STEPS[idea.status].icon} size={23} /></span>
              <div>
                <h2 id="idea-next-step">{NEXT_STEPS[idea.status].title}</h2>
                <p>{NEXT_STEPS[idea.status].text}</p>
                {isDraft ? (
                  <Link className="btn btn-primary" href={`/ideas/new?draft=${id}${returnTo === "/my" ? "" : `&returnTo=${encodeURIComponent(returnTo)}`}`}>{tr("Продолжить черновик")}<Icon name="arrow" size={18} /></Link>
                ) : needsInfo ? (
                  <a className="btn btn-primary" href="#idea-answer">{tr("Ответить на вопрос")}<Icon name="arrow" size={18} /></a>
                ) : (idea.status === "COMPLETED" || idea.status === "REJECTED") ? (
                  <a className="citizen-detail-action" href="#idea-dialog">{tr("Прочитать ответ")}<Icon name="arrow" size={16} /></a>
                ) : null}
              </div>
            </section>
            {!isDraft && (
              <dl className="citizen-detail-assignment">
                <div><dt>{tr("Направление")}</dt><dd>{idea.organizationCode ? orgName(idea.organizationCode) : tr("Пока не определено")}</dd></div>
                <div><dt>{tr("Ответственный")}</dt><dd>{idea.assigneeDisplayName ?? idea.assignee?.name ?? tr("Пока не назначен")}</dd></div>
              </dl>
            )}
            <nav className="citizen-detail-navigation" aria-label={tr("Разделы идеи")}>
              <a href="#idea-content">{tr("Содержание")}</a>
              {(idea.locationText || idea.locationGeometry) && <a href="#idea-location">{tr("Место")}</a>}
              <a href="#idea-dialog">{tr("Диалог")}</a>
              <a href="#idea-history">{tr("История")}</a>
            </nav>
            <section className="citizen-detail-section" id="idea-content" aria-labelledby="idea-content-title">
              <h2 id="idea-content-title">{tr("Содержание идеи")}</h2>
              <MessageOrigin name={idea.authorDisplayName ?? (user.role === "CITIZEN" ? user.displayName : null)} own={user.role === "CITIZEN"} />
              <div className="citizen-detail-text">
                <h3>{tr("Проблема")}</h3>
                <p>{idea.problem || tr("Описание проблемы пока не добавлено.")}</p>
              </div>
              <div className="citizen-detail-text">
                <h3>{tr("Предлагаемое решение")}</h3>
                <p>{idea.solution || tr("Решение пока не добавлено.")}</p>
              </div>
              {idea.expectedBenefit && (
                <div className="citizen-detail-text"><h3>{tr("Ожидаемая польза")}</h3><p>{idea.expectedBenefit}</p></div>
              )}
              {idea.attachments.length > 0 && (
                <div className="citizen-detail-materials">
                  <h3>{tr("Материалы")}</h3>
                  <ul className="citizen-detail-files" aria-label={tr("Приложенные материалы")}>
                    {idea.attachments.map((a) => (
                      <li key={a.id}><a className="file-link" href={`/api/v1/attachments/${a.id}/download`}><Icon name="file" size={17} />{a.originalName}</a></li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
            {(idea.locationText || idea.locationGeometry) && (
              <section className="citizen-detail-section" id="idea-location" aria-labelledby="idea-location-title" data-assistant-target={idea.locationGeometry ? "idea-location-map" : undefined}>
                <h2 id="idea-location-title">{tr("Место идеи")}</h2>
                {idea.locationText && <p>{idea.locationText}</p>}
                {idea.locationGeometry && (
                  <LocationMap value={idea.locationGeometry} readOnly />
                )}
              </section>
            )}
            {!isDraft && idea.routing && <div className="citizen-detail-route"><RouteCard route={idea.routing} /></div>}
            {!isDraft && <PublicationPanel ideaId={id} source={{ title: idea.title, problem: idea.problem, solution: idea.solution, expectedBenefit: idea.expectedBenefit ?? "" }} initialOpen={searchParams.get("publication") === "1"} />}
            <section className="citizen-detail-section" id="idea-dialog" aria-labelledby="idea-dialog-title" data-assistant-target="idea-dialog">
              <h2 id="idea-dialog-title">{tr("Диалог со специалистом")}</h2>
              {idea.comments.some((c) => c.visibility === "PUBLIC") && <MessageThread comments={idea.comments} currentUserId={user.id} />}
              {!idea.comments.some((c) => c.visibility === "PUBLIC") && (
                <p className="muted">{isDraft ? tr("После отправки идеи здесь появятся вопросы и ответы специалиста.") : tr("Сообщений пока нет. Ответы специалиста появятся здесь и в уведомлениях.")}</p>
              )}
            {needsInfo && (
              <section className="citizen-detail-clarification" id="idea-answer" aria-labelledby="idea-answer-title" data-assistant-target="citizen-clarification">
                <h3 id="idea-answer-title">{tr("Ответить на уточнение")}</h3>
                <div className="notice warn">
                  {lastQ?.body ?? tr("Специалист запросил уточнение.")}
                </div>
                <form onSubmit={sendAnswer}>
                  <div className="field">
                    <label htmlFor="answer">{tr("Ваш ответ")}</label>
                    <textarea
                      id="answer"
                      disabled={busy}
                      value={answer}
                      onChange={(e) => setAnswer(e.target.value)}
                      aria-invalid={formError ? "true" : undefined}
                      aria-describedby={
                        formError ? "answer-h answer-e" : "answer-h"
                      }
                    />
                    <p className="hint" id="answer-h">
                      {tr(" Ваш ответ добавится в историю, исходный текст идеи сохранится. 10–3000 символов. ")}</p>
                  </div>
                  {formError && <ErrorNotice error={formError} id="answer-e" />}
                  <button
                    className="btn btn-primary"
                    type="submit"
                    disabled={busy}
                    aria-busy={busy}
                  >
                    {busy ? tr("Отправляем…") : tr("Отправить ответ")}
                  </button>
                </form>
              </section>
            )}
            </section>
            <section className="citizen-detail-section" id="idea-history" aria-labelledby="idea-history-title" data-assistant-target="idea-history">
              <h2 id="idea-history-title">{isDraft ? tr("История черновика") : tr("История рассмотрения")}</h2>
              <Timeline items={idea.timeline} />
            </section>
          </>
        )}
        {(!idea || !needsInfo) && Boolean(answer.trim()) && (
          <section className="citizen-detail-section citizen-detail-clarification" aria-labelledby="unsent-answer-title">
            <h2 id="unsent-answer-title">{tr("Ваш неотправленный ответ")}</h2>
            <p className="notice warn" id="unsent-answer-h">{idea ? tr("Статус идеи изменился, и отправить уточнение сейчас нельзя.") : tr("Не удалось обновить карточку. Ответ не был отправлен.")} {tr(" Ваш текст остался на этой странице: скопируйте его перед уходом.")}</p>
            {formError && <ErrorNotice error={formError} id="unsent-answer-error" />}
            <div className="field">
              <label htmlFor="unsent-answer">{tr("Текст ответа для сохранения")}</label>
              <textarea id="unsent-answer" value={answer} readOnly aria-describedby={formError ? "unsent-answer-h unsent-answer-error" : "unsent-answer-h"} />
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

export default function IdeaDetailPage(props: { params: Promise<{ id: string }> }) {
  return <Suspense><IdeaDetailPageContent {...props} /></Suspense>;
}
