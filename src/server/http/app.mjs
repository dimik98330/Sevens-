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
import { ERROR_CODES, errorBody, successBody, listBody } from '../../contracts/errors.mjs';
import { RULE_VERSION, CONSENT_VERSION } from '../../contracts/enums.mjs';
import { createDraft, updateDraft, submitIdea } from '../ideas/service.mjs';
import {
  uploadAttachment, deleteAttachment, downloadAttachment, readMultipart,
} from '../attachments/store.mjs';
import { loadIdeaForActor, requireStaff } from '../policies/scopes.mjs';
import {
  assignIdea, changeStatus, addComment, rerouteIdea, answerClarification,
  listStaffQueue, listAssignees, listOrganizations,
  listNotifications, readNotification,
} from '../workflow/service.mjs';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';

// Contract 03 section 1: JSON uses camelCase, DB uses snake_case.
function camelIdea(idea) {
  return {
    id: idea.id,
    regionId: idea.region_id,
    publicNumber: idea.public_number,
    title: idea.title,
    problem: idea.problem,
    solution: idea.solution,
    expectedBenefit: idea.expected_benefit,
    requestedCategoryCode: idea.requested_category_code,
    effectiveCategoryCode: idea.effective_category_code,
    territoryId: idea.territory_id,
    locationText: idea.location_text,
    status: idea.status,
    organizationId: idea.organization_id,
    assigneeId: idea.assignee_id,
    version: idea.version,
    contentRevision: idea.content_revision,
    submittedAt: idea.submitted_at,
    createdAt: idea.created_at,
    updatedAt: idea.updated_at,
    resolutionType: idea.resolution_type,
    consentVersion: idea.consent_version,
    consentAt: idea.consent_at,
  };
}

