// FR-02 validation. Drafts accept partial fields within max bounds;
// submit enforces full bounds. Lengths in Unicode code points after NFC+trim.
import { CATEGORY_CODES } from '../../contracts/enums.mjs';
import { validateLocationGeometry } from '../geo/location.mjs';
import { requestFields, positiveVersion, uuidField } from './request-validation.mjs';

export function codePoints(s) {
  return Array.from(String(s).normalize('NFC')).length;
}

export function cleanText(value) {
  return typeof value === 'string' ? value.normalize('NFC').trim() : value;
}

export const LIMITS = {
  title: { min: 10, max: 120 },
  problem: { min: 30, max: 3000 },
  solution: { min: 30, max: 3000 },
  expectedBenefit: { max: 1000 },
  locationText: { max: 300 },
  clarification: { min: 10, max: 3000 },
  statusComment: { min: 20, max: 2000 },
  rerouteReason: { min: 10, max: 1000 },
};

export const ALLOWED_DRAFT_FIELDS = [
  'title', 'problem', 'solution', 'requestedCategoryCode', 'territoryId',
  'locationText', 'locationGeometry', 'expectedBenefit', 'consentAccepted',
];

function rejectUnknown(body, allowed) {
  const unknown = Object.keys(body || {}).filter((k) => !allowed.includes(k));
  if (unknown.length > 0) {
    const err = new Error('Неизвестные поля отклонены');
    err.code = 'VALIDATION_ERROR';
    err.fields = Object.fromEntries(unknown.map((k) => [k, 'Неизвестное поле']));
    throw err;
  }
}

function checkCategory(value, fields) {
  if (value === undefined || value === null) return null;
  if (value === 'AUTO' || !CATEGORY_CODES.includes(value)) {
    fields.requestedCategoryCode = 'Укажите категорию или AUTO';
    return undefined;
  }
  return value;
}

// Partial draft validation: min lengths NOT enforced, max lengths enforced.
export function validateDraftPatch(body, { withVersion = false } = {}) {
  requestFields(body, [...ALLOWED_DRAFT_FIELDS, ...(withVersion ? ['expectedVersion'] : [])]);
  if (withVersion) positiveVersion(body.expectedVersion);
  const { expectedVersion, ...known } = body || {};
  void expectedVersion;
  rejectUnknown(known, ALLOWED_DRAFT_FIELDS);
  const fields = {};
  const patch = {};
  for (const key of ['title', 'problem', 'solution', 'expectedBenefit', 'locationText']) {
    if (body[key] === undefined) continue;
    const v = cleanText(body[key]);
    if (typeof v !== 'string') { fields[key] = 'Некорректное значение'; continue; }
    const max = LIMITS[key === 'expectedBenefit' ? 'expectedBenefit' : key === 'locationText' ? 'locationText' : key].max;
    if (codePoints(v) > max) fields[key] = `Максимум ${max} символов`;
    else patch[key] = v;
  }
  if (body.requestedCategoryCode !== undefined) {
    const c = checkCategory(body.requestedCategoryCode, fields);
    if (c !== undefined) patch.requested_category_code = c;
  }
  if (body.territoryId !== undefined) {
    uuidField(body.territoryId, 'territoryId', { nullable: true });
    patch.territory_id = body.territoryId;
  }
  if (body.consentAccepted !== undefined) {
    if (typeof body.consentAccepted !== 'boolean') fields.consentAccepted = 'Некорректное значение';
    else patch.consent_accepted = body.consentAccepted;
  }
  if (body.locationGeometry !== undefined) {
    try { patch.locationGeometry = validateLocationGeometry(body.locationGeometry); }
    catch (err) {
      if (err.code !== 'VALIDATION_ERROR') throw err;
      Object.assign(fields, err.fields);
    }
  }
  if (Object.keys(fields).length > 0) {
    const err = new Error('Проверьте заполнение формы');
    err.code = 'VALIDATION_ERROR';
    err.fields = fields;
    throw err;
  }
  return patch;
}

// Full submit validation: every required field within bounds.
export function validateSubmitFields(idea) {
  const fields = {};
  const title = cleanText(idea.title);
  const problem = cleanText(idea.problem);
  const solution = cleanText(idea.solution);
  if (codePoints(title) < LIMITS.title.min || codePoints(title) > LIMITS.title.max) {
    fields.title = `Название: ${LIMITS.title.min}–${LIMITS.title.max} символов`;
  }
  if (codePoints(problem) < LIMITS.problem.min || codePoints(problem) > LIMITS.problem.max) {
    fields.problem = `Опишите проблему подробнее: минимум ${LIMITS.problem.min} символов`;
  }
  if (codePoints(solution) < LIMITS.solution.min || codePoints(solution) > LIMITS.solution.max) {
    fields.solution = `Опишите решение подробнее: минимум ${LIMITS.solution.min} символов`;
  }
  if (idea.expected_benefit && codePoints(idea.expected_benefit) > LIMITS.expectedBenefit.max) {
    fields.expectedBenefit = `Максимум ${LIMITS.expectedBenefit.max} символов`;
  }
  if (idea.location_text && codePoints(idea.location_text) > LIMITS.locationText.max) {
    fields.locationText = `Максимум ${LIMITS.locationText.max} символов`;
  }
  try { validateLocationGeometry(idea.location_geometry ?? null); }
  catch (err) {
    if (err.code !== 'VALIDATION_ERROR') throw err;
    Object.assign(fields, err.fields);
  }
  if (!idea.territory_id) fields.territoryId = 'Выберите территорию';
  if (idea.requested_category_code !== null && idea.requested_category_code !== undefined
    && !CATEGORY_CODES.includes(idea.requested_category_code)) {
    fields.requestedCategoryCode = 'Недопустимая категория';
  }
  if (Object.keys(fields).length > 0) {
    const err = new Error('Проверьте заполнение формы');
    err.code = 'VALIDATION_ERROR';
    err.fields = fields;
    throw err;
  }
  return { title, problem, solution };
}
