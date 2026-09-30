// D-02 groundwork (D-owned): routing behavior over real HTTP + PGlite.
// Independent angles, no duplication of B suites: submit-time routing
// outcomes, DTO boundaries, queue placement end-to-end, timeline filtering,
// honest wording, band-only confidence. Prepared in isolation; commits to
// tests/integration/security/ on D-02 claim.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDatabase } from '../../../src/server/db/client.mjs';
import { migrate } from '../../../scripts/migrate.mjs';
import { seed } from '../../../scripts/seed.mjs';
import { createServer } from '../../../src/server/http/app.mjs';

const ORIGIN = 'http://localhost:3000';
const SEED_PASSWORD = 'test-Seed-12-chars';

let db;
let base;
let server;
let territoryId;

function req(method, p, { cookie, csrf, body, key, query = '' } = {}) {
  const headers = { origin: ORIGIN };
  if (cookie) headers.cookie = cookie;
  if (csrf) headers['x-csrf-token'] = csrf;
  if (key) headers['idempotency-key'] = key;
  const opts = { method, headers };
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  return fetch(base + p + query, opts);
}

async function loginAs(email, password = SEED_PASSWORD) {
  const res = await req('POST', '/api/v1/auth/login', { body: { email, password } });
  assert.equal(res.status, 200, `login ${email}`);
  const json = await res.json();
  return { cookie: (res.headers.get('set-cookie') || '').split(';')[0], csrf: json.data.csrfToken, user: json.data.user };
}

async function registerCitizen(suffix) {
  const res = await req('POST', '/api/v1/auth/register', {
    body: {
      displayName: `Автор ${suffix}`, email: `d02-${suffix}@example.test`,
      password: 'correct-horse-12 symbols', consentAccepted: true,
    },
  });
  assert.equal(res.status, 201);
  const json = await res.json();
  return { cookie: (res.headers.get('set-cookie') || '').split(';')[0], csrf: json.data.csrfToken };
}

async function submitIdea(auth, fields) {
  const created = await req('POST', '/api/v1/ideas', {
    ...auth, key: randomUUID(), body: { territoryId, requestedCategoryCode: null, ...fields },
  });
  assert.equal(created.status, 201);
  const draft = (await created.json()).data;
  const sub = await req('POST', `/api/v1/ideas/${draft.id}/submit`, {
    ...auth, key: randomUUID(), body: { expectedVersion: draft.version, consentAccepted: true },
  });
  return { status: sub.status, json: sub.status === 200 ? await sub.json() : null, id: draft.id };
}

before(async () => {
  process.env.UPLOAD_DIR = mkdtempSync(path.join(tmpdir(), 'd02-uploads-'));
  db = await openDatabase({ databaseUrl: null, pgliteDir: null });
  await migrate(db);
  await seed(db, { demoPassword: SEED_PASSWORD });
  territoryId = (await db.query(`SELECT id FROM territories WHERE code='DEMO_SEMEY'`)).rows[0].id;
  server = createServer(db);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.close();
  await db.close();
});

const TRANSPORT_TEXT = {
  title: 'Умные светофоры рядом со школой',
  problem: 'Возле школы дорога требует внимания к безопасности детей.',
  solution: 'Установить умные светофоры и датчики загруженности дороги.',
};

