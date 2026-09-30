// Minimal HTTP application (B-owned routes). Plain node:http so the same
// handlers can later mount into Next.js route handlers. Contract envelopes
// follow 03 section 5; no SQL or stack traces leak to clients.
import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { tmpdir } from 'node:os';
import { readdirSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { access, mkdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { registerCitizen, login, logout } from '../auth/service.mjs';
import {
  getSession, verifyCsrf, parseCookies, sessionCookie, clearedSessionCookie,
  SESSION_COOKIE, csrfTokenForSession,
} from '../auth/session.mjs';
import { loginLimiter, registerLimiter, demoLoginLimiter } from '../auth/rateLimit.mjs';
import { demoLogin, demoLoginEnabled } from '../auth/demo.mjs';
import { ERROR_CODES, errorBody, successBody, listBody } from '../../contracts/errors.mjs';
import { RULE_VERSION, CONSENT_VERSION } from '../../contracts/enums.mjs';
import { createDraft, updateDraft, submitIdea } from '../ideas/service.mjs';
import {
  uploadAttachment, deleteAttachment, downloadAttachment, readMultipart, cleanupMultipart,
  resolveAttachmentStorage,
} from '../attachments/store.mjs';
import { loadIdeaForActor, requireStaff } from '../policies/scopes.mjs';
import {
  assignIdea, changeStatus, addComment, rerouteIdea, answerClarification,
  listStaffQueue, listAssignees, listOrganizations,
  listNotifications, readNotification, analyticsSummary,
} from '../workflow/service.mjs';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { parseWrite } from '../../contracts/requests.mjs';
import { parseListQuery, queryUuid } from './query.mjs';
import { routingPreview } from '../routing/preview.mjs';
import { createAssistantService } from '../assistant/service.mjs';
import { parseAssistantRequest } from '../assistant/validation.mjs';
import { activeClassifierVersion } from '../routing/adapter.mjs';
import { createSemanticClassifier } from '../routing/semantic.mjs';
import { admitClassificationCall } from '../routing/budget.mjs';
import {
  listShowcase, getShowcaseIdea, setShowcaseReaction, getPublication,
  requestPublication, withdrawPublication, reviewPublication, publishReply,
} from '../showcase/service.mjs';

const REQUIRED_MIGRATIONS = readdirSync(new URL('../../../db/migrations/', import.meta.url))
  .filter((name) => name.endsWith('.sql')).sort();

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
    locationGeometry: idea.location_geometry ?? null,
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
            rule_version AS "ruleVersion", created_at AS "createdAt",
            analysis_json->>'detectedCategoryCode' AS "detectedCategoryCode",
            analysis_json->>'catalogVersion' AS "catalogVersion",
            analysis_json->>'classificationSource' AS "classificationSource",
            analysis_json->>'classifierStatus' AS "classifierStatus",
            analysis_json->>'classificationMethod' AS "classificationMethod"
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
  const attachmentStorage = resolveAttachmentStorage();
  return {
    origin,
    secureCookies: origin.startsWith('https://'),
    attachmentStorage,
    uploadDir: process.env.UPLOAD_DIR || (attachmentStorage === 'database'
      ? path.join(tmpdir(), 'sevens-uploads') : './storage/uploads'),
    proxySecret: process.env.API_PROXY_SECRET || '',
    demoLoginEnabled: demoLoginEnabled(),
    logRequests: process.env.APP_ENV !== 'test' && process.env.LOG_LEVEL !== 'silent',
  };
}

function sendJson(res, status, payload, privateCache = true) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    ...(payload.meta?.requestId ? { 'x-request-id': payload.meta.requestId } : {}),
    ...(privateCache ? { 'cache-control': 'private, no-store' } : {}),
  });
  res.end(body);
}

