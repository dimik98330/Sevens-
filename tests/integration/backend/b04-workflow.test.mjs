// B-04 tests: assignment, statuses, clarifications, reroute, notifications.
// Real HTTP + PGlite. Covers the E2E-01 spine plus INT-04/09/10 and SEC rules.
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
let transportOrgId;
let triageOrgId;

function req(method, p, { cookie, csrf, body, key, query = '' } = {}) {
  const headers = { origin: ORIGIN };
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
      displayName: `Автор ${suffix}`, email: `b04-${suffix}@example.test`,
      password: 'correct-horse-12 symbols', consentAccepted: true,
    },
  });
  assert.equal(res.status, 201);
  const json = await res.json();
  return { cookie: (res.headers.get('set-cookie') || '').split(';')[0], csrf: json.data.csrfToken };
}

async function submitFreshIdea(auth) {
  const created = await req('POST', '/api/v1/ideas', {
    ...auth, key: randomUUID(),
    body: { ...IDEA_TEXT, territoryId, requestedCategoryCode: null },
  });
  assert.equal(created.status, 201);
  const draft = (await created.json()).data;
  const sub = await req('POST', `/api/v1/ideas/${draft.id}/submit`, {
    ...auth, key: randomUUID(), body: { expectedVersion: draft.version, consentAccepted: true },
  });
  assert.equal(sub.status, 200);
  return (await sub.json()).data;
}

before(async () => {
  db = await openDatabase();
  await migrate(db);
  await seed(db, { demoPassword: SEED_PASSWORD });
  territoryId = (await db.query(`SELECT id FROM territories WHERE code='DEMO_SEMEY'`)).rows[0].id;
  transportOrgId = (await db.query(`SELECT id FROM organizations WHERE code='DEMO_TRANSPORT'`)).rows[0].id;
  triageOrgId = (await db.query(`SELECT id FROM organizations WHERE code='DEMO_TRIAGE'`)).rows[0].id;
  server = createServer(db);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.close();
  await db.close();
});

