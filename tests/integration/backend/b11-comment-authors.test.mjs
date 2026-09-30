import { before, after, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../../../src/server/db/client.mjs';
import { migrate } from '../../../scripts/migrate.mjs';
import { seed } from '../../../scripts/seed.mjs';
import { createServer } from '../../../src/server/http/app.mjs';

const origin = 'http://localhost:3000';
const password = 'b11-synthetic-password-12';
const publicText = 'Проверили переход у школы, требуется уточнение расположения.';
const citizenText = 'Переход расположен у главного входа, рядом с автобусной остановкой.';
const adminText = 'Администратор уточнил порядок дальнейшего рассмотрения предложения.';
const internalText = 'Внутренний текст специалистов не должен попадать к жителю.';
let db, server, base, citizen, staff, admin, idea;

async function request(method, path, { auth, body, key } = {}) {
  const response = await fetch(base + path, { method, headers: {
    origin,
    ...(auth ? { cookie: auth.cookie, 'x-csrf-token': auth.csrf } : {}),
    ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    ...(key ? { 'idempotency-key': key } : {}),
  }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = response.status === 204 ? null : await response.json();
  return { status: response.status, json };
}

async function login(email) {
  const response = await fetch(`${base}/api/v1/auth/login`, {
    method: 'POST', headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(response.status, 200);
  const json = await response.json();
  return { cookie: response.headers.get('set-cookie').split(';')[0], csrf: json.data.csrfToken, user: json.data.user };
}

async function write(suffix, auth, body, status = 200) {
  const result = await request('POST', `/api/v1/ideas/${idea.id}${suffix}`, {
    auth, key: randomUUID(), body: { expectedVersion: idea.version, ...body },
  });
  assert.equal(result.status, status, JSON.stringify(result.json));
  idea.version = result.json.data.version ?? result.json.data.ideaVersion;
  return result.json.data;
}

before(async () => {
  db = await openDatabase({ databaseUrl: null, pgliteDir: null });
  await migrate(db);
  await seed(db, { demoPassword: password });
  server = createServer(db, { origin, secureCookies: false, logRequests: false,
    assistant: { enabled: false }, classifier: { enabled: false } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  citizen = await login('citizen1@example.test');
  staff = await login('transport@example.test');
  admin = await login('admin@example.test');
  const territoryId = (await db.query("SELECT id FROM territories WHERE code='DEMO_SEMEY'")).rows[0].id;
  const created = await request('POST', '/api/v1/ideas', { auth: citizen, key: randomUUID(), body: {
    title: 'Умные светофоры для безопасной дороги',
    problem: 'У школы дорога и светофоры не учитывают загруженность дороги и безопасность детей.',
    solution: 'Установить умные светофоры и датчики загруженности дороги возле школы.',
    requestedCategoryCode: 'TRANSPORT', territoryId,
  } });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  idea = created.json.data;
  await write('/submit', citizen, { consentAccepted: true });
  await write('/status', staff, { toStatus: 'UNDER_REVIEW', takeOwnership: true });
  await write('/status', staff, { toStatus: 'NEEDS_INFO', publicComment: publicText });
  await write('/clarifications', citizen, { body: citizenText });
  await write('/comments', staff, { visibility: 'INTERNAL', body: internalText }, 201);
  await write('/comments', admin, { visibility: 'PUBLIC', body: adminText }, 201);
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await db.close();
});

it('citizen receives staff question and own clarification with accurate names, roles and comment kinds', async () => {
  const result = await request('GET', `/api/v1/ideas/${idea.id}/timeline`, { auth: citizen });
  assert.equal(result.status, 200);
  const question = result.json.data.find((event) => event.body === publicText);
  const answer = result.json.data.find((event) => event.body === citizenText);
  const adminReply = result.json.data.find((event) => event.body === adminText);
  assert.ok(question);
  assert.ok(answer);
  assert.deepEqual([question.authorId, question.authorDisplayName, question.authorRole, question.commentKind],
    [staff.user.id, staff.user.displayName, 'STAFF', 'CLARIFICATION_QUESTION']);
  assert.deepEqual([answer.authorId, answer.authorDisplayName, answer.authorRole, answer.commentKind],
    [citizen.user.id, citizen.user.displayName, 'CITIZEN', 'CLARIFICATION_ANSWER']);
  assert.deepEqual([adminReply.authorId, adminReply.authorDisplayName, adminReply.authorRole, adminReply.commentKind],
    [admin.user.id, admin.user.displayName, 'ADMIN', 'NOTE']);
  assert.deepEqual([question.commentVisibility, answer.commentVisibility, adminReply.commentVisibility],
    ['PUBLIC', 'PUBLIC', 'PUBLIC']);
  assert.equal(answer.actorId, citizen.user.id);
  assert.ok(result.json.data.every((event) => event.visibility === 'PUBLIC'));
  assert.doesNotMatch(JSON.stringify(result.json), /Внутренний текст|example\.test|email|phone/);
  const unlinked = result.json.data.find((event) => event.commentId === null);
  assert.ok(unlinked);
  assert.deepEqual([unlinked.authorId, unlinked.authorDisplayName, unlinked.authorRole, unlinked.commentKind, unlinked.commentVisibility], [null, null, null, null, null]);
});

it('staff sees internal attribution, and linked author comes from comment rather than event actor', async () => {
  const original = await request('GET', `/api/v1/ideas/${idea.id}/timeline`, { auth: staff });
  const note = original.json.data.find((event) => event.body === internalText);
  assert.ok(note);
  assert.deepEqual([note.authorId, note.authorDisplayName, note.authorRole, note.commentKind],
    [staff.user.id, staff.user.displayName, 'STAFF', 'NOTE']);
  assert.equal(note.commentVisibility, 'INTERNAL');
  const syntheticEvent = await db.query(
    "INSERT INTO idea_events(idea_id,type,actor_id,visibility,comment_id,payload_json) VALUES($1,'COMMENT_PUBLIC',$2,'PUBLIC',$3,'{}') RETURNING id",
    [idea.id, admin.user.id, note.commentId]);
  // Events are append-only. This synthetic edge case lives only in the isolated
  // PGlite database, which the suite disposes in after().
  const staffTimeline = await request('GET', `/api/v1/ideas/${idea.id}/timeline`, { auth: staff });
  const linked = staffTimeline.json.data.find((event) => event.id === syntheticEvent.rows[0].id);
  assert.equal(linked.actorId, admin.user.id);
  assert.equal(linked.authorId, staff.user.id);
  assert.equal(linked.authorRole, 'STAFF');
  assert.equal(linked.visibility, 'PUBLIC');
  assert.equal(linked.commentVisibility, 'INTERNAL');
  const citizenTimeline = await request('GET', `/api/v1/ideas/${idea.id}/timeline`, { auth: citizen });
  const masked = citizenTimeline.json.data.find((event) => event.id === syntheticEvent.rows[0].id);
  assert.equal(masked.visibility, 'PUBLIC');
  assert.deepEqual([masked.body, masked.authorId, masked.authorDisplayName, masked.authorRole, masked.commentKind, masked.commentVisibility],
    [null, null, null, null, null, null]);
  assert.doesNotMatch(JSON.stringify(citizenTimeline.json), /Внутренний текст/);
});

it('clarification keeps its historical citizen role after current user role changes', async () => {
  const previous = (await db.query('SELECT role, organization_id FROM users WHERE id=$1', [citizen.user.id])).rows[0];
  await db.query("UPDATE users SET role='STAFF',organization_id=$2 WHERE id=$1", [citizen.user.id, staff.user.organizationId]);
  try {
    const result = await request('GET', `/api/v1/ideas/${idea.id}/timeline`, { auth: admin });
    assert.equal(result.status, 200);
    const answer = result.json.data.find((event) => event.body === citizenText);
    assert.equal(answer.authorRole, 'CITIZEN');
    assert.equal(answer.authorDisplayName, citizen.user.displayName);
  } finally {
    await db.query('UPDATE users SET role=$2,organization_id=$3 WHERE id=$1', [citizen.user.id, previous.role, previous.organization_id]);
  }
});