async function ideaDetail(db, actor, idea) {
  const att = await db.query(
    `SELECT id, original_name AS "originalName", detected_mime AS mime,
            size_bytes AS "sizeBytes", created_at AS "createdAt"
     FROM attachments WHERE idea_id=$1 AND removed_at IS NULL ORDER BY created_at, id`,
    [idea.id]);
  const route = await db.query(
    `SELECT source, mode, effective_category_code AS "effectiveCategoryCode",
            (SELECT code FROM organizations o WHERE o.id=organization_id) AS "organizationCode",
            tags_json AS tags, confidence_band AS "confidenceBand",
            reason_codes_json AS "reasonCodes", explanation,
            rule_version AS "ruleVersion", created_at AS "createdAt"
     FROM routing_decisions WHERE idea_id=$1 ORDER BY created_at DESC, id DESC LIMIT 1`,
    [idea.id]);
  let assigneeDisplayName = null;
  if (idea.assignee_id) {
    const a = await db.query('SELECT display_name FROM users WHERE id=$1', [idea.assignee_id]);
    assigneeDisplayName = a.rows[0]?.display_name || null;
  }
  const base = camelIdea(idea);
  if (actor.role === 'CITIZEN') {
    const { organizationId, assigneeId, ...rest } = base;
    void organizationId;
    void assigneeId;
    return {
      ...rest,
      assigneeDisplayName,
      organizationCode: route.rows[0]?.organizationCode || null,
      attachments: att.rows,
      routing: route.rows[0] || null,
    };
  }
  const author = await db.query(
    'SELECT display_name, email_normalized FROM users WHERE id=$1', [idea.author_id]);
  return {
    ...base,
    authorDisplayName: author.rows[0]?.display_name || null,
    authorEmail: author.rows[0]?.email_normalized || null,
    assigneeDisplayName,
    attachments: att.rows,
    routing: route.rows[0] || null,
  };
}

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
  // SQL guard violations that can surface through normal API use are mapped
  // to contract codes; anything else stays a 503 without details.
  if (err && /ATTACHMENT_LIMIT_REACHED/.test(err.message || '')) {
    return sendJson(res, 400, errorBody('VALIDATION_ERROR',
      'Максимум 3 активных файла', { file: 'Максимум 3 активных файла' }, requestId));
  }
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
          `SELECT t.id, t.code, t.kind, t.name_ru AS "nameRu", t.name_kk AS "nameKk"
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
      // Authenticated idea routes.
      const actor = await currentSession(db, req).then((s) => {
        if (!s) return null;
        return {
          id: s.uid, role: s.role,
          organizationId: s.organization_id, regionId: s.region_id,
        };
      });
      // Every /api/v1 route except register/login/catalogs (handled above)
      // requires a session; every mutation under it requires Origin+CSRF.
      // login/register enforce Origin inline (no session exists yet).
      const needAuth = url.pathname.startsWith('/api/v1/ideas')
        || url.pathname.startsWith('/api/v1/attachments/')
        || url.pathname.startsWith('/api/v1/notifications')
        || url.pathname.startsWith('/api/v1/staff/')
        || url.pathname.startsWith('/api/v1/admin/');
      if (needAuth && !actor) {
        const err = new Error('Требуется вход');
        err.code = 'UNAUTHENTICATED';
        throw err;
      }
      const needCsrf = needAuth && req.method !== 'GET' && req.method !== 'HEAD';
      if (needCsrf) {
        checkOrigin(req, config);
        const session = await currentSession(db, req);
        if (!verifyCsrf(session, req.headers['x-csrf-token'])) {
          const err = new Error('Недопустимый CSRF-токен');
          err.code = 'CSRF_INVALID';
          throw err;
        }
      }
      const idempotencyKey = req.headers['idempotency-key'];

      if (url.pathname === '/api/v1/ideas' && req.method === 'POST') {
        if (actor.role !== 'CITIZEN') {
          const err = new Error('Нет доступа');
          err.code = 'FORBIDDEN';
          throw err;
        }
        const body = await readJsonBody(req);
        const result = await createDraft(db, actor, body || {}, idempotencyKey, requestId);
        return sendJson(res, result.status, successBody(result.body, requestId));
      }

      const ideaMatch = /^\/api\/v1\/ideas\/([0-9a-f-]{36})(\/.*)?$/.exec(url.pathname);
      if (ideaMatch) {
        const ideaId = ideaMatch[1];
        const suffix = ideaMatch[2] || '';
        if (suffix === '' && req.method === 'PATCH') {
          const body = await readJsonBody(req);
          const result = await updateDraft(db, actor, ideaId, body || {}, requestId);
          return sendJson(res, result.status, successBody(result.body, requestId));
        }
        if (suffix === '/submit' && req.method === 'POST') {
          const body = await readJsonBody(req);
          const result = await submitIdea(db, actor, ideaId, body || {}, idempotencyKey, requestId);
          return sendJson(res, result.status, successBody(result.body, requestId));
        }
        if (suffix === '' && req.method === 'GET') {
          const idea = await loadIdeaForActor(db, actor, ideaId);
          return sendJson(res, 200, successBody(await ideaDetail(db, actor, idea), requestId));
        }
        if (suffix === '/timeline' && req.method === 'GET') {
          const idea = await loadIdeaForActor(db, actor, ideaId);
          const staffView = actor.role !== 'CITIZEN';
          // Comment text travels with the event, gated server-side: staff sees
          // every linked body; the author sees bodies of PUBLIC events only.
          // INTERNAL events never reach citizens (filtered below), and the CASE
          // additionally requires the linked comment row itself to be PUBLIC.
          const events = await db.query(
            `SELECT e.id, e.type, e.actor_id AS "actorId", e.visibility,
                    e.from_status AS "fromStatus", e.to_status AS "toStatus",
                    e.comment_id AS "commentId", e.payload_json AS payload,
                    e.created_at AS "createdAt",
                    CASE WHEN $2 OR (e.visibility = 'PUBLIC' AND c.visibility = 'PUBLIC')
                      THEN c.body ELSE NULL END AS body
             FROM idea_events e LEFT JOIN comments c ON c.id = e.comment_id
             WHERE e.idea_id = $1
             ${staffView ? '' : `AND e.visibility='PUBLIC'`}
             ORDER BY e.created_at, e.id`,
            [idea.id, staffView]);
          return sendJson(res, 200, successBody(events.rows, requestId));
        }
        if (suffix === '/attachments' && req.method === 'POST') {
          const parts = await readMultipart(req);
          const file = parts.find((p) => p.filename);
          const versionPart = parts.find((p) => p.name === 'expectedVersion');
          const expectedVersion = Number((versionPart?.content || '').toString());
          if (!Number.isInteger(expectedVersion)) {
            const err = new Error('Требуется expectedVersion');
            err.code = 'VALIDATION_ERROR';
            err.fields = { expectedVersion: 'Обновите карточку и повторите' };
            throw err;
          }
          const result = await uploadAttachment(db, actor, ideaId, {
            filename: file?.filename || '',
            content: file?.content || Buffer.alloc(0),
          }, expectedVersion, idempotencyKey, requestId, config.uploadDir);
          return sendJson(res, result.status, successBody(result.body, requestId));
        }
        const delMatch = /^\/attachments\/([0-9a-f-]{36})$/.exec(suffix);
        if (delMatch && req.method === 'DELETE') {
          const body = await readJsonBody(req);
          const result = await deleteAttachment(db, actor, ideaId, delMatch[1],
            body?.expectedVersion, idempotencyKey, requestId, config.uploadDir);
          return sendJson(res, result.status, successBody(result.body, requestId));
        }
        if (suffix === '/assignment' && req.method === 'POST') {
          const body = await readJsonBody(req);
          const result = await assignIdea(db, actor, ideaId, body || {}, idempotencyKey, requestId);
          return sendJson(res, result.status, successBody(result.body, requestId));
        }
        if (suffix === '/status' && req.method === 'POST') {
          const body = await readJsonBody(req);
          const result = await changeStatus(db, actor, ideaId, body || {}, idempotencyKey, requestId);
          return sendJson(res, result.status, successBody(result.body, requestId));
        }
        if (suffix === '/comments' && req.method === 'POST') {
          const body = await readJsonBody(req);
          const result = await addComment(db, actor, ideaId, body || {}, idempotencyKey, requestId);
          return sendJson(res, result.status, successBody(result.body, requestId));
        }
        if (suffix === '/clarifications' && req.method === 'POST') {
          const body = await readJsonBody(req);
          const result = await answerClarification(db, actor, ideaId, body || {}, idempotencyKey, requestId);
          return sendJson(res, result.status, successBody(result.body, requestId));
        }
      }

      const rerouteMatch = /^\/api\/v1\/admin\/ideas\/([0-9a-f-]{36})\/reroute$/.exec(url.pathname);
      if (rerouteMatch && req.method === 'POST') {
        if (!actor) {
          const err = new Error('Требуется вход');
          err.code = 'UNAUTHENTICATED';
          throw err;
        }
        const body = await readJsonBody(req);
        const result = await rerouteIdea(db, actor, rerouteMatch[1], body || {}, idempotencyKey, requestId);
        return sendJson(res, result.status, successBody(result.body, requestId));
      }

      if (url.pathname === '/api/v1/staff/assignees' && req.method === 'GET') {
        const items = await listAssignees(db, actor, url.searchParams.get('organizationId'));
        return sendJson(res, 200, successBody(items, requestId));
      }
      if (url.pathname === '/api/v1/admin/organizations' && req.method === 'GET') {
        const items = await listOrganizations(db, actor);
        return sendJson(res, 200, successBody(items, requestId));
      }
      if (url.pathname === '/api/v1/notifications' && req.method === 'GET') {
        const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
        const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get('pageSize')) || 20));
        const { items, total } = await listNotifications(db, actor, {
          unreadOnly: url.searchParams.get('unreadOnly') === 'true', page, pageSize,
        });
        return sendJson(res, 200, listBody(items, page, pageSize, total, requestId));
      }
      const notifMatch = /^\/api\/v1\/notifications\/([0-9a-f-]{36})\/read$/.exec(url.pathname);
      if (notifMatch && req.method === 'POST') {
        await readNotification(db, actor, notifMatch[1]);
        res.writeHead(204);
        return res.end();
      }

      if (url.pathname === '/api/v1/ideas' && req.method === 'GET') {
        const scope = url.searchParams.get('scope');
        if (scope === 'mine') {
          if (actor.role !== 'CITIZEN') {
            const err = new Error('Нет доступа');
            err.code = 'FORBIDDEN';
            throw err;
          }
          const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
          const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get('pageSize')) || 20));
          const status = url.searchParams.get('status');
          const q = (url.searchParams.get('q') || '').slice(0, 100);
          const params = [actor.id];
          let where = 'author_id=$1';
          if (status) {
            params.push(status);
            where += ` AND status=$${params.length}`;
          }
          if (q) {
            params.push(`%${q}%`);
            where += ` AND (title ILIKE $${params.length} OR problem ILIKE $${params.length} OR solution ILIKE $${params.length} OR public_number ILIKE $${params.length})`;
          }
          const total = await db.query(`SELECT count(*)::int AS c FROM ideas WHERE ${where}`, params);
          const rows = await db.query(
            `SELECT id, public_number AS "publicNumber", title, status,
                    effective_category_code AS "effectiveCategoryCode",
                    submitted_at AS "submittedAt", created_at AS "createdAt",
                    updated_at AS "updatedAt", version
             FROM ideas WHERE ${where}
             ORDER BY updated_at DESC, id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
            [...params, pageSize, (page - 1) * pageSize]);
          return sendJson(res, 200, listBody(rows.rows, page, pageSize, total.rows[0].c, requestId));
        }
        if (scope === 'staff' || scope === 'admin') {
          requireStaff(actor);
          const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
          const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get('pageSize')) || 20));
          const { items, total } = await listStaffQueue(db, actor, {
            organizationId: url.searchParams.get('organizationId'),
            q: url.searchParams.get('q') || '',
            category: url.searchParams.get('category') || '',
            territory: url.searchParams.get('territory') || '',
            status: url.searchParams.get('status') || '',
            assignee: url.searchParams.get('assignee') || '',
            dateFrom: url.searchParams.get('dateFrom') || '',
            dateTo: url.searchParams.get('dateTo') || '',
            sort: url.searchParams.get('sort') || '',
            dir: url.searchParams.get('dir') || '',
            page, pageSize,
          });
          return sendJson(res, 200, listBody(items, page, pageSize, total, requestId));
        }
        const err = new Error('Нет доступа');
        err.code = 'FORBIDDEN';
        throw err;
      }

      const dlMatch = /^\/api\/v1\/attachments\/([0-9a-f-]{36})\/download$/.exec(url.pathname);
      if (dlMatch && req.method === 'GET') {
        const meta = await downloadAttachment(db, actor, dlMatch[1]);
        const filePath = path.join(config.uploadDir, meta.storageKey);
        if (!path.resolve(filePath).startsWith(path.resolve(config.uploadDir) + path.sep)) {
          const err = new Error('Не найдено');
          err.code = 'NOT_FOUND';
          throw err;
        }
        const size = (await stat(filePath)).size;
        res.writeHead(200, {
          'content-type': meta.mime,
          'content-length': size,
          'cache-control': 'private, no-store',
          'x-content-type-options': 'nosniff',
          ...(meta.mime === 'application/pdf'
            ? { 'content-disposition': 'attachment' } : {}),
        });
        return createReadStream(filePath).pipe(res);
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
