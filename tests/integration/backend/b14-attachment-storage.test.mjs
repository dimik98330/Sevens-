// Synthetic, task-owned persistent PGlite: never opens DATABASE_URL or app data.
import { before, after, beforeEach, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDatabase } from '../../../src/server/db/client.mjs';
import { migrate } from '../../../scripts/migrate.mjs';
import { seed } from '../../../scripts/seed.mjs';
import { createServer } from '../../../src/server/http/app.mjs';
import { uploadAttachment, deleteAttachment, downloadAttachment } from '../../../src/server/attachments/store.mjs';
import { uploadLimiter } from '../../../src/server/auth/rateLimit.mjs';
import { VALID_PNG } from './helpers/valid-png.mjs';

const origin = 'http://localhost:3000';
const password = 'b14-synthetic-password-12';
let root, databaseDir, uploads, db, server, base, author, other, actor;

async function start() {
  server = createServer(db, { origin, secureCookies: false, uploadDir: uploads,
    attachmentStorage: 'database', demoLoginEnabled: false, logRequests: false });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
}

async function request(method, url, { auth, body, key } = {}) {
  return fetch(base + url, { method, headers: {
    origin,
    ...(auth ? { cookie: auth.cookie, 'x-csrf-token': auth.csrf } : {}),
    ...(key ? { 'idempotency-key': key } : {}),
    ...(body !== undefined && !(body instanceof FormData) ? { 'content-type': 'application/json' } : {}),
  }, body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body) });
}

async function login(email) {
  const response = await request('POST', '/api/v1/auth/login', { body: { email, password } });
  const json = await response.json();
  assert.equal(response.status, 200, JSON.stringify(json));
  return { cookie: response.headers.get('set-cookie').split(';')[0], csrf: json.data.csrfToken,
    user: json.data.user };
}

async function draft() {
  return (await db.query('INSERT INTO ideas(region_id,author_id,title) VALUES($1,$2,$3) RETURNING id',
    [actor.regionId, actor.id, 'Persistent attachment ' + randomUUID()])).rows[0].id;
}

async function upload(id, key = randomUUID()) {
  const form = new FormData();
  form.set('expectedVersion', '1');
  form.set('file', new Blob([VALID_PNG], { type: 'image/png' }), 'sample.png');
  const response = await request('POST', `/api/v1/ideas/${id}/attachments`, { auth: author, body: form, key });
  const json = await response.json();
  assert.equal(response.status, 201, JSON.stringify(json));
  return json.data;
}

async function counts(id) {
  return (await db.query(`SELECT
    (SELECT count(*)::int FROM attachments WHERE idea_id=$1) AS metadata,
    (SELECT count(*)::int FROM attachment_blobs b JOIN attachments a ON a.id=b.attachment_id WHERE a.idea_id=$1) AS blobs,
    (SELECT version FROM ideas WHERE id=$1) AS version`, [id])).rows[0];
}

function failOn(tx, fragment) {
  return { query(sql, params) {
    if (sql.includes(fragment)) throw new Error('Synthetic transaction failure');
    return tx.query(sql, params);
  } };
}

before(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'sevens-b14-'));
  databaseDir = path.join(root, 'db');
  uploads = path.join(root, 'uploads-1');
  db = await openDatabase({ databaseUrl: null, pgliteDir: databaseDir });
  await migrate(db);
  await seed(db, { demoPassword: password });
  await start();
  author = await login('citizen1@example.test');
  other = await login('citizen2@example.test');
  actor = { id: author.user.id, role: 'CITIZEN', regionId: author.user.regionId };
  // Login DTO intentionally omits region; test actor scope comes from test DB.
  actor.regionId = (await db.query('SELECT region_id FROM users WHERE id=$1', [actor.id])).rows[0].region_id;
});
beforeEach(() => uploadLimiter.hits.clear());
after(async () => {
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  await db?.close();
  if (root) {
    const target = path.resolve(root);
    assert.ok(target.startsWith(path.resolve(tmpdir()) + path.sep));
    assert.match(path.basename(target), /^sevens-b14-/);
    await rm(target, { recursive: true, force: true });
  }
});

it('uploads and downloads through authorized HTTP routes, replays once and leaves only empty temp storage', async () => {
  const id = await draft();
  const key = randomUUID();
  const first = await upload(id, key);
  assert.deepEqual(await upload(id, key), first);
  assert.deepEqual(await counts(id), { metadata: 1, blobs: 1, version: 2 });
  const response = await request('GET', `/api/v1/attachments/${first.attachment.id}/download`, { auth: author });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/png');
  assert.equal(response.headers.get('content-length'), String(VALID_PNG.length));
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), VALID_PNG);
  assert.deepEqual(await readdir(uploads), ['.tmp']);
  assert.deepEqual(await readdir(path.join(uploads, '.tmp')), []);
  const row = (await db.query('SELECT storage_backend FROM attachments WHERE id=$1', [first.attachment.id])).rows[0];
  assert.equal(row.storage_backend, 'database');
});

