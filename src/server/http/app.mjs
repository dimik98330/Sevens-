// Minimal HTTP application (B-owned routes). Plain node:http so the same
// handlers can later mount into Next.js route handlers. Contract envelopes
// follow 03 section 5; no SQL or stack traces leak to clients.
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { access, mkdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { registerCitizen, login, logout } from '../auth/service.mjs';
import {
  getSession, verifyCsrf, parseCookies, sessionCookie, clearedSessionCookie,
  SESSION_COOKIE, sha256Hex,
} from '../auth/session.mjs';
import { loginLimiter, registerLimiter } from '../auth/rateLimit.mjs';
import { ERROR_CODES, errorBody, successBody } from '../../contracts/errors.mjs';
import { RULE_VERSION, CONSENT_VERSION } from '../../contracts/enums.mjs';

const BODY_LIMIT = 64 * 1024;

export function appConfig() {
  const origin = process.env.APP_ORIGIN || 'http://localhost:3000';
  return {
    origin,
    secureCookies: origin.startsWith('https://'),
    uploadDir: process.env.UPLOAD_DIR || './storage/uploads',
  };
}

function sendJson(res, status, payload, privateCache = true) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    ...(privateCache ? { 'cache-control': 'private, no-store' } : {}),
  });
  res.end(body);
}

function sendError(res, err, requestId) {
  const code = err.code && ERROR_CODES[err.code] ? err.code : 'SERVICE_UNAVAILABLE';
  const status = ERROR_CODES[code] || 503;
  const message = status === 503 ? 'Сервис временно недоступен' : err.message;
  sendJson(res, status, errorBody(code, message, err.fields, requestId));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        const err = new Error('Слишком большое тело запроса');
        err.code = 'VALIDATION_ERROR';
        reject(err);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve(undefined);
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        const err = new Error('Некорректный JSON');
        err.code = 'VALIDATION_ERROR';
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function checkOrigin(req, config) {
  const origin = req.headers.origin;
  if (!origin || origin !== config.origin) {
    const err = new Error('Недопустимый источник запроса');
    err.code = 'CSRF_INVALID';
    throw err;
  }
}

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  // Untrusted proxy headers are ignored (06 section 5); direct peer only.
  void forwarded;
  return req.socket?.remoteAddress || 'unknown';
}

async function currentSession(db, req) {
  const cookies = parseCookies(req.headers.cookie);
  return getSession(db, cookies[SESSION_COOKIE]);
}

