// Hermetic regression coverage: memory-only PostgreSQL engine and synthetic
// identities. No ambient DATABASE_URL/PGLITE_DIR, shared resets or HTTP stand.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import argon2 from 'argon2';
import { openDatabase, databaseTimeouts } from '../../../src/server/db/client.mjs';
import { migrate } from '../../../scripts/migrate.mjs';
import {
  createSession, getSession, csrfTokenForSession, sha256Hex, verifyCsrf,
} from '../../../src/server/auth/session.mjs';
import { RateLimiter } from '../../../src/server/auth/rateLimit.mjs';
import { hashPassword, verifyPassword } from '../../../src/server/auth/password.mjs';
import { registerCitizen } from '../../../src/server/auth/service.mjs';

async function memoryDb() {
  return openDatabase({ databaseUrl: null, pgliteDir: null });
}

describe('B-06 database isolation and migrations', () => {
  it('rollback of a concurrent transaction cannot undo another commit or capture a standalone query', async () => {
    const db = await memoryDb();
    try {
      await db.query('CREATE TABLE tx_probe(label TEXT)');
      let releaseFirst;
      let insertedFirst;
      const release = new Promise((resolve) => { releaseFirst = resolve; });
      const inserted = new Promise((resolve) => { insertedFirst = resolve; });
      const first = db.transaction(async (tx) => {
        await tx.query("INSERT INTO tx_probe VALUES('committed')");
        insertedFirst();
        await release;
      });
      await inserted;
      let secondEntered = false;
      const second = assert.rejects(db.transaction(async (tx) => {
        secondEntered = true;
        await tx.query("INSERT INTO tx_probe VALUES('rolled-back')");
        throw new Error('planned rollback');
      }), /planned rollback/);
      const outside = db.query("INSERT INTO tx_probe VALUES('outside')");
      try {
        await delay(20);
        assert.equal(secondEntered, false, 'second transaction must wait for the first');
      } finally {
        releaseFirst();
        await Promise.all([first, second, outside]);
      }
      assert.deepEqual((await db.query('SELECT label FROM tx_probe ORDER BY label')).rows,
        [{ label: 'committed' }, { label: 'outside' }]);
    } finally { await db.close(); }
  });

  it('simultaneous migrations apply each version once', async () => {
    const db = await memoryDb();
    try {
      const results = await Promise.all([migrate(db), migrate(db)]);
      assert.ok(results[0].fresh.includes('0004_location_geometry.sql'));
      assert.deepEqual(results[1].fresh, []);
      const rows = await db.query('SELECT version FROM schema_migrations');
      assert.equal(rows.rows.length, results[0].fresh.length);
      assert.equal(new Set(rows.rows.map((row) => row.version)).size, rows.rows.length);
    } finally { await db.close(); }
  });

  it('failure midway through pending migrations rolls back schema and ledger together', async () => {
    const db = await memoryDb();
    try {
      const broken = {
        kind: db.kind,
        transaction: (fn) => db.transaction((tx) => fn({
          query: (text, params) => {
            if (text.includes('CREATE OR REPLACE FUNCTION guard_ideas_immutable')) throw new Error('injected schema failure');
            return tx.query(text, params);
          },
        })),
      };
      await assert.rejects(migrate(broken), /Migration 0002_guards.sql failed: injected schema failure/);
      const tables = await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public'");
      assert.deepEqual(tables.rows, []);
      assert.ok((await migrate(db)).fresh.includes('0004_location_geometry.sql'));
    } finally { await db.close(); }
  });

  it('PostgreSQL migration lock precedes ledger creation, using only scoped queries', async () => {
    const db = await memoryDb();
    try {
      const calls = [];
      const pgShape = {
        kind: 'pg',
        query: () => { throw new Error('unscoped pool query'); },
        transaction: (fn) => db.transaction((tx) => fn({
          query: (text, params) => {
            calls.push(text);
            return text.includes('pg_advisory_xact_lock') ? { rows: [] } : tx.query(text, params);
          },
        })),
      };
      await migrate(pgShape);
      assert.match(calls[0], /pg_advisory_xact_lock/);
      assert.match(calls[1], /CREATE TABLE IF NOT EXISTS schema_migrations/);
      assert.ok(!calls.some((text) => /^(BEGIN|COMMIT|ROLLBACK)$/.test(text)));
    } finally { await db.close(); }
  });

  it('database timeouts are bounded by default and reject invalid configuration', () => {
    assert.deepEqual(databaseTimeouts({}, {}), {
      connectionTimeoutMillis: 5000, statement_timeout: 10000,
      query_timeout: 15000, idle_in_transaction_session_timeout: 15000,
    });
    assert.equal(databaseTimeouts({ connectionTimeoutMs: 1200 }, {}).connectionTimeoutMillis, 1200);
    assert.throws(() => databaseTimeouts({}, { DB_QUERY_TIMEOUT_MS: '0' }), /positive integer/);
    assert.throws(() => databaseTimeouts({ statementTimeoutMs: NaN }, {}), /positive integer/);
  });
});

