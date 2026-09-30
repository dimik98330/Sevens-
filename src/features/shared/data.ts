"use client";

// Фасад данных C-02: mock для разработки/тестов, настоящий backend B — для выпуска.
// ?mock=0 / sessionStorage abai.useMock=0 / NEXT_PUBLIC_ABAI_MOCK=0 → все запросы
// идут в same-origin /api/v1. Mock обходится полностью (03 §9).
import { api, setCsrf } from "./api-client";
import { currentMockMode, mockStore } from "./mock";
import ru from "@/locales/ru.json";
import type { CategoryCode, RoutingPreviewInput, RoutingPreviewResult } from "@/contracts";
import { territoryMetadata, type CatalogTerritory } from './territories';

// Public server metadata may evolve independently of the route version.
export interface ServerRoutingPreviewResult extends RoutingPreviewResult {
  detectedCategoryCode?: CategoryCode | null;
  catalogVersion?: string;
  classificationSource?: "MODEL" | "RULES";
  classifierStatus?: "READY" | "FALLBACK";
}

export function useMock(): boolean {
  return currentMockMode();
}

// C-04: territoryId для B — это catalogs[].id (UUID, d37aeab); code —
// лишь fallback для старого каталога без id. Единое правило для
// визарда в mock- и real-режимах: каталоги в обеих формах несут id.
export function resolveTerritoryId(t: { id?: string; code: string }): string {
  return t.id ?? t.code;
}

export function territoryNameForDisplay(name: string): string {
  return name.replace(/\s*[—-]\s*демонстрационная территория$/iu, "");
}

interface FlatAuth {
  id: string;
  displayName: string;
  role: string;
  organizationId: string | null;
  csrfToken: string;
}

// Настоящий B: {user: {id, displayName, role, organizationId}, csrfToken}.
// Mock: те же поля плоско + csrfToken. Результат всегда плоский.
export function normalizeAuthResponse(data: unknown): FlatAuth {
  const d = data as { user?: Omit<FlatAuth, "csrfToken">; csrfToken?: string } & Partial<FlatAuth>;
  const u = d.user ?? d;
  if (typeof d.csrfToken === "string") setCsrf(d.csrfToken, typeof u.id === "string" ? u.id : null);
  return {
    id: String(u.id ?? ""),
    displayName: String(u.displayName ?? ""),
    role: String(u.role ?? "CITIZEN"),
    organizationId: (u.organizationId as string | null) ?? null,
    csrfToken: String(d.csrfToken ?? ""),
  };
}

export interface NormalizedCatalog {
  categories: string[];
  territories: CatalogTerritory[];
  ruleVersion: string;
  consentVersion: string;
}

// Настоящий B отдаёт категории объектами {code,nameRu,nameKk}, mock — строками.
// Фасад нормализует к форме mock (коды + ru.json для подписей), чтобы страницы
// не ветвились по режимам и не рендерили объекты (React #31, C-04 real DTO).
export function normalizeCatalogs(data: unknown): NormalizedCatalog {
  const d = (data ?? {}) as {
    categories?: Array<string | { code?: string }>;
    territories?: Array<{ id?: string; code?: string; kind?: string; nameRu?: string; nameKk?: string }>;
    ruleVersion?: string;
    consentVersion?: string;
  };
  return {
    categories: (d.categories ?? []).map((c) => (typeof c === "string" ? c : String(c?.code ?? ""))).filter(Boolean),
    territories: (d.territories ?? [])
      .filter((t) => typeof t?.code === "string")
      .filter(t => t.kind !== 'DISTRICT' && t.kind !== 'CITY_ADMIN')
      .map((t) => ({ ...territoryMetadata(t.code as string), id: t.id, code: t.code as string, kind: t.kind, nameRu: territoryNameForDisplay(String(t.nameRu ?? t.code)), nameKk: t.nameKk || territoryMetadata(t.code as string).nameKk })),
    ruleVersion: String(d.ruleVersion ?? ""),
    consentVersion: String(d.consentVersion ?? ""),
  };
}

