// B-02 tests: auth, sessions, CSRF/Origin, object policies.
// Real HTTP against an ephemeral server + PGlite (real PostgreSQL engine).
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../../../src/server/db/client.mjs';
import { resetDb } from './helpers/resetDb.mjs';
import { migrate } from '../../../scripts/migrate.mjs';
import { seed, uuidFromSeedKey } from '../../../scripts/seed.mjs';
import { createServer } from '../../../src/server/http/app.mjs';
import { loadIdeaForActor } from '../../../src/server/policies/scopes.mjs';

const ORIGIN = 'http://localhost:3000';
let db;
let base;
let server;

function req(method, path, { cookie, csrf, origin = ORIGIN, body } = {}) {
  const headers = {};
  if (origin) headers.origin = origin;
  if (cookie) headers.cookie = cookie;
  if (csrf) headers['x-csrf-token'] = csrf;
  const opts = { method, headers };
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  return fetch(base + path, opts);
}

async function registerUser(suffix, extra = {}) {
  const res = await req('POST', '/api/v1/auth/register', {
    body: {
      displayName: `Житель ${suffix}`,
      email: `b02-${suffix}@example.test`,
      password: 'correct-horse-12 symbols',
      consentAccepted: true,
      ...extra,
    },
  });
  const json = await res.json();
  const setCookie = res.headers.get('set-cookie') || '';
  return { res, json, cookie: setCookie.split(';')[0] };
}

before(async () => {
  db = await openDatabase();
  await resetDb(db);
  await migrate(db);
  await seed(db, { demoPassword: 'test-Seed-12-chars' });
  server = createServer(db);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.close();
  await db.close();
});

describe('B-02 auth and sessions', () => {
  it('registers a citizen, sets HttpOnly cookie, me works', async () => {
    const { res, json, cookie } = await registerUser('a');
    assert.equal(res.status, 201);
    assert.match(cookie, /^sid=/);
    assert.ok((res.headers.get('set-cookie') || '').includes('HttpOnly'));
    assert.equal(json.data.user.role, 'CITIZEN');
    assert.ok(json.data.csrfToken);
    assert.ok(json.meta.requestId);
    const me = await req('GET', '/api/v1/auth/me', { cookie });
    assert.equal(me.status, 200);
    assert.equal((await me.json()).data.role, 'CITIZEN');
  });

  it('public API never creates STAFF/ADMIN; unknown fields rejected', async () => {
    const { res, json } = await registerUser('b', { role: 'ADMIN' });
    assert.equal(res.status, 400);
    assert.equal(json.error.code, 'VALIDATION_ERROR');
    assert.ok(json.error.fields.role);
    const row = await db.query('SELECT count(*)::int AS c FROM users WHERE role=$1', ['ADMIN']);
    assert.equal(row.rows[0].c, 1); // only the demo seed admin
  });

  it('validates email, password length and consent', async () => {
    let r = await registerUser('c', { email: 'not-an-email' });
    assert.equal(r.res.status, 400);
    assert.ok(r.json.error.fields.email);
    r = await registerUser('d', { password: 'short' });
    assert.equal(r.res.status, 400);
    assert.ok(r.json.error.fields.password);
    r = await registerUser('e', { consentAccepted: false });
    assert.equal(r.res.status, 400);
    assert.ok(r.json.error.fields.consentAccepted);
  });

  it('duplicate email is rejected after normalization', async () => {
    await registerUser('f');
    const dup = await req('POST', '/api/v1/auth/register', {
      body: {
        displayName: 'Дубль', email: 'B02-F@EXAMPLE.test',
        password: 'correct-horse-12 symbols', consentAccepted: true,
      },
    });
    assert.equal(dup.status, 400);
    assert.ok((await dup.json()).error.fields.email);
  });

  it('login, wrong password, then rate limit after 5 failures', async () => {
    await registerUser('g');
    const ok = await req('POST', '/api/v1/auth/login', {
      body: { email: 'b02-g@example.test', password: 'correct-horse-12 symbols' },
    });
    assert.equal(ok.status, 200);
    for (let n = 0; n < 5; n++) {
      const bad = await req('POST', '/api/v1/auth/login', {
        body: { email: 'b02-g@example.test', password: 'wrong-password-xyz' },
      });
      assert.equal(bad.status, 401);
    }
    const limited = await req('POST', '/api/v1/auth/login', {
      body: { email: 'b02-g@example.test', password: 'wrong-password-xyz' },
    });
    assert.equal(limited.status, 429);
    assert.equal((await limited.json()).error.code, 'RATE_LIMITED');
  });

  it('logout revokes the session; old cookie stops working', async () => {
    const { cookie, json } = await registerUser('h');
    const out = await req('POST', '/api/v1/auth/logout', { cookie, csrf: json.data.csrfToken });
    assert.equal(out.status, 204);
    const me = await req('GET', '/api/v1/auth/me', { cookie });
    assert.equal(me.status, 401);
  });

  it('mutations require Origin and CSRF', async () => {
    const { cookie } = await registerUser('i');
    const noOrigin = await req('POST', '/api/v1/auth/logout', {
      cookie, csrf: 'x', origin: null,
    });
    assert.equal(noOrigin.status, 403);
    const badOrigin = await req('POST', '/api/v1/auth/logout', {
      cookie, csrf: 'x', origin: 'https://evil.example',
    });
    assert.equal(badOrigin.status, 403);
    const noCsrf = await req('POST', '/api/v1/auth/logout', { cookie });
    assert.equal(noCsrf.status, 403);
    assert.equal((await noCsrf.json()).error.code, 'CSRF_INVALID');
  });

  it('deactivated users lose access on the next request', async () => {
    const { cookie } = await registerUser('j');
    await db.query(`UPDATE users SET active=FALSE WHERE email_normalized='b02-j@example.test'`);
    const me = await req('GET', '/api/v1/auth/me', { cookie });
    assert.equal(me.status, 401);
  });

  it('expired sessions are rejected', async () => {
    const { cookie } = await registerUser('k');
    await db.query(
      `UPDATE sessions SET expires_at = now() - interval '1 hour'
       WHERE user_id = (SELECT id FROM users WHERE email_normalized='b02-k@example.test')`);
    const me = await req('GET', '/api/v1/auth/me', { cookie });
    assert.equal(me.status, 401);
  });

  it('catalogs and health are public', async () => {
    const cat = await req('GET', '/api/v1/catalogs', { origin: null });
    assert.equal(cat.status, 200);
    const catJson = await cat.json();
    assert.equal(catJson.data.categories.length, 9);
    assert.ok(catJson.data.territories.length >= 2);
    // C-04 joint: the wizard resolves territoryId UUID from catalogs.
    for (const t of catJson.data.territories) {
      assert.match(t.id, /^[0-9a-f-]{36}$/, 'territory id');
      assert.ok(t.code);
    }
    const live = await fetch(base + '/api/health/live');
    assert.equal(live.status, 200);
    const ready = await fetch(base + '/api/health/ready');
    assert.equal(ready.status, 200);
  });
});

