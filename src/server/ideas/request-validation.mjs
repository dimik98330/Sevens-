// Small strict request guards shared by idea/workflow services. HTTP also
// validates path/query inputs, but direct service callers get the same errors.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validationError(fields, message = 'Проверьте заполнение формы') {
  const error = new Error(message);
  error.code = 'VALIDATION_ERROR';
  error.fields = fields;
  throw error;
}

export function requestFields(body, allowed, required = []) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    validationError({ body: 'Ожидается JSON-объект' });
  }
  const fields = {};
  for (const field of Object.keys(body)) {
    if (!allowed.includes(field)) fields[field] = 'Неизвестное поле';
  }
  for (const field of required) {
    if (!Object.hasOwn(body, field)) fields[field] = 'Обязательное поле';
  }
  if (Object.keys(fields).length) validationError(fields);
  return body;
}

export function positiveVersion(value) {
  if (!Number.isSafeInteger(value) || value < 1) {
    validationError({ expectedVersion: 'Ожидается положительная целая версия карточки' });
  }
}

export function uuidField(value, field, { nullable = false } = {}) {
  if (nullable && value === null) return;
  if (typeof value !== 'string' || !UUID.test(value)) {
    validationError({ [field]: 'Ожидается корректный UUID' });
  }
}

export function booleanField(value, field) {
  if (typeof value !== 'boolean') validationError({ [field]: 'Ожидается boolean' });
}