it('denies anonymous/foreign downloads before querying blob bytes and denies foreign upload/delete', async () => {
  const id = await draft();
  const stored = await upload(id);
  const url = `/api/v1/attachments/${stored.attachment.id}/download`;
  assert.equal((await request('GET', url)).status, 401);
  assert.equal((await request('GET', url, { auth: other })).status, 404);
  const foreignActor = { ...actor, id: other.user.id };
  const traced = { query(sql, params) {
    assert.ok(!sql.includes('SELECT b.content'), 'Unauthorized request must never fetch private bytes');
    return db.query(sql, params);
  } };
  await assert.rejects(downloadAttachment(traced, foreignActor, stored.attachment.id), { code: 'NOT_FOUND' });
  await assert.rejects(uploadAttachment(db, foreignActor, id, { filename: 'sample.png', content: VALID_PNG },
    2, randomUUID(), 'b14-foreign', uploads, 'database'), { code: 'NOT_FOUND' });
  const removed = await request('DELETE', `/api/v1/ideas/${id}/attachments/${stored.attachment.id}`,
    { auth: other, body: { expectedVersion: 2 }, key: randomUUID() });
  assert.equal(removed.status, 404);
  assert.deepEqual(await counts(id), { metadata: 1, blobs: 1, version: 2 });
});

it('rolls back uploaded metadata, bytes, events and version if a later transaction step fails', async () => {
  const id = await draft();
  const broken = { ...db, transaction: (fn) => db.transaction((tx) => fn(failOn(tx, 'INSERT INTO idea_events'))) };
  await assert.rejects(uploadAttachment(broken, actor, id, { filename: 'sample.png', content: VALID_PNG },
    1, randomUUID(), 'b14-rollback', uploads, 'database'), /Synthetic transaction failure/);
  assert.deepEqual(await counts(id), { metadata: 0, blobs: 0, version: 1 });
  assert.equal((await db.query('SELECT count(*)::int AS count FROM idea_events WHERE idea_id=$1', [id])).rows[0].count, 0);
});

it('rolls back blob deletion on failure, then removes bytes with an idempotent delete', async () => {
  const id = await draft();
  const stored = await upload(id);
  const broken = { ...db, transaction: (fn) => db.transaction((tx) => fn(failOn(tx, 'UPDATE ideas SET version'))) };
  await assert.rejects(deleteAttachment(broken, actor, id, stored.attachment.id, 2, randomUUID(),
    'b14-rollback-delete', uploads), /Synthetic transaction failure/);
  assert.deepEqual((await downloadAttachment(db, actor, stored.attachment.id)).content, VALID_PNG);
  const key = randomUUID();
  const args = { auth: author, body: { expectedVersion: 2 }, key };
  const url = `/api/v1/ideas/${id}/attachments/${stored.attachment.id}`;
  const response = await request('DELETE', url, args);
  const first = await response.json();
  assert.equal(response.status, 200);
  const replay = await request('DELETE', url, args);
  assert.equal(replay.status, 200);
  assert.deepEqual((await replay.json()).data, first.data);
  assert.deepEqual(await counts(id), { metadata: 1, blobs: 0, version: 3 });
  assert.ok((await db.query('SELECT removed_at FROM attachments WHERE id=$1', [stored.attachment.id])).rows[0].removed_at);
  assert.equal((await request('GET', `/api/v1/attachments/${stored.attachment.id}/download`, { auth: author })).status, 404);
});

it('keeps filesystem metadata compatible when new uploads use database storage', async () => {
  const id = await draft();
  const stored = await uploadAttachment(db, actor, id, { filename: 'legacy.png', content: VALID_PNG },
    1, randomUUID(), 'b14-filesystem', uploads, 'filesystem');
  assert.deepEqual(await counts(id), { metadata: 1, blobs: 0, version: 2 });
  const response = await request('GET', `/api/v1/attachments/${stored.body.attachment.id}/download`, { auth: author });
  assert.equal(response.status, 200);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), VALID_PNG);
  await deleteAttachment(db, actor, id, stored.body.attachment.id, 2, randomUUID(), 'b14-filesystem-delete', uploads);
  assert.ok(!(await readdir(uploads)).some((name) => /^[a-f0-9]{32}$/.test(name)));
});

it('preserves download and replay after database reopen and replacement of ephemeral upload directory', async () => {
  const id = await draft();
  const key = randomUUID();
  const stored = await upload(id, key);
  await new Promise((resolve) => server.close(resolve));
  await db.close();
  db = null;
  // Simulate a host restart with a fresh filesystem and the same durable DB.
  uploads = path.join(root, 'uploads-2');
  db = await openDatabase({ databaseUrl: null, pgliteDir: databaseDir });
  await start();
  const ready = await request('GET', '/api/health/ready');
  assert.equal(ready.status, 200);
  const response = await request('GET', `/api/v1/attachments/${stored.attachment.id}/download`, { auth: author });
  assert.equal(response.status, 200);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), VALID_PNG);
  assert.deepEqual(await upload(id, key), stored);
  assert.deepEqual(await counts(id), { metadata: 1, blobs: 1, version: 2 });
  assert.deepEqual(await readdir(uploads), ['.tmp']);
  assert.deepEqual(await readdir(path.join(uploads, '.tmp')), []);
});
