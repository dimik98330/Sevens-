"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { ApiError } from "@/features/shared/api-client";
import { store } from "@/features/shared/data";
import { useSession } from "@/features/shared/session";
import { EmptyState, ErrorNotice, Skeleton } from "@/components/ui/Feedback";
import { StatusBadge } from "@/components/ui/StatusBadge";
import ru from "@/locales/ru.json";
import type { IdeaStatus } from "@/contracts";

interface Row {
  id: string;
  title: string;
  publicNumber: string | null;
  status: IdeaStatus;
  effectiveCategoryCode: string | null;
  updatedAt: string;
}

const CATEGORIES = ru.categories as Record<string, string>;
const ALL_STATUSES: IdeaStatus[] = ["DRAFT", "RECEIVED", "UNDER_REVIEW", "NEEDS_INFO", "IN_PROGRESS", "COMPLETED", "REJECTED"];

function MyIdeas() {
  const router = useRouter();
  const params = useSearchParams();
  const { user, checked } = useSession();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [q, setQ] = useState(params.get("q") ?? "");
  const [status, setStatus] = useState(params.get("status") ?? "");

  const load = useCallback(async (qq: string, ss: string) => {
    setError(null);
    try {
      const { data } = await store.mine({ q: qq || undefined, status: ss || undefined });
      setRows(data as Row[]);
    } catch (err) {
      setRows([]);
      setError(err as ApiError);
    }
  }, []);

  useEffect(() => {
    if (checked && user) load(params.get("q") ?? "", params.get("status") ?? "");
  }, [checked, user, params, load]);

  if (checked && !user) {
    router.replace("/login");
    return null;
  }

  const apply = (e: React.FormEvent) => {
    e.preventDefault();
    const s = new URLSearchParams();
    if (q) s.set("q", q);
    if (status) s.set("status", status);
    router.push(`/my${s.toString() ? `?${s}` : ""}`);
  };

  return (
    <div className="card">
      <h1>Мои идеи</h1>
      <p>
        <Link className="btn btn-primary" href="/ideas/new">
          Новая идея
        </Link>
      </p>
      <form onSubmit={apply} className="filters" role="search" aria-label="Поиск по своим идеям">
        <input
          type="search"
          value={q}
          maxLength={100}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Поиск: номер, название…"
          aria-label="Поиск по своим идеям"
        />
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Фильтр по статусу">
          <option value="">Все статусы</option>
          {ALL_STATUSES.map((s) => (
            <option key={s} value={s}>
              {ru.statuses[s]}
            </option>
          ))}
        </select>
        <button className="btn btn-secondary btn-sm" type="submit">
          Найти
        </button>
      </form>
      <div aria-live="polite">
        {error && <ErrorNotice error={error} onRetry={() => load(q, status)} />}
        {rows === null && <Skeleton lines={3} />}
        {rows !== null && !rows.length && !error && (
          <EmptyState
            title={q || status ? "Ничего не найдено" : "Пока нет идей"}
            text={q || status ? ru.emptyFilter : ru.emptyMine}
            action={
              q || status ? (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    setQ("");
                    setStatus("");
                    router.push("/my");
                  }}
                >
                  Сбросить фильтры
                </button>
              ) : (
                <p>
                  <Link className="btn btn-primary" href="/ideas/new">
                    Предложить первую идею
                  </Link>
                </p>
              )
            }
          />
        )}
        {rows?.map((it) => (
          <div key={it.id} className="idea-row">
            <div>
              <Link href={`/ideas/${it.id}`} style={{ fontWeight: 700, color: "inherit" }}>
                {it.title || "(без названия)"}
              </Link>
              {it.status === "NEEDS_INFO" && <p className="needs-you">{ru.needAnswer}</p>}
              <p className="meta">
                {it.publicNumber ?? "черновик"} ·{" "}
                {it.effectiveCategoryCode ? (CATEGORIES[it.effectiveCategoryCode] ?? it.effectiveCategoryCode) : "категория определится"} ·{" "}
                {new Date(it.updatedAt).toLocaleDateString("ru-RU")}
              </p>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <StatusBadge status={it.status} />
              {it.status === "DRAFT" ? (
                <Link className="btn btn-secondary btn-sm" href={`/ideas/new?draft=${it.id}`}>
                  Продолжить
                </Link>
              ) : (
                <Link
                  className="btn btn-secondary btn-sm"
                  href={`/ideas/${it.id}`}
                  tabIndex={-1}
                  aria-hidden="true"
                >
                  Открыть
                </Link>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function MyPage() {
  return (
    <Suspense>
      <MyIdeas />
    </Suspense>
  );
}
