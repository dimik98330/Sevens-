// Контракт 03 v1.0: enum, лимиты, допустимые переходы. Источник истины — docs/03.
// Любое изменение согласуется с A/B через журнал; фронт своих статусов не выдумывает.
export const ROLES = ['CITIZEN', 'STAFF', 'ADMIN'];
export const STATUSES = ['DRAFT', 'RECEIVED', 'UNDER_REVIEW', 'NEEDS_INFO', 'IN_PROGRESS', 'COMPLETED', 'REJECTED'];
export const CATEGORIES = ['TRANSPORT', 'UTILITIES', 'EDUCATION', 'ECOLOGY', 'SAFETY', 'HEALTH', 'TOURISM', 'ACCESSIBILITY', 'OTHER'];
export const RESOLUTION_TYPES = ['ANSWER_PROVIDED', 'PILOT_PLANNED', 'IMPLEMENTED', 'FORWARDED_EXTERNALLY'];

// Допустимые переходы (01 §12). UI показывает только их, а не весь enum.
export const TRANSITIONS = {
  DRAFT: ['RECEIVED'],
  RECEIVED: ['UNDER_REVIEW'],
  UNDER_REVIEW: ['NEEDS_INFO', 'IN_PROGRESS', 'REJECTED', 'COMPLETED'],
  NEEDS_INFO: ['UNDER_REVIEW'],
  IN_PROGRESS: ['NEEDS_INFO', 'COMPLETED', 'REJECTED'],
  COMPLETED: [],
  REJECTED: [],
};

export const LIMITS = {
  title: [10, 120],
  problem: [30, 3000],
  solution: [30, 3000],
  benefit: [0, 1000],
  locationText: [0, 300],
  comment: [20, 2000],
  clarification: [10, 3000],
  rerouteReason: [10, 1000],
  filesMax: 3,
  fileBytes: 5 * 1024 * 1024,
  fileTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
  password: [12, 128],
};

const cpLen = (s) => [...(s.normalize('NFC').trim())].length;

export function validateField(name, value) {
  const v = (value ?? '').toString();
  const n = cpLen(v);
  switch (name) {
    case 'title':
      if (n < 10) return 'Название короче 10 символов';
      if (n > 120) return 'Название длиннее 120 символов';
      return null;
    case 'problem':
    case 'solution':
      if (n < 30) return 'Нужно минимум 30 символов — опишите подробнее';
      if (n > 3000) return 'Превышен лимит 3000 символов';
      return null;
    case 'expectedBenefit':
      if (n > 1000) return 'Превышен лимит 1000 символов';
      return null;
    case 'locationText':
      if (n > 300) return 'Превышен лимит 300 символов';
      return null;
    case 'publicComment':
      if (n < 20) return 'Комментарий для жителя — минимум 20 символов';
      if (n > 2000) return 'Комментарий длиннее 2000 символов';
      return null;
    case 'clarification':
      if (n < 10) return 'Ответ — минимум 10 символов';
      if (n > 3000) return 'Ответ длиннее 3000 символов';
      return null;
    case 'rerouteReason':
      if (n < 10) return 'Причина — минимум 10 символов';
      if (n > 1000) return 'Причина длиннее 1000 символов';
      return null;
    default: return null;
  }
}

export function allowedTransitions(status) {
  return TRANSITIONS[status] ?? [];
}

// Нормализация ответа об ошибке по 03 §5.
export function parseApiError(status, payload) {
  const err = payload?.error ?? {};
  return {
    http: status,
    code: err.code ?? (status === 0 ? 'NETWORK_ERROR' : 'UNKNOWN_ERROR'),
    message: err.message ?? 'Что-то пошло не так. Попробуйте ещё раз.',
    fields: err.fields ?? {},
    requestId: payload?.meta?.requestId,
  };
}

export function newIdempotencyKey() {
  return (globalThis.crypto?.randomUUID?.() ?? `key-${Date.now()}-${Math.random().toString(16).slice(2)}`);
}
