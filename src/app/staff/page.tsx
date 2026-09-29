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
  assigneeDisplayName?: string | null;
  assignee?: { id: string; name: string } | null;
  updatedAt: string;
}

interface Territory {
  id?: string;
  code: string;
  nameRu: string;
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
  const [territory, setTerritory] = useState(params.get("territory") ?? "");
  const [unassigned, setUnassigned] = useState(params.get("unassigned") ?? "");
  const [orgId, setOrgId] = useState(params.get("organizationId") ?? "");
  const [territories, setTerritories] = useState<Territory[]>([]);
  const [orgs, setOrgs] = useState<Array<{ id: string; name: string }>>([]);
  const page = Math.max(1, parseInt(params.get("page") ?? "1", 10) || 1);

  const load = useCallback(
    async (pg: number) => {
      setError(null);
      try {
        const p: Record<string, string> = {
          q: (params.get("q") ?? "") || "",
          category: params.get("category") ?? "",
          status: params.get("status") ?? "",
          territory: params.get("territory") ?? "",
          unassigned: params.get("unassigned") ?? "",
          page: String(pg),
          pageSize: String(PAGE_SIZE),
        };
        // B 403s без organizationId: STAFF — своя, ADMIN — выбранная (msg 86).
        // Админ без выбранной организации не запрашивает очередь вообще:
        // подсказка вместо ошибки 403 на первом экране.
        const oid = params.get("organizationId") ?? (user?.role === "STAFF" ? (user.organizationId ?? "") : "");
        if (!oid && user?.role === "ADMIN") {
          setRows([]);
          setTotal(0);
          return;
        }
        if (oid) p.organizationId = oid;
        const { data, meta } = await store.staffList(p);
        setRows(data as Row[]);
        setTotal((meta as { total?: number }).total ?? (data as Row[]).length);
      } catch (err) {
        setRows([]);
        setError(err as ApiError);
      }
    },
    [params, user],
  );

  useEffect(() => {
    if (checked && user) {
      store
        .catalogs()
        .then(({ data }) => setTerritories((data as { territories: Territory[] }).territories ?? []))
        .catch(() => {});
      if (user.role === "ADMIN") {
        store
          .adminOrganizations()
          .then(({ data }) => setOrgs(data as Array<{ id: string; name: string }>))
          .catch(() => {});
      }
      load(page);
    }
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
    if (territory) s.set("territory", territory);
    if (unassigned) s.set("unassigned", unassigned);
    if (orgId) s.set("organizationId", orgId);
    router.push(`/staff${s.toString() ? `?${s}` : ""}`);
  };

  const resetAll = () => {
    setQ("");
    setCategory("");
    setStatus("");
    setTerritory("");
    setUnassigned("");
    setOrgId("");
    router.push("/staff");
  };

  const filtered = q || category || status || territory || unassigned || orgId;
  const pages = Math.ceil(total / PAGE_SIZE);
  const isAdmin = user?.role === "ADMIN";

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
        <select value={territory} onChange={(e) => setTerritory(e.target.value)} aria-label="Территория">
          <option value="">Все территории</option>
          {territories.map((t) => (
            <option key={t.code} value={t.code}>
              {t.nameRu}
            </option>
          ))}
        </select>
        <select value={unassigned} onChange={(e) => setUnassigned(e.target.value)} aria-label="Ответственный">
          <option value="">Все</option>
          <option value="1">Без ответственного</option>
        </select>
        {isAdmin && (
          <select value={orgId} onChange={(e) => setOrgId(e.target.value)} aria-label="Организация" required>
            <option value="">— выберите организацию —</option>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        )}
        <button className="btn btn-secondary btn-sm" type="submit">
          Применить
        </button>
        <button className="btn btn-secondary btn-sm" type="button" onClick={resetAll}>
          Сбросить
        </button>
      </form>
      {isAdmin && !orgId && (
        <p className="muted" role="status">
          Выберите организацию, чтобы увидеть её очередь.
        </p>
      )}
      <div aria-live="polite">
        {error && <ErrorNotice error={error} onRetry={() => load(page)} />}
        {rows === null && <Skeleton lines={4} />}
        {rows !== null && !rows.length && !error && !(isAdmin && !orgId) && (
          <EmptyState
            title="Ничего не найдено"
            text={filtered ? ru.emptyFilter : ru.emptyQueue}
            action={
              filtered ? (
                <button type="button" className="btn btn-secondary" onClick={resetAll}>
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
                  <td>{it.assigneeDisplayName ?? it.assignee?.name ?? "—"}</td>
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
