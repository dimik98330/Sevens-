"use client";

import { useRouter } from "next/navigation";
import { use, useCallback, useEffect, useState } from "react";
import { ApiError, api } from "@/features/shared/api-client";
import { store } from "@/features/shared/data";
import { useSession } from "@/features/shared/session";
import { TRANSITIONS } from "@/contracts/transitions.mjs";
import { ErrorNotice, Skeleton, Timeline } from "@/components/ui/Feedback";
import { RouteCard, type RouteInfo } from "@/components/ui/RouteCard";
import { StatusBadge, orgName } from "@/components/ui/StatusBadge";
import ru from "@/locales/ru.json";
import type { IdeaStatus } from "@/contracts";

interface Detail {
  id: string;
  publicNumber: string | null;
  version: number;
  title: string;
  problem: string;
  solution: string;
  status: IdeaStatus;
  organizationCode: string | null;
  assignee: { id: string; name: string } | null;
  resolutionType: string | null;
  attachments: Array<{ id: string; name: string }>;
  routing: RouteInfo | null;
  timeline: Array<{ id: string; at: string; actor: string; text: string }>;
  comments: Array<{ id: string; visibility: "PUBLIC" | "INTERNAL"; author: string; body: string; at: string }>;
}

const ACTION_LABEL: Record<string, string> = {
  UNDER_REVIEW: "Взять на рассмотрение",
  NEEDS_INFO: "Запросить уточнение",
  IN_PROGRESS: "Взять в работу",
  COMPLETED: "Завершить",
  REJECTED: "Отклонить",
};

const RESULT_TYPES = ru.resultTypes as Record<string, string>;

