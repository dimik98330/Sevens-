// B-04 negative tests: session, CSRF and account guards (SEC rules).
// Real HTTP + PGlite. Every mutation must reject missing/foreign/stale
// CSRF material with 403 CSRF_INVALID; dead sessions and deactivated
// accounts must fail closed with 401 UNAUTHENTICATED.
//
// Regression note: an earlier revision of src/server/http/app.mjs left
// POST /api/v1/notifications/:id/read outside the session/CSRF guard, so it
// returned 204/503 where 403/401 belong. Fixed by extending the guard
// prefixes; the assertions below encode the CORRECT contract behavior.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../../../src/server/db/client.mjs';
import { migrate } from '../../../scripts/migrate.mjs';
import { seed } from '../../../scripts/seed.mjs';
import { createServer } from '../../../src/server/http/app.mjs';

const ORIGIN = 'http://localhost:3000';
const SEED_PASSWORD = 'test-Seed-12-chars';
const IDEA_TEXT = {
  title: 'Умные светофоры рядом со школой',
  problem: 'Возле школы дорога требует внимания к безопасности детей. Нужны датчики и понятная схема движения.',
  solution: 'Установить умные светофоры и датчики загруженности дороги, добавить приложение для уведомлений.',
};

let db;
let base;
let server;
let territoryId;
let citizenA;
let citizenB;
let staff;
let draftId;
let submittableId;
let submittableVersion;
let submittedId;
let submittedVersion;
let notifId;

function req(method, p, { cookie, csrf, body, key, query = '', origin = ORIGIN } = {}) {
  const headers = {};
  if (origin) headers.origin = origin;
  if (cookie) headers.cookie = cookie;
  if (csrf) headers['x-csrf-token'] = csrf;
  if (key) headers['idempotency-key'] = key;
  const opts = { method, headers };
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  return fetch(base + p + query, opts);
}

async function loginAs(email, password = SEED_PASSWORD) {
  const res = await req('POST', '/api/v1/auth/login', { body: { email, password } });
  assert.equal(res.status, 200, `login ${email}`);
  const json = await res.json();
  return { cookie: (res.headers.get('set-cookie') || '').split(';')[0], csrf: json.data.csrfToken, user: json.data.user };
}

async function registerCitizen(suffix) {
  const res = await req('POST', '/api/v1/auth/register', {
    body: {
      displayName: `Негатив ${suffix}`, email: `b04neg-${suffix}@example.test`,
      password: 'correct-horse-12 symbols', consentAccepted: true,
    },
  });
  assert.equal(res.status, 201);
  const json = await res.json();
  return { cookie: (res.headers.get('set-cookie') || '').split(';')[0], csrf: json.data.csrfToken };
}

// Every guarded write endpoint in scope. CSRF/Origin checks run before any
// body validation, so these bodies only need to be plausible, not perfect.
function guardedWrites() {
  return [
    {
      label: 'POST /api/v1/ideas', method: 'POST', path: '/api/v1/ideas', role: 'citizen',
      body: { ...IDEA_TEXT, territoryId, requestedCategoryCode: null },
    },
    {
      label: 'PATCH /api/v1/ideas/:id', method: 'PATCH', path: `/api/v1/ideas/${draftId}`, role: 'citizen',
      body: { title: 'Отредактированный заголовок для негативного теста' },
    },
    {
      label: 'POST /api/v1/ideas/:id/submit', method: 'POST', path: `/api/v1/ideas/${submittableId}/submit`, role: 'citizen',
      body: { expectedVersion: submittableVersion, consentAccepted: true },
    },
    {
      label: 'POST /api/v1/ideas/:id/assignment', method: 'POST', path: `/api/v1/ideas/${submittedId}/assignment`, role: 'staff',
      body: { assigneeId: staff.user.id, expectedVersion: submittedVersion },
    },
    {
      label: 'POST /api/v1/ideas/:id/status', method: 'POST', path: `/api/v1/ideas/${submittedId}/status`, role: 'staff',
      body: { toStatus: 'UNDER_REVIEW', takeOwnership: true, expectedVersion: submittedVersion },
    },
    {
      label: 'POST /api/v1/ideas/:id/comments', method: 'POST', path: `/api/v1/ideas/${submittedId}/comments`, role: 'staff',
      body: { visibility: 'PUBLIC', body: 'Публичный комментарий для негативного теста.', expectedVersion: submittedVersion },
    },
    {
      label: 'POST /api/v1/ideas/:id/clarifications', method: 'POST', path: `/api/v1/ideas/${submittedId}/clarifications`, role: 'citizen',
      body: { expectedVersion: submittedVersion, body: 'Ответ автора для негативного теста.' },
    },
    {
      label: 'POST /api/v1/auth/logout', method: 'POST', path: '/api/v1/auth/logout', role: 'citizen', body: {},
    },
  ];
}

