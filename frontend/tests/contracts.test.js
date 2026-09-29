import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateField, allowedTransitions, parseApiError, newIdempotencyKey } from '../js/lib/contracts.js';
import { transitionRequirements } from '../js/lib/api.js';

describe('валидация формы (01 §6)', () => {
  it('лимиты названия/проблемы/решения', () => {
    assert.ok(validateField('title', 'коротко'));
    assert.equal(validateField('title', 'Умные светофоры рядом со школой'), null);
    assert.ok(validateField('problem', 'мало'));
    assert.equal(validateField('problem', 'x'.repeat(30)), null);
    assert.ok(validateField('solution', 'x'.repeat(3001)));
  });
  it('публичный комментарий 20–2000', () => {
    assert.ok(validateField('publicComment', 'коротко'));
    assert.equal(validateField('publicComment', 'x'.repeat(20)), null);
  });
});

describe('переходы статусов (01 §12)', () => {
  it('только допустимые кнопки', () => {
    assert.deepEqual(allowedTransitions('RECEIVED'), ['UNDER_REVIEW']);
    assert.deepEqual(allowedTransitions('COMPLETED'), []);
    assert.ok(allowedTransitions('UNDER_REVIEW').includes('NEEDS_INFO'));
    assert.ok(!allowedTransitions('RECEIVED').includes('COMPLETED'));
  });
  it('COMPLETED требует тип результата и комментарий', () => {
    const r = transitionRequirements('COMPLETED', { assignee: { id: 'x' } });
    assert.equal(r.needsComment, true);
    assert.equal(r.needsResolution, true);
  });
});

describe('API-клиент: ошибки и идемпотентность (03 §5, §7)', () => {
  it('409 VERSION_CONFLICT парсится', () => {
    const e = parseApiError(409, { error: { code: 'VERSION_CONFLICT', message: 'x' }, meta: {} });
    assert.equal(e.code, 'VERSION_CONFLICT');
  });
  it('ключи уникальны', () => {
    assert.notEqual(newIdempotencyKey(), newIdempotencyKey());
  });
  it('401/403 различимы', () => {
    assert.equal(parseApiError(401, { error: { code: 'UNAUTHENTICATED', message: 'm' } }).code, 'UNAUTHENTICATED');
    assert.equal(parseApiError(403, { error: { code: 'FORBIDDEN', message: 'm' } }).code, 'FORBIDDEN');
  });
});
