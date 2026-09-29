// Contract error codes (03 section 5) mapped to HTTP status.
export const ERROR_CODES = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  CSRF_INVALID: 403,
  NOT_FOUND: 404,
  VERSION_CONFLICT: 409,
  INVALID_TRANSITION: 409,
  IDEMPOTENCY_CONFLICT: 409,
  FILE_TOO_LARGE: 413,
  UNSUPPORTED_FILE_TYPE: 415,
  RATE_LIMITED: 429,
  SERVICE_UNAVAILABLE: 503,
};

export function errorBody(code, message, fields, requestId) {
  const body = { error: { code, message }, meta: { requestId } };
  if (fields && Object.keys(fields).length > 0) body.error.fields = fields;
  return body;
}

export function successBody(data, requestId) {
  return { data, meta: { requestId } };
}

export function listBody(items, page, pageSize, total, requestId) {
  return { data: items, meta: { requestId, page, pageSize, total } };
}