// Настоящий B не отдаёт тела комментариев на чтение (нет GET /comments;
// POST /comments возвращает только id/version). История и публичный диалог
// строятся по GET /ideas/:id/timeline: типы событий -> русские подписи,
// тела реплик сервером не раскрываются (DTO-запрос к B).
const STATUSES = ru.statuses as Record<string, string>;

function eventText(e: { type?: string; fromStatus?: string | null; toStatus?: string | null; payload?: { publicationState?: unknown } | null }): string {
  if (e.payload?.publicationState === "PENDING") return "Карточка отправлена на проверку публикации";
  if (e.payload?.publicationState === "PUBLISHED") return "Карточка опубликована в «Идеях региона»";
  if (e.payload?.publicationState === "REJECTED") return "Публикация возвращена автору на подготовку";
  const s = (code?: string | null) => (code ? (STATUSES[code] ?? code) : "");
  switch (e.type) {
    case "STATUS_CHANGED":
      return `Статус: ${s(e.fromStatus)} → ${s(e.toStatus)}`;
    case "CLARIFICATION_REQUESTED":
      return "Запрошен ответ жителя";
    case "CLARIFICATION_ANSWERED":
      return "Житель ответил на уточнение";
    case "COMMENT_PUBLIC":
      return "Публичный ответ специалиста";
    case "COMMENT_INTERNAL":
      return "Внутренняя заметка";
    case "ASSIGNED":
      return "Назначен ответственный";
    case "UNASSIGNED":
      return "Ответственный снят";
    case "REROUTED":
      return "Маршрут изменён";
    case "SUBMITTED":
    case "IDEA_REGISTERED":
      return "Идея зарегистрирована на платформе";
    case "CREATED":
      return "Создан черновик";
    case "ATTACHMENT_ADDED":
      return "Прикреплён файл";
    case "ATTACHMENT_REMOVED":
      return "Файл удалён";
    default:
      return e.type ? `Событие: ${e.type}` : "Событие";
  }
}

export interface TimelineRow {
  id: string;
  at: string;
  actor?: string;
  text: string;
  body?: string;
  visibility?: string;
}

export interface ThreadComment {
  id: string;
  visibility: "PUBLIC" | "INTERNAL";
  author: string;
  body: string;
  at: string;
  authorId?: string;
  authorRole?: "CITIZEN" | "STAFF" | "ADMIN" | null;
  kind?: string;
}

interface RawEvent {
  id?: string;
  createdAt?: string;
  actorId?: string;
  type?: string;
  visibility?: string;
  fromStatus?: string | null;
  toStatus?: string | null;
  // B 49d2427: тело linked-комментария в событии timeline (gated: гражданин —
  // только PUBLIC, сотрудник — все). Поле называется body.
  body?: string | null;
  authorId?: string | null;
  authorDisplayName?: string | null;
  authorRole?: string | null;
  commentKind?: string | null;
  commentVisibility?: string | null;
  payload?: { publicationState?: unknown } | null;
}

export function mapTimeline(
  items: unknown,
  withActor: boolean,
): TimelineRow[] {
  const list = (Array.isArray(items) ? items : []) as RawEvent[];
  return list.map((e, i) => ({
    id: String(e.id ?? `ev-${i}`),
    at: String(e.createdAt ?? ""),
    ...(withActor && e.actorId ? { actor: String(e.actorId).slice(0, 8) } : {}),
    text: eventText(e),
    ...(typeof e.body === "string" && e.body ? { body: e.body } : {}),
    ...(typeof e.visibility === "string" ? { visibility: e.visibility } : {}),
  }));
}