describe('B-04 full cycle (E2E-01 spine)', () => {
  it('submit -> queue -> takeOwnership -> progress -> complete with notifications', async () => {
    const author = await registerCitizen('cycle');
    const idea = await submitFreshIdea(author);
    const staff = await loginAs('transport@example.test');

    // Staff queue contains exactly this number.
    const queue = await req('GET', '/api/v1/ideas', { ...staff, query: '?scope=staff' });
    assert.equal(queue.status, 200);
    const queueJson = await queue.json();
    const numbers = queueJson.data.map((r) => r.publicNumber);
    assert.ok(numbers.includes(idea.publicNumber));
    assert.ok(!queueJson.data.find((r) => r.publicNumber === idea.publicNumber).triage);

    // Citizen is forbidden from the staff queue.
    const noQueue = await req('GET', '/api/v1/ideas', { ...author, query: '?scope=staff' });
    assert.equal(noQueue.status, 403);

    // «Взять на рассмотрение»: assign self + RECEIVED->UNDER_REVIEW atomically.
    const take = await req('POST', `/api/v1/ideas/${idea.id}/status`, {
      ...staff, key: randomUUID(),
      body: { toStatus: 'UNDER_REVIEW', takeOwnership: true, expectedVersion: idea.version },
    });
    assert.equal(take.status, 200);
    const taken = (await take.json()).data;
    assert.equal(taken.assigneeId, staff.user.id);

    // Race: second writer with the old version loses (INT-04).
    const race = await req('POST', `/api/v1/ideas/${idea.id}/status`, {
      ...staff, key: randomUUID(),
      body: { toStatus: 'IN_PROGRESS', publicComment: 'Принято в работу, готовим план действий.', expectedVersion: idea.version },
    });
    assert.equal(race.status, 409);

    const prog = await req('POST', `/api/v1/ideas/${idea.id}/status`, {
      ...staff, key: randomUUID(),
      body: { toStatus: 'IN_PROGRESS', publicComment: 'Принято в работу, готовим план действий.', expectedVersion: taken.version },
    });
    assert.equal(prog.status, 200);
    const progressed = (await prog.json()).data;

    // Author sees status, comment and notifications.
    const detail = await req('GET', `/api/v1/ideas/${idea.id}`, author);
    assert.equal((await detail.json()).data.status, 'IN_PROGRESS');
    const notifs = await req('GET', '/api/v1/notifications', { ...author, query: '?unreadOnly=true' });
    const notifsJson = await notifs.json();
    const kinds = notifsJson.data.map((n) => n.kind);
    assert.ok(kinds.includes('IDEA_REGISTERED'));
    assert.ok(kinds.includes('STATUS_CHANGED'));
    const firstNotif = notifsJson.data[0];
    const read = await req('POST', `/api/v1/notifications/${firstNotif.id}/read`, {
      cookie: author.cookie, csrf: author.csrf, key: randomUUID(), body: {},
    });
    assert.equal(read.status, 204);
    const reread = await req('POST', `/api/v1/notifications/${firstNotif.id}/read`, {
      cookie: author.cookie, csrf: author.csrf, key: randomUUID(), body: {},
    });
    assert.equal(reread.status, 204);

    // Complete with result type; terminal state is frozen.
    const done = await req('POST', `/api/v1/ideas/${idea.id}/status`, {
      ...staff, key: randomUUID(),
      body: {
        toStatus: 'COMPLETED', resolutionType: 'ANSWER_PROVIDED',
        publicComment: 'Ответ опубликован: светофоры включены в план работ следующего квартала.',
        expectedVersion: progressed.version,
      },
    });
    assert.equal(done.status, 200);
    const after = await req('POST', `/api/v1/ideas/${idea.id}/status`, {
      ...staff, key: randomUUID(),
      body: { toStatus: 'IN_PROGRESS', publicComment: 'Переоткрыть попыткой.', expectedVersion: (await done.json()).data.version },
    });
    assert.equal(after.status, 409);
  });

  it('reject/clarify require public text; author reply returns UNDER_REVIEW', async () => {
    const author = await registerCitizen('clarify');
    const idea = await submitFreshIdea(author);
    const staff = await loginAs('transport@example.test');

    // Assign first (UNDER_REVIEW requires an assignee), then ask.
    const take = await req('POST', `/api/v1/ideas/${idea.id}/status`, {
      ...staff, key: randomUUID(),
      body: { toStatus: 'UNDER_REVIEW', takeOwnership: true, expectedVersion: idea.version },
    });
    const v0 = (await take.json()).data.version;

    // REJECTED without a public reason is refused (FR-08).
    const noReason = await req('POST', `/api/v1/ideas/${idea.id}/status`, {
      ...staff, key: randomUUID(),
      body: { toStatus: 'REJECTED', expectedVersion: v0 },
    });
    assert.equal(noReason.status, 400);
    const v1 = v0;
    const ask = await req('POST', `/api/v1/ideas/${idea.id}/status`, {
      ...staff, key: randomUUID(),
      body: {
        toStatus: 'NEEDS_INFO',
        publicComment: 'Уточните, пожалуйста, конкретный перекрёсток и часы пик.',
        expectedVersion: v1,
      },
    });
    assert.equal(ask.status, 200);
    const v2 = (await ask.json()).data.version;

    // INTERNAL note stays hidden from the author timeline (SEC-05).
    const note = await req('POST', `/api/v1/ideas/${idea.id}/comments`, {
      ...staff, key: randomUUID(),
      body: { visibility: 'INTERNAL', body: 'Внутренняя пометка для коллег.', expectedVersion: v2 },
    });
    assert.equal(note.status, 201);
    const timeline = await req('GET', `/api/v1/ideas/${idea.id}/timeline`, author);
    const types = (await timeline.json()).data.map((e) => e.type);
    assert.ok(!types.includes('COMMENT_INTERNAL'));
    assert.ok(types.includes('CLARIFICATION_REQUESTED'));

    const reply = await req('POST', `/api/v1/ideas/${idea.id}/clarifications`, {
      ...author, key: randomUUID(),
      body: { expectedVersion: (await note.json()).data.ideaVersion, body: 'Перекрёсток у школы, часы пик с 8 до 9 утра.' },
    });
    assert.equal(reply.status, 200);
    assert.equal((await reply.json()).data.status, 'UNDER_REVIEW');
  });

  it('cross-org assignment is rejected; data unchanged (INT-10)', async () => {
    const author = await registerCitizen('assignx');
    const idea = await submitFreshIdea(author);
    const staff = await loginAs('transport@example.test');
    const other = await db.query(`SELECT id FROM users WHERE email_normalized='utilities@example.test'`);
    const bad = await req('POST', `/api/v1/ideas/${idea.id}/assignment`, {
      ...staff, key: randomUUID(),
      body: { assigneeId: other.rows[0].id, expectedVersion: idea.version },
    });
    assert.equal(bad.status, 400);
    const detail = await req('GET', `/api/v1/ideas/${idea.id}`, staff);
    assert.equal((await detail.json()).data.version, idea.version);
    const citizenAssign = await req('POST', `/api/v1/ideas/${idea.id}/assignment`, {
      ...author, key: randomUUID(), body: { assigneeId: staff.user.id, expectedVersion: idea.version },
    });
    assert.equal(citizenAssign.status, 403);
  });
});

