#!/usr/bin/env node
// B-owned demo seed. Consumes docs/fixtures/demo-seed.json (synthetic only).
// seedKey resolves to deterministic UUIDs; reruns upsert catalogs and never
// reset existing submitted ideas. Demo idea histories are created in B-03/B-04
// through domain transitions, not here.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import argon2 from 'argon2';
import { openDatabase } from '../src/server/db/client.mjs';
import { CONSENT_VERSION } from '../src/contracts/enums.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(here, '..', 'docs', 'fixtures', 'demo-seed.json');

const NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

// Deterministic UUIDv5 (RFC 4122) from a seed key.
export function uuidFromSeedKey(seedKey) {
  const ns = Buffer.from(NAMESPACE.replace(/-/g, ''), 'hex');
  const digest = createHash('sha1').update(ns).update(String(seedKey), 'utf8').digest();
  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = digest.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function seed(db, options = {}) {
  const fixture = JSON.parse(readFileSync(options.fixture || fixturePath, 'utf8'));
  if (fixture.schemaVersion !== 1 || fixture.syntheticOnly !== true) {
    throw new Error('Seed fixture must be schemaVersion 1 and syntheticOnly');
  }
  const demoPassword = options.demoPassword || process.env.DEMO_PASSWORD || 'demo-ChangeMe-12-chars';
  if (demoPassword.length < 12 || demoPassword.length > 128) {
    throw new Error('DEMO_PASSWORD must be 12..128 characters');
  }
  const passwordHash = await argon2.hash(demoPassword, {
    type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1,
  });
  const stats = { regions: 0, territories: 0, organizations: 0, rules: 0, users: 0 };

  const regionRes = await db.query(
    `INSERT INTO regions(id, code, name_ru, name_kk, active) VALUES($1,$2,$3,'',TRUE)
     ON CONFLICT (code) DO UPDATE SET name_ru=EXCLUDED.name_ru
     RETURNING id, (xmax = 0) AS inserted`,
    [uuidFromSeedKey('region:' + fixture.region.code), fixture.region.code, fixture.region.nameRu]
  );
  const regionId = regionRes.rows[0].id;
  if (regionRes.rows[0].inserted) stats.regions++;

  const territoryIds = {};
  for (const t of fixture.territories) {
    const r = await db.query(
      `INSERT INTO territories(id, region_id, code, kind, name_ru, name_kk, active, is_demo)
       VALUES($1,$2,$3,$4,$5,'',TRUE,TRUE)
       ON CONFLICT (code) DO UPDATE SET name_ru=EXCLUDED.name_ru, kind=EXCLUDED.kind, active=TRUE
       RETURNING id, (xmax = 0) AS inserted`,
      [uuidFromSeedKey('territory:' + t.code), regionId, t.code, t.kind || 'LOCALITY', t.nameRu]
    );
    territoryIds[t.code] = r.rows[0].id;
    if (r.rows[0].inserted) stats.territories++;
  }

  const orgIds = {};
  for (const o of fixture.organizations) {
    const r = await db.query(
      `INSERT INTO organizations(id, region_id, code, name, is_triage, active, is_demo)
       VALUES($1,$2,$3,$4,$5,$6,TRUE)
       ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name, is_triage=EXCLUDED.is_triage,
         active=EXCLUDED.active
       RETURNING id, (xmax = 0) AS inserted`,
      [uuidFromSeedKey('org:' + o.code), regionId, o.code, o.name, !!o.isTriage, o.active !== false]
    );
    orgIds[o.code] = r.rows[0].id;
    if (r.rows[0].inserted) stats.organizations++;
  }

  // Replace the demo routing rule set for this region+version (decisions keep
  // their own rule_version copy, so no FK blocks the replacement).
  await db.query(`DELETE FROM routing_rules WHERE region_id=$1 AND version='rules-v1'`, [regionId]);
  for (const rule of fixture.routingRules) {
    await db.query(
      `INSERT INTO routing_rules(id, region_id, territory_id, category_code, organization_id, priority, version, active)
       VALUES(gen_random_uuid(),$1,$2,$3,$4,$5,$6,TRUE)`,
      [regionId, rule.territoryCode ? territoryIds[rule.territoryCode] : null,
        rule.categoryCode, orgIds[rule.organizationCode], rule.priority || 100, rule.version || 'rules-v1']
    );
    stats.rules++;
  }

  for (const u of fixture.users) {
    const emailNormalized = u.email.trim().toLowerCase();
    const orgId = u.organizationCode ? orgIds[u.organizationCode] : null;
    if (u.role === 'STAFF' && !orgId) throw new Error(`STAFF seed user without org: ${u.seedKey}`);
    const r = await db.query(
      `INSERT INTO users(id, email_normalized, display_name, password_hash, role, organization_id, region_id, active)
       VALUES($1,$2,$3,$4,$5,$6,$7,TRUE)
       ON CONFLICT (email_normalized) DO UPDATE SET display_name=EXCLUDED.display_name,
         role=EXCLUDED.role, organization_id=EXCLUDED.organization_id, active=TRUE
       RETURNING id, (xmax = 0) AS inserted`,
      [uuidFromSeedKey('user:' + u.seedKey), emailNormalized, u.displayName, passwordHash,
        u.role, orgId, regionId]
    );
    if (r.rows[0].inserted) stats.users++;
    if (u.role === 'CITIZEN') {
      await db.query(
        `INSERT INTO user_consents(user_id, purpose, version) VALUES($1,'service',$2)
         ON CONFLICT DO NOTHING`,
        [r.rows[0].id, CONSENT_VERSION]
      );
    }
  }
  return { regionId, stats };
}

const runAsScript = process.argv[1] && path.resolve(process.argv[1]) === path.join(here, 'seed.mjs');
if (runAsScript) {
  const db = await openDatabase();
  try {
    const result = await migrateIfWanted(db);
    console.log(JSON.stringify({ backend: db.kind, ...result }));
  } finally {
    await db.close();
  }
}

async function migrateIfWanted(db) {
  const { migrate } = await import('./migrate.mjs');
  await migrate(db);
  return seed(db);
}