describe('B-06 stable sessions and identity', () => {
  it('CSRF remains valid across repeated and concurrent session reads; legacy hashes upgrade once', async () => {
    const db = await memoryDb();
    try {
      await migrate(db);
      const region = await db.query("INSERT INTO regions(code,name_ru) VALUES('ABAI','Test') RETURNING id");
      const user = await db.query(
        "INSERT INTO users(email_normalized,display_name,password_hash,role,region_id) VALUES('csrf@example.test','test','synthetic','CITIZEN',$1) RETURNING id",
        [region.rows[0].id]);
      const created = await createSession(db, user.rows[0].id);
      assert.equal(created.csrfToken, csrfTokenForSession(created.token));
      const sessions = await Promise.all([getSession(db, created.token), getSession(db, created.token)]);
      for (const session of sessions) assert.ok(verifyCsrf(session, created.csrfToken));
      await db.query('UPDATE sessions SET csrf_token_hash=$1 WHERE id=$2',
        [sha256Hex('legacy-random-token'), created.sessionId]);
      const upgraded = await getSession(db, created.token);
      assert.ok(verifyCsrf(upgraded, created.csrfToken));
      assert.equal(verifyCsrf(upgraded, 'legacy-random-token'), false);
      assert.equal(verifyCsrf(upgraded, []), false);
      assert.equal((await getSession(db, created.token)).csrf_token_hash, upgraded.csrf_token_hash);
      const stored = (await db.query('SELECT * FROM sessions WHERE id=$1', [created.sessionId])).rows[0];
      assert.equal(stored.token_hash, sha256Hex(created.token));
      assert.equal(stored.csrf_token_hash, sha256Hex(created.csrfToken));
      assert.ok(!Object.values(stored).includes(created.token));
      assert.ok(!Object.values(stored).includes(created.csrfToken));
      assert.notEqual(csrfTokenForSession('other-session'), created.csrfToken);
    } finally { await db.close(); }
  });

  it('concurrent registrations of one normalized email produce one citizen and a field error', async () => {
    const db = await memoryDb();
    try {
      await migrate(db);
      await db.query("INSERT INTO regions(code,name_ru) VALUES('ABAI','Test')");
      const input = { displayName: 'test', email: 'race@example.test', password: 'synthetic-Password-12', consentAccepted: true };
      const results = await Promise.allSettled([
        registerCitizen(db, input), registerCitizen(db, { ...input, email: 'RACE@EXAMPLE.TEST' }),
      ]);
      assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
      const failed = results.find((result) => result.status === 'rejected').reason;
      assert.equal(failed.code, 'VALIDATION_ERROR');
      assert.ok(failed.fields.email);
      assert.equal((await db.query("SELECT count(*)::int AS c FROM users WHERE email_normalized='race@example.test'")).rows[0].c, 1);
    } finally { await db.close(); }
  });
});

describe('B-06 bounded authentication work', () => {
  it('retryAfter does not consume attempts; five failures stop verification before success is possible', async () => {
    const limiter = new RateLimiter();
    let verifications = 0;
    const attempt = async (passwordCorrect, now) => {
      const retry = limiter.retryAfter('client:email', 5, 900, now);
      if (retry) return { status: 429, retry };
      verifications++;
      if (!passwordCorrect) { limiter.fail('client:email', 900, now); return { status: 401 }; }
      limiter.clear('client:email');
      return { status: 200 };
    };
    for (let n = 0; n < 5; n++) {
      assert.equal(limiter.retryAfter('client:email', 5, 900, 100 + n), null);
      assert.equal((await attempt(false, 100 + n)).status, 401);
    }
    assert.deepEqual(await attempt(true, 105), { status: 429, retry: 895 });
    assert.equal(verifications, 5);
    assert.equal((await attempt(true, 1005)).status, 200);
    assert.equal(verifications, 6);
    assert.equal(limiter.hits.size, 0);
  });

  it('live buckets cannot exceed capacity or evict active protection', () => {
    const limiter = new RateLimiter({ maxKeys: 2, maxHitsPerKey: 5 });
    assert.equal(limiter.check('a', 1, 10, 100), null);
    assert.equal(limiter.check('b', 1, 10, 101), null);
    assert.equal(limiter.check('c', 1, 10, 102), 8);
    assert.equal(limiter.hits.size, 2);
    assert.equal(limiter.retryAfter('a', 1, 10, 102), 8);
    for (let n = 0; n < 10; n++) limiter.fail('b', 10, 103);
    assert.equal(limiter.hits.get('b').length, 5);
    assert.equal(limiter.check('c', 1, 10, 110), null);
    assert.equal(limiter.hits.size, 2);
  });

  it('hashes and checks share a semaphore and reject work beyond its bounded queue', async () => {
    const originalHash = argon2.hash;
    const originalVerify = argon2.verify;
    let active = 0;
    let peak = 0;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const work = async (result) => {
      active++;
      peak = Math.max(peak, active);
      await gate;
      active--;
      return result;
    };
    argon2.hash = () => work('synthetic-hash');
    argon2.verify = () => work(true);
    let settled;
    try {
      settled = Promise.allSettled(Array.from({ length: 70 }, (_, n) => n % 2
        ? hashPassword('synthetic-password') : verifyPassword('synthetic-hash', 'synthetic-password')));
      await delay(5);
      assert.equal(peak, 4);
    } finally {
      release();
      const results = await settled;
      argon2.hash = originalHash;
      argon2.verify = originalVerify;
      assert.equal(results.filter((result) => result.status === 'fulfilled').length, 68);
      const rejected = results.filter((result) => result.status === 'rejected');
      assert.equal(rejected.length, 2);
      for (const result of rejected) assert.equal(result.reason.code, 'RATE_LIMITED');
    }
  });
});