describe('B-04 reroute (E2E-05/E2E-09)', () => {
  it('admin reroutes: number kept, assignee reset, access moves', async () => {
    const author = await registerCitizen('reroute');
    const idea = await submitFreshIdea(author);
    const staff = await loginAs('transport@example.test');
    const admin = await loginAs('admin@example.test');
    const take = await req('POST', `/api/v1/ideas/${idea.id}/status`, {
      ...staff, key: randomUUID(),
      body: { toStatus: 'UNDER_REVIEW', takeOwnership: true, expectedVersion: idea.version },
    });
    const v1 = (await take.json()).data.version;

    const badReason = await req('POST', `/api/v1/admin/ideas/${idea.id}/reroute`, {
      ...admin, key: randomUUID(),
      body: { organizationId: triageOrgId, effectiveCategoryCode: 'OTHER', reason: 'коротко', expectedVersion: v1 },
    });
    assert.equal(badReason.status, 400);

    const move = await req('POST', `/api/v1/admin/ideas/${idea.id}/reroute`, {
      ...admin, key: randomUUID(),
      body: {
        organizationId: triageOrgId, effectiveCategoryCode: 'OTHER',
        reason: 'Спорный маршрут: требуется ручной разбор центром инициатив.',
        expectedVersion: v1,
      },
    });
    assert.equal(move.status, 200);
    const moved = (await move.json()).data;
    assert.equal(moved.status, 'UNDER_REVIEW');

    const detail = await req('GET', `/api/v1/ideas/${idea.id}`, author);
    const detailJson = await detail.json();
    assert.equal(detailJson.data.publicNumber, idea.publicNumber);
    assert.equal(detailJson.data.routing.organizationCode, 'DEMO_TRIAGE');

    // Old org loses access; new org sees it as unassigned.
    const oldQueue = await req('GET', '/api/v1/ideas', { ...staff, query: '?scope=staff' });
    assert.ok(!(await oldQueue.json()).data.some((r) => r.id === idea.id));
    const oldDetail = await req('GET', `/api/v1/ideas/${idea.id}`, staff);
    assert.equal(oldDetail.status, 404);
    const triage = await loginAs('triage@example.test');
    const unassigned = await req('GET', '/api/v1/ideas', { ...triage, query: '?scope=staff&assignee=unassigned' });
    assert.ok((await unassigned.json()).data.some((r) => r.id === idea.id));
  });

  it('author reply after reroute lands UNDER_REVIEW without assignee (E2E-09)', async () => {
    const author = await registerCitizen('reroute-reply');
    const idea = await submitFreshIdea(author);
    const staff = await loginAs('transport@example.test');
    const admin = await loginAs('admin@example.test');
    const take = await req('POST', `/api/v1/ideas/${idea.id}/status`, {
      ...staff, key: randomUUID(),
      body: { toStatus: 'UNDER_REVIEW', takeOwnership: true, expectedVersion: idea.version },
    });
    const v1 = (await take.json()).data.version;
    const ask = await req('POST', `/api/v1/ideas/${idea.id}/status`, {
      ...staff, key: randomUUID(),
      body: { toStatus: 'NEEDS_INFO', publicComment: 'Уточните точное место установки.', expectedVersion: v1 },
    });
    const v2 = (await ask.json()).data.version;
    const move = await req('POST', `/api/v1/admin/ideas/${idea.id}/reroute`, {
      ...admin, key: randomUUID(),
      body: {
        organizationId: triageOrgId, effectiveCategoryCode: 'OTHER',
        reason: 'Передаём в центр разбора вместе с открытым уточнением.',
        expectedVersion: v2,
      },
    });
    const v3 = (await move.json()).data.version;
    const reply = await req('POST', `/api/v1/ideas/${idea.id}/clarifications`, {
      ...author, key: randomUUID(),
      body: { expectedVersion: v3, body: 'Место: перекрёсток у школы, сторона парка.' },
    });
    assert.equal(reply.status, 200);
    assert.equal((await reply.json()).data.status, 'UNDER_REVIEW');
    const triageDetail = await req('GET', `/api/v1/ideas/${idea.id}`, await loginAs('triage@example.test'));
    assert.equal((await triageDetail.json()).data.status, 'UNDER_REVIEW');
  });

  it('reroute of terminal ideas and inactive orgs is rejected', async () => {
    const author = await registerCitizen('reroute-neg');
    const idea = await submitFreshIdea(author);
    const staff = await loginAs('transport@example.test');
    const admin = await loginAs('admin@example.test');
    const take = await req('POST', `/api/v1/ideas/${idea.id}/status`, {
      ...staff, key: randomUUID(),
      body: { toStatus: 'UNDER_REVIEW', takeOwnership: true, expectedVersion: idea.version },
    });
    const v1 = (await take.json()).data.version;
    const done = await req('POST', `/api/v1/ideas/${idea.id}/status`, {
      ...staff, key: randomUUID(),
      body: { toStatus: 'COMPLETED', resolutionType: 'ANSWER_PROVIDED', publicComment: 'Итоговый ответ опубликован по существу предложения.', expectedVersion: v1 },
    });
    const v2 = (await done.json()).data.version;
    const term = await req('POST', `/api/v1/admin/ideas/${idea.id}/reroute`, {
      ...admin, key: randomUUID(),
      body: { organizationId: triageOrgId, effectiveCategoryCode: 'OTHER', reason: 'Попытка перенаправления завершённой.', expectedVersion: v2 },
    });
    assert.equal(term.status, 409);
    await db.query(`UPDATE organizations SET active=FALSE WHERE code='DEMO_ECOLOGY'`);
    try {
      const eco = await db.query(`SELECT id FROM organizations WHERE code='DEMO_ECOLOGY'`);
      const idea2 = await submitFreshIdea(author);
      const inactive = await req('POST', `/api/v1/admin/ideas/${idea2.id}/reroute`, {
        ...admin, key: randomUUID(),
        body: { organizationId: eco.rows[0].id, effectiveCategoryCode: 'ECOLOGY', reason: 'Попытка маршрута в неактивную организацию.', expectedVersion: idea2.version },
      });
      assert.equal(inactive.status, 400);
    } finally {
      await db.query(`UPDATE organizations SET active=TRUE WHERE code='DEMO_ECOLOGY'`);
    }
  });
});
