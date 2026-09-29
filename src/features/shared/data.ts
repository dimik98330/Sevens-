"use client";

// Фасад данных C-02: mock для разработки/тестов, настоящий backend B — для выпуска.
// ?mock=0 / sessionStorage abai.useMock=0 / NEXT_PUBLIC_ABAI_MOCK=0 → все запросы
// идут в same-origin /api/v1. Mock обходится полностью (03 §9).
import { api, setCsrf } from "./api-client";
import { currentMockMode, mockStore } from "./mock";

export function useMock(): boolean {
  return currentMockMode();
}

// C-04: territoryId для B — это catalogs[].id (UUID, d37aeab); code —
// лишь fallback для старого каталога без id. Единое правило для
// визарда в mock- и real-режимах: каталоги в обеих формах несут id.
export function resolveTerritoryId(t: { id?: string; code: string }): string {
  return t.id ?? t.code;
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
  if (typeof d.csrfToken === "string") setCsrf(d.csrfToken);
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
  territories: Array<{ id?: string; code: string; kind?: string; nameRu: string }>;
  ruleVersion: string;
  consentVersion: string;
}

// Настоящий B отдаёт категории объектами {code,nameRu,nameKk}, mock — строками.
// Фасад нормализует к форме mock (коды + ru.json для подписей), чтобы страницы
// не ветвились по режимам и не рендерили объекты (React #31, C-04 real DTO).
export function normalizeCatalogs(data: unknown): NormalizedCatalog {
  const d = (data ?? {}) as {
    categories?: Array<string | { code?: string }>;
    territories?: Array<{ id?: string; code?: string; kind?: string; nameRu?: string }>;
    ruleVersion?: string;
    consentVersion?: string;
  };
  return {
    categories: (d.categories ?? []).map((c) => (typeof c === "string" ? c : String(c?.code ?? ""))).filter(Boolean),
    territories: (d.territories ?? [])
      .filter((t) => typeof t?.code === "string")
      .map((t) => ({ id: t.id, code: t.code as string, kind: t.kind, nameRu: String(t.nameRu ?? t.code) })),
    ruleVersion: String(d.ruleVersion ?? ""),
    consentVersion: String(d.consentVersion ?? ""),
  };
}

export const store = {
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
  mine: (params: { q?: string; status?: string }) => {
    if (useMock()) return Promise.resolve(mockStore.mine(params));
    const s = new URLSearchParams({ scope: "mine" });
    if (params.q) s.set("q", params.q.slice(0, 100));
    if (params.status) s.set("status", params.status);
    return api.get(`/api/v1/ideas?${s}`);
  },
  get: (id: string) =>
    useMock() ? Promise.resolve(mockStore.get(id, false)) : api.get(`/api/v1/ideas/${id}`),
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
  staffGet: (id: string) =>
    useMock() ? Promise.resolve(mockStore.staffGet(id)) : api.get(`/api/v1/ideas/${id}`),
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