// Тела реплик (A DECISION msg 133, B 49d2427: поле body): B раскрывает тело
// linked-комментария в событии timeline (гражданину — только PUBLIC,
// сотруднику — все). Фасад сводит их к форме comments[], которую уже
// рендерят обе деталки.
export function threadFromTimeline(items: unknown, withActor: boolean): ThreadComment[] {
  const list = (Array.isArray(items) ? items : []) as RawEvent[];
  return list.filter((e) => typeof e.body === "string" && e.body.length > 0
    && (e.visibility === "PUBLIC" || withActor && e.visibility === "INTERNAL")
    && ((e.commentVisibility ?? e.visibility) === "PUBLIC" || withActor && (e.commentVisibility ?? e.visibility) === "INTERNAL"))
    .map((e, index) => {
      const kind = e.commentKind ?? (e.type === "CLARIFICATION_ANSWERED" ? "CLARIFICATION_ANSWER"
        : e.type === "CLARIFICATION_REQUESTED" ? "CLARIFICATION_QUESTION" : undefined);
      const role = e.authorRole === "CITIZEN" || e.authorRole === "STAFF" || e.authorRole === "ADMIN" ? e.authorRole : null;
      return {
        id: String(e.id ?? `comment-${index}`),
        visibility: e.visibility === "INTERNAL" || e.commentVisibility === "INTERNAL" ? "INTERNAL" as const : "PUBLIC" as const,
        author: typeof e.authorDisplayName === "string" ? e.authorDisplayName : "",
        body: e.body as string,
        at: String(e.createdAt ?? ""),
        ...(typeof e.authorId === "string" ? { authorId: e.authorId } : {}),
        authorRole: role,
        ...(typeof kind === "string" ? { kind } : {}),
      };
    });
}

