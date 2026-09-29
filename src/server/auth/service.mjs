// Identity service: public registration is CITIZEN-only (FR-01).
// Unknown write fields are rejected; role comes from the server, never JSON.
import { hashPassword, verifyPassword } from './password.mjs';
import { createSession, revokeSession } from './session.mjs';
import { CONSENT_VERSION } from '../../contracts/enums.mjs';

export const ALLOWED_REGISTER_FIELDS = ['displayName', 'email', 'password', 'consentAccepted'];
export const ALLOWED_LOGIN_FIELDS = ['email', 'password'];

export function normalizeEmail(email) {
  return String(email).normalize('NFC').trim().toLowerCase();
}

export function validateEmail(email) {
  if (typeof email !== 'string') return false;
  const v = email.normalize('NFC').trim();
  if (v.length < 3 || v.length > 320) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

export function codePoints(s) {
  return Array.from(String(s).normalize('NFC')).length;
}

function rejectUnknown(body, allowed) {
  const unknown = Object.keys(body || {}).filter((k) => !allowed.includes(k));
  if (unknown.length > 0) {
    const err = new Error('Unknown fields are rejected');
    err.code = 'VALIDATION_ERROR';
    err.fields = Object.fromEntries(unknown.map((k) => [k, 'Неизвестное поле']));
    throw err;
  }
}

export function validateRegister(body) {
  rejectUnknown(body, ALLOWED_REGISTER_FIELDS);
  const fields = {};
  const displayName = typeof body.displayName === 'string' ? body.displayName.normalize('NFC').trim() : '';
  if (!displayName) fields.displayName = 'Укажите имя';
  else if (codePoints(displayName) > 200) fields.displayName = 'Имя слишком длинное';
  if (!validateEmail(body.email)) fields.email = 'Проверьте email';
  if (typeof body.password !== 'string' || codePoints(body.password) < 12 || codePoints(body.password) > 128) {
    fields.password = 'Пароль: 12–128 символов';
  }
  if (body.consentAccepted !== true) fields.consentAccepted = 'Необходимо согласие';
  if (Object.keys(fields).length > 0) {
    const err = new Error('Проверьте заполнение формы');
    err.code = 'VALIDATION_ERROR';
    err.fields = fields;
    throw err;
  }
  return { displayName, email: body.email, password: body.password };
}

export async function registerCitizen(db, body) {
  const input = validateRegister(body);
  const emailNormalized = normalizeEmail(input.email);
  const existing = await db.query('SELECT id FROM users WHERE email_normalized=$1', [emailNormalized]);
  if (existing.rows.length > 0) {
    const err = new Error('Проверьте заполнение формы');
    err.code = 'VALIDATION_ERROR';
    err.fields = { email: 'Этот email уже зарегистрирован' };
    throw err;
  }
  // The demo region is resolved by code; multi-region signup is out of P0 scope.
  const region = await db.query(`SELECT id FROM regions WHERE code='ABAI' AND active`);
  if (region.rows.length === 0) {
    const err = new Error('Сервис временно недоступен');
    err.code = 'SERVICE_UNAVAILABLE';
    throw err;
  }
  const passwordHash = await hashPassword(input.password);
  const created = await db.query(
    `INSERT INTO users(email_normalized, display_name, password_hash, role, region_id)
     VALUES($1,$2,$3,'CITIZEN',$4)
     RETURNING id, display_name, role, organization_id, region_id`,
    [emailNormalized, input.displayName, passwordHash, region.rows[0].id]);
  const user = created.rows[0];
  await db.query(
    `INSERT INTO user_consents(user_id, purpose, version) VALUES($1,'service',$2)
     ON CONFLICT DO NOTHING`,
    [user.id, CONSENT_VERSION]);
  const session = await createSession(db, user.id);
  return { user, session };
}

export async function login(db, body) {
  rejectUnknown(body, ALLOWED_LOGIN_FIELDS);
  if (!validateEmail(body.email) || typeof body.password !== 'string' || body.password.length === 0) {
    const err = new Error('Неверный email или пароль');
    err.code = 'UNAUTHENTICATED';
    throw err;
  }
  const emailNormalized = normalizeEmail(body.email);
  const found = await db.query('SELECT * FROM users WHERE email_normalized=$1', [emailNormalized]);
  const user = found.rows[0];
  const ok = user && user.active && (await verifyPassword(user.password_hash, body.password));
  if (!ok) {
    const err = new Error('Неверный email или пароль');
    err.code = 'UNAUTHENTICATED';
    throw err;
  }
  const session = await createSession(db, user.id);
  return { user, session };
}

export async function logout(db, session) {
  if (session) await revokeSession(db, session.id);
}

export function publicActor(session) {
  return {
    id: session.uid,
    displayName: session.display_name,
    role: session.role,
    organizationId: session.organization_id,
    regionId: session.region_id,
    csrfToken: undefined, // attached by the HTTP layer only
  };
}
