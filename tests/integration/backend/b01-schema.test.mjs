// B-01 integration tests: migrations, catalogs, seed idempotency, SQL guards.
// Runs against PGlite (a real PostgreSQL engine). INT-01 coverage.
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../../../src/server/db/client.mjs';
import { migrate } from '../../../scripts/migrate.mjs';
import { seed, uuidFromSeedKey } from '../../../scripts/seed.mjs';
import { CATEGORY_CODES } from '../../../src/contracts/enums.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const contractsTs = readFileSync(
  path.join(here, '..', '..', '..', 'src', 'contracts', 'index.ts'), 'utf8');

let db;
let ids = {};

before(async () => {
  db = await openDatabase();
  await migrate(db);
  const first = await seed(db, { demoPassword: 'test-Seed-12-chars' });
  ids = { regionId: first.regionId };
  // A draft idea that a reseed must never touch.
  await db.query(
    `INSERT INTO ideas(id, region_id, author_id, title) VALUES($1,$2,$3,'probe')`,
    ['11111111-1111-4111-8111-111111111111', first.regionId,
      uuidFromSeedKey('user:citizen1')]);
  const second = await seed(db, { demoPassword: 'test-Seed-12-chars' });
  ids.secondStats = second.stats;
  const row = await db.query('SELECT * FROM ideas WHERE id=$1',
    ['11111111-1111-4111-8111-111111111111']);
  ids.probeIdea = row.rows[0];
});