function authFor(role) {
  return role === 'staff' ? staff : citizenA;
}

async function expectGuardCode(res, label, status, code) {
  assert.equal(res.status, status, `${label} status`);
  const json = await res.json();
  assert.equal(json.error.code, code, `${label} error code`);
}

before(async () => {
  db = await openDatabase();
  await migrate(db);
  await seed(db, { demoPassword: SEED_PASSWORD });
  territoryId = (await db.query(`SELECT id FROM territories WHERE code='DEMO_SEMEY'`)).rows[0].id;
  server = createServer(db);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  citizenA = await registerCitizen('a');
  citizenB = await registerCitizen('b');
  staff = await loginAs('transport@example.test');

  const d1 = await req('POST', '/api/v1/ideas', {
    ...citizenA, key: randomUUID(),
    body: { ...IDEA_TEXT, territoryId, requestedCategoryCode: null },
  });
  assert.equal(d1.status, 201);
  draftId = (await d1.json()).data.id;

  const d2 = await req('POST', '/api/v1/ideas', {
    ...citizenA, key: randomUUID(),
    body: { ...IDEA_TEXT, territoryId, requestedCategoryCode: null },
  });
  assert.equal(d2.status, 201);
  const d2json = (await d2.json()).data;
  submittableId = d2json.id;
  submittableVersion = d2json.version;

  const d3 = await req('POST', '/api/v1/ideas', {
    ...citizenA, key: randomUUID(),
    body: { ...IDEA_TEXT, territoryId, requestedCategoryCode: null },
  });
  assert.equal(d3.status, 201);
  const d3json = (await d3.json()).data;
  const sub = await req('POST', `/api/v1/ideas/${d3json.id}/submit`, {
    ...citizenA, key: randomUUID(),
    body: { expectedVersion: d3json.version, consentAccepted: true },
  });
  assert.equal(sub.status, 200);
  const submitted = (await sub.json()).data;
  submittedId = submitted.id;
  submittedVersion = submitted.version;

  const notifs = await req('GET', '/api/v1/notifications', { ...citizenA, query: '?unreadOnly=true' });
  assert.equal(notifs.status, 200);
  notifId = (await notifs.json()).data[0].id;
});

after(async () => {
  server.close();
  await db.close();
});

