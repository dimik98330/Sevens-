// Attachment regressions use only in-memory PGlite and task-owned temp files.
import { before, after, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { PassThrough } from 'node:stream';
import { createServer as createHttpServer, request as httpRequest } from 'node:http';
import { mkdtemp, readdir, readFile, writeFile, mkdir, rm, utimes, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { openDatabase } from '../../../src/server/db/client.mjs';
import { migrate } from '../../../scripts/migrate.mjs';
import { seed } from '../../../scripts/seed.mjs';
import { cleanupStorage } from '../../../scripts/cleanup-storage.mjs';
import { uploadLimiter } from '../../../src/server/auth/rateLimit.mjs';
import { readMultipart, cleanupMultipart, uploadAttachment, deleteAttachment, MAX_FILE_BYTES } from '../../../src/server/attachments/store.mjs';
import { VALID_PNG } from './helpers/valid-png.mjs';

let db, uploadDir, actor;
const errorCode = (code) => (error) => error.code === code;
const version = async (id) => (await db.query('SELECT version FROM ideas WHERE id=$1', [id])).rows[0].version;
const storedFiles = async () => (await readdir(uploadDir)).filter((name) => /^[a-f0-9]{32}$/.test(name));
const tempFiles = async () => readdir(path.join(uploadDir, '.tmp')).catch((error) => {
  if (error.code === 'ENOENT') return [];
  throw error;
});

async function draft() {
  return (await db.query('INSERT INTO ideas(region_id,author_id,title) VALUES($1,$2,$3) RETURNING id',
    [actor.regionId, actor.id, 'Attachment test ' + randomUUID()])).rows[0].id;
}

function form({ files = [{ name: 'file', filename: 'sample.png', content: VALID_PNG }],
  fields = [['expectedVersion', '1']], closing = true } = {}) {
  const boundary = 'b06-' + randomUUID();
  const chunks = [];
  for (const [name, value] of fields) chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  for (const file of files) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${file.name}"; filename="${file.filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`));
    chunks.push(file.content, Buffer.from('\r\n'));
  }
  if (closing) chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { contentType: `multipart/form-data; boundary=${boundary}`, body: Buffer.concat(chunks) };
}

async function parse(value) {
  const req = new PassThrough();
  req.headers = { 'content-type': value.contentType };
  const parsed = readMultipart(req, { uploadDir });
  req.end(value.body);
  return parsed;
}

async function upload(id, content = VALID_PNG, key = randomUUID(), expectedVersion = 1) {
  return uploadAttachment(db, actor, id, { filename: 'sample.png', content }, expectedVersion, key, 'req-b06', uploadDir);
}

before(async () => {
  uploadDir = await mkdtemp(path.join(tmpdir(), 'sevens-b06-'));
  db = await openDatabase({ databaseUrl: null, pgliteDir: null });
  assert.equal(db.kind, 'pglite');
  await migrate(db);
  await seed(db, { demoPassword: 'test-b06-12-characters' });
  const user = (await db.query("SELECT id, region_id FROM users WHERE email_normalized='citizen1@example.test'")).rows[0];
  actor = { id: user.id, role: 'CITIZEN', regionId: user.region_id };
});
beforeEach(() => uploadLimiter.hits.clear());
after(async () => {
  if (db) await db.close();
  const target = path.resolve(uploadDir);
  assert.ok(target.startsWith(path.resolve(tmpdir()) + path.sep));
  await rm(target, { recursive: true, force: true });
});

describe('B-06 multipart and real image validation', () => {
  it('streams bytes to a private temp file, then stores metadata and cleans temp', async () => {
    const id = await draft();
    const parts = await parse(form());
    const file = parts.find((part) => part.filename);
    assert.equal(file.content, undefined);
    assert.equal(file.sizeBytes, VALID_PNG.length);
    assert.equal(file.sha256.length, 64);
    assert.deepEqual(await readFile(file.tempPath), VALID_PNG);
    if (process.platform !== 'win32') assert.equal((await lstat(file.tempPath)).mode & 0o777, 0o600);
    const result = await uploadAttachment(db, actor, id, file, 1, randomUUID(), 'req-b06', uploadDir);
    assert.equal(result.status, 201);
    assert.equal(result.body.attachment.mime, 'image/png');
    assert.equal(result.body.ideaVersion, 2);
    assert.deepEqual(await tempFiles(), []);
    const meta = (await db.query('SELECT storage_key FROM attachments WHERE id=$1', [result.body.attachment.id])).rows[0];
    assert.match(meta.storage_key, /^[a-f0-9]{32}$/);
    assert.deepEqual(await readFile(path.join(uploadDir, meta.storage_key)), VALID_PNG);
  });

  it('rejects repeated/unknown/missing fields, extra files and malformed multipart without temp leaks', async () => {
    const cases = [
      form({ fields: [] }),
      form({ fields: [['expectedVersion', '1'], ['expectedVersion', '1']] }),
      form({ fields: [['other', '1']] }),
      form({ files: [] }),
      form({ files: [{ name: 'wrong', filename: 'a.png', content: VALID_PNG }] }),
      form({ files: [{ name: 'file', filename: 'a.png', content: VALID_PNG }, { name: 'file', filename: 'b.png', content: VALID_PNG }] }),
      form({ closing: false }),
    ];
    for (const value of cases) {
      await assert.rejects(parse(value), errorCode('VALIDATION_ERROR'));
      assert.deepEqual(await tempFiles(), []);
    }
  });

  it('rejects blank, zero, negative, decimal and unsafe versions on streaming and Buffer paths', async () => {
    const id = await draft();
    for (const value of ['', '0', '-1', '1.5', '9007199254740992']) {
      await assert.rejects(parse(form({ fields: [['expectedVersion', value]] })), errorCode('VALIDATION_ERROR'));
    }
    for (const value of [undefined, '', '1', 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      await assert.rejects(uploadAttachment(db, actor, id, { filename: 'sample.png', content: VALID_PNG }, value, randomUUID(), 'req-b06', uploadDir), errorCode('VALIDATION_ERROR'));
    }
    assert.equal(await version(id), 1);
    assert.deepEqual(await tempFiles(), []);
  });

  it('rejects oversized streaming content with a contract 413 code and no temp orphan', async () => {
    await assert.rejects(parse(form({ files: [{ name: 'file', filename: 'large.png', content: Buffer.alloc(MAX_FILE_BYTES + 1) }] })), errorCode('FILE_TOO_LARGE'));
    await assert.rejects(parse(form({ files: [{ name: 'file', filename: 'huge.png', content: Buffer.alloc(MAX_FILE_BYTES + 70000) }] })), errorCode('FILE_TOO_LARGE'));
    assert.deepEqual(await tempFiles(), []);
  });

  it('accepts exactly 5 MiB and preserves a 413 response for a larger raw HTTP request', async () => {
    const content = Buffer.alloc(MAX_FILE_BYTES, 0x20);
    Buffer.from('%PDF-1.7').copy(content);
    const parts = await parse(form({ files: [{ name: 'file', filename: 'max.pdf', content }] }));
    const file = parts.find((part) => part.filename);
    assert.equal(file.sizeBytes, MAX_FILE_BYTES);
    const result = await uploadAttachment(db, actor, await draft(), file, 1, randomUUID(), 'req-b06', uploadDir);
    assert.equal(result.body.attachment.sizeBytes, MAX_FILE_BYTES);
    const server = createHttpServer(async (req, res) => {
      try {
        await cleanupMultipart(await readMultipart(req, { uploadDir }), uploadDir);
        res.writeHead(201).end();
      } catch (error) {
        res.writeHead(error.code === 'FILE_TOO_LARGE' ? 413 : 400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ code: error.code }));
      }
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const value = form({ files: [{ name: 'file', filename: 'too-large.pdf', content: Buffer.alloc(MAX_FILE_BYTES + 70000) }] });
      const response = await fetch(`http://127.0.0.1:${server.address().port}/`, { method: 'POST', headers: { 'content-type': value.contentType }, body: value.body });
      assert.equal(response.status, 413);
      assert.equal((await response.json()).code, 'FILE_TOO_LARGE');
      assert.deepEqual(await tempFiles(), []);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('cleans a disconnected partial upload', async () => {
    const req = new PassThrough();
    req.headers = { 'content-type': 'multipart/form-data; boundary=abort-b06' };
    const resumed = once(req, 'resume');
    const parsed = readMultipart(req, { uploadDir });
    await resumed;
    req.write(Buffer.from('--abort-b06\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\n\r\npartial'));
    req.emit('aborted');
    await assert.rejects(parsed, errorCode('VALIDATION_ERROR'));
    req.destroy();
    assert.deepEqual(await tempFiles(), []);
  });

  it('handles a raw socket disconnect without leaking files or rejecting outside the handler', async () => {
    let observed;
    const finished = new Promise((resolve) => { observed = resolve; });
    const server = createHttpServer(async (req, res) => {
      try {
        const parts = await readMultipart(req, { uploadDir });
        await cleanupMultipart(parts, uploadDir);
        observed(null);
      } catch (error) { observed(error); }
      if (!res.destroyed) res.end();
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const client = httpRequest({ hostname: '127.0.0.1', port: server.address().port, method: 'POST',
        headers: { 'content-type': 'multipart/form-data; boundary=raw-abort' } });
      client.on('error', () => {});
      const received = once(server, 'request');
      client.write('--raw-abort\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\n\r\npartial');
      await received;
      client.destroy();
      const error = await finished;
      assert.equal(error.code, 'VALIDATION_ERROR');
      assert.deepEqual(await tempFiles(), []);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('rejects magic-only and truncated PNG, JPEG, WebP instead of trusting dimensions', async () => {
    const id = await draft();
    const jpeg = await sharp(VALID_PNG).jpeg().toBuffer();
    const webp = await sharp(VALID_PNG).webp().toBuffer();
    const before = await storedFiles();
    for (const content of [VALID_PNG.subarray(0, 24), VALID_PNG.subarray(0, 45), jpeg.subarray(0, 30), webp.subarray(0, 20), Buffer.from('<svg/>')]) {
      await assert.rejects(upload(id, content), errorCode('UNSUPPORTED_FILE_TYPE'));
    }
    assert.equal(await version(id), 1);
    assert.deepEqual(await storedFiles(), before);
  });

  it('accepts decoded JPEG and WebP and rejects images exceeding 20 megapixels', async () => {
    for (const type of ['jpeg', 'webp']) {
      const id = await draft();
      const content = await sharp(VALID_PNG)[type]().toBuffer();
      const result = await upload(id, content);
      assert.equal(result.body.attachment.mime, 'image/' + type);
    }
    const huge = await sharp({ create: { width: 5000, height: 4001, channels: 3, background: '#000' } }).png().toBuffer();
    assert.ok(huge.length < MAX_FILE_BYTES);
    await assert.rejects(upload(await draft(), huge), errorCode('FILE_TOO_LARGE'));
  });
});

describe('B-06 atomic storage, replay and quota', () => {
  it('rolls back a database error after file publication, with no metadata/events/file', async () => {
    const id = await draft();
    const before = await storedFiles();
    const parts = await parse(form());
    await db.query('ALTER TABLE audit_events ADD CONSTRAINT b06_audit_failure CHECK (false) NOT VALID');
    try {
      await assert.rejects(uploadAttachment(db, actor, id, parts.find((part) => part.filename), 1, randomUUID(), 'req-b06', uploadDir));
    } finally {
      await db.query('ALTER TABLE audit_events DROP CONSTRAINT b06_audit_failure');
    }
    assert.equal(await version(id), 1);
    assert.equal((await db.query('SELECT count(*)::int AS count FROM attachments WHERE idea_id=$1', [id])).rows[0].count, 0);
    assert.equal((await db.query('SELECT count(*)::int AS count FROM idea_events WHERE idea_id=$1', [id])).rows[0].count, 0);
    assert.deepEqual(await storedFiles(), before);
    assert.deepEqual(await tempFiles(), []);
  });

  it('replays successes without quota/decode/storage changes and refuses changed bytes', async () => {
    const id = await draft();
    const key = randomUUID();
    const first = await upload(id, VALID_PNG, key);
    const before = await storedFiles();
    for (let index = 0; index < 35; index++) assert.deepEqual(await upload(id, VALID_PNG, key), first);
    assert.equal(uploadLimiter.hits.get('upload:' + actor.id).length, 1);
    const parts = await parse(form());
    assert.deepEqual(await uploadAttachment(db, actor, id, parts.find((part) => part.filename), 1, key, 'req-b06', uploadDir), first);
    assert.deepEqual(await tempFiles(), []);
    await assert.rejects(upload(id, Buffer.from('%PDF-changed bytes'), key), errorCode('IDEMPOTENCY_CONFLICT'));
    assert.deepEqual(await storedFiles(), before);
    assert.equal(await version(id), 2);
  });

  it('limits fresh attempts to 30/hour before expensive decode', async () => {
    const id = await draft();
    for (let index = 0; index < 30; index++) await assert.rejects(upload(id, Buffer.from('<svg/>')), errorCode('UNSUPPORTED_FILE_TYPE'));
    await assert.rejects(upload(id), (error) => error.code === 'RATE_LIMITED' && error.retryAfter > 0);
    assert.equal(await version(id), 1);
  });

  it('never returns an upload/delete replay after role, region or current ownership changed', async () => {
    const id = await draft();
    const uploadKey = randomUUID();
    const created = await upload(id, VALID_PNG, uploadKey);
    const deleteKey = randomUUID();
    await deleteAttachment(db, actor, id, created.body.attachment.id, 2, deleteKey, 'req-b06', uploadDir);
    for (const changedActor of [{ ...actor, role: 'ADMIN' }, { ...actor, role: 'STAFF' }, { ...actor, regionId: randomUUID() }]) {
      await assert.rejects(uploadAttachment(db, changedActor, id, { filename: 'sample.png', content: VALID_PNG }, 1, uploadKey, 'req-b06', uploadDir), errorCode('NOT_FOUND'));
      await assert.rejects(deleteAttachment(db, changedActor, id, created.body.attachment.id, 2, deleteKey, 'req-b06', uploadDir), errorCode('NOT_FOUND'));
    }
    const other = (await db.query("SELECT id FROM users WHERE email_normalized='citizen2@example.test'")).rows[0];
    await db.query('UPDATE ideas SET author_id=$1 WHERE id=$2', [other.id, id]);
    await assert.rejects(uploadAttachment(db, actor, id, { filename: 'sample.png', content: VALID_PNG }, 1, uploadKey, 'req-b06', uploadDir), errorCode('NOT_FOUND'));
    await assert.rejects(deleteAttachment(db, actor, id, created.body.attachment.id, 2, deleteKey, 'req-b06', uploadDir), errorCode('NOT_FOUND'));
    assert.equal(await version(id), 3);
  });

  it('preserves the three-file cap and cleans rejected temp sources', async () => {
    const id = await draft();
    for (let index = 1; index <= 3; index++) await upload(id, VALID_PNG, randomUUID(), index);
    const parts = await parse(form({ fields: [['expectedVersion', '4']] }));
    const before = await storedFiles();
    await assert.rejects(uploadAttachment(db, actor, id, parts.find((part) => part.filename), 4, randomUUID(), 'req-b06', uploadDir), errorCode('VALIDATION_ERROR'));
    assert.deepEqual(await tempFiles(), []);
    assert.deepEqual(await storedFiles(), before);
    assert.equal(await version(id), 4);
  });

  it('strict delete version cannot mutate storage and valid deletion commits before unlink', async () => {
    const id = await draft();
    const created = await upload(id);
    await assert.rejects(deleteAttachment(db, actor, id, created.body.attachment.id, '', randomUUID(), 'req-b06', uploadDir), errorCode('VALIDATION_ERROR'));
    const result = await deleteAttachment(db, actor, id, created.body.attachment.id, 2, randomUUID(), 'req-b06', uploadDir);
    assert.equal(result.body.ideaVersion, 3);
    assert.ok((await db.query('SELECT removed_at FROM attachments WHERE id=$1', [created.body.attachment.id])).rows[0].removed_at);
  });
});

describe('B-06 guarded maintenance', () => {
  it('defaults to dry-run; apply removes only old orphans and expired records in the confirmed stand', async () => {
    const directory = path.join(uploadDir, 'maintenance');
    await mkdir(directory);
    const activeKey = (await db.query('SELECT storage_key FROM attachments WHERE removed_at IS NULL LIMIT 1')).rows[0].storage_key;
    const orphan = 'a'.repeat(32), fresh = 'b'.repeat(32);
    for (const key of [activeKey, orphan, fresh]) await writeFile(path.join(directory, key), 'test');
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await utimes(path.join(directory, activeKey), old, old);
    await utimes(path.join(directory, orphan), old, old);
    const temp = path.join(directory, '.tmp', 'u-oldtest');
    await mkdir(temp, { recursive: true });
    await writeFile(path.join(temp, 'file'), 'partial');
    await utimes(path.join(temp, 'file'), old, old);
    await utimes(temp, old, old);
    await db.query(`INSERT INTO sessions(user_id,token_hash,csrf_token_hash,expires_at)
      VALUES($1,$2,$3,now()-interval '1 hour')`, [actor.id, 'a'.repeat(64), 'b'.repeat(64)]);
    await db.query(`INSERT INTO idempotency_records(user_id,operation,key,request_hash,response_status,response_json,expires_at)
      VALUES($1,'b06.expiry',$2,$3,201,'{}',now()-interval '1 hour')`, [actor.id, randomUUID(), 'a'.repeat(64)]);
    const dry = await cleanupStorage({ db, uploadDir: directory });
    assert.equal(dry.mode, 'dry-run');
    assert.deepEqual(dry.orphanFiles, [orphan]);
    assert.deepEqual(dry.staleTempDirectories, ['u-oldtest']);
    assert.equal(dry.expiredSessions, 1);
    assert.equal(dry.expiredIdempotency, 1);
    assert.equal(dry.removedFiles, 0);
    const database = (await db.query('SELECT current_database() AS name')).rows[0].name;
    await assert.rejects(cleanupStorage({ db, uploadDir: directory, apply: true }));
    await assert.rejects(cleanupStorage({ db, uploadDir: directory, apply: true, environment: 'production', confirmUploadDir: directory, confirmDatabase: database }));
    await assert.rejects(cleanupStorage({ db, uploadDir: directory, apply: true, environment: 'test', confirmUploadDir: directory, confirmDatabase: 'wrong-database' }));
    const applied = await cleanupStorage({ db, uploadDir: directory, apply: true, environment: 'test', confirmUploadDir: directory, confirmDatabase: database });
    assert.equal(applied.removedFiles, 1);
    assert.equal(applied.removedTempDirectories, 1);
    assert.equal(applied.removedSessions, 1);
    assert.equal(applied.removedIdempotency, 1);
    assert.deepEqual((await readdir(directory)).sort(), ['.tmp', activeKey, fresh].sort());
    await assert.rejects(cleanupStorage({ db, uploadDir: directory, minimumAgeMs: 1 }));
    await assert.rejects(cleanupStorage({ db, uploadDir: path.parse(directory).root }));
  });

  it('allows explicit cleanup of a parsed file after an outer handler failure', async () => {
    const parts = await parse(form());
    await cleanupMultipart(parts, uploadDir);
    assert.deepEqual(await tempFiles(), []);
  });
});
