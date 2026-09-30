import { CATEGORY_CODES, IDEA_STATUSES } from '../../contracts/enums.mjs';
import { requestFields, uuidField, validationError } from '../ideas/request-validation.mjs';

export function safePublicText(value, field, min, max, { nullable = false } = {}) {
  if (nullable && (value == null || value === '')) return null;
  if (typeof value !== 'string') validationError({ [field]: 'Ожидается текст' });
  const text = value.normalize('NFC').trim();
  if ([...text].length < min || [...text].length > max) {
    validationError({ [field]: `Текст: ${min}–${max} символов` });
  }
  const email = /[^\s@]+@[^\s@]+\.[^\s@]+/u.test(text);
  const withoutIdeaNumbers = text.replace(/\bABAI-\d{4}-\d{6}\b/g, '');
  const phones = withoutIdeaNumbers.match(/(?:\+?\d[\d ()\-.]{5,}\d)/gu) || [];
  if (email || phones.some((phone) => (phone.match(/\d/g) || []).length >= 7)
    || /(?:mailto:|tel:|wa\.me\/|t\.me\/)/iu.test(text)) {
    validationError({ [field]: 'Удалите телефоны, почту и личные контакты из публичного текста' });
  }
  const exactAddress = /(?:^|[^\p{L}\p{N}])(?:дом|д\.|квартира|кв\.|пәтер|үй)\s*№?\s*\d+/iu.test(text)
    || /(?:ул\.?|улиц[ауы]|көшес[іи]|көше)\s+[^\n]{1,70},\s*\d{1,4}(?:\D|$)/iu.test(text);
  const coordinates = /(?:^|[^\d])[-+]?\d{1,2}[.,]\d{3,}\s*[,;/]\s*[-+]?\d{1,3}[.,]\d{3,}(?!\d)/u.test(text)
    || /(?:широта|долгота|latitude|longitude|ендік|бойлық)\s*[:=]?\s*[-+]?\d+[.,]\d+/iu.test(text);
  if (exactAddress || coordinates) validationError({ [field]: 'Удалите точный адрес и координаты из публичного текста' });
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text)) {
    validationError({ [field]: 'Удалите служебные символы из текста' });
  }
  return text;
}

export function publicationText(body) {
  return {
    title: safePublicText(body.title, 'title', 10, 120),
    problem: safePublicText(body.problem, 'problem', 30, 3000),
    solution: safePublicText(body.solution, 'solution', 30, 3000),
    expectedBenefit: safePublicText(body.expectedBenefit, 'expectedBenefit', 0, 1000, { nullable: true }),
  };
}

export function publicationVersion(body, current) {
  if (current === 0 && (body.expectedVersion === undefined || body.expectedVersion === 0)) return;
  if (!Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 1) {
    validationError({ expectedVersion: 'Обновите версию публикации' });
  }
  if (body.expectedVersion !== current) {
    const error = new Error('Публикация изменилась: обновите данные');
    error.code = 'VERSION_CONFLICT';
    throw error;
  }
}

export function requestPublicationBody(body) {
  requestFields(body, ['title', 'problem', 'solution', 'expectedBenefit', 'consentAccepted', 'expectedVersion'],
    ['title', 'problem', 'solution', 'consentAccepted']);
  if (body.consentAccepted !== true) validationError({ consentAccepted: 'Необходимо отдельное согласие на публикацию' });
  return publicationText(body);
}

export function reviewPublicationBody(body) {
  requestFields(body, ['decision', 'title', 'problem', 'solution', 'expectedBenefit', 'moderationNote', 'expectedVersion'],
    ['decision', 'title', 'problem', 'solution', 'expectedVersion']);
  if (!['PUBLISH', 'REJECT'].includes(body.decision)) validationError({ decision: 'PUBLISH или REJECT' });
  return { ...publicationText(body), moderationNote: safePublicText(body.moderationNote, 'moderationNote', 0, 1000, { nullable: true }) };
}

export function showcaseQuery(params) {
  const allowed = new Set(['q', 'category', 'territory', 'status', 'sort', 'page', 'pageSize', 'following']);
  for (const key of params.keys()) if (!allowed.has(key)) validationError({ [key]: 'Неизвестный фильтр' });
  const q = (params.get('q') || '').normalize('NFC').trim();
  if ([...q].length > 100) validationError({ q: 'Максимум 100 символов' });
  const category = params.get('category') || '';
  if (category && !CATEGORY_CODES.includes(category)) validationError({ category: 'Выберите категорию' });
  const territory = params.get('territory') || '';
  if (territory) uuidField(territory, 'territory');
  const status = params.get('status') || '';
  if (status && (status === 'DRAFT' || !IDEA_STATUSES.includes(status))) validationError({ status: 'Выберите публичный статус' });
  const sort = params.get('sort') || 'newest';
  if (!['newest', 'popular', 'updated'].includes(sort)) validationError({ sort: 'newest, popular или updated' });
  const integer = (name, fallback, max) => {
    const value = params.get(name);
    if (value === null) return fallback;
    if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > max) {
      validationError({ [name]: `Целое число от 1 до ${max}` });
    }
    return Number(value);
  };
  const following = params.get('following');
  if (following !== null && !['true', 'false'].includes(following)) validationError({ following: 'true или false' });
  return { q, category, territory, status, sort, page: integer('page', 1, 1_000_000),
    pageSize: integer('pageSize', 12, 24), following: following === 'true' };
}
