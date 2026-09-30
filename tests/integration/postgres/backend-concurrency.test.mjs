import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import {
  disposableDatabase, disposableTestUrl, interceptQueries, pauseIdeaLock, TEST_PASSWORD,
} from './helpers/disposable-db.mjs';
import { migrate } from '../../../scripts/migrate.mjs';
import { createDraft, updateDraft, submitIdea } from '../../../src/server/ideas/service.mjs';
import { changeStatus, addComment, rerouteIdea } from '../../../src/server/workflow/service.mjs';
import { uploadAttachment } from '../../../src/server/attachments/store.mjs';
import { createServer } from '../../../src/server/http/app.mjs';
import { admitClassificationCall } from '../../../src/server/routing/budget.mjs';

const enabled = Boolean(process.env.BACKEND_PG_TEST_URL);
const TRANSPORT = {
  title: 'Умные светофоры рядом со школой',
  problem: 'Возле школы дорога требует внимания к безопасности детей. Нужны датчики и понятная схема движения.',
  solution: 'Установить умные светофоры и датчики загруженности дороги, добавить приложение для уведомлений.',
  requestedCategoryCode: 'TRANSPORT',
};
const UTILITIES = {
  title: 'Датчики утечек в водопроводе',
  problem: 'Водопровод часто даёт утечки, жители теряют воду и долго ждут ремонт труб.',
  solution: 'Установить датчики утечек в водопроводе и отправлять сигналы диспетчеру ЖКХ.',
  requestedCategoryCode: 'UTILITIES',
};
const requestId = () => `pg-test-${randomUUID()}`;
const capture = (promise) => promise.then((value) => ({ value }), (error) => ({ error }));

it('PostgreSQL tests refuse an unintended database before connecting', () => {
  assert.throws(() => disposableTestUrl('postgres://localhost/app_production'), /disposable sevens_backend_test/);
  assert.throws(() => disposableTestUrl('not-a-url'), /Invalid BACKEND_PG_TEST_URL/);
});

