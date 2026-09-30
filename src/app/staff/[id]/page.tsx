"use client";
import { PublicationPanel } from "@/components/showcase/PublicationPanel";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, use, useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api } from "@/features/shared/api-client";
import { store, type ThreadComment } from "@/features/shared/data";
import { MessageOrigin, MessageThread } from "@/components/communication/MessageThread";
import { useSession } from "@/features/shared/session";
import { loginHref, safeNextPath } from "@/features/shared/navigation";
import { TRANSITIONS } from "@/contracts/transitions.mjs";
import { ErrorNotice, Skeleton, Timeline } from "@/components/ui/Feedback";
import { RouteCard, type RouteInfo } from "@/components/ui/RouteCard";
import { StatusBadge, orgName } from "@/components/ui/StatusBadge";
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
  expectedBenefit?: string | null;
  id: string;
  publicNumber: string | null;
  version: number;
  title: string;
  problem: string;
  solution: string;
  locationText?: string | null;
  locationGeometry?: LocationGeometry | null;
  status: IdeaStatus;
  organizationCode: string | null;
  organizationId?: string | null;
  assigneeId?: string | null;
  assignee: { id: string; name: string } | null;
  assigneeDisplayName?: string | null;
  resolutionType: string | null;
  attachments: Array<{ id: string; originalName: string }>;
  routing: RouteInfo | null;
  timeline: Array<{ id: string; at: string; actor: string; text: string }>;
  comments: ThreadComment[];
}

const ACTION_LABEL: Record<string, string> = {
  UNDER_REVIEW: "Взять на рассмотрение",
  NEEDS_INFO: "Запросить уточнение",
  IN_PROGRESS: "Взять в работу",
  COMPLETED: "Завершить",
  REJECTED: "Отклонить",
};

const RESULT_TYPES = ru.resultTypes as Record<string, string>;
const CATEGORIES = ru.categories as Record<string, string>;

interface TransitionDraft {
  publicComment?: string;
  resolutionType?: string;
  takeOwnership?: boolean;
}

