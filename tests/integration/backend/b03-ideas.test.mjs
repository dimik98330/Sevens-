// B-03 tests: drafts, submit, idempotency, uploads (INT-03..08, INT-11, SEC-04).
// Real HTTP + PGlite. Routing engine loaded from D's own sources (no fork).
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
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64');

const IDEA_TEXT = {
  title: 'Умные светофоры рядом со школой',
  problem: 'Возле школы дорога требует внимания к безопасности детей. Нужны датчики и понятная схема движения.',
  solution: 'Установить умные светофоры и датчики загруженности дороги, добавить приложение для уведомлений.',
};

let db;
let base;
let server;
let uploadDir;
let territoryId;

function req(method, p, { cookie, csrf, body, key } = {}) {
  const headers = { origin: ORIGIN };
  if (cookie) headers.cookie = cookie;
  if (csrf) headers['x-csrf-token'] = csrf;
  if (key) headers['idempotency-key'] = key;
  const opts = { method, headers };
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  return fetch(base + p, opts);
}

function multipart(fileBuffer, filename, fields = {}) {
  const boundary = '----test' + randomUUID().replace(/-/g, '');
  const chunks = [];
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  if (fileBuffer) {
    chunks.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: application/octet-stream\r\n\r\n`));
    chunks.push(fileBuffer);
    chunks.push(Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { boundary, body: Buffer.concat(chunks) };
}

async function registerCitizen(suffix) {
  const res = await req('POST', '/api/v1/auth/register', {
    body: {
      displayName: `Автор ${suffix}`, email: `b03-${suffix}@example.test`,
      password: 'correct-horse-12 symbols', consentAccepted: true,
    },
  });
  assert.equal(res.status, 201);
  const json = await res.json();
  return {
    cookie: (res.headers.get('set-cookie') || '').split(';')[0],
    csrf: json.data.csrfToken,
  };
}

async function createFullDraft(auth) {
  const key = randomUUID();
  const res = await req('POST', '/api/v1/ideas', {
    ...auth, key, body: { ...IDEA_TEXT, territoryId, requestedCategoryCode: null },
  });
  assert.equal(res.status, 201);
  return (await res.json()).data;
}

before(async () => {
  uploadDir = mkdtempSync(path.join(tmpdir(), 'uploads-'));
  process.env.UPLOAD_DIR = uploadDir;
  db = await openDatabase();
  await migrate(db);
  await seed(db, { demoPassword: 'test-Seed-12-chars' });
  territoryId = (await db.query(`SELECT id FROM territories WHERE code='DEMO_SEMEY'`)).rows[0].id;
  server = createServer(db);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.close();
  await db.close();
});

describe('B-03 drafts and submit', () => {
  it('creates a partial draft; key required; unknown fields rejected', async () => {
    const auth = await registerCitizen('draft');
    const noKey = await req('POST', '/api/v1/ideas', { ...auth, body: { title: 'x' } });
    assert.equal(noKey.status, 400);
    const bad = await req('POST', '/api/v1/ideas', {
      ...auth, key: randomUUID(), body: { title: 'Черновик', status: 'RECEIVED' },
    });
    assert.equal(bad.status, 400);
    const ok = await req('POST', '/api/v1/ideas', {
      ...auth, key: randomUUID(), body: { title: 'Черновик про дорогу' },
    });
    assert.equal(ok.status, 201);
    assert.equal((await ok.json()).data.version, 1);
  });

  it('PATCH bumps version; stale version is 409; submitted text is frozen (INT-11)', async () => {
    const auth = await registerCitizen('patch');
    const draft = await createFullDraft(auth);
    const upd = await req('PATCH', `/api/v1/ideas/${draft.id}`, {
      ...auth, body: { expectedVersion: 1, title: 'Умные светофоры рядом со школой обновлено' },
    });
    assert.equal(upd.status, 200);
    assert.equal((await upd.json()).data.version, 2);
    const stale = await req('PATCH', `/api/v1/ideas/${draft.id}`, {
      ...auth, body: { expectedVersion: 1, title: 'Попытка перезаписи' },
    });
    assert.equal(stale.status, 409);
    const sub = await req('POST', `/api/v1/ideas/${draft.id}/submit`, {
      ...auth, key: randomUUID(), body: { expectedVersion: 2, consentAccepted: true },
    });
    assert.equal(sub.status, 200);
    const frozen = await req('PATCH', `/api/v1/ideas/${draft.id}`, {
      ...auth, body: { expectedVersion: 3, title: 'Задним числом' },
    });
    assert.equal(frozen.status, 409);
  });

  it('submit validates, routes via rules engine, numbers atomically', async () => {
    const auth = await registerCitizen('submit');
    const draft = await createFullDraft(auth);
    const key = randomUUID();
    const res = await req('POST', `/api/v1/ideas/${draft.id}/submit`, {
      ...auth, key, body: { expectedVersion: 1, consentAccepted: true },
    });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.match(json.data.publicNumber, /^ABAI-\d{4}-\d{6}$/);
    assert.equal(json.data.status, 'RECEIVED');
    assert.equal(json.data.routing.effectiveCategoryCode, 'TRANSPORT');
    assert.equal(json.data.routing.organizationCode, 'DEMO_TRANSPORT');
    assert.equal(json.data.routing.mode, 'ASSIGNED');
    assert.equal(json.data.routing.confidenceBand, 'HIGH');
    // Atomic side effects: decision, event, notification, audit.
    const dec = await db.query('SELECT count(*)::int AS c FROM routing_decisions WHERE idea_id=$1', [draft.id]);
    assert.equal(dec.rows[0].c, 1);
    const ev = await db.query(`SELECT type FROM idea_events WHERE idea_id=$1 ORDER BY created_at, id`, [draft.id]);
    assert.deepEqual(ev.rows.map((r) => r.type), ['CREATED', 'SUBMITTED']);
    const nt = await db.query('SELECT kind FROM notifications WHERE idea_id=$1', [draft.id]);
    assert.deepEqual(nt.rows.map((r) => r.kind), ['IDEA_REGISTERED']);
    const au = await db.query(`SELECT action FROM audit_events WHERE entity_id=$1`, [draft.id]);
    assert.ok(au.rows.map((r) => r.action).includes('idea.submit'));
  });

  it('submit rejects short texts with field errors', async () => {
    const auth = await registerCitizen('short');
    const res = await req('POST', '/api/v1/ideas', {
      ...auth, key: randomUUID(), body: { title: 'Коротко', territoryId },
    });
    const draft = (await res.json()).data;
    const sub = await req('POST', `/api/v1/ideas/${draft.id}/submit`, {
      ...auth, key: randomUUID(), body: { expectedVersion: 1, consentAccepted: true },
    });
    assert.equal(sub.status, 400);
    const fields = (await sub.json()).error.fields;
    assert.ok(fields.title && fields.problem && fields.solution);
  });

  it('idempotent submit replays stored success (INT-03/INT-06)', async () => {
    const auth = await registerCitizen('idem');
    const draft = await createFullDraft(auth);
    const key = randomUUID();
    const first = await req('POST', `/api/v1/ideas/${draft.id}/submit`, {
      ...auth, key, body: { expectedVersion: 1, consentAccepted: true },
    });
    assert.equal(first.status, 200);
    const firstJson = await first.json();
    const second = await req('POST', `/api/v1/ideas/${draft.id}/submit`, {
      ...auth, key, body: { expectedVersion: 1, consentAccepted: true },
    });
    assert.equal(second.status, 200);
    const secondJson = await second.json();
    // Stored success replays; only the per-request envelope id is fresh.
    assert.deepEqual(secondJson.data, firstJson.data);
    assert.ok(secondJson.meta.requestId);
    assert.notEqual(secondJson.meta.requestId, firstJson.meta.requestId);
    const count = await db.query(
      `SELECT count(*)::int AS c FROM ideas WHERE author_id=(SELECT id FROM users WHERE email_normalized='b03-idem@example.test') AND status='RECEIVED'`);
    assert.equal(count.rows[0].c, 1);
  });

  it('same key with a different body is 409 (INT-05)', async () => {
    const auth = await registerCitizen('conflict');
    const draft = await createFullDraft(auth);
    const key = randomUUID();
    const first = await req('POST', `/api/v1/ideas/${draft.id}/submit`, {
      ...auth, key, body: { expectedVersion: 1, consentAccepted: true },
    });
    assert.equal(first.status, 200);
    const other = await req('POST', `/api/v1/ideas/${draft.id}/submit`, {
      ...auth, key, body: { expectedVersion: 999, consentAccepted: true },
    });
    assert.equal(other.status, 409);
    assert.equal((await other.json()).error.code, 'IDEMPOTENCY_CONFLICT');
  });

  it('audit failure rolls back the whole submit (INT-02); same key retries clean', async () => {
    const auth = await registerCitizen('atomic');
    const draft = await createFullDraft(auth);
    const key = randomUUID();
    await db.query(`ALTER TABLE audit_events ADD CONSTRAINT tmp_never CHECK (false) NOT VALID`);
    try {
      const failed = await req('POST', `/api/v1/ideas/${draft.id}/submit`, {
        ...auth, key, body: { expectedVersion: 1, consentAccepted: true },
      });
      assert.equal(failed.status, 503);
    } finally {
      await db.query(`ALTER TABLE audit_events DROP CONSTRAINT tmp_never`);
    }
    const idea = await db.query('SELECT status, public_number FROM ideas WHERE id=$1', [draft.id]);
    assert.equal(idea.rows[0].status, 'DRAFT');
    assert.equal(idea.rows[0].public_number, null);
    const nt = await db.query('SELECT count(*)::int AS c FROM notifications WHERE idea_id=$1', [draft.id]);
    assert.equal(nt.rows[0].c, 0);
    // The rolled-back attempt left no reservation: the same key still works.
    const retry = await req('POST', `/api/v1/ideas/${draft.id}/submit`, {
      ...auth, key, body: { expectedVersion: 1, consentAccepted: true },
    });
    assert.equal(retry.status, 200);
  });

  it('stale expectedVersion is 409 (INT-04)', async () => {
    const auth = await registerCitizen('stale');
    const draft = await createFullDraft(auth);
    const sub = await req('POST', `/api/v1/ideas/${draft.id}/submit`, {
      ...auth, key: randomUUID(), body: { expectedVersion: 42, consentAccepted: true },
    });
    assert.equal(sub.status, 409);
    assert.equal((await sub.json()).error.code, 'VERSION_CONFLICT');
  });

  it('mine list, search and citizen detail hide internals (SEC-05)', async () => {
    const auth = await registerCitizen('list');
    await createFullDraft(auth);
    await createFullDraft(auth);
    const list = await req('GET', '/api/v1/ideas?scope=mine', auth);
    assert.equal(list.status, 200);
    const listJson = await list.json();
    assert.equal(listJson.meta.total, 2);
    assert.ok(listJson.data[0].version);
    const found = await req('GET', '/api/v1/ideas?scope=mine&q=светофор', auth);
    assert.equal((await found.json()).meta.total, 2);
    const empty = await req('GET', '/api/v1/ideas?scope=mine&q=несуществующийзапрос', auth);
    assert.equal((await empty.json()).meta.total, 0);
    const detail = await req('GET', `/api/v1/ideas/${listJson.data[0].id}`, auth);
    const detailJson = await detail.json();
    const serialized = JSON.stringify(detailJson);
    assert.ok(!serialized.includes('storage_key'));
    assert.ok(!serialized.includes('password_hash'));
    assert.ok(!serialized.includes('token_hash'));
    assert.equal(detailJson.data.authorEmail, undefined);
    const timeline = await req('GET', `/api/v1/ideas/${listJson.data[0].id}/timeline`, auth);
    const events = (await timeline.json()).data;
    assert.ok(events.every((e) => e.visibility === 'PUBLIC'));
  });
});

describe('B-03 uploads (SEC-04/SEC-08)', () => {
  it('uploads PNG, downloads it, rejects foreign access', async () => {
    const author = await registerCitizen('file');
    const other = await registerCitizen('file-other');
    const draft = await createFullDraft(author);
    const { boundary, body } = multipart(PNG_1PX, 'light.png', { expectedVersion: '1' });
    const up = await fetch(base + `/api/v1/ideas/${draft.id}/attachments`, {
      method: 'POST',
      headers: {
        origin: ORIGIN, cookie: author.cookie, 'x-csrf-token': author.csrf,
        'idempotency-key': randomUUID(), 'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });
    assert.equal(up.status, 201);
    const upJson = await up.json();
    assert.equal(upJson.data.attachment.mime, 'image/png');
    assert.equal(upJson.data.ideaVersion, 2);
    const dl = await req('GET', `/api/v1/attachments/${upJson.data.attachment.id}/download`, author);
    assert.equal(dl.status, 200);
    assert.equal(dl.headers.get('content-type'), 'image/png');
    assert.equal((await dl.arrayBuffer()).byteLength, PNG_1PX.length);
    const foreign = await req('GET', `/api/v1/attachments/${upJson.data.attachment.id}/download`, other);
    assert.equal(foreign.status, 404);
  });

  it('rejects SVG masquerade, oversize and the 4th file', async () => {
    const auth = await registerCitizen('file-neg');
    const draft = await createFullDraft(auth);
    let version = 1;
    const send = async (content, filename) => {
      const { boundary, body } = multipart(content, filename, { expectedVersion: String(version) });
      return fetch(base + `/api/v1/ideas/${draft.id}/attachments`, {
        method: 'POST',
        headers: {
          origin: ORIGIN, cookie: auth.cookie, 'x-csrf-token': auth.csrf,
          'idempotency-key': randomUUID(), 'content-type': `multipart/form-data; boundary=${boundary}`,
        },
        body,
      });
    };
    const svg = await send(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), 'x.png');
    assert.equal(svg.status, 415);
    const big = await send(Buffer.alloc(5 * 1024 * 1024 + 1, 1), 'big.png');
    assert.equal(big.status, 413);
    for (let n = 0; n < 3; n++) {
      const r = await send(PNG_1PX, `f${n}.png`);
      assert.equal(r.status, 201);
      version = (await r.json()).data.ideaVersion;
    }
    const fourth = await send(PNG_1PX, 'f3.png');
    assert.equal(fourth.status, 400);
  });

  it('deletes own file; download is gone afterwards', async () => {
    const auth = await registerCitizen('file-del');
    const draft = await createFullDraft(auth);
    const { boundary, body } = multipart(PNG_1PX, 'del.png', { expectedVersion: '1' });
    const up = await fetch(base + `/api/v1/ideas/${draft.id}/attachments`, {
      method: 'POST',
      headers: {
        origin: ORIGIN, cookie: auth.cookie, 'x-csrf-token': auth.csrf,
        'idempotency-key': randomUUID(), 'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });
    const attId = (await up.json()).data.attachment.id;
    const del = await req('DELETE', `/api/v1/ideas/${draft.id}/attachments/${attId}`, {
      ...auth, key: randomUUID(), body: { expectedVersion: 2 },
    });
    assert.equal(del.status, 200);
    const dl = await req('GET', `/api/v1/attachments/${attId}/download`, auth);
    assert.equal(dl.status, 404);
  });
});