describe('D-02 routing over HTTP', () => {
  it('author conflict routes TRIAGE, keeps author choice, flags CATEGORY_CONFLICT', async () => {
    const auth = await registerCitizen('conflict');
    const { status, json, id } = await submitIdea(auth, { ...TRANSPORT_TEXT, requestedCategoryCode: 'ECOLOGY' });
    assert.equal(status, 200);
    const r = json.data.routing;
    assert.equal(r.effectiveCategoryCode, 'ECOLOGY');
    assert.equal(r.organizationCode, 'DEMO_TRIAGE');
    assert.equal(r.mode, 'TRIAGE');
    assert.equal(json.data.status, 'RECEIVED');
    // Reason codes persist server-side (citizen DTO follows the 03 sect 6.4 shape).
    const dec = await db.query(`SELECT reason_codes_json FROM routing_decisions WHERE idea_id=$1`, [id]);
    assert.equal(dec.rows.length, 1);
    assert.ok(JSON.stringify(dec.rows[0].reason_codes_json).includes('CATEGORY_CONFLICT'));
  });

  it('vague AUTO text is RECEIVED as OTHER/TRIAGE/LOW, never an error', async () => {
    const auth = await registerCitizen('vague');
    const { status, json } = await submitIdea(auth, {
      title: 'Сделать регион удобнее',
      problem: 'Есть идея улучшения повседневной жизни.',
      solution: 'Подробности пока необходимо обсудить.',
    });
    assert.equal(status, 200);
    assert.equal(json.data.routing.effectiveCategoryCode, 'OTHER');
    assert.equal(json.data.routing.mode, 'TRIAGE');
    assert.equal(json.data.routing.confidenceBand, 'LOW');
    assert.match(json.data.publicNumber, /^ABAI-\d{4}-\d{6}$/);
  });

  it('unknown territory reference is 400 at draft create', async () => {
    const auth = await registerCitizen('terr');
    const created = await req('POST', '/api/v1/ideas', {
      ...auth, key: randomUUID(),
      body: { ...TRANSPORT_TEXT, territoryId: randomUUID(), requestedCategoryCode: null },
    });
    assert.equal(created.status, 400);
  });

  it('deactivated territory between create and submit fails submit as 400, draft stays DRAFT', async () => {
    const auth = await registerCitizen('terrace');
    const created = await req('POST', '/api/v1/ideas', {
      ...auth, key: randomUUID(),
      body: { ...TRANSPORT_TEXT, territoryId, requestedCategoryCode: null },
    });
    assert.equal(created.status, 201);
    const draft = (await created.json()).data;
    await db.query(`UPDATE territories SET active=false WHERE id=$1`, [territoryId]);
    try {
      const sub = await req('POST', `/api/v1/ideas/${draft.id}/submit`, {
        ...auth, key: randomUUID(), body: { expectedVersion: draft.version, consentAccepted: true },
      });
      assert.equal(sub.status, 400);
      const reread = await req('GET', `/api/v1/ideas/${draft.id}`, { ...auth });
      assert.equal((await reread.json()).data.status, 'DRAFT');
    } finally {
      await db.query(`UPDATE territories SET active=true WHERE id=$1`, [territoryId]);
    }
  });

  it("literal 'AUTO' requestedCategoryCode is 400, never routed", async () => {
    const auth = await registerCitizen('autostr');
    const res = await req('POST', '/api/v1/ideas', {
      ...auth, key: randomUUID(),
      body: { ...TRANSPORT_TEXT, territoryId, requestedCategoryCode: 'AUTO' },
    });
    assert.equal(res.status, 400);
  });

  it('Kazakh aliases route over the wire (NFC/Unicode intact)', async () => {
    const auth = await registerCitizen('kk');
    const { status, json } = await submitIdea(auth, {
      title: 'Бағдаршам және жол',
      problem: 'Мектеп жанындағы жол мәселесі.',
      solution: 'Бағдаршам және сенсор деректерін қолдану.',
    });
    assert.equal(status, 200);
    assert.equal(json.data.routing.effectiveCategoryCode, 'TRANSPORT');
    assert.equal(json.data.routing.mode, 'ASSIGNED');
    assert.equal(json.data.routing.confidenceBand, 'HIGH');
  });

  it('queue placement follows routing: transport org sees it, utilities does not', async () => {
    const auth = await registerCitizen('place');
    const { status, json } = await submitIdea(auth, TRANSPORT_TEXT);
    assert.equal(status, 200);
    const transport = await loginAs('transport@example.test');
    const utilities = await loginAs('utilities@example.test');
    const q1 = await req('GET', '/api/v1/ideas', { ...transport, query: '?scope=staff' });
    const ids1 = (await q1.json()).data.map((x) => x.id);
    assert.ok(ids1.includes(json.data.id), 'transport queue contains the idea');
    const q2 = await req('GET', '/api/v1/ideas', { ...utilities, query: '?scope=staff' });
    const ids2 = (await q2.json()).data.map((x) => x.id);
    assert.ok(!ids2.includes(json.data.id), 'utilities queue does not contain it');
  });

  it('triage ideas land in the triage queue', async () => {
    const auth = await registerCitizen('triageq');
    const { status, json } = await submitIdea(auth, {
      title: 'Сделать регион удобнее',
      problem: 'Есть идея улучшения повседневной жизни.',
      solution: 'Подробности пока необходимо обсудить.',
    });
    assert.equal(status, 200);
    const triage = await loginAs('triage@example.test');
    const q = await req('GET', '/api/v1/ideas', { ...triage, query: '?scope=staff' });
    const ids = (await q.json()).data.map((x) => x.id);
    assert.ok(ids.includes(json.data.id), 'triage queue contains the idea');
  });

  it('citizen timeline hides INTERNAL notes', async () => {
    const auth = await registerCitizen('timeline');
    const { status, json } = await submitIdea(auth, TRANSPORT_TEXT);
    assert.equal(status, 200);
    const staff = await loginAs('transport@example.test');
    const card = await req('GET', `/api/v1/ideas/${json.data.id}`, { ...staff });
    const version = (await card.json()).data.version;
    const note = await req('POST', `/api/v1/ideas/${json.data.id}/comments`, {
      ...staff, key: randomUUID(),
      body: { visibility: 'INTERNAL', body: 'Секретная внутренняя пометка для проверки.', expectedVersion: version },
    });
    assert.equal(note.status, 201);
    const tl = await req('GET', `/api/v1/ideas/${json.data.id}/timeline`, { ...auth });
    assert.equal(tl.status, 200);
    const text = JSON.stringify(await tl.json());
    assert.ok(!text.includes('Секретная внутренняя пометка'), 'internal note absent from citizen timeline');
  });

  it('routing payload carries a band enum, never a percent accuracy', async () => {
    const auth = await registerCitizen('band');
    const { status, json } = await submitIdea(auth, TRANSPORT_TEXT);
    assert.equal(status, 200);
    assert.ok(['HIGH', 'MEDIUM', 'LOW'].includes(json.data.routing.confidenceBand));
    assert.ok(!('accuracy' in json.data.routing) && !('confidence' in json.data.routing));
  });

  it('honest wording: no claim of official/akimat submission', async () => {
    const auth = await registerCitizen('honest');
    const { status, json } = await submitIdea(auth, TRANSPORT_TEXT);
    assert.equal(status, 200);
    const text = JSON.stringify(json.data).toLowerCase();
    for (const claim of ['акимат', 'eotinish', 'официальн']) {
      assert.ok(!text.includes(claim), `must not claim: ${claim}`);
    }
    assert.ok(json.data.routing.explanation.length > 10);
  });
});
