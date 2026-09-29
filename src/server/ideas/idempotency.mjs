// Idempotency helper (03 section 7): canonical request hash, replay of the
// stored success BEFORE any version check, 409 on key reuse with new body.
import { createHash } from 'node:crypto';
import { IDEMPOTENCY_TTL_HOURS } from '../../contracts/enums.mjs';

export function canonicalHash(value) {
  const normalized = JSON.stringify(sortKeys(value));
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((k) => [k, sortKeys(value[k])]));
  }
  return value;
}

export function idempotencyConflict() {
  const err = new Error('Ключ уже использован с другим запросом');
  err.code = 'IDEMPOTENCY_CONFLICT';
  throw err;
}

// Returns a stored response when the key was already applied.
export async function findReplay(db, userId, operation, key, requestHash) {
  const row = await db.query(
    `SELECT request_hash, response_status, response_json FROM idempotency_records
     WHERE user_id=$1 AND operation=$2 AND key=$3 AND expires_at > now()`,
    [userId, operation, key]);
  if (row.rows.length === 0) return null;
  const stored = row.rows[0];
  if (stored.request_hash !== requestHash) idempotencyConflict();
  return { status: stored.response_status, body: stored.response_json };
}

export async function storeReplay(db, userId, operation, key, requestHash, status, body) {
  await db.query(
    `INSERT INTO idempotency_records(user_id, operation, key, request_hash,
       response_status, response_json, expires_at)
     VALUES($1,$2,$3,$4,$5,$6, now() + make_interval(hours => $7))
     ON CONFLICT (user_id, operation, key) DO NOTHING`,
    [userId, operation, key, requestHash, status, JSON.stringify(body), IDEMPOTENCY_TTL_HOURS]);
}

// Reserve-first slot inside the business transaction. The placeholder insert
// serializes concurrent writers on the unique index: the loser blocks until
// the winner commits or rolls back, then replays the stored success or takes
// the freed slot. A rolled-back transaction leaves no reservation behind.
export async function beginKeyedOp(tx, userId, operation, key, requestHash) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const ins = await tx.query(
      `INSERT INTO idempotency_records(user_id, operation, key, request_hash,
         response_status, response_json, expires_at)
       VALUES($1,$2,$3,$4,0,'{}', now() + make_interval(hours => $5))
       ON CONFLICT (user_id, operation, key) DO NOTHING RETURNING id`,
      [userId, operation, key, requestHash, IDEMPOTENCY_TTL_HOURS]);
    if (ins.rows.length === 1) return { proceed: true };
    const row = await tx.query(
      `SELECT request_hash, response_status, response_json, expires_at FROM idempotency_records
       WHERE user_id=$1 AND operation=$2 AND key=$3`,
      [userId, operation, key]);
    const stored = row.rows[0];
    if (!stored || stored.response_status === 0 || new Date(stored.expires_at) <= new Date()) {
      // Stale placeholder (crashed writer) or expired key: reclaim the slot.
      await tx.query(
        `DELETE FROM idempotency_records WHERE user_id=$1 AND operation=$2 AND key=$3`,
        [userId, operation, key]);
      continue;
    }
    if (stored.request_hash !== requestHash) idempotencyConflict();
    return { replay: { status: stored.response_status, body: stored.response_json } };
  }
  const err = new Error('Сервис временно недоступен');
  err.code = 'SERVICE_UNAVAILABLE';
  throw err;
}

export async function finishKeyedOp(tx, userId, operation, key, status, body) {
  await tx.query(
    `UPDATE idempotency_records SET response_status=$1, response_json=$2
     WHERE user_id=$3 AND operation=$4 AND key=$5`,
    [status, JSON.stringify(body), userId, operation, key]);
}

export function requireKey(value) {
  if (typeof value !== 'string' || value.length < 8 || value.length > 128) {
    const err = new Error('Требуется Idempotency-Key');
    err.code = 'VALIDATION_ERROR';
    err.fields = { idempotencyKey: 'Передайте уникальный ключ повторной отправки' };
    throw err;
  }
  return value;
}