function sendError(res, err, requestId) {
  if (res.headersSent) { res.destroy(); return; }
  // SQL guard violations that can surface through normal API use are mapped
  // to contract codes; anything else stays a 503 without details.
  if (err && /ATTACHMENT_LIMIT_REACHED/.test(err.message || '')) {
    return sendJson(res, 400, errorBody('VALIDATION_ERROR',
      'Максимум 3 активных файла', { file: 'Максимум 3 активных файла' }, requestId));
  }
  const code = err.code && ERROR_CODES[err.code] ? err.code : 'SERVICE_UNAVAILABLE';
  const status = ERROR_CODES[code] || 503;
  const message = status === 503 ? 'Сервис временно недоступен' : err.message;
  if (status === 429) res.setHeader('Retry-After', String(err.retryAfterSeconds || err.retryAfter || 60));
  res.apiErrorCode = code;
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
        err.code = 'FILE_TOO_LARGE';
        reject(err);
        // Drain without buffering so the contract response can reach the client.
        chunks.length = 0;
        return;
      }
      if (size <= BODY_LIMIT) chunks.push(chunk);
    });
    req.on('end', () => {
      if (size > BODY_LIMIT) return;
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
    req.on('aborted', () => {
      const error = new Error('Запрос прерван'); error.code = 'VALIDATION_ERROR'; reject(error);
    });
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

function clientIp(req, config) {
  const presented = String(req.headers['x-abai-proxy-key'] || '');
  const expected = String(config.proxySecret || '');
  const forwarded = req.headers['x-abai-client-ip'];
  const a = Buffer.from(presented), b = Buffer.from(expected);
  if (b.length >= 32 && a.length === b.length && timingSafeEqual(a, b)
      && typeof forwarded === 'string' && isIP(forwarded)) return forwarded;
  return req.socket?.remoteAddress || 'unknown';
}

function rateLimited(retryAfter) {
  const error = new Error('Слишком много попыток');
  error.code = 'RATE_LIMITED'; error.retryAfter = retryAfter; return error;
}

async function readWrite(req, schema) {
  const body = await readJsonBody(req);
  parseWrite(schema, body);
  return body === undefined ? {} : body;
}

async function currentSession(db, req) {
  const cookies = parseCookies(req.headers.cookie);
  return getSession(db, cookies[SESSION_COOKIE]);
}

export function createHandler(db, config = appConfig()) {
  const attachmentStorage = resolveAttachmentStorage(config.attachmentStorage);
  const assistantReply = createAssistantService(config.assistant);
  const classifier=config.classifier??createSemanticClassifier({
    admit:(context)=>admitClassificationCall(db,context),
  });
  return async (req, res) => {
    const requestId = 'req_' + randomBytes(8).toString('hex');
    const url = new URL(req.url || '/', 'http://localhost');
    const started = performance.now();
    if (config.logRequests) res.once('finish', () => {
      const route = /^\/api\/(v1\/(auth|ideas|staff|admin|notifications|attachments|analytics|assistant)|health)/.test(url.pathname)
        ? url.pathname.replace(/[0-9a-f-]{36}/gi, ':id').slice(0, 150) : 'unmatched';
      console.log(JSON.stringify({ requestId, method: req.method, route,
        status: res.statusCode, durationMs: Math.round(performance.now() - started),
        ...(res.apiErrorCode ? { errorCode: res.apiErrorCode } : {}) }));
    });
    try {
      // Public health endpoints.
      if (req.method === 'GET' && url.pathname === '/api/health/live') {
        return sendJson(res, 200, successBody({ status: 'ok' }, requestId), false);
      }
      if (req.method === 'GET' && url.pathname === '/api/health/ready') {
        try {
          await db.query('SELECT 1');
          const schema = await db.query('SELECT version FROM schema_migrations');
          const applied = new Set(schema.rows.map((row) => row.version));
          if (REQUIRED_MIGRATIONS.some((name) => !applied.has(name))) throw new Error('Schema migration missing');
          if (attachmentStorage === 'database') await db.query('SELECT 1 FROM attachment_blobs LIMIT 0');
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
          ruleVersion: activeClassifierVersion(),
          catalogVersion: RULE_VERSION,
          consentVersion: CONSENT_VERSION,
        }, requestId), false);
      }

      // Auth endpoints.
      if(url.pathname==='/api/v1/auth/demo'&&req.method==='GET'){
        return sendJson(res,200,successBody({enabled:config.demoLoginEnabled===true},requestId));
      }
      if(url.pathname==='/api/v1/auth/demo'&&req.method==='POST'){
        if(config.demoLoginEnabled!==true){const error=new Error('Нет доступа');error.code='NOT_FOUND';throw error;}
        checkOrigin(req,config);
        const previousSession=await currentSession(db,req);
        if(previousSession&&!verifyCsrf(previousSession,req.headers['x-csrf-token'])){
          const error=new Error('Недопустимый CSRF-токен');error.code='CSRF_INVALID';throw error;
        }
        const retry=demoLoginLimiter.check(`demo:${clientIp(req,config)}`,60,900);
        if(retry)throw rateLimited(retry);
        const body=await readWrite(req,'demoLogin');
        const {user,session}=await demoLogin(db,body.role,{enabled:true,previousSession});
        res.setHeader('Set-Cookie',sessionCookie(session.token,{secure:config.secureCookies,maxAgeSeconds:12*3600}));
        return sendJson(res,200,successBody({user:{id:user.id,displayName:user.display_name,
          role:user.role,organizationId:user.organization_id},csrfToken:session.csrfToken},requestId));
      }
      if (url.pathname === '/api/v1/auth/register' && req.method === 'POST') {
        checkOrigin(req, config);
        const ip = clientIp(req, config);
        const retryAfter = registerLimiter.check(`register:${ip}`, 20, 3600);
        if (retryAfter) {
          throw rateLimited(retryAfter);
        }
        const body = await readWrite(req, 'register');
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
        const body = await readWrite(req, 'login');
        const emailKey = String(body?.email || '').normalize('NFC').trim().toLowerCase();
        const failKey = `login-fail:${clientIp(req, config)}:${emailKey}`;
        const blocked = loginLimiter.retryAfter(failKey, 5, 900);
        if (blocked) throw rateLimited(blocked);
        try {
          const { user, session } = await login(db, body || {});
          loginLimiter.clear(failKey);
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
            loginLimiter.fail(failKey, 900);
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
        await readWrite(req, 'empty');
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
        const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
        const csrfToken = csrfTokenForSession(token);
        return sendJson(res, 200, successBody({
          id: session.uid,
          displayName: session.display_name,
          role: session.role,
          organizationId: session.organization_id,
          csrfToken,
        }, requestId));
      }
      // Public guidance uses the same Origin/session protections as the site.
      // Its role comes only from the session; client context cannot grant rights.
      if (url.pathname === '/api/v1/assistant/chat' && req.method === 'POST') {
        checkOrigin(req, config);
        const session = await currentSession(db, req);
        if (session && !verifyCsrf(session, req.headers['x-csrf-token'])) {
          const error = new Error('Недопустимый CSRF-токен');
          error.code = 'CSRF_INVALID';
          throw error;
        }
        const body = parseAssistantRequest(await readJsonBody(req));
        if (req.aborted || res.destroyed) return;
        const role = session?.role || 'GUEST';
        const controller = new AbortController();
        const cancel = () => { if (!res.writableEnded) controller.abort(); };
        req.once('aborted', cancel);
        res.once('close', cancel);
        try {
          const data = await assistantReply({
            request: body,
            role,
            identity: session ? `user:${session.uid}` : `guest:${clientIp(req, config)}`,
            authenticated: Boolean(session),
            signal: controller.signal,
          });
          if (!res.destroyed) {
            const response = successBody(data, requestId);
            response.meta.assistantRole = role;
            return sendJson(res, 200, response);
          }
          return;
        } finally {
          req.removeListener('aborted', cancel);
          res.removeListener('close', cancel);
        }
      }
      // Authenticated idea routes.
      const actor = await currentSession(db, req).then((s) => {
        if (!s) return null;
        return {
          id: s.uid, role: s.role,
          organizationId: s.organization_id, regionId: s.region_id,
        };
      });
      // Every /api/v1 route except register/login/catalogs/assistant (handled above)
      // requires a session; every mutation under it requires Origin+CSRF.
      // login/register enforce Origin inline (no session exists yet).
      const publicShowcaseRead = req.method === 'GET' && (url.pathname === '/api/v1/showcase'
        || /^\/api\/v1\/showcase\/[^/]+$/.test(url.pathname));
      const needAuth = url.pathname.startsWith('/api/v1/') && !publicShowcaseRead;
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

      if (url.pathname === '/api/v1/showcase' && req.method === 'GET') {
        const result = await listShowcase(db, actor, url.searchParams);
        return sendJson(res, 200, { data: result.items, meta: { requestId, page: result.page,
          pageSize: result.pageSize, total: result.total, totalPages: result.totalPages, summary: result.summary } });
      }
      const showcaseMatch = /^\/api\/v1\/showcase\/([^/]+)(?:\/(support|follow))?$/.exec(url.pathname);
      if (showcaseMatch) {
        const ideaId = queryUuid(showcaseMatch[1], 'ideaId');
        if (!showcaseMatch[2] && req.method === 'GET') {
          return sendJson(res, 200, successBody(await getShowcaseIdea(db, actor, ideaId), requestId));
        }
        if (showcaseMatch[2] && ['PUT', 'DELETE'].includes(req.method)) {
          await readWrite(req, 'empty');
          const result = await setShowcaseReaction(db, actor, ideaId, showcaseMatch[2], req.method === 'PUT');
          return sendJson(res, 200, successBody(result, requestId));
        }
      }
      const publicationMatch = /^\/api\/v1\/ideas\/([^/]+)\/publication(?:\/(review|replies))?$/.exec(url.pathname);
      if (publicationMatch) {
        const ideaId = queryUuid(publicationMatch[1], 'ideaId');
        const action = publicationMatch[2];
        let result;
        if (!action && req.method === 'GET') result = await getPublication(db, actor, ideaId);
        else if (!action && req.method === 'PUT') result = await requestPublication(db, actor, ideaId, await readJsonBody(req), requestId);
        else if (!action && req.method === 'DELETE') result = await withdrawPublication(db, actor, ideaId, await readJsonBody(req), requestId);
        else if (action === 'review' && req.method === 'POST') result = await reviewPublication(db, actor, ideaId, await readJsonBody(req), requestId);
        else if (action === 'replies' && req.method === 'POST') result = await publishReply(db, actor, ideaId, await readJsonBody(req), requestId);
        if (result) return sendJson(res, 200, successBody(result, requestId));
      }

      if (url.pathname === '/api/v1/ideas/routing-preview' && req.method === 'POST') {
        const decision = await routingPreview(db, actor, await readWrite(req, 'preview'),classifier);
        return sendJson(res, 200, { data: decision, meta: { requestId, preview: true } });
      }
      if (url.pathname === '/api/v1/analytics/summary' && req.method === 'GET') {
        requireStaff(actor);
        const summary = await analyticsSummary(db, actor, parseListQuery(url.searchParams));
        return sendJson(res, 200, successBody(summary, requestId));
      }

      if (url.pathname === '/api/v1/ideas' && req.method === 'POST') {
        if (actor.role !== 'CITIZEN') {
          const err = new Error('Нет доступа');
          err.code = 'FORBIDDEN';
          throw err;
        }
        const body = await readWrite(req, 'draft');
        const result = await createDraft(db, actor, body || {}, idempotencyKey, requestId);
        return sendJson(res, result.status, successBody(result.body, requestId));
      }

      const ideaMatch = /^\/api\/v1\/ideas\/([^/]+)(\/.*)?$/.exec(url.pathname);
      if (ideaMatch) {
        const ideaId = queryUuid(ideaMatch[1], 'ideaId');
        const suffix = ideaMatch[2] || '';
        if (suffix === '' && req.method === 'PATCH') {
          const body = await readWrite(req, 'patch');
          const result = await updateDraft(db, actor, ideaId, body || {}, requestId);
          return sendJson(res, result.status, successBody(result.body, requestId));
        }
        if (suffix === '/submit' && req.method === 'POST') {
          const body = await readWrite(req, 'submit');
          const result = await submitIdea(db, actor, ideaId, body || {}, idempotencyKey, requestId,classifier);
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
                      THEN c.author_id ELSE NULL END AS "authorId",
                    CASE WHEN $2 OR (e.visibility = 'PUBLIC' AND c.visibility = 'PUBLIC')
                      THEN author.display_name ELSE NULL END AS "authorDisplayName",
                    CASE WHEN NOT ($2 OR (e.visibility = 'PUBLIC' AND c.visibility = 'PUBLIC'))
                           OR author.id IS NULL THEN NULL
                         WHEN c.kind = 'CLARIFICATION_ANSWER' THEN 'CITIZEN'
                         WHEN author.role IN ('CITIZEN', 'STAFF', 'ADMIN') THEN author.role
                         ELSE NULL END AS "authorRole",
                    CASE WHEN $2 OR (e.visibility = 'PUBLIC' AND c.visibility = 'PUBLIC')
                      THEN c.kind ELSE NULL END AS "commentKind",
                    CASE WHEN $2 OR (e.visibility = 'PUBLIC' AND c.visibility = 'PUBLIC')
                      THEN c.visibility ELSE NULL END AS "commentVisibility",
                    CASE WHEN $2 OR (e.visibility = 'PUBLIC' AND c.visibility = 'PUBLIC')
                      THEN c.body ELSE NULL END AS body
             FROM idea_events e LEFT JOIN comments c ON c.id = e.comment_id
             LEFT JOIN users author ON author.id = c.author_id
             WHERE e.idea_id = $1
             ${staffView ? '' : `AND e.visibility='PUBLIC'`}
             ORDER BY e.created_at, e.id`,
            [idea.id, staffView]);
          return sendJson(res, 200, successBody(events.rows, requestId));
        }
        if (suffix === '/attachments' && req.method === 'POST') {
          const parts = await readMultipart(req, { uploadDir: config.uploadDir });
          try {
          const file = parts.find((p) => p.name === 'file');
          const versionPart = parts.find((p) => p.name === 'expectedVersion');
          const expectedVersion = Number((versionPart?.content || '').toString());
          if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
            const err = new Error('Требуется expectedVersion');
            err.code = 'VALIDATION_ERROR';
            err.fields = { expectedVersion: 'Обновите карточку и повторите' };
            throw err;
          }
          const result = await uploadAttachment(db, actor, ideaId, file,
            expectedVersion, idempotencyKey, requestId, config.uploadDir, attachmentStorage);
          return sendJson(res, result.status, successBody(result.body, requestId));
          } finally { await cleanupMultipart(parts, config.uploadDir); }
        }
        const delMatch = /^\/attachments\/([0-9a-f-]{36})$/.exec(suffix);
        if (delMatch && req.method === 'DELETE') {
          const body = await readWrite(req, 'deleteAttachment');
          const result = await deleteAttachment(db, actor, ideaId, delMatch[1],
            body?.expectedVersion, idempotencyKey, requestId, config.uploadDir);
          return sendJson(res, result.status, successBody(result.body, requestId));
        }
        if (suffix === '/assignment' && req.method === 'POST') {
          const body = await readWrite(req, 'assignment');
          const result = await assignIdea(db, actor, ideaId, body || {}, idempotencyKey, requestId);
          return sendJson(res, result.status, successBody(result.body, requestId));
        }
        if (suffix === '/status' && req.method === 'POST') {
          const body = await readWrite(req, 'status');
          const result = await changeStatus(db, actor, ideaId, body || {}, idempotencyKey, requestId);
          return sendJson(res, result.status, successBody(result.body, requestId));
        }
        if (suffix === '/comments' && req.method === 'POST') {
          const body = await readWrite(req, 'comment');
          const result = await addComment(db, actor, ideaId, body || {}, idempotencyKey, requestId);
          return sendJson(res, result.status, successBody(result.body, requestId));
        }
        if (suffix === '/clarifications' && req.method === 'POST') {
          const body = await readWrite(req, 'clarification');
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
        const body = await readWrite(req, 'reroute');
        const result = await rerouteIdea(db, actor, rerouteMatch[1], body || {}, idempotencyKey, requestId);
        return sendJson(res, result.status, successBody(result.body, requestId));
      }

      if (url.pathname === '/api/v1/staff/assignees' && req.method === 'GET') {
        const organizationId = queryUuid(url.searchParams.get('organizationId'), 'organizationId');
        const items = await listAssignees(db, actor, organizationId);
        return sendJson(res, 200, successBody(items, requestId));
      }
      if (url.pathname === '/api/v1/admin/organizations' && req.method === 'GET') {
        const items = await listOrganizations(db, actor);
        return sendJson(res, 200, successBody(items, requestId));
      }
      if (url.pathname === '/api/v1/notifications' && req.method === 'GET') {
        const query = parseListQuery(url.searchParams);
        const { items, total, unreadCount } = await listNotifications(db, actor, query);
        const response = listBody(items, query.page, query.pageSize, total, requestId);
        response.meta.unreadCount = unreadCount;
        return sendJson(res, 200, response);
      }
      const notifMatch = /^\/api\/v1\/notifications\/([0-9a-f-]{36})\/read$/.exec(url.pathname);
      if (notifMatch && req.method === 'POST') {
        await readWrite(req, 'empty');
        await readNotification(db, actor, notifMatch[1]);
        res.writeHead(204);
        return res.end();
      }

      if (url.pathname === '/api/v1/ideas' && req.method === 'GET') {
        const query = parseListQuery(url.searchParams);
        const scope = url.searchParams.get('scope');
        if (scope === 'mine') {
          if (actor.role !== 'CITIZEN') {
            const err = new Error('Нет доступа');
            err.code = 'FORBIDDEN';
            throw err;
          }
          const { page, pageSize, status, q } = query;
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
                    location_geometry AS "locationGeometry",
                    (SELECT t.name_ru FROM territories t WHERE t.id=ideas.territory_id) AS "territoryName",
                    (SELECT o.code FROM organizations o WHERE o.id=ideas.organization_id) AS "organizationCode",
                    (SELECT u.display_name FROM users u WHERE u.id=ideas.assignee_id) AS "assigneeDisplayName",
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
          const { page, pageSize } = query;
          const { items, total } = await listStaffQueue(db, actor, query);
          return sendJson(res, 200, listBody(items, page, pageSize, total, requestId));
        }
        const err = new Error('Нет доступа');
        err.code = 'FORBIDDEN';
        throw err;
      }

      const dlMatch = /^\/api\/v1\/attachments\/([0-9a-f-]{36})\/download$/.exec(url.pathname);
      if (dlMatch && req.method === 'GET') {
        const meta = await downloadAttachment(db, actor, dlMatch[1]);
        const filePath = meta.content ? null : path.join(config.uploadDir, meta.storageKey);
        if (filePath && !path.resolve(filePath).startsWith(path.resolve(config.uploadDir) + path.sep)) {
          const err = new Error('Не найдено');
          err.code = 'NOT_FOUND';
          throw err;
        }
        const size = meta.content ? meta.content.length : (await stat(filePath)).size;
        res.writeHead(200, {
          'content-type': meta.mime,
          'content-length': size,
          'cache-control': 'private, no-store',
          'x-content-type-options': 'nosniff',
          ...(meta.mime === 'application/pdf'
            ? { 'content-disposition': 'attachment' } : {}),
        });
        if (meta.content) return res.end(meta.content);
        try { await pipeline(createReadStream(filePath), res); }
        catch { if (!res.destroyed) res.destroy(); }
        return;
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