describe('Real PostgreSQL migrations and concurrent backend flow', { skip: !enabled, timeout: 120000 }, () => {
  let fixture;
  let db;
  let citizen;
  let staff;
  let staff2;
  let admin;
  let territoryId;
  let utilitiesOrgId;

  before(async () => {
    fixture = await disposableDatabase();
    db = fixture.db;
    assert.equal(db.kind, 'pg');
    const actors = (await db.query(
      'SELECT id, role, region_id AS "regionId", organization_id AS "organizationId", email_normalized FROM users')).rows;
    citizen = actors.find((actor) => actor.email_normalized === 'citizen1@example.test');
    staff = actors.find((actor) => actor.email_normalized === 'transport@example.test');
    admin = actors.find((actor) => actor.email_normalized === 'admin@example.test');
    staff2 = (await db.query(
      `INSERT INTO users(email_normalized,display_name,password_hash,role,organization_id,region_id)
       SELECT 'transport-second@example.test','Second staff',password_hash,role,organization_id,region_id
       FROM users WHERE id=$1
       RETURNING id,role,region_id AS "regionId",organization_id AS "organizationId"`, [staff.id])).rows[0];
    territoryId = (await db.query("SELECT id FROM territories WHERE code='DEMO_SEMEY'")).rows[0].id;
    utilitiesOrgId = (await db.query("SELECT id FROM organizations WHERE code='DEMO_UTILITIES'")).rows[0].id;
  });

  after(async () => { await fixture?.close(); });

  const draft = async () => (await createDraft(db, citizen, { ...TRANSPORT, territoryId }, randomUUID(), requestId())).body;
  const submitted = async () => {
    const idea = await draft();
    return (await submitIdea(db, citizen, idea.id,
      { expectedVersion: idea.version, consentAccepted: true }, randomUUID(), requestId())).body;
  };
  const reviewing = async () => {
    const idea = await submitted();
    return (await changeStatus(db, staff, idea.id,
      { expectedVersion: idea.version, toStatus: 'UNDER_REVIEW', takeOwnership: true }, randomUUID(), requestId())).body;
  };
  const moveToUtilities = (ideaId, expectedVersion) => rerouteIdea(db, admin, ideaId, {
    expectedVersion, organizationId: utilitiesOrgId, effectiveCategoryCode: 'UTILITIES',
    reason: 'Передаём идею в направление ЖКХ для согласованного рассмотрения.',
  }, randomUUID(), requestId());

  it('independent migration clients serialize on the advisory lock and apply each migration once', async () => {
    const isolated = await disposableDatabase({ prepare: false });
    let peer;
    try {
      peer = await isolated.openPeer();
      const sessions = await Promise.all([isolated.db.query('SELECT pg_backend_pid() AS pid'), peer.query('SELECT pg_backend_pid() AS pid')]);
      assert.notEqual(sessions[0].rows[0].pid, sessions[1].rows[0].pid);
      const results = await Promise.all([migrate(isolated.db), migrate(peer)]);
      const writer = results.find((result) => result.fresh.length);
      const replay = results.find((result) => !result.fresh.length);
      assert.ok(writer.fresh.includes('0004_location_geometry.sql'));
      assert.ok(replay.applied.includes('0004_location_geometry.sql'));
      const rows = (await isolated.db.query('SELECT version FROM schema_migrations')).rows;
      assert.equal(rows.length, writer.fresh.length);
      assert.equal(new Set(rows.map((row) => row.version)).size, rows.length);
    } finally { await peer?.close(); await isolated.close(); }
  });

  it('migration failure rolls back an earlier complete migration and the ledger on real PG', async () => {
    const isolated = await disposableDatabase({ prepare: false });
    try {
      const broken = interceptQueries(isolated.db, ({ text, run }) => {
        if (text.includes('CREATE OR REPLACE FUNCTION guard_ideas_immutable')) throw new Error('injected PG migration failure');
        return run();
      });
      await assert.rejects(migrate(broken), /Migration 0002_guards.sql failed: injected PG migration failure/);
      assert.deepEqual((await isolated.db.query('SELECT tablename FROM pg_tables WHERE schemaname=$1', [isolated.schema])).rows, []);
      assert.ok((await migrate(isolated.db)).fresh.includes('0004_location_geometry.sql'));
    } finally { await isolated.close(); }
  });

  it('paid classifier admission stays within its global budget across independent PG pools',async()=>{
    const isolated=await disposableDatabase();const peers=[];
    try{
      peers.push(await isolated.openPeer(),await isolated.openPeer());
      const connections=[isolated.db,...peers];
      const ids=(await isolated.db.query('SELECT id FROM users WHERE active ORDER BY id LIMIT 3')).rows.map((row)=>row.id);
      assert.equal(ids.length,3);
      const outcomes=await Promise.all(ids.flatMap((actorId,actorIndex)=>Array.from({length:45},(_,index)=>
        admitClassificationCall(connections[(actorIndex+index)%connections.length],{actorId}))));
      assert.equal(outcomes.filter(Boolean).length,100);
      assert.equal((await isolated.db.query('SELECT used_calls FROM classifier_global_budget')).rows[0].used_calls,100);
      const actors=(await isolated.db.query('SELECT used_calls FROM classifier_actor_budget')).rows;
      assert.equal(actors.reduce((total,row)=>total+row.used_calls,0),100);
      assert.ok(actors.every((row)=>row.used_calls<=50));
    }finally{await Promise.all(peers.map((peer)=>peer.close()));await isolated.close();}
  });

  it('parallel same-key submits return the exact saved response and create one set of side effects', async () => {
    const idea = await draft();
    const key = randomUUID();
    const body = { expectedVersion: idea.version, consentAccepted: true };
    const results = await Promise.all([
      submitIdea(db, citizen, idea.id, body, key, requestId()),
      submitIdea(db, citizen, idea.id, body, key, requestId()),
    ]);
    assert.deepEqual(results[0], results[1]);
    assert.equal(results[0].status, 200);
    assert.equal(results[0].body.routing.effectiveCategoryCode, 'TRANSPORT');
    const counts = (await db.query(`SELECT
      (SELECT count(*)::int FROM routing_decisions WHERE idea_id=$1) AS decisions,
      (SELECT count(*)::int FROM idea_events WHERE idea_id=$1 AND type='SUBMITTED') AS submitted,
      (SELECT count(*)::int FROM notifications WHERE idea_id=$1 AND recipient_id=$2 AND kind='IDEA_REGISTERED') AS notifications,
      (SELECT count(*)::int FROM audit_events WHERE entity_id=$1::text AND action='idea.submit') AS audits,
      (SELECT count(*)::int FROM idempotency_records WHERE user_id=$2 AND operation='idea.submit' AND key=$3) AS replays`,
    [idea.id, citizen.id, key])).rows[0];
    assert.deepEqual(counts, { decisions: 1, submitted: 1, notifications: 1, audits: 1, replays: 1 });
    const notified = (await db.query("SELECT recipient_id FROM notifications WHERE idea_id=$1 AND kind='IDEA_REGISTERED'",
      [idea.id])).rows.map((row) => row.recipient_id);
    assert.deepEqual(notified.sort(), [citizen.id, staff.id, staff2.id].sort());
    assert.equal((await db.query('SELECT public_number FROM ideas WHERE id=$1', [idea.id])).rows[0].public_number,
      results[0].body.publicNumber);
  });

  it('different staff changing the same version yield one success and one 409 without duplicate comments/events', async () => {
    const idea = await reviewing();
    const comments = ['Принято в работу первым сотрудником для подготовки решения.',
      'Принято в работу вторым сотрудником для подготовки решения.'];
    const results = await Promise.allSettled([staff, staff2].map((actor, index) =>
      changeStatus(db, actor, idea.id, { expectedVersion: idea.version, toStatus: 'IN_PROGRESS', publicComment: comments[index] },
        randomUUID(), requestId())));
    const success = results.find((result) => result.status === 'fulfilled');
    const failure = results.find((result) => result.status === 'rejected');
    assert.equal(success.value.status, 200);
    assert.equal(failure.reason.code, 'VERSION_CONFLICT');
    assert.equal((await db.query('SELECT version,status FROM ideas WHERE id=$1', [idea.id])).rows[0].version, idea.version + 1);
    assert.equal((await db.query("SELECT count(*)::int AS c FROM idea_events WHERE idea_id=$1 AND to_status='IN_PROGRESS'", [idea.id])).rows[0].c, 1);
    const stored = (await db.query('SELECT body FROM comments WHERE idea_id=$1', [idea.id])).rows;
    assert.equal(stored.length, 1);
    assert.ok(comments.includes(stored[0].body));
  });

  it('a PATCH committed before a waiting submit cannot be overwritten by a stale routing snapshot', async () => {
    const idea = await draft();
    const barrier = pauseIdeaLock(db, idea.id);
    const waiting = capture(submitIdea(barrier.db, citizen, idea.id,
      { expectedVersion: idea.version, consentAccepted: true }, randomUUID(), requestId()));
    try {
      await barrier.started();
      const patched = await updateDraft(db, citizen, idea.id,
        { ...UTILITIES, expectedVersion: idea.version }, requestId());
      assert.equal(patched.body.version, idea.version + 1);
    } finally { barrier.release(); }
    assert.equal((await waiting).error.code, 'VERSION_CONFLICT');
    const row = (await db.query('SELECT title,problem,solution,status,version FROM ideas WHERE id=$1', [idea.id])).rows[0];
    assert.equal(row.title, UTILITIES.title);
    assert.equal(row.problem, UTILITIES.problem);
    assert.equal(row.solution, UTILITIES.solution);
    assert.equal(row.status, 'DRAFT');
    assert.equal((await db.query('SELECT count(*)::int AS c FROM routing_decisions WHERE idea_id=$1', [idea.id])).rows[0].c, 0);
    const retried = await submitIdea(db, citizen, idea.id,
      { expectedVersion: row.version, consentAccepted: true }, randomUUID(), requestId());
    assert.equal(retried.body.routing.effectiveCategoryCode, 'UTILITIES');
    assert.equal((await db.query('SELECT title FROM ideas WHERE id=$1', [idea.id])).rows[0].title, UTILITIES.title);
  });

  it('a PATCH waiting behind a submitted row cannot mutate the submitted text', async () => {
    const idea = await draft();
    const barrier = pauseIdeaLock(db, idea.id, { afterLock: true });
    const submit = capture(submitIdea(barrier.db, citizen, idea.id,
      { expectedVersion: idea.version, consentAccepted: true }, randomUUID(), requestId()));
    let patch;
    try {
      await barrier.started();
      patch = capture(updateDraft(db, citizen, idea.id,
        { ...UTILITIES, expectedVersion: idea.version }, requestId()));
    } finally { barrier.release(); }
    assert.equal((await submit).value.status, 200);
    assert.equal((await patch).error.code, 'VERSION_CONFLICT');
    const row = (await db.query('SELECT title,status,effective_category_code FROM ideas WHERE id=$1', [idea.id])).rows[0];
    assert.deepEqual(row, { title: TRANSPORT.title, status: 'RECEIVED', effective_category_code: 'TRANSPORT' });
  });

  for (const operation of ['comment', 'status']) {
    it(`reroute committed while old organization ${operation} waits revokes access after the row lock`, async () => {
      const idea = await reviewing();
      const barrier = pauseIdeaLock(db, idea.id);
      const forbiddenText = `Старый орган пытается добавить ${operation} после перенаправления идеи.`;
      const nextVersion = idea.version + 1; // Even an anticipated fresh version grants no access.
      const waiting = capture(operation === 'comment'
        ? addComment(barrier.db, staff, idea.id,
          { expectedVersion: nextVersion, visibility: 'PUBLIC', body: forbiddenText }, randomUUID(), requestId())
        : changeStatus(barrier.db, staff, idea.id,
          { expectedVersion: nextVersion, toStatus: 'REJECTED', publicComment: forbiddenText }, randomUUID(), requestId()));
      let moved;
      try {
        await barrier.started();
        moved = await moveToUtilities(idea.id, idea.version);
      } finally { barrier.release(); }
      assert.equal((await waiting).error.code, 'NOT_FOUND');
      const row = (await db.query('SELECT organization_id,status,version FROM ideas WHERE id=$1', [idea.id])).rows[0];
      assert.deepEqual(row, { organization_id: utilitiesOrgId, status: 'UNDER_REVIEW', version: moved.body.version });
      assert.equal((await db.query('SELECT count(*)::int AS c FROM comments WHERE idea_id=$1 AND body=$2',
        [idea.id, forbiddenText])).rows[0].c, 0);
    });
  }

  it('an exact saved comment replay cannot bypass organization access revoked by rerouting', async () => {
    const idea = await reviewing();
    const key = randomUUID();
    const body = { expectedVersion: idea.version, visibility: 'PUBLIC',
      body: 'Ответ старого органа сохранён до перенаправления в новое направление.' };
    const original = await addComment(db, staff, idea.id, body, key, requestId());
    await moveToUtilities(idea.id, original.body.ideaVersion);
    await assert.rejects(addComment(db, staff, idea.id, body, key, requestId()), (error) => error.code === 'NOT_FOUND');
    assert.equal((await db.query('SELECT count(*)::int AS c FROM comments WHERE idea_id=$1', [idea.id])).rows[0].c, 1);
    assert.equal((await db.query("SELECT count(*)::int AS c FROM notifications WHERE idea_id=$1 AND kind='PUBLIC_REPLY'",
      [idea.id])).rows[0].c, 1);
  });

  it('parallel uploads at two existing files preserve the cap and leave no orphan disk files', async () => {
    const { default: sharp } = await import('sharp');
    const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#25bc81' } }).png().toBuffer();
    const idea = await draft();
    let version = idea.version;
    for (let index = 0; index < 2; index++) {
      const upload = await uploadAttachment(db, citizen, idea.id, { filename: `existing-${index}.png`, content: png },
        version, randomUUID(), requestId(), fixture.uploadDir);
      version = upload.body.ideaVersion;
    }
    const results = await Promise.allSettled([0, 1].map((index) =>
      uploadAttachment(db, citizen, idea.id, { filename: `racing-${index}.png`, content: png },
        version, randomUUID(), requestId(), fixture.uploadDir)));
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    const failed = results.find((result) => result.status === 'rejected').reason;
    assert.equal(failed.code, 'VERSION_CONFLICT');
    const attachments = (await db.query('SELECT storage_key FROM attachments WHERE idea_id=$1 AND removed_at IS NULL', [idea.id])).rows;
    assert.equal(attachments.length, 3);
    const current = (await db.query('SELECT version FROM ideas WHERE id=$1', [idea.id])).rows[0].version;
    await assert.rejects(uploadAttachment(db, citizen, idea.id, { filename: 'fourth.png', content: png },
      current, randomUUID(), requestId(), fixture.uploadDir), (error) => error.code === 'VALIDATION_ERROR' || /ATTACHMENT_LIMIT_REACHED/.test(error.message));
    const disk = (await readdir(fixture.uploadDir)).filter((name) => /^[0-9a-f]{32}$/.test(name));
    assert.deepEqual(disk.sort(), attachments.map((row) => row.storage_key).sort());
  });

  it('real PG HTTP login blocks before identity/password lookup, and /me keeps both tabs authenticated', async () => {
    const origin = 'http://localhost:3000';
    let blockedAccountLookups = 0;
    const counted = interceptQueries(db, ({ text, params, run }) => {
      if (text === 'SELECT * FROM users WHERE email_normalized=$1' && params[0] === 'transport-second@example.test') {
        blockedAccountLookups++;
      }
      return run();
    });
    const server = createServer(counted, { origin, secureCookies: false, uploadDir: fixture.uploadDir });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const login = (email, password) => fetch(base + '/api/v1/auth/login', {
      method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ email, password }),
    });
    try {
      for (let index = 0; index < 5; index++) {
        const failure = await login('transport-second@example.test', 'wrong-synthetic-password');
        assert.equal(failure.status, 401);
        await failure.json();
      }
      const blocked = await login('transport-second@example.test', TEST_PASSWORD);
      assert.equal(blocked.status, 429);
      assert.ok(Number(blocked.headers.get('retry-after')) > 0);
      assert.equal((await blocked.json()).error.code, 'RATE_LIMITED');
      assert.equal(blockedAccountLookups, 5, 'blocked request must not reach user lookup or Argon verification');

      const loggedIn = await login('citizen2@example.test', TEST_PASSWORD);
      assert.equal(loggedIn.status, 200);
      const initial = (await loggedIn.json()).data.csrfToken;
      const cookie = loggedIn.headers.get('set-cookie').split(';')[0];
      const tabs = await Promise.all([0, 1].map(() => fetch(base + '/api/v1/auth/me', { headers: { cookie } })));
      for (const response of tabs) {
        assert.equal(response.status, 200);
        assert.equal((await response.json()).data.csrfToken, initial);
      }
      const create = await fetch(base + '/api/v1/ideas', {
        method: 'POST', headers: { origin, cookie, 'x-csrf-token': initial,
          'idempotency-key': randomUUID(), 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Черновик после чтения двух вкладок' }),
      });
      assert.equal(create.status, 201);
      await create.json();
      const logout = await fetch(base + '/api/v1/auth/logout', { method: 'POST',
        headers: { origin, cookie, 'x-csrf-token': initial } });
      assert.equal(logout.status, 204);
      const afterLogout = await fetch(base + '/api/v1/auth/me', { headers: { cookie } });
      assert.equal(afterLogout.status, 401);
      await afterLogout.json();
    } finally {
      server.closeAllConnections();
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('real PG HTTP cycle preserves exact replies, clarification, reroute, access denial and resident notifications', async () => {
    const origin = 'http://localhost:3000';
    const server = createServer(db, { origin, secureCookies: false, uploadDir: fixture.uploadDir });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const request = async (method, endpoint, auth = {}, body) => {
      const headers = { origin };
      if (auth.cookie) headers.cookie = auth.cookie;
      if (auth.csrf) headers['x-csrf-token'] = auth.csrf;
      if (method !== 'GET') headers['idempotency-key'] = randomUUID();
      if (body !== undefined) headers['content-type'] = 'application/json';
      const response = await fetch(base + endpoint, { method, headers,
        body: body === undefined ? undefined : JSON.stringify(body) });
      const json = response.status === 204 ? null : await response.json();
      return { response, json };
    };
    const login = async (email) => {
      const { response, json } = await request('POST', '/api/v1/auth/login', {}, { email, password: TEST_PASSWORD });
      assert.equal(response.status, 200);
      return { cookie: response.headers.get('set-cookie').split(';')[0], csrf: json.data.csrfToken };
    };
    try {
      const registration = await request('POST', '/api/v1/auth/register', {}, {
        displayName: 'PG cycle citizen', email: 'pg-cycle@example.test', password: TEST_PASSWORD, consentAccepted: true,
      });
      assert.equal(registration.response.status, 201);
      const author = { cookie: registration.response.headers.get('set-cookie').split(';')[0], csrf: registration.json.data.csrfToken };
      const transport = await login('transport@example.test');
      const utilities = await login('utilities@example.test');
      const administrator = await login('admin@example.test');
      const created = await request('POST', '/api/v1/ideas', author, { ...TRANSPORT, territoryId });
      assert.equal(created.response.status, 201);
      const ideaId = created.json.data.id;
      const { default: sharp } = await import('sharp');
      const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#1d9671' } }).png().toBuffer();
      const form = new FormData();
      form.append('expectedVersion', String(created.json.data.version));
      form.append('file', new Blob([png], { type: 'image/png' }), 'intersection.png');
      const uploadResponse = await fetch(base + `/api/v1/ideas/${ideaId}/attachments`, {
        method: 'POST', headers: { origin, cookie: author.cookie, 'x-csrf-token': author.csrf, 'idempotency-key': randomUUID() }, body: form,
      });
      assert.equal(uploadResponse.status, 201);
      const upload = (await uploadResponse.json()).data;
      let current = await request('POST', `/api/v1/ideas/${ideaId}/submit`, author,
        { expectedVersion: upload.ideaVersion, consentAccepted: true });
      assert.equal(current.response.status, 200);
      assert.equal(current.json.data.routing.effectiveCategoryCode, 'TRANSPORT');
      const queue = await request('GET', '/api/v1/ideas?scope=staff', transport);
      assert.ok(queue.json.data.some((row) => row.id === ideaId));
      current = await request('POST', `/api/v1/ideas/${ideaId}/status`, transport,
        { expectedVersion: current.json.data.version, toStatus: 'UNDER_REVIEW', takeOwnership: true });
      assert.equal(current.response.status, 200);
      const publicReply = 'Публичный ответ PG: предложение проверено, уточняем место установки датчиков.';
      const internalReply = 'Закрытая служебная заметка PG для сотрудников текущего органа.';
      let note = await request('POST', `/api/v1/ideas/${ideaId}/comments`, transport,
        { expectedVersion: current.json.data.version, visibility: 'PUBLIC', body: publicReply });
      assert.equal(note.response.status, 201);
      note = await request('POST', `/api/v1/ideas/${ideaId}/comments`, transport,
        { expectedVersion: note.json.data.ideaVersion, visibility: 'INTERNAL', body: internalReply });
      assert.equal(note.response.status, 201);
      const timeline = await request('GET', `/api/v1/ideas/${ideaId}/timeline`, author);
      assert.ok(timeline.json.data.some((event) => event.body === publicReply));
      assert.ok(!JSON.stringify(timeline.json).includes(internalReply));
      const question = 'Уточните перекрёсток возле школы и время максимальной загруженности дороги.';
      current = await request('POST', `/api/v1/ideas/${ideaId}/status`, transport,
        { expectedVersion: note.json.data.ideaVersion, toStatus: 'NEEDS_INFO', publicComment: question });
      assert.equal(current.response.status, 200);
      const answer = 'Перекрёсток у школы, основная загруженность наблюдается с восьми до девяти утра.';
      current = await request('POST', `/api/v1/ideas/${ideaId}/clarifications`, author,
        { expectedVersion: current.json.data.version, body: answer });
      assert.equal(current.response.status, 200);
      assert.equal(current.json.data.status, 'UNDER_REVIEW');
      const afterAnswer = await request('GET', `/api/v1/ideas/${ideaId}/timeline`, author);
      assert.ok(afterAnswer.json.data.some((event) => event.body === answer));
      current = await request('POST', `/api/v1/admin/ideas/${ideaId}/reroute`, administrator, {
        expectedVersion: current.json.data.version, organizationId: utilitiesOrgId, effectiveCategoryCode: 'UTILITIES',
        reason: 'Передаём комплексную идею в направление ЖКХ для дальнейшего рассмотрения.',
      });
      assert.equal(current.response.status, 200);
      assert.equal((await request('GET', `/api/v1/ideas/${ideaId}`, transport)).response.status, 404);
      const deniedFile = await fetch(base + `/api/v1/attachments/${upload.attachment.id}/download`, { headers: { cookie: transport.cookie } });
      assert.equal(deniedFile.status, 404);
      const movedQueue = await request('GET', '/api/v1/ideas?scope=staff&assignee=unassigned', utilities);
      assert.ok(movedQueue.json.data.some((row) => row.id === ideaId));
      const assigned = await request('POST', `/api/v1/ideas/${ideaId}/assignment`, utilities,
        { expectedVersion: current.json.data.version, assigneeId: (await db.query("SELECT id FROM users WHERE email_normalized='utilities@example.test'")).rows[0].id });
      assert.equal(assigned.response.status, 200);
      const rejection = 'Идея отклонена с объяснением PG: предложенное решение требует другого технического подхода.';
      const rejected = await request('POST', `/api/v1/ideas/${ideaId}/status`, utilities,
        { expectedVersion: assigned.json.data.version, toStatus: 'REJECTED', publicComment: rejection });
      assert.equal(rejected.response.status, 200);
      const residentDetail = await request('GET', `/api/v1/ideas/${ideaId}`, author);
      assert.equal(residentDetail.json.data.status, 'REJECTED');
      const finalHistory = await request('GET', `/api/v1/ideas/${ideaId}/timeline`, author);
      assert.ok(finalHistory.json.data.some((event) => event.body === rejection));
      const notifications = await request('GET', '/api/v1/notifications?unreadOnly=true', author);
      assert.ok(notifications.json.data.some((notification) => notification.kind === 'REROUTED'));
      assert.ok(notifications.json.data.some((notification) => notification.kind === 'STATUS_CHANGED'));
    } finally {
      server.closeAllConnections();
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
