// Фасад данных: mock для разработки/тестов, настоящий backend B — для выпуска.
// Выбор: ?api=<base> включает реальный backend; ?mock=0/useMock=0 отключает mock.
// По умолчанию mock ВКЛ (backend B ещё в работе — B-01 IN_PROGRESS).
import { api, useMock } from './api.js';
import { createMock } from './mock.js';

let mock = null;
const mockActive = () => {
  const q = new URLSearchParams(location.search);
  if (q.has('mock')) return q.get('mock') !== '0';
  if (q.has('api')) return false;
  return useMock();
};
export const isMock = () => mockActive();
function m() { if (!mock) mock = createMock(); return mock; }
const wrap = (fn) => { try { return fn(); } catch (e) { throw e?.detail ? Object.assign(new Error(e.message), e) : e; } };

export const store = {
  get useMock() { return mockActive(); },
  catalogs: () => mockActive() ? wrap(() => m().catalogs()) : api.get('/api/v1/catalogs'),
  me: () => mockActive() ? wrap(() => m().me()) : api.get('/api/v1/auth/me'),
  register: (b) => mockActive() ? wrap(() => m().register(b)) : api.post('/api/v1/auth/register', b),
  login: (b) => mockActive() ? wrap(() => m().login(b)) : api.post('/api/v1/auth/login', b),
  logout: () => mockActive() ? wrap(() => m().logout()) : api.post('/api/v1/auth/logout', {}),
  createDraft: (b, key) => mockActive() ? wrap(() => m().createDraft(b, key)) : api.post('/api/v1/ideas', b, { idempotencyKey: key }),
  patchDraft: (id, b) => mockActive() ? wrap(() => m().patchDraft(id, b)) : api.patch(`/api/v1/ideas/${id}`, b),
  submit: (id, b, key) => mockActive() ? wrap(() => m().submit(id, b, key)) : api.post(`/api/v1/ideas/${id}/submit`, b, { idempotencyKey: key }),
  mine: (p) => mockActive() ? wrap(() => m().mine(p)) : api.get('/api/v1/ideas?scope=mine&' + new URLSearchParams(p)),
  staffList: (p) => mockActive() ? wrap(() => m().staffList(p)) : api.get('/api/v1/ideas?scope=staff&' + new URLSearchParams(p)),
  get: (id, staff) => mockActive() ? wrap(() => m().get(id, staff)) : api.get(`/api/v1/ideas/${id}`),
  clarify: (id, b, key) => mockActive() ? wrap(() => m().clarify(id, b, key)) : api.post(`/api/v1/ideas/${id}/clarifications`, b, { idempotencyKey: key }),
  assign: (id, b, key) => mockActive() ? wrap(() => m().assign(id, b, key)) : api.post(`/api/v1/ideas/${id}/assignment`, b, { idempotencyKey: key }),
  status: (id, b, key) => mockActive() ? wrap(() => m().status(id, b, key)) : api.post(`/api/v1/ideas/${id}/status`, b, { idempotencyKey: key }),
  comment: (id, b, key) => mockActive() ? wrap(() => m().comment(id, b, key)) : api.post(`/api/v1/ideas/${id}/comments`, b, { idempotencyKey: key }),
  reroute: (id, b, key) => mockActive() ? wrap(() => m().reroute(id, b, key)) : api.post(`/api/v1/admin/ideas/${id}/reroute`, b, { idempotencyKey: key }),
  attach: (id, file, v) => mockActive() ? wrap(() => m().attach(id, file, v)) : api.upload(`/api/v1/ideas/${id}/attachments`, file, { expectedVersion: v }),
  notifications: () => mockActive() ? wrap(() => m().notifications()) : api.get('/api/v1/notifications'),
  readNotif: (id) => mockActive() ? wrap(() => m().readNotif(id)) : api.post(`/api/v1/notifications/${id}/read`, {}),
  assignees: () => mockActive() ? wrap(() => m().assignees()) : api.get('/api/v1/staff/assignees'),
};
export const mockState = () => m().state;
