"use client";

// Фасад данных C-02: mock для разработки/тестов, настоящий backend B — для выпуска.
// ?mock=0 / sessionStorage abai.useMock=0 / NEXT_PUBLIC_ABAI_MOCK=0 → все запросы
// идут в same-origin /api/v1. Mock обходится полностью (03 §9).
import { api } from "./api-client";
import { currentMockMode, mockStore } from "./mock";

export function useMock(): boolean {
  return currentMockMode();
}

export const store = {
  catalogs: () => (useMock() ? Promise.resolve(mockStore.catalogs()) : api.get("/api/v1/catalogs")),
  login: (body: { email: string; password: string }) =>
    useMock() ? Promise.resolve(mockStore.login(body)) : api.post("/api/v1/auth/login", body),
  register: (body: { displayName: string; email: string; password: string; consentAccepted: boolean }) =>
    useMock() ? Promise.resolve(mockStore.register(body)) : api.post("/api/v1/auth/register", body),
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
  attach: (id: string, file: File, expectedVersion: number) =>
    useMock()
      ? Promise.resolve(mockStore.attach(id, { name: file.name, size: file.size, type: file.type }, expectedVersion))
      : api.upload(`/api/v1/ideas/${id}/attachments`, file, { expectedVersion: String(expectedVersion) }),
  staffList: (params: Record<string, string>) => {
    if (useMock()) return Promise.resolve(mockStore.staffList(params));
    const s = new URLSearchParams({ scope: "staff", ...params });
    return api.get(`/api/v1/ideas?${s}`);
  },
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
