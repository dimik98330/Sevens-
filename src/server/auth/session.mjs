// Server-side sessions (06 section 4): 32-byte random tokens, only SHA-256
// hashes stored, 12h lifetime, revocation on logout. CSRF token is bound to
// the session; neither token lives in localStorage, logs or query strings.
import { randomBytes, createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { SESSION_TTL_HOURS } from '../../contracts/enums.mjs';

export const SESSION_COOKIE = 'sid';

export function sha256Hex(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

// The unguessable HttpOnly session token is the HMAC key. A fixed domain
// separator keeps the derived token distinct from the stored session hash.
// Reading /me returns the same token and does not invalidate other tabs.
export function csrfTokenForSession(token) {
  if (typeof token !== 'string' || !token) throw new TypeError('Session token required');
  return createHmac('sha256', token).update('sevens:session-csrf:v1').digest('base64url');
}

function safeEqualHex(a, b) {
  const ab = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ab.length === bb.length && ab.length > 0 && timingSafeEqual(ab, bb);
}

export async function createSession(db, userId) {
  const token = randomBytes(32).toString('base64url');
  const csrfToken = csrfTokenForSession(token);
  const row = await db.query(
    `INSERT INTO sessions(user_id, token_hash, csrf_token_hash, expires_at)
     VALUES($1,$2,$3,now() + make_interval(hours => $4))
     RETURNING id, expires_at`,
    [userId, sha256Hex(token), sha256Hex(csrfToken), SESSION_TTL_HOURS]);
  return { token, csrfToken, sessionId: row.rows[0].id, expiresAt: row.rows[0].expires_at };
}

export async function getSession(db, token) {
  if (!token) return null;
  const row = await db.query(
    `SELECT s.id, s.user_id, s.csrf_token_hash, s.expires_at, s.revoked_at,
            u.id AS uid, u.role, u.organization_id, u.region_id, u.active,
            u.display_name, u.email_normalized
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1`,
    [sha256Hex(token)]);
  if (row.rows.length === 0) return null;
  const s = row.rows[0];
  if (s.revoked_at) return null;
  if (new Date(s.expires_at).getTime() <= Date.now()) return null;
  if (!s.active) return null;
  const csrfHash = sha256Hex(csrfTokenForSession(token));
  if (!safeEqualHex(csrfHash, s.csrf_token_hash)) {
    // Sessions created before stable CSRF are upgraded on their first read.
    // They retain their lifetime/identity; only the old tab's token expires.
    await db.query('UPDATE sessions SET csrf_token_hash=$1 WHERE id=$2', [csrfHash, s.id]);
    s.csrf_token_hash = csrfHash;
  }
  return s;
}

export function verifyCsrf(session, presented) {
  if (!session || typeof presented !== 'string' || !presented) return false;
  // presented token is the raw value; DB keeps its hash.
  return safeEqualHex(sha256Hex(presented), session.csrf_token_hash);
}

export async function revokeSession(db, sessionId) {
  await db.query('UPDATE sessions SET revoked_at = now() WHERE id = $1', [sessionId]);
}

export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (name && !(name in out)) {
      try { out[name] = decodeURIComponent(value); } catch { /* invalid cookie is ignored */ }
    }
  }
  return out;
}

export function sessionCookie(token, { secure, maxAgeSeconds }) {
  let cookie = `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
  if (secure) cookie += '; Secure';
  return cookie;
}

export function clearedSessionCookie(secure) {
  let cookie = `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`;
  if (secure) cookie += '; Secure';
  return cookie;
}
