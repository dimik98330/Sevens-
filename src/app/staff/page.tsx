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
  assignee: { id: string; name: string } | null;
  updatedAt: string;
}

const CATEGORIES = ru.categories as Record<string, string>;
const PAGE_SIZE = 20;

function Queue() {
  const router = useRouter();
  const params = useSearchParams();
  const { user, checked } = useSession();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<ApiError | null>(null);
  const [q, setQ] = useState(params.get("q") ?? "");
  const [category, setCategory] = useState(params.get("category") ?? "");
  const [status, setStatus] = useState(params.get("status") ?? "");
  const [unassigned, setUnassigned] = useState(params.get("unassigned") ?? "");
  const page = Math.max(1, parseInt(params.get("page") ?? "1", 10) || 1);

  const load = useCallback(
    async (pg: number) => {
      setError(null);
      try {
        const { data, meta } = await store.staffList({
          q: (params.get("q") ?? "") || "",
          category: params.get("category") ?? "",
          status: params.get("status") ?? "",
          unassigned: params.get("unassigned") ?? "",
          page: String(pg),
          pageSize: String(PAGE_SIZE),
        });
        setRows(data as Row[]);
        setTotal((meta as { total?: number }).total ?? (data as Row[]).length);
      } catch (err) {
        setRows([]);
        setError(err as ApiError);
      }
    },
    [params],
  );

  useEffect(() => {
    if (checked && user) load(page);
  }, [checked, user, page, load]);

  useEffect(() => {
    if (checked && user && user.role === "CITIZEN") router.replace("/");
  }, [checked, user, router]);
  useEffect(() => {
    if (checked && !user) router.replace("/login");
  }, [checked, user, router]);

  if (!checked || !user || user.role === "CITIZEN") return null;

  const apply = (e: React.FormEvent) => {
    e.preventDefault();
    const s = new URLSearchParams();
    if (q) s.set("q", q);
    if (category) s.set("category", category);
    if (status) s.set("status", status);
    if (unassigned) s.set("unassigned", unassigned);
    router.push(`/staff${s.toString() ? `?${s}` : ""}`);
  };

  const filtered = q || category || status || unassigned;
  const pages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="card">
      <h1>Очередь предложений</h1>
      <form onSubmit={apply} className="filters" role="search" aria-label="Фильтры очереди">
        <input type="search" value={q} maxLength={100} onChange={(e) => setQ(e.target.value)} placeholder="Поиск" aria-label="Текстовый поиск" />
        <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Категория">
          <option value="">Все категории</option>
          {Object.entries(CATEGORIES).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Статус">
          <option value="">Все статусы</option>
          {Object.entries(ru.statuses)
            .filter(([k]) => k !== "DRAFT")
            .map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
        </select>
        <select value={unassigned} onChange={(e) => setUnassigned(e.target.value)} aria-label="Ответственный">
          <option value="">Все</option>
          <option value="1">Без ответственного</option>
        </select>
        <button className="btn btn-secondary btn-sm" type="submit">
          Применить
        </button>
        <button
          className="btn btn-secondary btn-sm"
          type="button"
          onClick={() => {
            setQ("");
            setCategory("");
            setStatus("");
            setUnassigned("");
            router.push("/staff");
          }}
        >
          Сбросить
        </button>
      </form>
      <div aria-live="polite">
        {error && <ErrorNotice error={error} onRetry={() => load(page)} />}
        {rows === null && <Skeleton lines={4} />}
        {rows !== null && !rows.length && !error && (
          <EmptyState
            title="Ничего не найдено"
            text={filtered ? ru.emptyFilter : ru.emptyQueue}
            action={
              filtered ? (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    setQ("");
                    setCategory("");
                    setStatus("");
                    setUnassigned("");
                    router.push("/staff");
                  }}
                >
                  Сбросить фильтры
                </button>
              ) : undefined
            }
          />
        )}
        {rows !== null && rows.length > 0 && (
          <div className="queue-scroll">
          <table className="queue">
            <thead>
              <tr>
                <th>Номер</th>
                <th>Название</th>
                <th>Категория</th>
                <th>Статус</th>
                <th>Ответственный</th>
                <th>Дата</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((it) => (
                <tr key={it.id}>
                  <td>{it.publicNumber ?? ""}</td>
                  <td>
                    <Link href={`/staff/${it.id}`}>{it.title}</Link>
                  </td>
                  <td>{it.effectiveCategoryCode ? (CATEGORIES[it.effectiveCategoryCode] ?? "") : ""}</td>
                  <td>
                    <StatusBadge status={it.status} />
                  </td>
                  <td>{it.assignee?.name ?? "—"}</td>
                  <td>{new Date(it.updatedAt).toLocaleDateString("ru-RU")}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
        {pages > 1 && (
          <p className="muted">
            Стр. {page} из {pages} · всего {total}{" "}
            {page < pages && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  const s = new URLSearchParams(params.toString());
                  s.set("page", String(page + 1));
                  router.push(`/staff?${s}`);
                }}
              >
                Дальше
              </button>
            )}
          </p>
        )}
      </div>
    </div>
  );
}

export default function StaffQueuePage() {
  return (
    <Suspense>
      <Queue />
    </Suspense>
  );
}
