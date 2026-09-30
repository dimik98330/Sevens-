// B-05: real HTTP + isolated PostgreSQL engine; never uses DATABASE_URL.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDatabase } from '../../../src/server/db/client.mjs';
import { migrate, splitStatements } from '../../../scripts/migrate.mjs';
import { seed } from '../../../scripts/seed.mjs';
import { createServer } from '../../../src/server/http/app.mjs';

const ORIGIN = 'http://localhost:3000';
const PASSWORD = 'test-Seed-12-chars';
import { VALID_PNG as PNG } from './helpers/valid-png.mjs';
const TEXT = {
  title: 'Умные светофоры рядом со школой',
  problem: 'Возле школы дорога требует внимания к безопасности детей. Нужны датчики и понятная схема движения.',
  solution: 'Установить умные светофоры и датчики загруженности дороги, добавить приложение для уведомлений.',
};
const POINT = { type: 'Point', coordinates: [80.249, 50.411] };
const LINE = { type: 'LineString', coordinates: [[80.249, 50.411], [80.26, 50.415], [80.27, 50.42]] };
const POLYGON = { type: 'Polygon', coordinates: [[[80.249, 50.411], [80.26, 50.411], [80.26, 50.42], [80.249, 50.411]]] };
let db, base, server, citizen, other, transport, utilities, territoryId, legacyId, migrationResult, uploadDir;
const previousUploadDir = process.env.UPLOAD_DIR;
const savedShapes = [];

async function request(method, route, { auth, body, rawBody, key } = {}) {
  const headers = { origin: ORIGIN };
  if (auth) { headers.cookie = auth.cookie; headers['x-csrf-token'] = auth.csrf; }
  if (key) headers['idempotency-key'] = key;
  if (body !== undefined || rawBody !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(base + route, { method, headers, body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)) });
  const json = response.status === 204 ? null : await response.json();
  return { status: response.status, json, headers: response.headers };
}

async function login(email) {
  const response = await request('POST', '/api/v1/auth/login', { body: { email, password: PASSWORD } });
  assert.equal(response.status, 200);
  return { cookie: response.headers.get('set-cookie').split(';')[0], csrf: response.json.data.csrfToken };
}

async function draft(geometry, extra = {}) {
  const body = { ...TEXT, territoryId, locationText: 'У школы, со стороны перехода', ...extra };
  if (geometry !== undefined) body.locationGeometry = geometry;
  const result = await request('POST', '/api/v1/ideas', { auth: citizen, key: randomUUID(), body });
  assert.equal(result.status, 201, JSON.stringify(result.json));
  return result.json.data;
}

async function detail(id, auth = citizen) {
  const result = await request('GET', `/api/v1/ideas/${id}`, { auth });
  assert.equal(result.status, 200, JSON.stringify(result.json));
  return result.json.data;
}

before(async () => {
  uploadDir = mkdtempSync(path.join(tmpdir(), 'sevens-b05-uploads-'));
  process.env.UPLOAD_DIR = uploadDir;
  db = await openDatabase({ databaseUrl: null, pgliteDir: null });
  assert.equal(db.kind, 'pglite');
  // Build the old schema and seed real old rows before applying the additive
  // migration, reproducing an upgrade rather than only testing a fresh table.
  for (const filename of ['0001_schema.sql', '0002_guards.sql', '0003_categories.sql']) {
    const sql = readFileSync(new URL(`../../../db/migrations/${filename}`, import.meta.url), 'utf8');
    for (const statement of splitStatements(sql)) await db.query(statement);
    await db.query('INSERT INTO schema_migrations(version) VALUES($1)', [filename]);
  }
  await seed(db, { demoPassword: PASSWORD });
  territoryId = (await db.query("SELECT id FROM territories WHERE code='DEMO_SEMEY'")).rows[0].id;
  legacyId = (await db.query(`INSERT INTO ideas(region_id, author_id, title, location_text)
    SELECT region_id, id, 'Существовавшая до миграции идея', 'Ориентир из старой карточки'
    FROM users WHERE email_normalized='citizen1@example.test' RETURNING id`)).rows[0].id;
  migrationResult = await migrate(db);
  server = createServer(db);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  citizen = await login('citizen1@example.test');
  other = await login('citizen2@example.test');
  transport = await login('transport@example.test');
  utilities = await login('utilities@example.test');
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (db) await db.close();
  if (previousUploadDir === undefined) delete process.env.UPLOAD_DIR;
  else process.env.UPLOAD_DIR = previousUploadDir;
  if (uploadDir) {
    const resolved = path.resolve(uploadDir);
    assert.equal(path.dirname(resolved), path.resolve(tmpdir()));
    assert.ok(path.basename(resolved).startsWith('sevens-b05-uploads-'));
    rmSync(resolved, { recursive: true, force: true });
  }
});

