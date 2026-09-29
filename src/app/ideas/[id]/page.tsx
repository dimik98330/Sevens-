"use client";

import { useRouter } from "next/navigation";
import { use, useCallback, useEffect, useState } from "react";
import { ApiError, api } from "@/features/shared/api-client";
import { store } from "@/features/shared/data";
import { useSession } from "@/features/shared/session";
import { ErrorNotice, Skeleton, Timeline } from "@/components/ui/Feedback";
import { RouteCard, type RouteInfo } from "@/components/ui/RouteCard";
import { StatusBadge, orgName } from "@/components/ui/StatusBadge";
import ru from "@/locales/ru.json";
import type { IdeaStatus } from "@/contracts";

interface Comment {
  id: string;
  visibility: "PUBLIC" | "INTERNAL";
  author: string;
  body: string;
  at: string;
}

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
  comments: Comment[];
}

const RESULT_TYPES = ru.resultTypes as Record<string, string>;

export default function IdeaDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
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
    if (checked && user) load();
  }, [checked, user, load]);

  useEffect(() => {
    if (checked && !user) router.replace("/login");
  }, [checked, user, router]);

  if (!checked || !user) return null;

  const needsInfo = idea?.status === "NEEDS_INFO";
  const lastQ = idea ? [...idea.comments].reverse().find((c) => c.visibility === "PUBLIC") : undefined;

  const sendAnswer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!idea) return;
    if (answer.trim().length < 10) {
      setFormError(new ApiError({ http: 400, code: "VALIDATION_ERROR", message: "Ответ — минимум 10 символов", fields: {} }));
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      await store.clarify(id, { body: answer, expectedVersion: idea.version }, api.key());
      setAnswer("");
      load();
    } catch (err) {
      setFormError(err as ApiError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <div aria-live="polite">
        {error && <ErrorNotice error={error} onRetry={load} />}
        {!error && !idea && <Skeleton lines={4} />}
        {idea && (
          <>
            <p className="muted">{idea.publicNumber ?? "Черновик"}</p>
            <h1>{idea.title}</h1>
            <p>
              <StatusBadge status={idea.status} />{" "}
              {idea.resolutionType && <span className="tag">{RESULT_TYPES[idea.resolutionType]}</span>}
            </p>
            <section aria-label="Сейчас происходит">
              <h2>Сейчас происходит</h2>
              <p>
                Направление: <strong>{orgName(idea.organizationCode)}</strong> · Ответственный:{" "}
                <strong>{idea.assignee?.name ?? "не назначен"}</strong>
              </p>
              <p className="muted">
                Следующий шаг:{" "}
                {needsInfo
                  ? "ответьте на вопрос специалиста ниже"
                  : idea.status === "COMPLETED"
                    ? "ознакомьтесь с итогом"
                    : "ожидайте обновления от специалиста"}
              </p>
            </section>
            <section aria-label="Содержание">
              <h2>Исходная идея</h2>
              <p>
                <strong>Проблема:</strong> {idea.problem}
              </p>
              <p>
                <strong>Решение:</strong> {idea.solution}
              </p>
              {idea.attachments.length > 0 && (
                <p>
                  <strong>Материалы:</strong> {idea.attachments.map((a) => a.name).join(", ")}
                </p>
              )}
            </section>
            <RouteCard route={idea.routing} />
            <section aria-label="Публичный диалог">
              <h2>Диалог</h2>
              {idea.comments.filter((c) => c.visibility === "PUBLIC").map((c) => (
                <div key={c.id} className="notice">
                  <strong>{c.author}</strong> <span className="muted">{c.at}</span>
                  <br />
                  {c.body}
                </div>
              ))}
              {!idea.comments.some((c) => c.visibility === "PUBLIC") && (
                <p className="muted">Публичных сообщений пока нет.</p>
              )}
            </section>
            {needsInfo && (
              <section aria-label="Ответ на уточнение">
                <h2>Вопрос специалиста</h2>
                <div className="notice warn">{lastQ?.body ?? "Специалист запросил уточнение."}</div>
                <form onSubmit={sendAnswer}>
                  <div className="field">
                    <label htmlFor="answer">Ваш ответ</label>
                    <textarea id="answer" value={answer} onChange={(e) => setAnswer(e.target.value)} aria-describedby="answer-h" />
                    <p className="hint" id="answer-h">
                      Ваш ответ добавится в историю, исходный текст идеи сохранится. 10–3000 символов.
                    </p>
                  </div>
                  {formError && <ErrorNotice error={formError} />}
                  <button className="btn btn-primary" type="submit" disabled={busy}>
                    {busy ? "Отправляем…" : "Отправить ответ"}
                  </button>
                </form>
              </section>
            )}
            <section aria-label="История">
              <h2>История</h2>
              <Timeline items={idea.timeline} />
            </section>
          </>
        )}
      </div>
    </div>
  );
}
