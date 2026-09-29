// Typed API-клиент по 03 §5–6. Один на весь фронт.
// Реальный backend: same-origin /api/v1 либо ?api=https://host. Mock — только для разработки.
import { parseApiError, newIdempotencyKey } from './contracts.js';

function resolveBase() {
  const q = new URLSearchParams(location.search).get('api');
  if (q) { sessionStorage.setItem('abai.apiBase', q); return q.replace(/\/$/, ''); }
  return sessionStorage.getItem('abai.apiBase') || '';
}

export const apiBase = () => resolveBase();
export const useMock = () => sessionStorage.getItem('abai.useMock') !== '0';

export class ApiError extends Error {
  constructor(parsed) { super(parsed.message); this.detail = parsed; }
}

async function request(path, { method = 'GET', body, idempotencyKey, csrf, formData } = {}) {
  const base = resolveBase();
  const headers = {};
  if (csrf) headers['X-CSRF-Token'] = csrf;
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  let payload;
  if (formData) { payload = formData; }
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  let res;
  try {
    res = await fetch(base + path, { method, headers, body: payload, credentials: 'include' });
  } catch {
    throw new ApiError(parseApiError(0, null));
  }
  const text = await res.text();
  const json = text ? (() => { try { return JSON.parse(text); } catch { return null; } })() : null;
  if (!res.ok) throw new ApiError(parseApiError(res.status, json));
  return json;
}

export const api = {
  get: (p) => request(p),
  post: (p, body, opt) => request(p, { method: 'POST', body, ...opt }),
  patch: (p, body, opt) => request(p, { method: 'PATCH', body, ...opt }),
  del: (p, body, opt) => request(p, { method: 'DELETE', body, ...opt }),
  upload: (p, file, fields, opt) => {
    const fd = new FormData();
    fd.append('file', file);
    for (const [k, v] of Object.entries(fields ?? {})) fd.append(k, v);
    return request(p, { method: 'POST', formData: fd, ...opt });
  },
  key: newIdempotencyKey,
};

// Карта действий сотрудника: какие поля обязательны для каждого перехода.
export function transitionRequirements(toStatus, current) {
  const needsComment = ['NEEDS_INFO', 'REJECTED', 'COMPLETED'].includes(toStatus);
  const needsResolution = toStatus === 'COMPLETED';
  const needsAssignee = (toStatus === 'UNDER_REVIEW' || toStatus === 'IN_PROGRESS') && !current?.assignee;
  return { needsComment, needsResolution, needsAssignee };
}