describe('B-02 object policies (SEC-01/SEC-02)', () => {
  let ideaId;
  before(async () => {
    const region = await db.query(`SELECT id FROM regions WHERE code='ABAI'`);
    const ins = await db.query(
      `INSERT INTO ideas(region_id, author_id, title) VALUES($1,$2,'чужая идея') RETURNING id`,
      [region.rows[0].id, uuidFromSeedKey('user:citizen1')]);
    ideaId = ins.rows[0].id;
  });

  async function actorFor(seedKey) {
    const row = await db.query(
      `SELECT u.id, u.role, u.organization_id AS "organizationId", u.region_id AS "regionId"
       FROM users u WHERE u.id=$1`, [uuidFromSeedKey('user:' + seedKey)]);
    return { ...row.rows[0], organizationId: row.rows[0].organizationId };
  }

  it('citizen cannot read чужую идею (404, no existence leak)', async () => {
    const citizen2 = await actorFor('citizen2');
    await assert.rejects(loadIdeaForActor(db, { ...citizen2, id: citizen2.id }, ideaId),
      (e) => e.code === 'NOT_FOUND');
  });

  it('staff of another organization gets 404', async () => {
    // Move the idea to TRANSPORT org first.
    const org = await db.query(`SELECT id FROM organizations WHERE code='DEMO_TRANSPORT'`);
    await db.query('UPDATE ideas SET organization_id=$1 WHERE id=$2', [org.rows[0].id, ideaId]);
    const staffUtil = await actorFor('staff_utilities');
    await assert.rejects(loadIdeaForActor(db, staffUtil, ideaId),
      (e) => e.code === 'NOT_FOUND');
    const staffTrans = await actorFor('staff_transport');
    const idea = await loadIdeaForActor(db, staffTrans, ideaId);
    assert.equal(idea.id, ideaId);
  });

  it('admin of the region can read; unknown id is the same 404', async () => {
    const admin = await actorFor('admin');
    const idea = await loadIdeaForActor(db, admin, ideaId);
    assert.equal(idea.id, ideaId);
    await assert.rejects(
      loadIdeaForActor(db, admin, '99999999-9999-4999-8999-999999999999'),
      (e) => e.code === 'NOT_FOUND');
  });
});