describe('B-01 migrations and seed (INT-01)', () => {
  it('applies all migrations and is a no-op on rerun', async () => {
    const again = await migrate(db);
    assert.deepEqual(again.fresh, []);
    assert.ok(again.applied.length >= 3);
  });

  it('reseed creates no duplicates and preserves user ideas', async () => {
    assert.deepEqual(ids.secondStats, {
      regions: 0, territories: 0, organizations: 0, rules: 9, users: 0,
    });
    const users = await db.query('SELECT count(*)::int AS c FROM users');
    assert.equal(users.rows[0].c, 9);
    const orgs = await db.query('SELECT count(*)::int AS c FROM organizations');
    assert.equal(orgs.rows[0].c, 6);
    const rules = await db.query(
      `SELECT count(*)::int AS c FROM routing_rules WHERE version='rules-v1'`);
    assert.equal(rules.rows[0].c, 9);
    assert.equal(ids.probeIdea.title, 'probe');
  });

  it('categories match the contract enum', async () => {
    const rows = await db.query('SELECT code FROM categories WHERE active ORDER BY code');
    assert.deepEqual(rows.rows.map((r) => r.code).sort(), [...CATEGORY_CODES].sort());
  });

  it('exactly one active triage organization per region', async () => {
    const rows = await db.query(
      `SELECT count(*)::int AS c FROM organizations
        WHERE region_id=$1 AND is_triage AND active`, [ids.regionId]);
    assert.equal(rows.rows[0].c, 1);
    await assert.rejects(
      db.query(
        `INSERT INTO organizations(region_id, code, name, is_triage, active)
         VALUES($1,'SECOND_TRIAGE','x',TRUE,TRUE)`, [ids.regionId]),
      /single_active_triage|duplicate/i);
  });

  it('STAFF requires an organization', async () => {
    await assert.rejects(
      db.query(
        `INSERT INTO users(email_normalized, display_name, password_hash, role, region_id)
         VALUES('norole@example.test','x','x','STAFF',$1)`, [ids.regionId]),
      /staff_requires_organization/i);
  });

  it('submitted number and timestamps are immutable, versions never decrease', async () => {
    const ideaId = '22222222-2222-4222-8222-222222222222';
    await db.query(
      `INSERT INTO ideas(id, region_id, author_id, public_number, title, problem, solution,
         effective_category_code, organization_id, territory_id, status, submitted_at)
       VALUES($1,$2,$3,'ABAI-2026-000001','t','p','s','TRANSPORT',
         (SELECT id FROM organizations WHERE code='DEMO_TRANSPORT'),
         (SELECT id FROM territories WHERE code='DEMO_SEMEY'),
         'RECEIVED', now())`,
      [ideaId, ids.regionId, uuidFromSeedKey('user:citizen1')]);
    await assert.rejects(
      db.query(`UPDATE ideas SET public_number='ABAI-2026-000002' WHERE id=$1`, [ideaId]),
      /IMMUTABLE_PUBLIC_NUMBER/);
    await assert.rejects(
      db.query(`UPDATE ideas SET version=0 WHERE id=$1`, [ideaId]),
      /VERSION_MUST_NOT_DECREASE/);
  });

  it('resolution_type only with COMPLETED', async () => {
    await assert.rejects(
      db.query(
        `INSERT INTO ideas(region_id, author_id, title, status, resolution_type)
         VALUES($1,$2,'t','RECEIVED','ANSWER_PROVIDED')`,
        [ids.regionId, uuidFromSeedKey('user:citizen1')]),
      /resolution_only_when_completed/i);
  });

  it('at most 3 active attachments per idea', async () => {
    const ideaId = '33333333-3333-4333-8333-333333333333';
    await db.query(
      `INSERT INTO ideas(id, region_id, author_id, title) VALUES($1,$2,$3,'files')`,
      [ideaId, ids.regionId, uuidFromSeedKey('user:citizen1')]);
    for (let n = 0; n < 3; n++) {
      await db.query(
        `INSERT INTO attachments(idea_id, uploaded_by, storage_key, original_name,
           detected_mime, size_bytes, sha256)
         VALUES($1,$2,$3,'a.png','image/png',10,'abc')`,
        [ideaId, uuidFromSeedKey('user:citizen1'), `key-${n}`]);
    }
    await assert.rejects(
      db.query(
        `INSERT INTO attachments(idea_id, uploaded_by, storage_key, original_name,
           detected_mime, size_bytes, sha256)
         VALUES($1,$2,'key-3','a.png','image/png',10,'abc')`,
        [ideaId, uuidFromSeedKey('user:citizen1')]),
      /ATTACHMENT_LIMIT_REACHED/);
  });

  it('events and audit are append-only', async () => {
    const ev = await db.query(
      `INSERT INTO idea_events(idea_id, type) VALUES($1,'CREATED') RETURNING id`,
      ['11111111-1111-4111-8111-111111111111']);
    await assert.rejects(
      db.query(`UPDATE idea_events SET type='SUBMITTED' WHERE id=$1`, [ev.rows[0].id]),
      /APPEND_ONLY_TABLE/);
    const au = await db.query(
      `INSERT INTO audit_events(region_id, action, entity_type, entity_id, request_id)
       VALUES($1,'test','idea','x','req-1') RETURNING id`, [ids.regionId]);
    await assert.rejects(
      db.query(`DELETE FROM audit_events WHERE id=$1`, [au.rows[0].id]),
      /APPEND_ONLY_TABLE/);
  });

  it('cross-region references are rejected', async () => {
    const other = await db.query(
      `INSERT INTO regions(code, name_ru) VALUES('OTHER','Другой') RETURNING id`);
    const otherTerr = await db.query(
      `INSERT INTO territories(region_id, code, name_ru) VALUES($1,'OTHER_T','t') RETURNING id`,
      [other.rows[0].id]);
    await assert.rejects(
      db.query(
        `INSERT INTO ideas(region_id, author_id, title, territory_id)
         VALUES($1,$2,'t',$3)`,
        [ids.regionId, uuidFromSeedKey('user:citizen1'), otherTerr.rows[0].id]),
      /REGION_MISMATCH_TERRITORY/);
  });

  it('assignee must belong to the current organization', async () => {
    const ideaId = '44444444-4444-4444-8444-444444444444';
    await db.query(
      `INSERT INTO ideas(id, region_id, author_id, title, organization_id)
       VALUES($1,$2,$3,'t',(SELECT id FROM organizations WHERE code='DEMO_TRANSPORT'))`,
      [ideaId, ids.regionId, uuidFromSeedKey('user:citizen1')]);
    await assert.rejects(
      db.query(`UPDATE ideas SET assignee_id=$2 WHERE id=$1`,
        [ideaId, uuidFromSeedKey('user:staff_utilities')]),
      /ASSIGNEE_OUTSIDE_ORGANIZATION/);
  });

  it('seed fails closed without an explicit password', async () => {
    const fresh = await openDatabase();
    try {
      await migrate(fresh);
      await assert.rejects(seed(fresh), /DEMO_PASSWORD/);
    } finally {
      await fresh.close();
    }
  });

  it('transaction helper rolls back failed work', async () => {
    await assert.rejects(db.transaction(async (tx) => {
      await tx.query(`INSERT INTO regions(code, name_ru) VALUES('TMP','tmp')`);
      throw new Error('boom');
    }), /boom/);
    const row = await db.query(`SELECT count(*)::int AS c FROM regions WHERE code='TMP'`);
    assert.equal(row.rows[0].c, 0);
  });

  it('runtime contract mirror matches src/contracts/index.ts', () => {
    for (const [tsName, jsValues] of [
      ['Role', ['CITIZEN', 'STAFF', 'ADMIN']],
      ['IdeaStatus', ['DRAFT', 'RECEIVED', 'UNDER_REVIEW', 'NEEDS_INFO', 'IN_PROGRESS', 'COMPLETED', 'REJECTED']],
      ['CategoryCode', CATEGORY_CODES],
    ]) {
      const m = new RegExp(tsName + '\\s*=\\s*\\[([\\s\\S]*?)\\]').exec(contractsTs);
      assert.ok(m, `enum ${tsName} found in index.ts`);
      const tsValues = [...m[1].matchAll(/"([A-Z_]+)"/g)].map((x) => x[1]);
      assert.deepEqual([...jsValues].sort(), tsValues.sort(), `drift: ${tsName}`);
    }
  });
});
