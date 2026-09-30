import { before, beforeEach, after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../../../src/server/db/client.mjs';
import { migrate } from '../../../scripts/migrate.mjs';
import { seed, uuidFromSeedKey } from '../../../scripts/seed.mjs';
import { admitClassificationCall } from '../../../src/server/routing/budget.mjs';

let db;
const first = uuidFromSeedKey('user:citizen1');
const second = uuidFromSeedKey('user:citizen2');
const third = uuidFromSeedKey('user:staff_transport');
before(async () => {
  db = await openDatabase({ databaseUrl: null, pgliteDir: null });
  await migrate(db);
  await seed(db, { demoPassword: 'isolated-budget-test-only',
    fixture: new URL('../../../fixtures/demo-seed.json', import.meta.url) });
});
beforeEach(async () => {
  await db.query('DELETE FROM classifier_actor_budget');
  await db.query('DELETE FROM classifier_global_budget');
});
after(async () => { await db?.close(); });
const snapshot = async () => ({
  global: (await db.query('SELECT used_calls, expires_at FROM classifier_global_budget')).rows,
  actors: (await db.query('SELECT actor_id, used_calls, expires_at FROM classifier_actor_budget ORDER BY actor_id')).rows,
});

describe('shared paid-classifier budget', () => {
  it('concurrent callers admit at most 50 for one actor and denial consumes neither bucket', async () => {
    const outcomes = await Promise.all(Array.from({ length: 60 }, () => admitClassificationCall(db, { actorId: first })));
    assert.equal(outcomes.filter(Boolean).length, 50);
    const beforeState = await snapshot();
    assert.equal(beforeState.global[0].used_calls, 50);
    assert.equal(beforeState.actors[0].used_calls, 50);
    assert.equal(await admitClassificationCall(db, { actorId: first }), false);
    assert.deepEqual(await snapshot(), beforeState);
  });
  it('enforces a shared global 100 across actors and instances of the caller', async () => {
    const outcomes = await Promise.all([first, second, third].flatMap((actorId) =>
      Array.from({ length: 45 }, () => admitClassificationCall(db, { actorId }))));
    assert.equal(outcomes.filter(Boolean).length, 100);
    const beforeState = await snapshot();
    assert.equal(beforeState.global[0].used_calls, 100);
    assert.equal(beforeState.actors.reduce((sum, row) => sum + row.used_calls, 0), 100);
    assert.equal(await admitClassificationCall(db, { actorId: second }), false);
    assert.deepEqual(await snapshot(), beforeState);
  });
  it('resets expired windows on admission without changing a live actor window', async () => {
    await admitClassificationCall(db, { actorId: first });
    await db.query("UPDATE classifier_global_budget SET used_calls=100, expires_at=now()-interval '1 second'");
    await db.query("UPDATE classifier_actor_budget SET used_calls=50, expires_at=now()-interval '1 second'");
    assert.equal(await admitClassificationCall(db, { actorId: first }), true);
    const state = await snapshot();
    assert.equal(state.global[0].used_calls, 1);
    assert.equal(state.actors[0].used_calls, 1);
    assert.ok(new Date(state.global[0].expires_at).getTime() > Date.now());
  });
  it('does not consume a fresh global window when an actor window is exhausted', async () => {
    await admitClassificationCall(db, { actorId: first });
    await db.query("UPDATE classifier_global_budget SET used_calls=10, expires_at=now()-interval '1 second'");
    await db.query('UPDATE classifier_actor_budget SET used_calls=50 WHERE actor_id=$1', [first]);
    const beforeState = await snapshot();
    assert.equal(await admitClassificationCall(db, { actorId: first }), false);
    assert.deepEqual(await snapshot(), beforeState);
  });
  it('rolls back the global increment if the actor write fails', async () => {
    await admitClassificationCall(db, { actorId: first });
    const beforeState = await snapshot();
    await db.query('ALTER TABLE classifier_actor_budget ADD CONSTRAINT b10_fault CHECK (used_calls <= 1) NOT VALID');
    try { await assert.rejects(admitClassificationCall(db, { actorId: first })); }
    finally { await db.query('ALTER TABLE classifier_actor_budget DROP CONSTRAINT b10_fault'); }
    assert.deepEqual(await snapshot(), beforeState);
  });
  it('denies missing, malformed or nonexistent actors without a paid admission', async () => {
    assert.equal(await admitClassificationCall(db, {}), false);
    assert.equal(await admitClassificationCall(db, { actorId: 'not-a-uuid' }), false);
    assert.equal(await admitClassificationCall(db, { actorId: randomUUID() }), false);
    const state = await snapshot();
    assert.equal(state.global[0].used_calls, 0);
    assert.equal(state.actors.length, 0);
  });
});