function StaffDetailContent({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ru = useUiMessages();
  const { t: tr, intlLocale } = useTranslation();
  const { id } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, checked } = useSession();
  const [idea, setIdea] = useState<Detail | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [assignees, setAssignees] = useState<
    Array<{ id: string; displayName: string }>
  >([]);
  const [assignmentSelection, setAssignmentSelection] = useState<string | null>(null);
  const [orgs, setOrgs] = useState<
    Array<{ id: string; code: string; name: string }>
  >([]);
  const [actError, setActError] = useState<ApiError | null>(null);
  const [noteError, setNoteError] = useState<ApiError | null>(null);
  const [rrError, setRrError] = useState<ApiError | null>(null);
  const [keep, setKeep] = useState<Record<string, TransitionDraft>>({});
  const [noteText, setNoteText] = useState("");
  const [rerouteDraft, setRerouteDraft] = useState<{
    organizationId?: string;
    effectiveCategoryCode?: string;
    reason?: string;
  }>({});
  const candidate = safeNextPath(searchParams.get("returnTo"));
  const returnTo = candidate && (/^\/staff(?:\?|$)/.test(candidate) || /^\/notifications(?:\?|$)/.test(candidate)) ? candidate : "/staff";
  const [publicText, setPublicText] = useState("");
  const [mutationBusy, setMutationBusy] = useState<string | null>(null);
  const mutationLock = useRef(false);
  const publicBusy = mutationBusy === "public";
  const [publicError, setPublicError] = useState<ApiError | null>(null);
  const publicIntent = useRef<{ body: string; version: number; key: string } | null>(null);
  useEffect(() => {
    setAssignmentSelection(null);
    setKeep({});
    setNoteText("");
    setRerouteDraft({});
    setPublicText("");
    publicIntent.current = null;
  }, [id]);

  const load = useCallback(
    async () => {
      setError(null);
      try {
        const { data } = await store.staffGet(id);
        const detail = data as Detail;
        setIdea(detail);
        try {
          // Настоящий B требует organizationId для assignees (иначе 403):
          // сотрудник — своя организация, админ — организация карточки.
          const orgId =
            user?.role === "STAFF"
              ? (user.organizationId ?? undefined)
              : (detail.organizationId ?? undefined);
          const { data: a } = await store.assignees(orgId);
          setAssignees(a as Array<{ id: string; displayName: string }>);
        } catch {
          setAssignees([]);
        }
        if (user?.role === "ADMIN") {
          try {
            const { data: o } = await store.adminOrganizations();
            setOrgs(o as Array<{ id: string; code: string; name: string }>);
          } catch {
            setOrgs([]);
          }
        }
      } catch (err) {
        setIdea(null);
        setError(err as ApiError);
      }
    },
    [id, user],
  );

  useEffect(() => {
    if (checked && user && user.role !== "CITIZEN") load();
  }, [checked, user, load]);
  useEffect(() => {
    if (checked && (!user || user.role === "CITIZEN"))
      router.replace(user ? "/my" : loginHref(window.location.pathname + window.location.search + window.location.hash));
  }, [checked, user, router]);

  useAssistantPage({
    page: "staff-detail",
    status: idea?.status,
    saving: mutationBusy !== null,
    navigationBlocked: mutationBusy !== null || Boolean(publicText.trim() || noteText.trim()) || Object.values(keep).some((draft) => Object.keys(draft).length > 0) || assignmentSelection !== null || Object.keys(rerouteDraft).length > 0,
    errorCode: publicError?.detail?.code ?? noteError?.detail?.code ?? actError?.detail?.code ?? rrError?.detail?.code ?? error?.detail?.code,
    targets: checked && user && user.role !== "CITIZEN" && idea ? ["staff-assignment", "staff-status-actions", "staff-public-reply", "staff-internal-note", "idea-history", ...(idea.locationGeometry ? ["idea-location-map"] : []), ...(user.role === "ADMIN" ? ["admin-reroute"] : [])] : [],
  });

  if (!checked || !user || user.role === "CITIZEN") return null;

  // Только допустимые переходы из зеркала контрактов (01 §12), не весь enum.
  const actions = ((TRANSITIONS as Record<string, string[]>)[
    idea?.status ?? ""
  ] ?? []) as IdeaStatus[];

  const saveAssign = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!idea || mutationLock.current) return;
    const v =
      (e.currentTarget.elements.namedItem("assignee") as HTMLSelectElement)
        .value || null;
    mutationLock.current = true;
    setMutationBusy("assign");
    setActError(null);
    try {
      await store.assign(
        id,
        { assigneeId: v, expectedVersion: idea.version },
        api.key(),
      );
      await load();
      setAssignmentSelection(null);
    } catch (err) {
      setActError(err as ApiError);
      if ((err as ApiError).detail?.code === "VERSION_CONFLICT") await load();
    } finally {
      mutationLock.current = false;
      setMutationBusy(null);
    }
  };

  const doTransition =
    (to: string) => async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (!idea || mutationLock.current) return;
      const fd = new FormData(e.currentTarget);
      const payload: Record<string, unknown> = {
        toStatus: to,
        expectedVersion: idea.version,
      };
      const pc = fd.get("publicComment");
      if (pc !== null) payload.publicComment = pc;
      const rt = fd.get("resolutionType");
      if (rt) payload.resolutionType = rt;
      if (fd.get("takeOwnership")) payload.takeOwnership = true;
      if (
        (["NEEDS_INFO", "REJECTED", "COMPLETED"].includes(to) ||
          (idea.status === "NEEDS_INFO" && to === "UNDER_REVIEW")) &&
        String(payload.publicComment ?? "").trim().length < 20
      ) {
        setActError(
          new ApiError({
            http: 400,
            code: "VALIDATION_ERROR",
            message:
              "Публичный комментарий — минимум 20 символов. Без причины отклонение/завершение невозможно.",
            fields: {},
          }),
        );
        return;
      }
      const shown = String(payload.publicComment ?? "—").slice(0, 140);
      if (
        !confirm(
          `Подтвердите переход «${ru.statuses[to as IdeaStatus]}». Автор увидит: ${shown}`,
        )
      )
        return;
      mutationLock.current = true;
      setMutationBusy(`status:${to}`);
      setActError(null);
      try {
        await store.changeStatus(id, payload, api.key());
        await load();
        setKeep((current) => {
          const next = { ...current };
          delete next[to];
          return next;
        });
      } catch (err) {
        setActError(err as ApiError);
        if ((err as ApiError).detail?.code === "VERSION_CONFLICT") {
          await load();
        }
      } finally {
        mutationLock.current = false;
        setMutationBusy(null);
      }
    };

  const saveNote = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!idea || mutationLock.current) return;
    const v = (
      e.currentTarget.elements.namedItem("note") as HTMLTextAreaElement
    ).value;
    mutationLock.current = true;
    setMutationBusy("note");
    setNoteError(null);
    try {
      await store.addComment(
        id,
        { visibility: "INTERNAL", body: v, expectedVersion: idea.version },
        api.key(),
      );
      await load();
      setNoteText("");
    } catch (err) {
      setNoteError(err as ApiError);
      if ((err as ApiError).detail?.code === "VERSION_CONFLICT") await load();
    } finally {
      mutationLock.current = false;
      setMutationBusy(null);
    }
  };

  const saveReroute = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!idea || mutationLock.current) return;
    const form = e.currentTarget;
    const organizationId = (form.elements.namedItem("org") as HTMLSelectElement)
      .value;
    const effectiveCategoryCode = (
      form.elements.namedItem("category") as HTMLSelectElement
    ).value;
    const reason = (form.elements.namedItem("reason") as HTMLTextAreaElement)
      .value;
    mutationLock.current = true;
    setMutationBusy("reroute");
    setRrError(null);
    try {
      // Настоящий B требует effectiveCategoryCode (движок D валидирует категорию).
      await store.reroute(
        id,
        {
          organizationId,
          effectiveCategoryCode,
          reason,
          expectedVersion: idea.version,
        },
        api.key(),
      );
      await load();
      setRerouteDraft({});
    } catch (err) {
      setRrError(err as ApiError);
      if ((err as ApiError).detail?.code === "VERSION_CONFLICT") await load();
    } finally {
      mutationLock.current = false;
      setMutationBusy(null);
    }
  };

  const sendPublic = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!idea || mutationLock.current) return;
    if (publicText.trim().length < 20) {
      setPublicError(new ApiError({
        http: 400,
        code: "VALIDATION_ERROR",
        message: "Публичный ответ — минимум 20 символов.",
        fields: { body: "Минимум 20 символов." },
      }));
      return;
    }
    mutationLock.current = true;
    setMutationBusy("public");
    setPublicError(null);
    if (publicIntent.current?.body !== publicText || publicIntent.current?.version !== idea.version)
      publicIntent.current = { body: publicText, version: idea.version, key: api.key() };
    try {
      await store.addComment(
        id,
        {
          visibility: "PUBLIC",
          body: publicText,
          expectedVersion: idea.version,
        },
        publicIntent.current.key,
      );
      setPublicText("");
      publicIntent.current = null;
      await load();
    } catch (err) {
      setPublicError(err as ApiError);
      if ((err as ApiError).detail?.code === "VERSION_CONFLICT") {
        publicIntent.current = null;
        await load();
      }
    } finally {
      mutationLock.current = false;
      setMutationBusy(null);
    }
  };
  return (
    <div aria-live="polite">
      {error && (
        <div className="card">
          <ErrorNotice error={error} onRetry={() => load()} />
        </div>
      )}
      {!error && !idea && (
        <div className="card">
          <Skeleton lines={4} />
        </div>
      )}
      {idea && (
        <div className="staff-layout">
          <div className="card">
            <Link className="back-link" href={returnTo}>
              {tr(returnTo.startsWith("/notifications") ? "← Уведомления" : " ← Вернуться в очередь ")}</Link>
            <p className="eyebrow">{idea.publicNumber ?? ""}</p>
            <h1>{idea.title}</h1>
            <p>
              <StatusBadge status={idea.status} />{" "}
              {idea.resolutionType && (
                <span className="tag">{RESULT_TYPES[idea.resolutionType]}</span>
              )}
            </p>
            <h2>{tr("Содержание")}</h2>
            <MessageOrigin name={idea.authorDisplayName} />
            <a className="btn btn-secondary staff-mobile-actions" href="#staff-actions">{tr("Перейти к действиям ↓")}</a>
            <p>
              <strong>{tr("Проблема:")}</strong> {idea.problem}
            </p>
            <p>
              <strong>{tr("Решение:")}</strong> {idea.solution}
            </p>
            {idea.attachments.length > 0 && (
              <p>
                <strong>{tr("Файлы:")}</strong>{" "}
                {idea.attachments.map((a) => (
                  <a
                    key={a.id}
                    className="file-link"
                    href={`/api/v1/attachments/${a.id}/download`}
                  >
                    {a.originalName}
                  </a>
                ))}
              </p>
            )}
            {(idea.locationText || idea.locationGeometry) && (
              <section aria-label={tr("Место идеи")} data-assistant-target={idea.locationGeometry ? "idea-location-map" : undefined}>
                <h2>{tr("Место идеи")}</h2>
                <p>{idea.locationText}</p>
                {idea.locationGeometry && (
                  <LocationMap value={idea.locationGeometry} readOnly />
                )}
              </section>
            )}
            <PublicationPanel ideaId={id} staff source={{ title: idea.title, problem: idea.problem, solution: idea.solution, expectedBenefit: idea.expectedBenefit ?? "" }} />
            <h2>{tr("Ответ жителю (публичный диалог)")}</h2>
            {idea.comments.some((c) => c.visibility === "PUBLIC") && <MessageThread comments={idea.comments} currentUserId={user.id} />}
            {!idea.comments.some((c) => c.visibility === "PUBLIC") && (
              <p className="muted">{tr("Публичных сообщений пока нет.")}</p>
            )}
            <form onSubmit={sendPublic} className="public-reply-form" aria-busy={mutationBusy !== null} data-assistant-target="staff-public-reply">
              <div className="field">
                <label htmlFor="publicReply">{tr("Публичный ответ жителю")}</label>
                <textarea
                  id="publicReply"
                  value={publicText}
                  onChange={(e) => setPublicText(e.target.value)}
                  required
                  minLength={20}
                  maxLength={2000}
                  disabled={mutationBusy !== null}
                  aria-describedby="publicReplyHint"
                />
                <p id="publicReplyHint" className="hint">
                  {tr(" От 20 до 2000 символов. Этот текст увидит автор идеи. Внутренняя заметка для коллег находится в отдельном блоке. ")}</p>
              </div>
              {publicError && <ErrorNotice error={publicError} />}
              <button
                type="submit"
                className="btn btn-primary"
                disabled={mutationBusy !== null}
              >
                {publicBusy ? tr("Отправляем…") : tr("Отправить ответ")}
              </button>
            </form>
            <details className="staff-history" data-assistant-target="idea-history">
              <summary><strong>{tr("История рассмотрения")}</strong></summary>
              <Timeline items={idea.timeline} />
            </details>
          </div>
          <div>
            <div className="card">
              <h2>{tr("Маршрут")}</h2>
              <RouteCard route={idea.routing} />
              <p className="muted">
                {tr(" Ответственный:")}{" "}
                <strong>
                  {idea.assigneeDisplayName ??
                    idea.assignee?.name ??
                    tr("не назначен")}
                </strong>
              </p>
              <form onSubmit={saveAssign} aria-busy={mutationBusy !== null} data-assistant-target="staff-assignment">
                <div className="field">
                  <label htmlFor="assignee">{tr("Назначить ответственного")}</label>
                  <select
                    id="assignee"
                    name="assignee"
                    value={assignmentSelection ?? idea.assigneeId ?? idea.assignee?.id ?? ""}
                    onChange={(event) => setAssignmentSelection(event.target.value)}
                    disabled={mutationBusy !== null}
                  >
                    <option value="">{tr("— без ответственного —")}</option>
                    {assignees.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.displayName}
                      </option>
                    ))}
                  </select>
                </div>
                <button className="btn btn-secondary btn-sm" type="submit" disabled={mutationBusy !== null}>
                  {mutationBusy === "assign" ? tr("Сохраняем…") : tr("Сохранить назначение")}
                </button>
              </form>
            </div>
            <div className="card" id="staff-actions" tabIndex={-1} data-assistant-target="staff-status-actions">
              <h2>{tr("Действия по статусу")}</h2>
              {actions.length === 0 && (
                <p className="muted">{tr("Терминальный статус: переходов нет.")}</p>
              )}
              {actError && <ErrorNotice error={actError} />}
              {actions.map((to) => (
                <details key={to}>
                  <summary>
                    <strong>{ACTION_LABEL[to] ?? to}</strong> →{" "}
                    {ru.statuses[to]}
                  </summary>
                  <form onSubmit={doTransition(to)} aria-busy={mutationBusy !== null}>
                    {(["NEEDS_INFO", "REJECTED", "COMPLETED"].includes(to) ||
                      (idea.status === "NEEDS_INFO" && to === "UNDER_REVIEW")) && (
                      <div className="field">
                        <label>
                          {tr(" Текст, который увидит автор (публичный комментарий, мин. 20 символов) ")}<textarea
                            name="publicComment"
                            required
                            minLength={20}
                            maxLength={2000}
                            value={keep[to]?.publicComment ?? ""}
                            onChange={(event) => setKeep((current) => ({
                              ...current,
                              [to]: { ...current[to], publicComment: event.target.value },
                            }))}
                            disabled={mutationBusy !== null}
                          />
                        </label>
                      </div>
                    )}
                    {to === "COMPLETED" && (
                      <div className="field">
                        <label>
                          {tr(" Тип результата ")}<select
                            name="resolutionType"
                            value={keep[to]?.resolutionType ?? Object.keys(RESULT_TYPES)[0] ?? ""}
                            onChange={(event) => setKeep((current) => ({
                              ...current,
                              [to]: { ...current[to], resolutionType: event.target.value },
                            }))}
                            disabled={mutationBusy !== null}
                          >
                            {Object.entries(RESULT_TYPES).map(([k, v]) => (
                              <option key={k} value={k}>
                                {v}
                              </option>
                            ))}
                          </select>
                        </label>
                        <p className="hint">
                          «{RESULT_TYPES.ANSWER_PROVIDED}{tr("» не означает, что инфраструктура уже построена. ")}</p>
                      </div>
                    )}
                    {to === "UNDER_REVIEW" &&
                      !idea.assigneeId &&
                      !idea.assignee && (
                        <p className="hint">
                          <label>
                            <input
                              type="checkbox"
                              name="takeOwnership"
                              checked={keep[to]?.takeOwnership ?? true}
                              onChange={(event) => setKeep((current) => ({
                                ...current,
                                [to]: { ...current[to], takeOwnership: event.target.checked },
                              }))}
                              disabled={mutationBusy !== null}
                            />{" "}
                            {tr(" Назначить меня ответственным ")}</label>
                        </p>
                      )}
                    <p>
                      <button className="btn btn-primary btn-sm" type="submit" disabled={mutationBusy !== null}>
                        {mutationBusy === `status:${to}` ? tr("Сохраняем…") : tr("Подтвердить")}
                      </button>
                    </p>
                  </form>
                </details>
              ))}
            </div>
            <div className="card internal-box" data-assistant-target="staff-internal-note">
              <h3>{tr("Внутренняя заметка (не видна жителю)")}</h3>
              <form onSubmit={saveNote} aria-busy={mutationBusy !== null}>
                <div className="field">
                  <label htmlFor="note">{tr("Заметка для коллег")}</label>
                  <textarea
                    id="note"
                    name="note"
                    value={noteText}
                    onChange={(event) => setNoteText(event.target.value)}
                    disabled={mutationBusy !== null}
                  />
                </div>
                {noteError && <ErrorNotice error={noteError} />}
                <button className="btn btn-secondary btn-sm" type="submit" disabled={mutationBusy !== null}>
                  {mutationBusy === "note" ? tr("Сохраняем…") : tr("Сохранить заметку")}
                </button>
              </form>
              <MessageThread comments={idea.comments} currentUserId={user.id} visibility="INTERNAL" />
            </div>
            {user.role === "ADMIN" && (
              <div className="card" data-assistant-target="admin-reroute">
                <h2>{tr("Исправление маршрута (админ)")}</h2>
                <form onSubmit={saveReroute} aria-busy={mutationBusy !== null}>
                  <div className="field">
                    <label htmlFor="category">
                      {tr(" Тема (категория) после перенаправления ")}</label>
                    <select
                      id="category"
                      name="category"
                      required
                      value={rerouteDraft.effectiveCategoryCode ?? idea.routing?.effectiveCategoryCode ?? ""}
                      onChange={(event) => setRerouteDraft((current) => ({
                        ...current,
                        effectiveCategoryCode: event.target.value,
                      }))}
                      disabled={mutationBusy !== null}
                    >
                      <option value="">{tr("— выберите тему —")}</option>
                      {Object.entries(CATEGORIES).map(([code, name]) => (
                        <option key={code} value={code}>
                          {name as string}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="org">
                      {tr(" Новая организация (из справочника) ")}</label>
                    <select
                      id="org"
                      name="org"
                      value={rerouteDraft.organizationId ??
                        orgs.find((o) => o.code === idea.organizationCode)
                          ?.id ?? ""
                      }
                      onChange={(event) => setRerouteDraft((current) => ({
                        ...current,
                        organizationId: event.target.value,
                      }))}
                      disabled={mutationBusy !== null}
                    >
                      {orgs.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="reason">{tr("Причина (10–1000 символов)")}</label>
                    <textarea
                      id="reason"
                      name="reason"
                      value={rerouteDraft.reason ?? ""}
                      onChange={(event) => setRerouteDraft((current) => ({
                        ...current,
                        reason: event.target.value,
                      }))}
                      disabled={mutationBusy !== null}
                    />
                  </div>
                  {rrError && <ErrorNotice error={rrError} />}
                  <button className="btn btn-secondary btn-sm" type="submit" disabled={mutationBusy !== null}>
                    {mutationBusy === "reroute" ? tr("Сохраняем…") : tr("Перенаправить (сбросит ответственного)")}
                  </button>
                </form>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function StaffDetailPage(props: { params: Promise<{ id: string }> }) {
  return <Suspense fallback={<Skeleton lines={4} />}><StaffDetailContent {...props} /></Suspense>;
}