describe('B-05 persisted private geometry', () => {
  it('upgrades legacy rows to null without losing text and reruns migrations safely', async () => {
    const laterMigrations = readdirSync(new URL('../../../db/migrations/', import.meta.url))
      .filter((name) => name.endsWith('.sql') && name > '0003_categories.sql').sort();
    assert.deepEqual(migrationResult.fresh, laterMigrations);
    assert.deepEqual((await migrate(db)).fresh, []);
    const before = await db.query('SELECT title, location_text, location_geometry FROM ideas WHERE id=$1', [legacyId]);
    const loaded = await detail(legacyId);
    assert.equal(loaded.locationGeometry, null);
    assert.equal(loaded.title, 'Существовавшая до миграции идея');
    assert.equal(loaded.locationText, 'Ориентир из старой карточки');
    assert.equal(loaded.title, before.rows[0].title);
    assert.equal(loaded.locationText, before.rows[0].location_text);
  });

  for (const geometry of [POINT, LINE, POLYGON]) {
    it(`${geometry.type} saves on create, changes on PATCH, and reloads from DB/HTTP`, async () => {
      const created = await draft(geometry);
      assert.deepEqual((await detail(created.id)).locationGeometry, geometry);
      const updated = structuredClone(geometry);
      const shift = (p) => [p[0] + .0001, p[1] + .0001];
      updated.coordinates = geometry.type === 'Point' ? shift(geometry.coordinates)
        : geometry.type === 'LineString' ? geometry.coordinates.map(shift) : [geometry.coordinates[0].map(shift)];
      const patched = await request('PATCH', `/api/v1/ideas/${created.id}`, {
        auth: citizen, body: { expectedVersion: created.version, locationGeometry: updated },
      });
      assert.equal(patched.status, 200, JSON.stringify(patched.json));
      assert.equal(patched.json.data.version, created.version + 1);
      const reloaded = await detail(created.id);
      assert.deepEqual(reloaded.locationGeometry, updated);
      assert.equal(reloaded.contentRevision, 1);
      const stored = (await db.query('SELECT location_geometry FROM ideas WHERE id=$1', [created.id])).rows[0];
      assert.deepEqual(stored.location_geometry, updated);
      savedShapes.push({ id: created.id, geometry: updated });
      const list = await request('GET', '/api/v1/ideas?scope=mine&pageSize=100', { auth: citizen });
      assert.deepEqual(list.json.data.find((idea) => idea.id === created.id).locationGeometry, updated);
    });
  }

  it('restores all three saved geometry types after logout and a fresh login', async () => {
    assert.equal((await request('POST', '/api/v1/auth/logout', { auth: citizen })).status, 204);
    citizen = await login('citizen1@example.test');
    assert.equal(savedShapes.length, 3);
    for (const saved of savedShapes) assert.deepEqual((await detail(saved.id)).locationGeometry, saved.geometry);
  });

  it('omission preserves geometry, explicit null clears it, text remains independent', async () => {
    const created = await draft(POLYGON);
    const textOnly = await request('PATCH', `/api/v1/ideas/${created.id}`, {
      auth: citizen, body: { expectedVersion: 1, locationText: 'Обновлённый ориентир' },
    });
    assert.equal(textOnly.status, 200);
    assert.deepEqual((await detail(created.id)).locationGeometry, POLYGON);
    const cleared = await request('PATCH', `/api/v1/ideas/${created.id}`, {
      auth: citizen, body: { expectedVersion: 2, locationGeometry: null },
    });
    assert.equal(cleared.status, 200);
    const loaded = await detail(created.id);
    assert.equal(loaded.locationGeometry, null);
    assert.equal(loaded.locationText, 'Обновлённый ориентир');
    assert.equal((await detail((await draft()).id)).locationGeometry, null);
    assert.equal((await detail((await draft(null)).id)).locationGeometry, null);
  });

  it('preserves create idempotency including changed-geometry conflict', async () => {
    const key = randomUUID();
    const body = { ...TEXT, territoryId, locationGeometry: POINT };
    const first = await request('POST', '/api/v1/ideas', { auth: citizen, body, key });
    const replay = await request('POST', '/api/v1/ideas', { auth: citizen, body, key });
    assert.equal(first.status, 201);
    assert.deepEqual(replay.json.data, first.json.data);
    const conflict = await request('POST', '/api/v1/ideas', { auth: citizen, body: { ...body, locationGeometry: LINE }, key });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.json.error.code, 'IDEMPOTENCY_CONFLICT');
  });

  it('keeps geometry private and refuses stale/foreign mutation without data loss', async () => {
    const created = await draft(POINT);
    for (const auth of [other, transport, utilities]) {
      const denied = await request('GET', `/api/v1/ideas/${created.id}`, { auth });
      assert.equal(denied.status, 404);
      assert.equal(JSON.stringify(denied.json).includes('80.249'), false);
    }
    const anonymous = await request('GET', `/api/v1/ideas/${created.id}`);
    assert.equal(anonymous.status, 401);
    const foreign = await request('PATCH', `/api/v1/ideas/${created.id}`, {
      auth: other, body: { expectedVersion: 1, locationGeometry: LINE },
    });
    assert.equal(foreign.status, 404);
    const changed = await request('PATCH', `/api/v1/ideas/${created.id}`, {
      auth: citizen, body: { expectedVersion: 1, locationText: 'Актуальное описание места' },
    });
    assert.equal(changed.status, 200);
    const stale = await request('PATCH', `/api/v1/ideas/${created.id}`, {
      auth: citizen, body: { expectedVersion: 1, locationGeometry: LINE },
    });
    assert.equal(stale.status, 409);
    assert.equal(stale.json.error.code, 'VERSION_CONFLICT');
    assert.deepEqual((await detail(created.id)).locationGeometry, POINT);
    assert.equal((await detail(created.id)).version, 2);
  });

  it('rejects malformed, outside, crossing and over-complex geometry without mutating a draft', async () => {
    const created = await draft(POINT);
    const invalid = [
      { ...POINT, extra: true }, { type: 'Point', coordinates: [80, 91] },
      { type: 'Point', coordinates: [82.611, 49.948] },
      { type: 'Point', coordinates: [null, 50] },
      { type: 'LineString', coordinates: [[76.56013, 49.4136885], [76.584581, 49.3768896]] },
      { type: 'LineString', coordinates: Array.from({ length: 129 }, (_, i) => [80.249 + i / 10000, 50.411]) },
      { type: 'Polygon', coordinates: [[[80.24, 50.41], [80.26, 50.43], [80.24, 50.43], [80.26, 50.41], [80.24, 50.41]]] },
      { type: 'Polygon', coordinates: [POLYGON.coordinates[0].slice(0, 3)] },
    ];
    for (const locationGeometry of invalid) {
      for (const method of ['POST', 'PATCH']) {
        const rejected = await request(method, method === 'POST' ? '/api/v1/ideas' : `/api/v1/ideas/${created.id}`, {
          auth: citizen, key: randomUUID(), body: { ...(method === 'PATCH' ? { expectedVersion: 1 } : {}), locationGeometry },
        });
        assert.equal(rejected.status, 400, JSON.stringify(rejected.json));
        assert.equal(rejected.json.error.code, 'VALIDATION_ERROR');
        assert.ok(rejected.json.error.fields.locationGeometry);
      }
    }
    // JSON allows an exponent that JS parses to Infinity; reject server-side.
    const nonFinite = await request('PATCH', `/api/v1/ideas/${created.id}`, {
      auth: citizen, rawBody: '{"expectedVersion":1,"locationGeometry":{"type":"Point","coordinates":[1e400,50]}}',
    });
    assert.equal(nonFinite.status, 400);
    assert.ok(nonFinite.json.error.fields.locationGeometry);
    const loaded = await detail(created.id);
    assert.deepEqual(loaded.locationGeometry, POINT);
    assert.equal(loaded.version, 1);
  });

  it('revalidates stored geometry before submit', async () => {
    const created = await draft(POINT);
    // Simulate a legacy/imported object that passed only the SQL envelope.
    await db.query('UPDATE ideas SET location_geometry=$1::jsonb WHERE id=$2', [JSON.stringify({ type: 'Point', coordinates: [82.611, 49.948] }), created.id]);
    const submitted = await request('POST', `/api/v1/ideas/${created.id}/submit`, {
      auth: citizen, key: randomUUID(), body: { expectedVersion: 1, consentAccepted: true },
    });
    assert.equal(submitted.status, 400);
    assert.ok(submitted.json.error.fields.locationGeometry);
    assert.equal((await detail(created.id)).status, 'DRAFT');
  });

  it('uploads a file, submits a zone, and reloads it for new citizen session and scoped staff', async () => {
    const created = await draft(POLYGON);
    const form = new FormData();
    form.set('expectedVersion', String(created.version));
    form.set('file', new Blob([PNG], { type: 'image/png' }), 'location.png');
    const upload = await fetch(`${base}/api/v1/ideas/${created.id}/attachments`, {
      method: 'POST', headers: { origin: ORIGIN, cookie: citizen.cookie, 'x-csrf-token': citizen.csrf, 'idempotency-key': randomUUID() }, body: form,
    });
    assert.equal(upload.status, 201);
    const uploaded = (await upload.json()).data;
    assert.equal(uploaded.ideaVersion, 2);
    const key = randomUUID();
    const body = { expectedVersion: uploaded.ideaVersion, consentAccepted: true };
    const submitted = await request('POST', `/api/v1/ideas/${created.id}/submit`, { auth: citizen, body, key });
    assert.equal(submitted.status, 200, JSON.stringify(submitted.json));
    assert.equal(submitted.json.data.routing.organizationCode, 'DEMO_TRANSPORT');
    assert.equal(submitted.json.data.version, 3);
    const replay = await request('POST', `/api/v1/ideas/${created.id}/submit`, { auth: citizen, body, key });
    assert.deepEqual(replay.json.data, submitted.json.data);
    assert.equal((await request('POST', '/api/v1/auth/logout', { auth: citizen })).status, 204);
    citizen = await login('citizen1@example.test');
    for (const auth of [citizen, transport]) {
      const loaded = await detail(created.id, auth);
      assert.deepEqual(loaded.locationGeometry, POLYGON);
      assert.equal(loaded.locationText, 'У школы, со стороны перехода');
      assert.equal(loaded.status, 'RECEIVED');
      assert.equal(loaded.attachments[0].id, uploaded.attachment.id);
    }
    const staffList = await request('GET', '/api/v1/ideas?scope=staff&pageSize=100', { auth: transport });
    assert.deepEqual(staffList.json.data.find((idea) => idea.id === created.id).locationGeometry, POLYGON);
    for (const auth of [other, utilities]) assert.equal((await request('GET', `/api/v1/ideas/${created.id}`, { auth })).status, 404);
    const frozen = await request('PATCH', `/api/v1/ideas/${created.id}`, { auth: citizen, body: { expectedVersion: 3, locationGeometry: null } });
    assert.equal(frozen.status, 409);
    assert.equal(frozen.json.error.code, 'INVALID_TRANSITION');
    assert.deepEqual((await detail(created.id)).locationGeometry, POLYGON);
  });
});
