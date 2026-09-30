// C: один typed API-клиент на весь фронт (C-01). Контракт 03 §5–§6:
// успех {data, meta{requestId,...}}, ошибка {error{code,message,fields?}, meta}.
// Каждое новое намерение записи — новый Idempotency-Key; повтор — тем же ключом.
import type { ErrorCode } from "@/contracts";

export interface ApiErrorDetail {
  http: number;
  code: ErrorCode | "NETWORK_ERROR" | "UNKNOWN_ERROR";
  message: string;
  fields: Record<string, string>;
  requestId?: string;
}

export class ApiError extends Error {
  readonly detail: ApiErrorDetail;
  constructor(detail: ApiErrorDetail) {
    super(detail.message);
    this.name = "ApiError";
    this.detail = detail;
  }
}

export function parseApiError(status: number, payload: unknown): ApiErrorDetail {
  const err = (payload as { error?: { code?: string; message?: string; fields?: Record<string, string> } } | null)?.error;
  const meta = (payload as { meta?: { requestId?: string } } | null)?.meta;
  const code = (err?.code ?? (status === 0 ? "NETWORK_ERROR" : "UNKNOWN_ERROR")) as ApiErrorDetail["code"];
  return {
    http: status,
    code,
    message: err?.message ?? "Что-то пошло не так. Попробуйте ещё раз.",
    fields: err?.fields ?? {},
    requestId: meta?.requestId,
  };
}

export function newIdempotencyKey(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && "randomUUID" in c && typeof c.randomUUID === "function") return c.randomUUID();
  return `key-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// CSRF-токен живёт только в памяти вкладки (не localStorage), получаем его из /me.
let csrfToken: string | null = null;
let csrfActorId: string | null = null;
let csrfRevision = 0;
let csrfRefresh: Promise<boolean> | null = null;
export function setCsrf(token: string | null, actorId?: string | null): void {
  csrfToken = token;
  csrfActorId = token && typeof actorId === "string" && actorId ? actorId : null;
  csrfRevision += 1;
}

async function refreshCsrf(actorId: string | null): Promise<boolean> {
  if (!actorId || csrfActorId !== actorId) return false;
  if (csrfRefresh) return csrfRefresh;
  const revision = csrfRevision;
  csrfRefresh = (async () => {
    try {
      const response = await fetch("/api/v1/auth/me", {
        credentials: "include",
        cache: "no-store",
      });
      if (!response.ok) return false;
      const result = await response.json() as { data?: { id?: unknown; csrfToken?: unknown } };
      const token = result.data?.csrfToken;
      // A sign-out/sign-in or explicit session refresh supersedes this result.
      // Never replay an old page's write under a different cookie actor.
      if (csrfRevision !== revision || csrfActorId !== actorId || result.data?.id !== actorId
        || typeof token !== "string" || !token) return false;
      setCsrf(token, actorId);
      return true;
    } catch {
      return false;
    }
  })().finally(() => {
    csrfRefresh = null;
  });
  return csrfRefresh;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  idempotencyKey?: string;
  formData?: FormData;
  signal?: AbortSignal;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<{ data: T; meta: Record<string, unknown> }> {
  const method = options.method ?? "GET";
  const requestActorId = csrfActorId;
  const headers: Record<string, string> = {};
  if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;
  let payload: BodyInit | undefined;
  if (options.formData) {
    payload = options.formData;
  } else if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(options.body);
  }
  let csrfRetried = false;
  while (true) {
    if (csrfToken) headers["X-CSRF-Token"] = csrfToken;
    else delete headers["X-CSRF-Token"];
    let res: Response;
    try {
      res = await fetch(path, {
        method,
        headers,
        body: payload,
        credentials: "include",
        signal: options.signal,
      });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      throw new ApiError(parseApiError(0, null));
    }
    if (res.status === 204) return { data: undefined as T, meta: {} };
    const text = await res.text();
    let json: unknown = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    if (!res.ok) {
      const detail = parseApiError(res.status, json);
      // This exact rejection occurs before body/idempotency/business handling.
      // CSRF_INVALID from Origin checks, generic 403 and validation never retry.
      if (!csrfRetried && path.startsWith("/api/v1/") && method !== "GET" && method !== "HEAD"
        && detail.http === 403 && detail.code === "CSRF_INVALID"
        && detail.message === "Недопустимый CSRF-токен" && await refreshCsrf(requestActorId)
        && csrfActorId === requestActorId) {
        csrfRetried = true;
        continue;
      }
      throw new ApiError(detail);
    }
    const data = (json as { data?: T } | null)?.data as T;
    const meta = ((json as { meta?: Record<string, unknown> } | null)?.meta ?? {}) as Record<string, unknown>;
    return { data, meta };
  }
}

/** Same-origin assistant requests keep the existing session and CSRF handling. */
export function assistantChatRequest<T>(body: unknown, signal: AbortSignal) {
  return request<T>("/api/v1/assistant/chat", { method: "POST", body, signal });
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  put: <T>(path: string, body?: unknown, opt?: Omit<RequestOptions, "method" | "body">) =>
    request<T>(path, { method: "PUT", body, ...opt }),
  post: <T>(path: string, body?: unknown, opt?: Omit<RequestOptions, "method" | "body">) =>
    request<T>(path, { method: "POST", body, ...opt }),
  patch: <T>(path: string, body?: unknown, opt?: Omit<RequestOptions, "method" | "body">) =>
    request<T>(path, { method: "PATCH", body, ...opt }),
  del: <T>(path: string, body?: unknown, opt?: Omit<RequestOptions, "method" | "body">) =>
    request<T>(path, { method: "DELETE", body, ...opt }),
  upload: <T>(path: string, file: File, fields?: Record<string, string>, opt?: Omit<RequestOptions, "method" | "body" | "formData">) => {
    const fd = new FormData();
    fd.append("file", file);
    for (const [k, v] of Object.entries(fields ?? {})) fd.append(k, v);
    return request<T>(path, { method: "POST", formData: fd, ...opt });
  },
  key: newIdempotencyKey,
};