describe('B-04 session negative', () => {
  it('(1) write endpoints without Origin header -> 403 CSRF_INVALID', async () => {
    // Positive control: the same call WITH Origin succeeds.
    const control = await req('POST', '/api/v1/ideas', {
      ...citizenA, key: randomUUID(),
      body: { ...IDEA_TEXT, territoryId, requestedCategoryCode: null },
    });
    assert.equal(control.status, 201, 'control call with Origin must succeed');
    await control.json();

    for (const t of guardedWrites()) {
      const auth = authFor(t.role);
      const res = await req(t.method, t.path, {
        cookie: auth.cookie, csrf: auth.csrf, body: t.body, key: randomUUID(), origin: null,
      });
      await expectGuardCode(res, `${t.label} without Origin`, 403, 'CSRF_INVALID');
    }

    // Read is idempotent, so reusing notifId across tests is safe.
    const notif = await req('POST', `/api/v1/notifications/${notifId}/read`, {
      cookie: citizenA.cookie, csrf: citizenA.csrf, body: {}, key: randomUUID(), origin: null,
    });
    await expectGuardCode(notif, 'notifications/read without Origin', 403, 'CSRF_INVALID');
  });

  it('(2) write endpoints with wrong X-CSRF-Token -> 403 CSRF_INVALID', async () => {
    for (const t of guardedWrites()) {
      const auth = authFor(t.role);
      const res = await req(t.method, t.path, {
        cookie: auth.cookie, csrf: 'wrong-csrf-token-value', body: t.body, key: randomUUID(),
      });
      await expectGuardCode(res, `${t.label} with wrong CSRF`, 403, 'CSRF_INVALID');
    }

    const notif = await req('POST', `/api/v1/notifications/${notifId}/read`, {
      cookie: citizenA.cookie, csrf: 'wrong-csrf-token-value', body: {}, key: randomUUID(),
    });
    await expectGuardCode(notif, 'notifications/read with wrong CSRF', 403, 'CSRF_INVALID');
  });

  it('(3) cross-user CSRF (A cookie + B token) -> 403 CSRF_INVALID', async () => {
    for (const t of guardedWrites()) {
      const auth = authFor(t.role);
      const res = await req(t.method, t.path, {
        cookie: auth.cookie, csrf: citizenB.csrf, body: t.body, key: randomUUID(),
      });
      await expectGuardCode(res, `${t.label} with cross-user CSRF`, 403, 'CSRF_INVALID');
    }

    const notif = await req('POST', `/api/v1/notifications/${notifId}/read`, {
      cookie: citizenA.cookie, csrf: citizenB.csrf, body: {}, key: randomUUID(),
    });
    await expectGuardCode(notif, 'notifications/read with cross-user CSRF', 403, 'CSRF_INVALID');
  });

  it('(4) stale CSRF after GET /me rotation is rejected on next mutation', async () => {
    const oldCsrf = citizenA.csrf;
    const me = await req('GET', '/api/v1/auth/me', { cookie: citizenA.cookie });
    assert.equal(me.status, 200);
    const freshCsrf = (await me.json()).data.csrfToken;
    assert.notEqual(freshCsrf, oldCsrf, 'rotation must issue a new token');

    const stale = await req('POST', '/api/v1/ideas', {
      cookie: citizenA.cookie, csrf: oldCsrf, key: randomUUID(),
      body: { ...IDEA_TEXT, territoryId, requestedCategoryCode: null },
    });
    await expectGuardCode(stale, 'POST /ideas with stale CSRF', 403, 'CSRF_INVALID');

    // The rotated token works: session itself is still valid, so the 403
    // above can only come from the rotation.
    const fresh = await req('POST', '/api/v1/ideas', {
      cookie: citizenA.cookie, csrf: freshCsrf, key: randomUUID(),
      body: { ...IDEA_TEXT, territoryId, requestedCategoryCode: null },
    });
    assert.equal(fresh.status, 201, 'fresh CSRF after rotation must succeed');
    await fresh.json();
    citizenA.csrf = freshCsrf;
  });

  it('(5) tampered/garbage sid cookie -> 401 UNAUTHENTICATED', async () => {
    for (const t of guardedWrites()) {
      const auth = authFor(t.role);
      const res = await req(t.method, t.path, {
        cookie: 'sid=not-a-real-session-token', csrf: auth.csrf, body: t.body, key: randomUUID(),
      });
      await expectGuardCode(res, `${t.label} with garbage sid`, 401, 'UNAUTHENTICATED');
    }

    // A real token with the last byte flipped must also fail closed.
    const real = citizenA.cookie.slice('sid='.length);
    const tampered = real.slice(0, -1) + (real.endsWith('A') ? 'B' : 'A');
    const res = await req('POST', '/api/v1/ideas', {
      cookie: `sid=${tampered}`, csrf: citizenA.csrf, key: randomUUID(),
      body: { ...IDEA_TEXT, territoryId, requestedCategoryCode: null },
    });
    await expectGuardCode(res, 'POST /ideas with tampered sid', 401, 'UNAUTHENTICATED');

    const notif = await req('POST', `/api/v1/notifications/${notifId}/read`, {
      cookie: 'sid=not-a-real-session-token', csrf: 'x', body: {}, key: randomUUID(),
    });
    await expectGuardCode(notif, 'notifications/read with garbage sid', 401, 'UNAUTHENTICATED');
  });

  it('(6) staff session revoked via logout mid-flow -> subsequent call 401', async () => {
    const staff2 = await loginAs('transport@example.test');
    const out = await req('POST', '/api/v1/auth/logout', { ...staff2, body: {} });
    assert.equal(out.status, 204, 'logout of a valid session must succeed');

    const write = await req('POST', `/api/v1/ideas/${submittedId}/status`, {
      cookie: staff2.cookie, csrf: staff2.csrf, key: randomUUID(),
      body: { toStatus: 'UNDER_REVIEW', takeOwnership: true, expectedVersion: submittedVersion },
    });
    await expectGuardCode(write, 'staff write after logout', 401, 'UNAUTHENTICATED');

    const queue = await req('GET', '/api/v1/ideas', { cookie: staff2.cookie, query: '?scope=staff' });
    await expectGuardCode(queue, 'staff queue after logout', 401, 'UNAUTHENTICATED');
  });

  it('(7) deactivated citizen calling a write endpoint -> 401', async () => {
    const citizenC = await registerCitizen('c');
    const me = await req('GET', '/api/v1/auth/me', { cookie: citizenC.cookie });
    assert.equal(me.status, 200, 'fresh citizen session must be valid before deactivation');

    const row = await db.query(
      `SELECT id FROM users WHERE email_normalized='b04neg-c@example.test'`);
    await db.query('UPDATE users SET active=FALSE WHERE id=$1', [row.rows[0].id]);
    try {
      const res = await req('POST', '/api/v1/ideas', {
        ...citizenC, key: randomUUID(),
        body: { ...IDEA_TEXT, territoryId, requestedCategoryCode: null },
      });
      await expectGuardCode(res, 'deactivated citizen write', 401, 'UNAUTHENTICATED');
    } finally {
      await db.query('UPDATE users SET active=TRUE WHERE id=$1', [row.rows[0].id]);
    }
  });
});