export default function StaffDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { user, checked } = useSession();
  const [idea, setIdea] = useState<Detail | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [assignees, setAssignees] = useState<Array<{ id: string; displayName: string }>>([]);
  const [orgs, setOrgs] = useState<Array<{ id: string; code: string; name: string }>>([]);
  const [actError, setActError] = useState<ApiError | null>(null);
  const [noteError, setNoteError] = useState<ApiError | null>(null);
  const [rrError, setRrError] = useState<ApiError | null>(null);
  const [keep, setKeep] = useState<Record<string, { publicComment?: string }>>({});

  const load = useCallback(
    async (keepForm?: Record<string, { publicComment?: string }>) => {
      setError(null);
      try {
        const { data } = await store.staffGet(id);
        setIdea(data as Detail);
        if (keepForm) setKeep(keepForm);
        try {
          const { data: a } = await store.assignees();
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
    if (checked && user) load();
  }, [checked, user, load]);
  useEffect(() => {
    if (checked && (!user || user.role === "CITIZEN")) router.replace(user ? "/" : "/login");
  }, [checked, user, router]);

  if (!checked || !user || user.role === "CITIZEN") return null;

  // Только допустимые переходы из зеркала контрактов (01 §12), не весь enum.
  const actions = ((TRANSITIONS as Record<string, string[]>)[idea?.status ?? ""] ?? []) as IdeaStatus[];

  const saveAssign = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!idea) return;
    const v = (e.currentTarget.elements.namedItem("assignee") as HTMLSelectElement).value || null;
    setActError(null);
    try {
      await store.assign(id, { assigneeId: v, expectedVersion: idea.version }, api.key());
      load();
    } catch (err) {
      setActError(err as ApiError);
    }
  };

  const doTransition = (to: string) => async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!idea) return;
    const fd = new FormData(e.currentTarget);
    const payload: Record<string, unknown> = { toStatus: to, expectedVersion: idea.version };
    const pc = fd.get("publicComment");
    if (pc !== null) payload.publicComment = pc;
    const rt = fd.get("resolutionType");
    if (rt) payload.resolutionType = rt;
    if (fd.get("takeOwnership")) payload.takeOwnership = true;
    if (["NEEDS_INFO", "REJECTED", "COMPLETED"].includes(to) && String(payload.publicComment ?? "").trim().length < 20) {
      setActError(
        new ApiError({
          http: 400,
          code: "VALIDATION_ERROR",
          message: "Публичный комментарий — минимум 20 символов. Без причины отклонение/завершение невозможно.",
          fields: {},
        }),
      );
      return;
    }
    const shown = String(payload.publicComment ?? "—").slice(0, 140);
    if (!confirm(`Подтвердите переход «${ru.statuses[to as IdeaStatus]}». Автор увидит: ${shown}`)) return;
    setActError(null);
    try {
      await store.changeStatus(id, payload, api.key());
      setKeep({});
      load();
    } catch (err) {
      if ((err as ApiError).detail?.code === "VERSION_CONFLICT") {
        load({ [to]: { publicComment: String(payload.publicComment ?? "") } });
      } else {
        setActError(err as ApiError);
      }
    }
  };

  const saveNote = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!idea) return;
    const v = (e.currentTarget.elements.namedItem("note") as HTMLTextAreaElement).value;
    setNoteError(null);
    try {
      await store.addComment(id, { visibility: "INTERNAL", body: v, expectedVersion: idea.version }, api.key());
      load();
    } catch (err) {
      setNoteError(err as ApiError);
    }
  };

  const saveReroute = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!idea) return;
    const form = e.currentTarget;
    const organizationId = (form.elements.namedItem("org") as HTMLSelectElement).value;
    const reason = (form.elements.namedItem("reason") as HTMLTextAreaElement).value;
    setRrError(null);
    try {
      await store.reroute(id, { organizationId, reason, expectedVersion: idea.version }, api.key());
      load();
    } catch (err) {
      setRrError(err as ApiError);
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
            <p className="muted">{idea.publicNumber ?? ""}</p>
            <h1>{idea.title}</h1>
            <p>
              <StatusBadge status={idea.status} />{" "}
              {idea.resolutionType && <span className="tag">{RESULT_TYPES[idea.resolutionType]}</span>}
            </p>
            <h2>Содержание</h2>
            <p>
              <strong>Проблема:</strong> {idea.problem}
            </p>
            <p>
              <strong>Решение:</strong> {idea.solution}
            </p>
            {idea.attachments.length > 0 && (
              <p>
                <strong>Файлы:</strong> {idea.attachments.map((a) => a.name).join(", ")}
              </p>
            )}
            <h2>Ответ жителю (публичный диалог)</h2>
            {idea.comments
              .filter((c) => c.visibility === "PUBLIC")
              .map((c) => (
                <div key={c.id} className="notice">
                  <strong>{c.author}</strong>
                  <br />
                  {c.body}
                </div>
              ))}
            {!idea.comments.some((c) => c.visibility === "PUBLIC") && (
              <p className="muted">Публичных сообщений пока нет.</p>
            )}
            <h2>История</h2>
            <Timeline items={idea.timeline} />
          </div>
          <div>
            <div className="card">
              <h2>Маршрут</h2>
              <RouteCard route={idea.routing} />
              <p className="muted">
                Ответственный: <strong>{idea.assignee?.name ?? "не назначен"}</strong>
              </p>
              <form onSubmit={saveAssign}>
                <div className="field">
                  <label htmlFor="assignee">Назначить ответственного</label>
                  <select id="assignee" name="assignee" defaultValue={idea.assignee?.id ?? ""}>
                    <option value="">— без ответственного —</option>
                    {assignees.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.displayName}
                      </option>
                    ))}
                  </select>
                </div>
                <button className="btn btn-secondary btn-sm" type="submit">
                  Сохранить назначение
                </button>
              </form>
            </div>
            <div className="card">
              <h2>Действия по статусу</h2>
              {actions.length === 0 && <p className="muted">Терминальный статус: переходов нет.</p>}
              {actError && <ErrorNotice error={actError} />}
              {actions.map((to) => (
                <details key={to}>
                  <summary>
                    <strong>{ACTION_LABEL[to] ?? to}</strong> → {ru.statuses[to]}
                  </summary>
                  <form onSubmit={doTransition(to)}>
                    {["NEEDS_INFO", "REJECTED", "COMPLETED"].includes(to) && (
                      <div className="field">
                        <label>
                          Текст, который увидит автор (публичный комментарий, мин. 20 символов)
                          <textarea name="publicComment" required minLength={20} maxLength={2000} defaultValue={keep[to]?.publicComment ?? ""} />
                        </label>
                      </div>
                    )}
                    {to === "COMPLETED" && (
                      <div className="field">
                        <label>
                          Тип результата
                          <select name="resolutionType">
                            {Object.entries(RESULT_TYPES).map(([k, v]) => (
                              <option key={k} value={k}>
                                {v}
                              </option>
                            ))}
                          </select>
                        </label>
                        <p className="hint">«{RESULT_TYPES.ANSWER_PROVIDED}» не означает, что инфраструктура уже построена.</p>
                      </div>
                    )}
                    {to === "UNDER_REVIEW" && !idea.assignee && (
                      <p className="hint">
                        <label>
                          <input type="checkbox" name="takeOwnership" defaultChecked /> Назначить меня (атомарно с
                          переходом)
                        </label>
                      </p>
                    )}
                    <p>
                      <button className="btn btn-primary btn-sm" type="submit">
                        Подтвердить
                      </button>
                    </p>
                  </form>
                </details>
              ))}
            </div>
            <div className="card internal-box">
              <h3>Внутренняя заметка (не видна жителю)</h3>
              <form onSubmit={saveNote}>
                <div className="field">
                  <label htmlFor="note">Заметка для коллег</label>
                  <textarea id="note" name="note" />
                </div>
                {noteError && <ErrorNotice error={noteError} />}
                <button className="btn btn-secondary btn-sm" type="submit">
                  Сохранить заметку
                </button>
              </form>
              {idea.comments
                .filter((c) => c.visibility === "INTERNAL")
                .map((c) => (
                  <p key={c.id}>
                    <strong>{c.author}:</strong> {c.body}
                  </p>
                ))}
            </div>
            {user.role === "ADMIN" && (
              <div className="card">
                <h2>Исправление маршрута (админ)</h2>
                <form onSubmit={saveReroute}>
                  <div className="field">
                    <label htmlFor="org">Новая организация (из справочника)</label>
                    <select id="org" name="org" defaultValue={orgs.find((o) => o.code === idea.organizationCode)?.id ?? ""}>
                      {orgs.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="reason">Причина (10–1000 символов)</label>
                    <textarea id="reason" name="reason" />
                  </div>
                  {rrError && <ErrorNotice error={rrError} />}
                  <button className="btn btn-secondary btn-sm" type="submit">
                    Перенаправить (сбросит ответственного)
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
