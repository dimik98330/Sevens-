import { CATEGORY_CODES, IDEA_STATUSES } from '../../contracts/enums.mjs';
import { uuidSchema } from '../../contracts/requests.mjs';

function bad(field, message) {
  const error = new Error('Проверьте параметры запроса');
  error.code = 'VALIDATION_ERROR'; error.fields = { [field]: message }; throw error;
}
function integer(params, name, fallback, max) {
  const value = params.get(name);
  if (value === null) return fallback;
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > max) {
    bad(name, `Целое число от 1 до ${max}`);
  }
  return Number(value);
}
function choice(params, name, choices) {
  const value = params.get(name) || '';
  if (value && !choices.includes(value)) bad(name, 'Недопустимое значение');
  return value;
}
export function queryUuid(value, name) {
  if (value && !uuidSchema.safeParse(value).success) bad(name, 'Требуется UUID');
  return value || null;
}

// Calendar dates are inclusive in Asia/Qyzylorda, converted to UTC half-open bounds.
export function calendarDay(value, field) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) bad(field, 'Дата: YYYY-MM-DD');
  const [year, month, day] = value.split('-').map(Number);
  const utc = Date.UTC(year, month - 1, day);
  const check = new Date(utc);
  if (year < 1000 || check.toISOString().slice(0, 10) !== value) bad(field, 'Некорректная дата');
  const boundary = (instant) => {
    const offsetText = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Qyzylorda', timeZoneName: 'longOffset',
    }).formatToParts(new Date(instant)).find((p) => p.type === 'timeZoneName').value;
    const offset = /GMT([+-])(\d{2}):(\d{2})/.exec(offsetText);
    const minutes = offset ? (Number(offset[2]) * 60 + Number(offset[3])) * (offset[1] === '+' ? 1 : -1) : 0;
    return new Date(instant - minutes * 60_000).toISOString();
  };
  return { start: boundary(utc), next: boundary(utc + 86_400_000) };
}

export function parseListQuery(params) {
  const q = (params.get('q') || '').normalize('NFC').trim();
  if ([...q].length > 100) bad('q', 'Максимум 100 символов');
  const territory = params.get('territory') || '';
  if (territory && !/^[\w-]{1,64}$/.test(territory)) bad('territory', 'Некорректный код территории');
  let assignee = params.get('assignee') || '';
  const unassigned = choice(params, 'unassigned', ['1', '0', 'true', 'false']);
  if (['1', 'true'].includes(unassigned)) {
    if (assignee && assignee !== 'unassigned') bad('assignee', 'Конфликт фильтров');
    assignee = 'unassigned';
  }
  if (assignee && assignee !== 'unassigned') queryUuid(assignee, 'assignee');
  const from = params.get('dateFrom') || '';
  const to = params.get('dateTo') || '';
  if (from && to && from > to) bad('dateTo', 'Дата окончания раньше начала');
  return {
    page: integer(params, 'page', 1, 1_000_000), pageSize: integer(params, 'pageSize', 20, 100), q,
    status: choice(params, 'status', IDEA_STATUSES), category: choice(params, 'category', CATEGORY_CODES),
    publication: choice(params, 'publication', ['pending']),
    territory, assignee, organizationId: queryUuid(params.get('organizationId'), 'organizationId'),
    dateFrom: from ? calendarDay(from, 'dateFrom').start : '',
    dateToExclusive: to ? calendarDay(to, 'dateTo').next : '',
    sort: choice(params, 'sort', ['createdAt', 'updatedAt', 'submittedAt', 'publicNumber', 'title']),
    dir: choice(params, 'dir', ['asc', 'desc']),
    unreadOnly: choice(params, 'unreadOnly', ['true', 'false']) === 'true',
  };
}