export function createHandler(db, config = appConfig()) {
  return async (req, res) => {
    const requestId = 'req_' + randomBytes(8).toString('hex');
    const url = new URL(req.url || '/', 'http://localhost');
    try {
      // Public health endpoints.
      if (req.method === 'GET' && url.pathname === '/api/health/live') {
        return sendJson(res, 200, successBody({ status: 'ok' }, requestId), false);
      }
      if (req.method === 'GET' && url.pathname === '/api/health/ready') {
        try {
          await db.query('SELECT 1');
          await db.query('SELECT version FROM schema_migrations LIMIT 1');
          await mkdir(config.uploadDir, { recursive: true });
          await access(config.uploadDir, constants.W_OK);
          return sendJson(res, 200, successBody({ status: 'ready' }, requestId), false);
        } catch {
          return sendJson(res, 503,
            errorBody('SERVICE_UNAVAILABLE', 'Сервис временно недоступен', undefined, requestId), false);
        }
      }
      if (req.method === 'GET' && url.pathname === '/api/v1/catalogs') {
        const categories = await db.query(
          'SELECT code, name_ru AS "nameRu", name_kk AS "nameKk" FROM categories WHERE active ORDER BY code');
        const territories = await db.query(
          `SELECT t.code, t.kind, t.name_ru AS "nameRu", t.name_kk AS "nameKk"
           FROM territories t JOIN regions r ON r.id = t.region_id
           WHERE t.active AND r.active ORDER BY t.code`);
        return sendJson(res, 200, successBody({
          categories: categories.rows,
          territories: territories.rows,
          ruleVersion: RULE_VERSION,
          consentVersion: CONSENT_VERSION,
        }, requestId), false);
      }

      // Auth endpoints.
      if (url.pathname === '/api/v1/auth/register' && req.method === 'POST') {
        checkOrigin(req, config);
        const ip = clientIp(req);
        const retryAfter = registerLimiter.check(`register:${ip}`, 20, 3600);
        if (retryAfter) {
          const err = new Error('Слишком много попыток');
          err.code = 'RATE_LIMITED';
          throw err;
        }
        const body = await readJsonBody(req);
        const { user, session } = await registerCitizen(db, body || {});
        res.setHeader('Set-Cookie', sessionCookie(session.token, {
          secure: config.secureCookies, maxAgeSeconds: 12 * 3600,
        }));
        return sendJson(res, 201, successBody({
          user: {
            id: user.id, displayName: user.display_name,
            role: user.role, organizationId: user.organization_id,
          },
          csrfToken: session.csrfToken,
        }, requestId));
      }
      if (url.pathname === '/api/v1/auth/login' && req.method === 'POST') {
        checkOrigin(req, config);
        const body = await readJsonBody(req);
        const emailKey = String(body?.email || '').normalize('NFC').trim().toLowerCase();
        const failKey = `login-fail:${clientIp(req)}:${emailKey}`;
        try {
          const { user, session } = await login(db, body || {});
          res.setHeader('Set-Cookie', sessionCookie(session.token, {
            secure: config.secureCookies, maxAgeSeconds: 12 * 3600,
          }));
          return sendJson(res, 200, successBody({
            user: {
              id: user.id, displayName: user.display_name,
              role: user.role, organizationId: user.organization_id,
            },
            csrfToken: session.csrfToken,
          }, requestId));
        } catch (err) {
          if (err.code === 'UNAUTHENTICATED') {
            const retryAfter = loginLimiter.check(failKey, 5, 900);
            if (retryAfter) {
              const limitedErr = new Error('Слишком много попыток');
              limitedErr.code = 'RATE_LIMITED';
              throw limitedErr;
            }
          }
          throw err;
        }
      }
      if (url.pathname === '/api/v1/auth/logout' && req.method === 'POST') {
        checkOrigin(req, config);
        const session = await currentSession(db, req);
        if (!session) {
          const err = new Error('Требуется вход');
          err.code = 'UNAUTHENTICATED';
          throw err;
        }
        if (!verifyCsrf(session, req.headers['x-csrf-token'])) {
          const err = new Error('Недопустимый CSRF-токен');
          err.code = 'CSRF_INVALID';
          throw err;
        }
        await logout(db, session);
        res.setHeader('Set-Cookie', clearedSessionCookie(config.secureCookies));
        res.writeHead(204);
        return res.end();
      }
      if (url.pathname === '/api/v1/auth/me' && req.method === 'GET') {
        const session = await currentSession(db, req);
        if (!session) {
          const err = new Error('Требуется вход');
          err.code = 'UNAUTHENTICATED';
          throw err;
        }
        // Raw CSRF token is stored hashed, so /me rotates it and returns
        // the fresh value (never in query string or logs).
        const csrfToken = randomBytes(32).toString('base64url');
        await db.query('UPDATE sessions SET csrf_token_hash=$1 WHERE id=$2',
          [sha256Hex(csrfToken), session.id]);
        return sendJson(res, 200, successBody({
          id: session.uid,
          displayName: session.display_name,
          role: session.role,
          organizationId: session.organization_id,
          csrfToken,
        }, requestId));
      }
      const err = new Error('Не найдено');
      err.code = 'NOT_FOUND';
      throw err;
    } catch (e) {
      sendError(res, e, requestId);
    }
  };
}

export function createServer(db, config = appConfig()) {
  return http.createServer(createHandler(db, config));
}
