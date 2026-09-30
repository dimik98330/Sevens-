// Isolated service/SQL regressions; never reads DATABASE_URL or live data.
import { before, beforeEach, after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../../../src/server/db/client.mjs';
import { migrate } from '../../../scripts/migrate.mjs';
import { seed } from '../../../scripts/seed.mjs';
import { submitLimiter } from '../../../src/server/auth/rateLimit.mjs';
import { createDraft, updateDraft, submitIdea } from '../../../src/server/ideas/service.mjs';
import {
  assignIdea, changeStatus, addComment, rerouteIdea, answerClarification,
  listStaffQueue, analyticsSummary, listNotifications, readNotification,
} from '../../../src/server/workflow/service.mjs';

let db, citizen, staff, admin, territoryId, triageOrgId;
const text = {
  title: 'Умные светофоры рядом со школой',
  problem: 'Возле школы дорога требует внимания к безопасности детей и загруженности движения.',
  solution: 'Установить умные светофоры и датчики загруженности дороги, добавить приложение.',
};
const requestId = 'b06-service-regression';
const fails = (code, field) => (error) => error.code === code && (!field || Boolean(error.fields?.[field]));
const version = (idea) => ({ expectedVersion: idea.version });

async function fresh(suffix = '', override = {}) {
  const draft = (await createDraft(db, citizen,
    { ...text, title: `${text.title} ${suffix}`.trim(), territoryId, requestedCategoryCode: null, ...override },
    randomUUID(), requestId)).body;
  return (await submitIdea(db, citizen, draft.id,
    { ...version(draft), consentAccepted: true }, randomUUID(), requestId)).body;
}

async function take(idea) {
  return (await changeStatus(db, staff, idea.id,
    { ...version(idea), toStatus: 'UNDER_REVIEW', takeOwnership: true }, randomUUID(), requestId)).body;
}

async function effects(ideaId) {
  return (await db.query(
    `SELECT i.status, i.version,
      (SELECT count(*)::int FROM comments WHERE idea_id=i.id) AS comments,
      (SELECT count(*)::int FROM idea_events WHERE idea_id=i.id) AS events,
      (SELECT count(*)::int FROM notifications WHERE idea_id=i.id) AS notifications,
      (SELECT count(*)::int FROM audit_events WHERE entity_id=i.id::text) AS audits
     FROM ideas i WHERE i.id=$1`, [ideaId])).rows[0];
}

before(async () => {
  db = await openDatabase({ databaseUrl: null, pgliteDir: null });
  await migrate(db);
  await seed(db, { demoPassword: 'b06-test-password-only' });
  const users = (await db.query(`SELECT id, role, region_id AS "regionId",
    organization_id AS "organizationId", email_normalized FROM users`)).rows;
  citizen = users.find((u) => u.email_normalized === 'citizen1@example.test');
  staff = users.find((u) => u.email_normalized === 'transport@example.test');
  admin = users.find((u) => u.email_normalized === 'admin@example.test');
  territoryId = (await db.query("SELECT id FROM territories WHERE code='DEMO_SEMEY'")).rows[0].id;
  triageOrgId = (await db.query("SELECT id FROM organizations WHERE code='DEMO_TRIAGE'")).rows[0].id;
});
after(async () => { await db?.close(); });
beforeEach(() => { submitLimiter.clear(`submit:${citizen.id}`); });

describe('workflow regression invariants', () => {
  it('parallel identical submit returns one saved result and notifies only the current organization', async () => {
    const draft = (await createDraft(db, citizen, { ...text, territoryId }, randomUUID(), requestId)).body;
    const key = randomUUID();
    const body = { ...version(draft), consentAccepted: true };
    const results = await Promise.all([
      submitIdea(db, citizen, draft.id, body, key, requestId),
      submitIdea(db, citizen, draft.id, body, key, requestId),
    ]);
    assert.deepEqual(results[0], results[1]);
    const counts = (await db.query(`SELECT
      (SELECT count(*)::int FROM routing_decisions WHERE idea_id=$1) AS routes,
      (SELECT count(*)::int FROM idea_events WHERE idea_id=$1 AND type='SUBMITTED') AS submits,
      (SELECT count(*)::int FROM audit_events WHERE entity_id=$1::text AND action='idea.submit') AS audits`,
    [draft.id])).rows[0];
    assert.deepEqual(counts, { routes: 1, submits: 1, audits: 1 });
    const recipients = (await db.query('SELECT recipient_id FROM notifications WHERE idea_id=$1', [draft.id])).rows;
    assert.deepEqual(recipients.map((r) => r.recipient_id).sort(), [citizen.id, staff.id].sort());
  });

  it('different concurrent status operations permit one winner and keep one assignment event', async () => {
    const idea = await fresh();
    const results = await Promise.allSettled([take(idea), take(idea)]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    const loser = results.find((r) => r.status === 'rejected');
    assert.equal(loser.reason.code, 'VERSION_CONFLICT');
    const assigned = (await db.query("SELECT count(*)::int AS c FROM idea_events WHERE idea_id=$1 AND type='ASSIGNED'", [idea.id])).rows[0].c;
    assert.equal(assigned, 1);
  });

  it('exhausted submission quota still permits saved success replay without duplicate effects', async () => {
    const draft = (await createDraft(db, citizen, { ...text, territoryId }, randomUUID(), requestId)).body;
    const key = randomUUID();
    const body = { ...version(draft), consentAccepted: true };
    const first = await submitIdea(db, citizen, draft.id, body, key, requestId);
    for (let n = 0; n < 9; n++) await fresh(`quota ${n}`);
    const blocked = (await createDraft(db, citizen, { ...text, territoryId }, randomUUID(), requestId)).body;
    const beforeState = await effects(blocked.id);
    await assert.rejects(submitIdea(db, citizen, blocked.id,
      { ...version(blocked), consentAccepted: true }, randomUUID(), requestId),
    (error) => error.code === 'RATE_LIMITED' && error.retryAfterSeconds > 0);
    assert.deepEqual(await effects(blocked.id), beforeState);
    assert.deepEqual(await submitIdea(db, citizen, draft.id, body, key, requestId), first);
  });

  it('every status change keeps the exact supplied public comment and saved replay', async () => {
    const taken = await take(await fresh());
    const body = { ...version(taken), toStatus: 'IN_PROGRESS', publicComment: 'Принято в работу, готовим план действий.' };
    const key = randomUUID();
    const first = await changeStatus(db, staff, taken.id, body, key, requestId);
    assert.deepEqual(await changeStatus(db, staff, taken.id, body, key, requestId), first);
    const comments = (await db.query(`SELECT c.body FROM idea_events e JOIN comments c ON c.id=e.comment_id
      WHERE e.idea_id=$1 AND e.to_status='IN_PROGRESS' AND e.visibility='PUBLIC'`, [taken.id])).rows;
    assert.deepEqual(comments, [{ body: body.publicComment }]);
  });

  for (const failedTable of ['audit_events', 'notifications']) {
    it(`a ${failedTable} failure rolls back comment/status/history and the same key retries cleanly`, async () => {
      const taken = await take(await fresh());
      const body = { ...version(taken), toStatus: 'IN_PROGRESS', publicComment: 'Комментарий и статус должны сохраниться вместе.' };
      const key = randomUUID();
      const beforeState = await effects(taken.id);
      const constraint = `b06_fault_${failedTable}`;
      const predicate = failedTable === 'audit_events' ? "action <> 'idea.status'" : "kind <> 'STATUS_CHANGED'";
      await db.query(`ALTER TABLE ${failedTable} ADD CONSTRAINT ${constraint} CHECK (${predicate}) NOT VALID`);
      try {
        await assert.rejects(changeStatus(db, staff, taken.id, body, key, requestId));
      } finally {
        await db.query(`ALTER TABLE ${failedTable} DROP CONSTRAINT ${constraint}`);
      }
      assert.deepEqual(await effects(taken.id), beforeState);
      const replay = await db.query('SELECT id FROM idempotency_records WHERE key=$1', [key]);
      assert.equal(replay.rows.length, 0);
      assert.equal((await changeStatus(db, staff, taken.id, body, key, requestId)).body.status, 'IN_PROGRESS');
    });
  }

  it('an old organization cannot replay its previous comment after rerouting', async () => {
    const idea = await fresh();
    const key = randomUUID();
    const body = { ...version(idea), visibility: 'PUBLIC', body: 'Ответ от транспортной организации до перенаправления.' };
    const comment = (await addComment(db, staff, idea.id, body, key, requestId)).body;
    await rerouteIdea(db, admin, idea.id, {
      expectedVersion: comment.ideaVersion, organizationId: triageOrgId,
      effectiveCategoryCode: 'OTHER', reason: 'Передаём идею специалисту центра разбора.',
    }, randomUUID(), requestId);
    const beforeState = await effects(idea.id);
    await assert.rejects(addComment(db, staff, idea.id, body, key, requestId), fails('NOT_FOUND'));
    assert.deepEqual(await effects(idea.id), beforeState);
  });

  it('pending clarification retains an assignee and employee return requires a public reason', async () => {
    const taken = await take(await fresh());
    const asked = (await changeStatus(db, staff, taken.id, {
      ...version(taken), toStatus: 'NEEDS_INFO', publicComment: 'Уточните конкретное место установки светофоров.',
    }, randomUUID(), requestId)).body;
    const beforeState = await effects(asked.id);
    await assert.rejects(assignIdea(db, staff, asked.id,
      { ...version(asked), assigneeId: null }, randomUUID(), requestId), fails('VALIDATION_ERROR', 'assigneeId'));
    await assert.rejects(changeStatus(db, staff, asked.id,
      { ...version(asked), toStatus: 'UNDER_REVIEW' }, randomUUID(), requestId), fails('VALIDATION_ERROR', 'publicComment'));
    assert.deepEqual(await effects(asked.id), beforeState);
    const moved = (await rerouteIdea(db, admin, asked.id, {
      ...version(asked), organizationId: triageOrgId, effectiveCategoryCode: 'OTHER',
      reason: 'Уточнение рассматривает другая организация.',
    }, randomUUID(), requestId)).body;
    const answered = (await answerClarification(db, citizen, asked.id,
      { ...version(moved), body: 'Установка возле школы, со стороны городского парка.' }, randomUUID(), requestId)).body;
    assert.equal(answered.status, 'UNDER_REVIEW');
    const row = (await db.query('SELECT assignee_id FROM ideas WHERE id=$1', [asked.id])).rows[0];
    assert.equal(row.assignee_id, null);
  });

  it('rejects malformed mutation fields, identifiers and fractional versions without changes', async () => {
    const idea = await fresh();
    const beforeState = await effects(idea.id);
    for (const invalidVersion of [0, -1, 1.5, '2', null]) {
      await assert.rejects(changeStatus(db, staff, idea.id,
        { expectedVersion: invalidVersion, toStatus: 'UNDER_REVIEW' }, randomUUID(), requestId), fails('VALIDATION_ERROR', 'expectedVersion'));
    }
    await assert.rejects(submitIdea(db, citizen, idea.id,
      { expectedVersion: 2, consentAccepted: true, organizationId: triageOrgId }, randomUUID(), requestId), fails('VALIDATION_ERROR', 'organizationId'));
    await assert.rejects(assignIdea(db, staff, idea.id,
      { ...version(idea), assigneeId: 'broken-id' }, randomUUID(), requestId), fails('VALIDATION_ERROR', 'assigneeId'));
    await assert.rejects(createDraft(db, citizen, { territoryId: 'broken-id' }, randomUUID(), requestId), fails('VALIDATION_ERROR', 'territoryId'));
    await assert.rejects(createDraft(db, citizen, [], randomUUID(), requestId), fails('VALIDATION_ERROR', 'body'));
    assert.deepEqual(await effects(idea.id), beforeState);
  });

  it('submission reads and routes the locked current text exclusively inside its transaction', async () => {
    const draft = (await createDraft(db, citizen, { ...text, territoryId }, randomUUID(), requestId)).body;
    const patched = (await updateDraft(db, citizen, draft.id, {
      ...version(draft), title: 'Мониторинг загрязнения воздуха в городе',
      problem: 'Возле домов загрязнение воздуха и смог, жителей беспокоит экология и выбросы.',
      solution: 'Установить датчики качества воздуха и карту загрязнения с уведомлениями.',
    }, requestId)).body;
    const transactionalOnly = {
      query: () => { throw new Error('Submission must not read business state outside the transaction'); },
      transaction: (callback) => db.transaction(callback),
    };
    const submitted = (await submitIdea(transactionalOnly, citizen, draft.id,
      { ...version(patched), consentAccepted: true }, randomUUID(), requestId)).body;
    assert.equal(submitted.routing.effectiveCategoryCode, 'ECOLOGY');
    const saved = (await db.query('SELECT title FROM ideas WHERE id=$1', [draft.id])).rows[0];
    assert.equal(saved.title, 'Мониторинг загрязнения воздуха в городе');
  });

  it('analytics applies the same organization/search/date filters as the queue, excludes drafts and handles empty data', async () => {
    const unique = randomUUID().slice(0, 8);
    const first = await fresh(unique);
    await fresh(unique);
    await createDraft(db, citizen, { ...text, title: `${text.title} ${unique}`, territoryId }, randomUUID(), requestId);
    await take(first);
    const query = { q: unique, territory: 'DEMO_SEMEY', page: 1, pageSize: 100 };
    const queue = await listStaffQueue(db, staff, query);
    const stats = await analyticsSummary(db, staff, query);
    assert.equal(stats.total, queue.total);
    assert.equal(stats.total, 2);
    assert.deepEqual(stats.byStatus, { RECEIVED: 1, UNDER_REVIEW: 1 });
    assert.deepEqual(stats.byCategory, { TRANSPORT: 2 });
    assert.equal(stats.unassigned, 1);
    assert.equal(stats.triage, 0);
    assert.ok(stats.medianFirstReviewSeconds >= 0);
    assert.deepEqual(await analyticsSummary(db, staff, { q: 'unmatched-unique-b06' }),
      { total: 0, byStatus: {}, byCategory: {}, unassigned: 0, triage: 0, medianFirstReviewSeconds: null });
    await assert.rejects(analyticsSummary(db, citizen, query), fails('FORBIDDEN'));
    await assert.rejects(analyticsSummary(db, admin, query), fails('FORBIDDEN'));
    const excluded = await analyticsSummary(db, staff, { ...query, dateToExclusive: '2000-01-01T00:00:00Z' });
    assert.equal(excluded.total, 0);
    assert.equal((await listStaffQueue(db, staff, { ...query, dateToExclusive: '2000-01-01T00:00:00Z' })).total, 0);
  });

  it('unreadCount covers the full actor set even when pagination returns one item', async () => {
    await fresh();
    const all = await listNotifications(db, citizen, { page: 1, pageSize: 100 });
    const one = await listNotifications(db, citizen, { page: 1, pageSize: 1 });
    assert.equal(one.items.length, 1);
    assert.equal(one.unreadCount, all.unreadCount);
    assert.ok(one.unreadCount > 1);
    await readNotification(db, citizen, one.items[0].id);
    const changed = await listNotifications(db, citizen, { page: 1, pageSize: 1 });
    assert.equal(changed.unreadCount, one.unreadCount - 1);
  });
});