export const store = {
  routingPreview: (body: RoutingPreviewInput, signal?: AbortSignal) =>
    api.post<ServerRoutingPreviewResult>("/api/v1/ideas/routing-preview", body, { signal }),
  catalogs: async () => {
    if (useMock()) return Promise.resolve(mockStore.catalogs());
    const { data, meta } = await api.get<unknown>("/api/v1/catalogs");
    return { data: normalizeCatalogs(data), meta };
  },
  // Настоящий B возвращает вход как {user: {...}, csrfToken}, mock — плоско.
  // Фасад нормализует к плоской форме, чтобы страницы не ветвились по режимам.
  login: async (body: { email: string; password: string }) => {
    if (useMock()) return Promise.resolve(mockStore.login(body));
    const { data, meta } = await api.post<unknown>("/api/v1/auth/login", body);
    return { data: normalizeAuthResponse(data), meta };
  },
  // Demo shortcuts always use real server sessions, never mock identities.
  demoLogin: async(role:'CITIZEN'|'STAFF')=>{
    const {data,meta}=await api.post<unknown>('/api/v1/auth/demo',{role});
    return {data:normalizeAuthResponse(data),meta};
  },
  register: async (body: { displayName: string; email: string; password: string; consentAccepted: boolean }) => {
    if (useMock()) return Promise.resolve(mockStore.register(body));
    const { data, meta } = await api.post<unknown>("/api/v1/auth/register", body);
    return { data: normalizeAuthResponse(data), meta };
  },
  createDraft: (body: Record<string, unknown>, key: string) =>
    useMock()
      ? Promise.resolve(mockStore.createDraft(body as { title?: string; problem?: string; solution?: string }))
      : api.post("/api/v1/ideas", body, { idempotencyKey: key }),
  patchDraft: (id: string, body: Record<string, unknown>) =>
    useMock() ? Promise.resolve(mockStore.patchDraft(id, body)) : api.patch(`/api/v1/ideas/${id}`, body),
  submit: (id: string, body: { expectedVersion: number; consentAccepted: boolean }, key: string) =>
    useMock() ? Promise.resolve(mockStore.submit(id, body)) : api.post(`/api/v1/ideas/${id}/submit`, body, { idempotencyKey: key }),
  mine: (params: { q?: string; status?: string; page?: number; pageSize?: number }) => {
    if (useMock()) {
      const result = mockStore.mine(params);
      const page = params.page ?? 1;
      const pageSize = params.pageSize ?? 20;
      return Promise.resolve({ ...result, data: result.data.slice((page - 1) * pageSize, page * pageSize), meta: { ...result.meta, page, pageSize } });
    }
    const s = new URLSearchParams({ scope: "mine" });
    if (params.q) s.set("q", params.q.slice(0, 100));
    if (params.status) s.set("status", params.status);
    if (params.page) s.set("page", String(params.page));
    if (params.pageSize) s.set("pageSize", String(params.pageSize));
    return api.get(`/api/v1/ideas?${s}`);
  },
  get: async (id: string) => {
    if (useMock()) return Promise.resolve(mockStore.get(id, false));
    const [detail, tl] = await Promise.all([
      api.get<Record<string, unknown>>(`/api/v1/ideas/${id}`),
      api.get<unknown[]>(`/api/v1/ideas/${id}/timeline`),
    ]);
    return {
      data: { ...detail.data, timeline: mapTimeline(tl.data, false), comments: threadFromTimeline(tl.data, false) },
      meta: detail.meta,
    };
  },
  clarify: (id: string, body: { body: string; expectedVersion: number }, key: string) =>
    useMock()
      ? Promise.resolve(mockStore.clarify(id, body))
      : api.post(`/api/v1/ideas/${id}/clarifications`, body, { idempotencyKey: key }),
  attach: (id: string, file: File, expectedVersion: number, key: string) =>
    useMock()
      ? Promise.resolve(mockStore.attach(id, { name: file.name, size: file.size, type: file.type }, expectedVersion))
      : api.upload(`/api/v1/ideas/${id}/attachments`, file, { expectedVersion: String(expectedVersion) }, { idempotencyKey: key }),
  staffList: (params: Record<string, string>) => {
    // B reads the unassigned sentinel as assignee=unassigned (B PASS msg 86).
    const mapped = { ...params };
    if (mapped.unassigned === "1") {
      delete mapped.unassigned;
      mapped.assignee = "unassigned";
    }
    if (useMock()) return Promise.resolve(mockStore.staffList(mapped));
    const s = new URLSearchParams({ scope: "staff", ...mapped });
    return api.get(`/api/v1/ideas?${s}`);
  },
  deleteAttachment: (id: string, attachmentId: string, expectedVersion: number, key: string) =>
    useMock()
      ? Promise.resolve(mockStore.deleteAttachment(id, attachmentId, expectedVersion))
      : api.del(`/api/v1/ideas/${id}/attachments/${attachmentId}`, { expectedVersion }, { idempotencyKey: key }),
  staffGet: async (id: string) => {
    if (useMock()) return Promise.resolve(mockStore.staffGet(id));
    const [detail, tl] = await Promise.all([
      api.get<Record<string, unknown>>(`/api/v1/ideas/${id}`),
      api.get<unknown[]>(`/api/v1/ideas/${id}/timeline`),
    ]);
    return {
      data: { ...detail.data, timeline: mapTimeline(tl.data, true), comments: threadFromTimeline(tl.data, true) },
      meta: detail.meta,
    };
  },
  assignees: (organizationId?: string) => {
    if (useMock()) return Promise.resolve(mockStore.assignees());
    const s = organizationId ? `?organizationId=${encodeURIComponent(organizationId)}` : "";
    return api.get(`/api/v1/staff/assignees${s}`);
  },
  adminOrganizations: () =>
    useMock() ? Promise.resolve(mockStore.adminOrganizations()) : api.get("/api/v1/admin/organizations"),
  assign: (id: string, body: { assigneeId: string | null; expectedVersion: number }, key: string) =>
    useMock() ? Promise.resolve(mockStore.assign(id, body)) : api.post(`/api/v1/ideas/${id}/assignment`, body, { idempotencyKey: key }),
  changeStatus: (id: string, body: Record<string, unknown>, key: string) =>
    useMock() ? Promise.resolve(mockStore.changeStatus(id, body)) : api.post(`/api/v1/ideas/${id}/status`, body, { idempotencyKey: key }),
  addComment: (id: string, body: { visibility: "PUBLIC" | "INTERNAL"; body: string; expectedVersion: number }, key: string) =>
    useMock() ? Promise.resolve(mockStore.addComment(id, body)) : api.post(`/api/v1/ideas/${id}/comments`, body, { idempotencyKey: key }),
  reroute: (
    id: string,
    body: { organizationId: string; effectiveCategoryCode?: string; reason: string; expectedVersion: number },
    key: string,
  ) =>
    useMock() ? Promise.resolve(mockStore.reroute(id, body)) : api.post(`/api/v1/admin/ideas/${id}/reroute`, body, { idempotencyKey: key }),
};
