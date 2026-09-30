// Isolated PostgreSQL engine + HTTP. Real PG is opt-in and accepts only the
// explicit disposable test database; never uses ambient DATABASE_URL.
import { before, after, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../../../src/server/db/client.mjs';
import { migrate } from '../../../scripts/migrate.mjs';
import { seed } from '../../../scripts/seed.mjs';
import { createServer } from '../../../src/server/http/app.mjs';
import { createDraft, submitIdea } from '../../../src/server/ideas/service.mjs';
import { addComment, changeStatus, answerClarification } from '../../../src/server/workflow/service.mjs';
import { submitLimiter } from '../../../src/server/auth/rateLimit.mjs';
import { disposableDatabase } from '../postgres/helpers/disposable-db.mjs';

const ORIGIN = 'http://localhost:3000';
const PASSWORD = 'showcase-isolated-test-password';
const SAFE = {
  title: 'Безопасные светофоры для города',
  problem: 'Пешеходам сложно пересекать оживлённую дорогу рядом с общественной остановкой.',
  solution: 'Установить умные светофоры и повысить безопасность движения на городских перекрёстках.',
  expectedBenefit: 'Более безопасные маршруты для жителей.',
};
const PRIVATE = 'PRIVATE_CONTACT_MARKER +77011234567 resident-private@example.test';
let db, server, base, territoryId, accounts, pgFixture;

async function req(method, route, auth, body, headers = {}) {
  const opts = { method, headers: { origin: ORIGIN, ...headers } };
  if (auth) { opts.headers.cookie = auth.cookie; opts.headers['x-csrf-token'] = auth.csrf; }
  if (body !== undefined) { opts.headers['content-type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const response = await fetch(base + route, opts);
  return { response, status: response.status, json: await response.json() };
}
async function login(email, actor) {
  const result = await req('POST', '/api/v1/auth/login', null, { email, password: PASSWORD });
  assert.equal(result.status, 200);
  return { ...actor, cookie: result.response.headers.get('set-cookie').split(';')[0], csrf: result.json.data.csrfToken };
}
async function fresh({ draft = false } = {}) {
  const idea = (await createDraft(db, accounts.author, { ...SAFE,
    problem: `${SAFE.problem} ${PRIVATE}`, locationText: 'ул. Абая, дом12, кв.34',
    territoryId, requestedCategoryCode: 'TRANSPORT' }, randomUUID(), 'showcase-test')).body;
  if (draft) return idea;
  return (await submitIdea(db, accounts.author, idea.id, { expectedVersion: idea.version, consentAccepted: true },
    randomUUID(), 'showcase-test', { enabled: false })).body;
}
const publicationPath = (idea) => `/api/v1/ideas/${idea.id}/publication`;
async function pending(idea) {
  const result = await req('PUT', publicationPath(idea), accounts.author, { ...SAFE, consentAccepted: true, expectedVersion: 0 });
  assert.equal(result.status, 200);
  assert.equal(result.json.data.state, 'PENDING');
  return result.json.data;
}
async function published(idea) {
  const publication = await pending(idea);
  const result = await req('POST', `${publicationPath(idea)}/review`, accounts.staff,
    { ...SAFE, decision: 'PUBLISH', expectedVersion: publication.version });
  assert.equal(result.status, 200);
  assert.equal(result.json.data.state, 'PUBLISHED');
  return result.json.data;
}
async function startServer() {
  server = createServer(db, { origin: ORIGIN, secureCookies: false, logRequests: false,
    classifier: { enabled: false }, assistant: { enabled: false } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
}

before(async () => {
  if (process.env.SHOWCASE_PG_TEST === '1') {
    pgFixture = await disposableDatabase({ prepare: false });
    db = pgFixture.db;
  } else db = await openDatabase({ databaseUrl: null, pgliteDir: null });
  await migrate(db);
  await seed(db, { demoPassword: PASSWORD });
  territoryId = (await db.query("SELECT id FROM territories WHERE code='DEMO_SEMEY'")).rows[0].id;
  const actors = (await db.query(`SELECT id,role,region_id AS "regionId",organization_id AS "organizationId",email_normalized FROM users`)).rows;
  await startServer();
  accounts = {};
  for (const [name, email] of Object.entries({ author: 'citizen1@example.test', citizen: 'citizen2@example.test',
    staff: 'transport@example.test', foreignStaff: 'utilities@example.test', admin: 'admin@example.test' })) {
    accounts[name] = await login(email, actors.find((actor) => actor.email_normalized === email));
  }
});
beforeEach(() => submitLimiter.clear(`submit:${accounts.author.id}`));
after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (pgFixture) await pgFixture.close(); else await db?.close();
});

describe('opt-in public showcase', () => {
  it('starts private, guest reads only published records and cannot inspect publication administration', async () => {
    const idea = await fresh();
    const list = await req('GET', '/api/v1/showcase');
    assert.equal(list.status, 200);
    assert.equal(list.json.data.length, 0);
    assert.deepEqual(list.json.meta.summary, { published: 0, inProgress: 0, completed: 0, totalSupports: 0 });
    assert.equal((await req('GET', `/api/v1/showcase/${idea.id}`)).status, 404);
    assert.equal((await req('GET', publicationPath(idea))).status, 401);
    const own = await req('GET', publicationPath(idea), accounts.author);
    assert.deepEqual(own.json.data, { state: 'PRIVATE', title: '', problem: '', solution: '', expectedBenefit: null,
      moderationNote: null, publishedAt: null, version: 0, authorConsent: false });
    assert.equal((await req('GET', publicationPath(idea), accounts.citizen)).status, 404);
    assert.equal((await req('GET', publicationPath(idea), accounts.foreignStaff)).status, 404);
    await pending(idea);
    assert.equal((await req('GET', `/api/v1/showcase/${idea.id}`)).status, 404);
  });

  it('requires separate author consent, rejects write escalation and contact/address/coordinate text', async () => {
    const idea = await fresh();
    const path = publicationPath(idea);
    assert.equal((await req('PUT', path, accounts.author, { ...SAFE, consentAccepted: false })).status, 400);
    assert.equal((await req('PUT', path, accounts.author, { ...SAFE, consentAccepted: true, state: 'PUBLISHED' })).status, 400);
    assert.equal((await req('PUT', path, accounts.citizen, { ...SAFE, consentAccepted: true })).status, 404);
    assert.equal((await req('PUT', path, accounts.staff, { ...SAFE, consentAccepted: true })).status, 403);
    for (const privateText of ['private@example.test', '+7 (701) 123-45-67', 'ул. Абая, дом12, кв.34',
      'Абай көшесі, үй12, пәтер34', '50.411,80.227']) {
      const result = await req('PUT', path, accounts.author,
        { ...SAFE, problem: `${SAFE.problem} ${privateText}`, consentAccepted: true });
      assert.equal(result.status, 400, privateText);
      assert.ok(result.json.error.fields.problem);
    }
    const result = await req('PUT', path, accounts.author, { ...SAFE,
      expectedBenefit: 'Для 12 остановок; идея ABAI-2026-000001.', consentAccepted: true });
    assert.equal(result.status, 200, 'ordinary counts and public numbers are allowed');
  });

  it('moderation enforces current organization, consent, non-draft status and publication versions', async () => {
    const idea = await fresh();
    const beforeVersion = (await db.query('SELECT version FROM ideas WHERE id=$1', [idea.id])).rows[0].version;
    const p = await pending(idea);
    const path = `${publicationPath(idea)}/review`;
    const body = { ...SAFE, decision: 'PUBLISH', expectedVersion: p.version };
    assert.equal((await req('POST', path, accounts.citizen, body)).status, 403);
    assert.equal((await req('POST', path, accounts.foreignStaff, body)).status, 404);
    assert.equal((await req('PUT', publicationPath(idea), accounts.author, { ...SAFE, consentAccepted: true })).status, 400);
    assert.equal((await req('POST', path, accounts.staff, { ...body, expectedVersion: p.version + 1 })).status, 409);
    for (const privateText of ['ул. Абая, дом12, кв.34', '50.411,80.227']) {
      assert.equal((await req('POST', path, accounts.staff, { ...body, solution: `${SAFE.solution} ${privateText}` })).status, 400);
    }
    await db.query('UPDATE idea_publications SET author_consent=FALSE WHERE idea_id=$1', [idea.id]);
    assert.equal((await req('POST', path, accounts.staff, body)).status, 409);
    await db.query('UPDATE idea_publications SET author_consent=TRUE WHERE idea_id=$1', [idea.id]);
    assert.equal((await req('POST', path, accounts.staff, { ...body, decision: 'REJECT', moderationNote: 'Уточните публичный текст.' })).status, 200);
    const rejected = (await req('GET', publicationPath(idea), accounts.author)).json.data;
    assert.equal(rejected.state, 'REJECTED');
    assert.equal((await req('GET', `/api/v1/showcase/${idea.id}`)).status, 404);
    assert.equal((await req('PUT', publicationPath(idea), accounts.author,
      { ...SAFE, consentAccepted: true, expectedVersion: rejected.version })).status, 200);
    const updated = (await req('GET', publicationPath(idea), accounts.staff)).json.data;
    assert.equal((await req('POST', path, accounts.admin, { ...body, expectedVersion: updated.version })).status, 200);
    assert.equal((await db.query('SELECT version FROM ideas WHERE id=$1', [idea.id])).rows[0].version, beforeVersion);
    const draft = await fresh({ draft: true });
    const draftRequest = await req('PUT', publicationPath(draft), accounts.author,
      { ...SAFE, consentAccepted: true, expectedVersion: 0 });
    assert.equal(draftRequest.status, 409, 'drafts cannot request publication before submission');
    assert.equal((await req('GET', publicationPath(draft), accounts.author)).json.data.state, 'PRIVATE');
    assert.equal((await db.query('SELECT count(*)::int AS count FROM idea_publications WHERE idea_id=$1', [draft.id])).rows[0].count, 0);
    // A legacy/inconsistent pending row must not bypass the review-side guard.
    const draftPublication = (await db.query(`INSERT INTO idea_publications
      (idea_id,state,title,problem,solution,expected_benefit,author_consent)
      VALUES($1,'PENDING',$2,$3,$4,$5,TRUE) RETURNING version`,
    [draft.id, SAFE.title, SAFE.problem, SAFE.solution, SAFE.expectedBenefit])).rows[0];
    assert.equal((await req('POST', `${publicationPath(draft)}/review`, accounts.admin,
      { ...body, expectedVersion: draftPublication.version })).status, 409);
    assert.equal((await req('GET', `/api/v1/showcase/${draft.id}`)).status, 404);
  });

  it('public projection is allowlisted and search never uses private source text', async () => {
    const idea = await fresh();
    await published(idea);
    const detail = await req('GET', `/api/v1/showcase/${idea.id}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.json.data.problem, SAFE.problem);
    assert.equal(detail.json.data.latestReply, null);
    assert.deepEqual(detail.json.data.timeline.map((event) => event.type), ['PUBLISHED']);
    const keys = ['id','publicNumber','title','problem','solution','expectedBenefit','categoryCode','territoryId',
      'territoryName','organizationName','status','resolutionType','publishedAt','updatedAt','supportCount',
      'isSupported','isFollowing','isAuthor','latestReply','timeline'];
    assert.deepEqual(Object.keys(detail.json.data).sort(), keys.sort());
    const json = JSON.stringify(detail.json);
    for (const forbidden of ['PRIVATE_CONTACT_MARKER', 'resident-private', 'authorEmail', 'displayName',
      'locationText', 'locationGeometry', 'attachments', 'storageKey', 'actorId', 'payload']) assert.ok(!json.includes(forbidden), forbidden);
    const list = await req('GET', '/api/v1/showcase?q=PRIVATE_CONTACT_MARKER');
    assert.equal(list.json.data.length, 0);
    assert.ok(list.json.meta.summary.published > 0, 'summary is independent of filtered page');
    assert.ok((await req('GET', '/api/v1/showcase?q=светофоры&category=TRANSPORT')).json.data.some((row) => row.id === idea.id));
    assert.equal((await req('GET', '/api/v1/showcase?territory=DEMO_SEMEY')).status, 400);
    assert.ok((await req('GET', `/api/v1/showcase?territory=${territoryId}&pageSize=9&sort=popular`)).json.data.length > 0);
    assert.equal((await req('GET', '/api/v1/showcase?pageSize=25')).status, 400);
    assert.equal((await req('GET', '/api/v1/showcase?status=DRAFT')).status, 400);
  });

  it('supports/follows are real, unique and idempotent with role, CSRF and self-support protection', async () => {
    const idea = await fresh();
    await published(idea);
    const path = `/api/v1/showcase/${idea.id}`;
    assert.equal((await req('PUT', `${path}/support`)).status, 401);
    assert.equal((await req('PUT', `${path}/support`, { ...accounts.citizen, csrf: '' })).status, 403);
    assert.equal((await req('PUT', `${path}/support`, accounts.staff)).status, 403);
    assert.equal((await req('PUT', `${path}/support`, accounts.author)).status, 403);
    const results = await Promise.all(Array.from({ length: 6 }, () => req('PUT', `${path}/support`, accounts.citizen)));
    assert.ok(results.every((result) => result.status === 200 && result.json.data.supportCount === 1));
    assert.equal((await db.query('SELECT count(*)::int AS c FROM idea_supports WHERE idea_id=$1', [idea.id])).rows[0].c, 1);
    await req('PUT', `${path}/follow`, accounts.citizen);
    const followed = await req('PUT', `${path}/follow`, accounts.citizen);
    assert.deepEqual(followed.json.data, { supportCount: 1, isSupported: true, isFollowing: true });
    assert.equal((await req('GET', '/api/v1/showcase?following=true')).status, 401);
    assert.equal((await req('GET', '/api/v1/showcase?following=true', accounts.staff)).status, 403);
    const ownFollowing = await req('GET', '/api/v1/showcase?following=true', accounts.citizen);
    assert.deepEqual(ownFollowing.json.data.map((row) => row.id), [idea.id]);
    assert.equal((await req('GET', path, accounts.citizen)).json.data.isSupported, true);
    assert.equal((await req('GET', path, accounts.author)).json.data.isAuthor, true);
    await new Promise((resolve) => server.close(resolve));
    await startServer();
    assert.equal((await req('GET', path, accounts.citizen)).json.data.isFollowing, true, 'server restart preserves DB follows');
    assert.equal((await req('DELETE', `${path}/support`, accounts.citizen)).json.data.supportCount, 0);
    assert.equal((await req('DELETE', `${path}/support`, accounts.citizen)).json.data.supportCount, 0);
    assert.equal((await req('DELETE', `${path}/follow`, accounts.citizen)).json.data.isFollowing, false);
  });

  it('only explicit safe replies and generic status events reach public timelines and followers', async () => {
    const idea = await fresh();
    let p = await published(idea);
    const path = `/api/v1/showcase/${idea.id}`;
    await req('PUT', `${path}/follow`, accounts.citizen);
    await req('PUT', `${path}/follow`, accounts.author);
    const taken = (await changeStatus(db, accounts.staff, idea.id,
      { expectedVersion: idea.version, toStatus: 'UNDER_REVIEW', takeOwnership: true, publicComment: `PRIVATE_STATUS_MARKER ${PRIVATE}` },
      randomUUID(), 'showcase-test')).body;
    p = (await req('GET', publicationPath(idea), accounts.staff)).json.data;
    const replyPath = `${publicationPath(idea)}/replies`;
    const reply = 'Инициативу обсудили: специалисты изучают безопасные варианты улучшения движения.';
    assert.equal((await req('POST', replyPath, accounts.foreignStaff, { body: reply, expectedVersion: p.version })).status, 404);
    assert.equal((await req('POST', replyPath, accounts.staff, { body: reply, expectedVersion: p.version - 1 })).status, 409);
    for (const privateText of ['ул. Абая, дом12, кв.34', '50.411,80.227']) {
      assert.equal((await req('POST', replyPath, accounts.staff, { body: `${reply} ${privateText}`, expectedVersion: p.version })).status, 400);
    }
    const beforeInternal = (await req('GET', path)).json.data;
    const internal = (await addComment(db, accounts.staff, idea.id,
      { expectedVersion: taken.version, visibility: 'INTERNAL', body: `INTERNAL_SECRET_MARKER ${PRIVATE}` }, randomUUID(), 'showcase-test')).body;
    const afterInternal = (await req('GET', path)).json.data;
    assert.deepEqual(afterInternal.timeline, beforeInternal.timeline);
    assert.equal(afterInternal.updatedAt, beforeInternal.updatedAt);
    assert.equal((await req('POST', replyPath, accounts.staff, { body: reply, expectedVersion: p.version })).status, 200);
    const needs = (await changeStatus(db, accounts.staff, idea.id,
      { expectedVersion: internal.ideaVersion, toStatus: 'NEEDS_INFO', publicComment: `PRIVATE_QUESTION_MARKER ${PRIVATE}` },
      randomUUID(), 'showcase-test')).body;
    await answerClarification(db, accounts.author, idea.id,
      { expectedVersion: needs.version, body: `PRIVATE_ANSWER_MARKER ${PRIVATE}` }, randomUUID(), 'showcase-test');
    const detail = (await req('GET', path)).json.data;
    assert.equal(detail.latestReply.body, reply);
    assert.equal(detail.status, 'UNDER_REVIEW');
    assert.equal(detail.timeline.at(-1).status, 'UNDER_REVIEW');
    assert.ok(detail.timeline.filter((event) => event.type !== 'REPLY').every((event) => event.body === null));
    assert.ok(!JSON.stringify(detail).includes('PRIVATE_'));
    assert.ok(!JSON.stringify(detail).includes('INTERNAL_SECRET'));
    const notifications = (await db.query(`SELECT n.* FROM notifications n WHERE n.idea_id=$1 AND n.kind='SHOWCASE_UPDATE'`, [idea.id])).rows;
    const follower = notifications.filter((notification) => notification.recipient_id !== accounts.author.id);
    assert.equal(follower.length, 4, 'take/reply/needs-info/clarification each notify once');
    assert.ok(follower.every((notification) => notification.recipient_id === accounts.citizen.id
      && notification.title === 'Обновление публичной идеи'));
    const authorReplies = notifications.filter((notification) => notification.recipient_id === accounts.author.id);
    assert.equal(authorReplies.length, 1, 'author receives the explicit public reply without a duplicate follow notification');
    assert.equal(authorReplies[0].title, 'Обновление публичной идеи');
    const source = (await db.query('SELECT type,payload_json FROM idea_events WHERE id=$1', [authorReplies[0].source_event_id])).rows[0];
    assert.equal(source.type, 'COMMENT_PUBLIC');
    assert.ok(source.payload_json.showcaseEventId, 'SHOWCASE_UPDATE opens the public ledger, not private comments');
  });

  it('author withdrawal hides immediately, prevents interactions and rejects stale approval', async () => {
    const idea = await fresh();
    let p = await published(idea);
    const path = `/api/v1/showcase/${idea.id}`;
    await req('PUT', `${path}/support`, accounts.citizen);
    await req('PUT', `${path}/follow`, accounts.citizen);
    assert.equal((await req('DELETE', publicationPath(idea), accounts.citizen)).status, 404);
    assert.equal((await req('DELETE', publicationPath(idea), accounts.staff)).status, 403);
    const withdraw = await req('DELETE', publicationPath(idea), accounts.author);
    assert.equal(withdraw.json.data.state, 'PRIVATE');
    assert.equal(withdraw.json.data.authorConsent, false);
    assert.equal(withdraw.json.data.version, p.version + 1);
    assert.equal((await req('GET', path)).status, 404);
    assert.equal((await req('PUT', `${path}/support`, accounts.citizen)).status, 404);
    assert.equal((await req('DELETE', `${path}/follow`, accounts.citizen)).status, 404);
    assert.ok(!(await req('GET', '/api/v1/showcase')).json.data.some((row) => row.id === idea.id));
    assert.equal((await req('POST', `${publicationPath(idea)}/review`, accounts.staff,
      { ...SAFE, decision: 'PUBLISH', expectedVersion: p.version })).status, 409);
    const version = (await db.query('SELECT version FROM ideas WHERE id=$1', [idea.id])).rows[0].version;
    await changeStatus(db, accounts.staff, idea.id, { expectedVersion: version, toStatus: 'UNDER_REVIEW', takeOwnership: true },
      randomUUID(), 'showcase-test');
    assert.equal((await db.query("SELECT count(*)::int AS c FROM notifications WHERE idea_id=$1 AND kind='SHOWCASE_UPDATE'", [idea.id])).rows[0].c, 0);
  });

  it('summary tracks real public progress/completion and ignores filters and private ideas', async () => {
    const baseline = (await req('GET', '/api/v1/showcase')).json.meta.summary;
    const idea = await fresh();
    await fresh(); // a private submission contributes to none of the counters
    await published(idea);
    await req('PUT', `/api/v1/showcase/${idea.id}/support`, accounts.citizen);
    let current = (await changeStatus(db, accounts.staff, idea.id,
      { expectedVersion: idea.version, toStatus: 'UNDER_REVIEW', takeOwnership: true }, randomUUID(), 'showcase-test')).body;
    current = (await changeStatus(db, accounts.staff, idea.id,
      { expectedVersion: current.version, toStatus: 'IN_PROGRESS' }, randomUUID(), 'showcase-test')).body;
    let summary = (await req('GET', '/api/v1/showcase?q=not-present-public-search')).json.meta.summary;
    assert.deepEqual(summary, { published: baseline.published + 1, inProgress: baseline.inProgress + 1,
      completed: baseline.completed, totalSupports: baseline.totalSupports + 1 });
    await changeStatus(db, accounts.staff, idea.id, { expectedVersion: current.version, toStatus: 'COMPLETED',
      resolutionType: 'ANSWER_PROVIDED', publicComment: `PRIVATE_COMPLETION_MARKER ${PRIVATE}` }, randomUUID(), 'showcase-test');
    summary = (await req('GET', '/api/v1/showcase?status=REJECTED')).json.meta.summary;
    assert.deepEqual(summary, { published: baseline.published + 1, inProgress: baseline.inProgress,
      completed: baseline.completed + 1, totalSupports: baseline.totalSupports + 1 });
    const detail = (await req('GET', `/api/v1/showcase/${idea.id}`)).json.data;
    assert.equal(detail.status, 'COMPLETED');
    assert.equal(detail.resolutionType, 'ANSWER_PROVIDED');
    assert.equal(detail.timeline.at(-1).status, 'COMPLETED');
    assert.ok(!JSON.stringify(detail).includes('PRIVATE_COMPLETION'));
  });
});
