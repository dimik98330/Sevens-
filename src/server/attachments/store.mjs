// Private, bounded uploads: streamed temp files and complete image decoding.
import { randomBytes, createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { writeFile, readFile, unlink, mkdir, mkdtemp, chmod, lstat, open, link, rm } from 'node:fs/promises';
import { Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import Busboy from 'busboy';
import sharp from 'sharp';
import { canonicalHash, requireKey, beginKeyedOp, finishKeyedOp } from '../ideas/idempotency.mjs';
import { versionConflict } from '../ideas/service.mjs';
import { loadIdeaForActor, lockIdeaForActor } from '../policies/scopes.mjs';
import { uploadLimiter } from '../auth/rateLimit.mjs';
import { audit } from '../audit/log.mjs';

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 20_000_000;
export const MAX_MULTIPART_BYTES = MAX_FILE_BYTES + 65536;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// The free cloud service shares 512 MB between Next and the API. These
// process-wide libvips settings apply only to database-storage runtimes.
if (process.env.ATTACHMENT_STORAGE === 'database') {
  sharp.concurrency(1);
  sharp.cache({ memory: 8 });
}

export function resolveAttachmentStorage(value = process.env.ATTACHMENT_STORAGE || 'filesystem') {
  if (!['filesystem', 'database'].includes(value)) {
    throw fail('SERVICE_UNAVAILABLE', 'Некорректная настройка хранилища');
  }
  return value;
}

function fail(code, message, fields) {
  const error = new Error(message);
  error.code = code;
  if (fields) error.fields = fields;
  return error;
}

function validateVersion(value) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw fail('VALIDATION_ERROR', 'Требуется положительная целая версия карточки', {
      expectedVersion: 'Обновите карточку и повторите',
    });
  }
}

export function detectMime(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_MAGIC)) return 'image/png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString() === 'RIFF'
    && buffer.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString() === '%PDF-') return 'application/pdf';
  return null;
}

async function makeTempDirectory(uploadDir) {
  const root = path.resolve(uploadDir);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const tempRoot = path.join(root, '.tmp');
  await mkdir(tempRoot, { recursive: true, mode: 0o700 });
  const info = await lstat(tempRoot);
  if (!info.isDirectory() || info.isSymbolicLink()) throw fail('SERVICE_UNAVAILABLE', 'Хранилище недоступно');
  await chmod(tempRoot, 0o700);
  return mkdtemp(path.join(tempRoot, 'u-'));
}

function tempDirectory(tempPath, uploadDir) {
  if (typeof tempPath !== 'string') throw fail('VALIDATION_ERROR', 'Некорректный временный файл');
  const resolved = path.resolve(tempPath);
  const parent = path.dirname(resolved);
  if (path.dirname(parent) !== path.join(path.resolve(uploadDir), '.tmp')
    || !/^u-[A-Za-z0-9_-]+$/.test(path.basename(parent)) || path.basename(resolved) !== 'file') {
    throw fail('VALIDATION_ERROR', 'Некорректный временный файл');
  }
  return parent;
}

export async function cleanupMultipart(parts, uploadDir = process.env.UPLOAD_DIR || './storage/uploads') {
  for (const part of parts || []) {
    if (!part.tempPath) continue;
    const dir = tempDirectory(part.tempPath, uploadDir);
    const info = await lstat(dir).catch((error) => { if (error.code !== 'ENOENT') throw error; });
    if (info?.isDirectory() && !info.isSymbolicLink()) await rm(dir, { recursive: true, force: true });
  }
}

export async function readMultipart(req, options = {}) {
  const uploadDir = options.uploadDir || process.env.UPLOAD_DIR || './storage/uploads';
  let parser;
  try {
    if (!/^multipart\/form-data(?:\s*;|$)/i.test(req.headers['content-type'] || '')) throw new Error('multipart required');
    parser = Busboy({ headers: req.headers, defParamCharset: 'utf8', limits: {
      fileSize: MAX_FILE_BYTES + 1, files: 1, fields: 1, parts: 3,
      fieldSize: 32, fieldNameSize: 32, headerPairs: 20,
    } });
  } catch {
    throw fail('VALIDATION_ERROR', 'Ожидается корректная multipart-форма');
  }
  // Keep an error listener even while filesystem setup yields; disconnects can
  // happen before busboy is piped, and must not become unhandled stream errors.
  let earlyError = false;
  const duringSetup = () => { earlyError = true; };
  req.on('error', duringSetup);
  let dir;
  try { dir = await makeTempDirectory(uploadDir); }
  catch (error) { req.off('error', duringSetup); throw error; }
  const parts = [];
  const writes = [];
  let failure = null;
  let total = 0;
  const noteFailure = (error) => { failure ||= error; };
  const stop = (error) => {
    noteFailure(error);
    req.unpipe(parser);
    // Destroy outside busboy callbacks, which can still be writing a part.
    queueMicrotask(() => parser.destroy(error));
    if (!req.destroyed) req.resume();
  };
  const onData = (chunk) => {
    total += chunk.length;
    if (total > MAX_MULTIPART_BYTES) stop(fail('FILE_TOO_LARGE', 'Файл слишком большой'));
  };
  const onAborted = () => stop(fail('VALIDATION_ERROR', 'Загрузка прервана'));
  const onError = () => stop(fail('VALIDATION_ERROR', 'Загрузка прервана'));
  try {
    await new Promise((resolve) => {
      parser.on('file', (name, stream, info) => {
        if (name !== 'file' || !info.filename) {
          noteFailure(fail('VALIDATION_ERROR', 'Ожидается один файл в поле file'));
          stream.resume();
          return;
        }
        const part = { name, filename: info.filename, contentType: info.mimeType,
          tempPath: path.join(dir, 'file'), sizeBytes: 0, sha256: null };
        parts.push(part);
        const digest = createHash('sha256');
        stream.on('limit', () => noteFailure(fail('FILE_TOO_LARGE', 'Файл слишком большой')));
        const measure = new Transform({ transform(chunk, _encoding, callback) {
          part.sizeBytes += chunk.length;
          digest.update(chunk);
          callback(null, chunk);
        } });
        const work = pipeline(stream, measure, createWriteStream(part.tempPath, { flags: 'wx', mode: 0o600 }))
          .then(() => {
            part.sha256 = digest.digest('hex');
            if (stream.truncated || part.sizeBytes > MAX_FILE_BYTES) noteFailure(fail('FILE_TOO_LARGE', 'Файл слишком большой'));
          }).catch(() => noteFailure(fail('VALIDATION_ERROR', 'Загрузка прервана')));
        writes.push(work);
      });
      parser.on('field', (name, value, info) => {
        if (name !== 'expectedVersion' || info.nameTruncated || info.valueTruncated
          || !/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(Number(value))) {
          noteFailure(fail('VALIDATION_ERROR', 'Некорректное поле формы', { expectedVersion: 'Обновите карточку и повторите' }));
          return;
        }
        parts.push({ name, content: Buffer.from(value) });
      });
      for (const event of ['filesLimit', 'fieldsLimit', 'partsLimit']) {
        parser.on(event, () => noteFailure(fail('VALIDATION_ERROR', 'Ожидаются один файл и expectedVersion')));
      }
      parser.on('error', (error) => noteFailure(error.code && ['FILE_TOO_LARGE', 'VALIDATION_ERROR'].includes(error.code)
        ? error : fail('VALIDATION_ERROR', 'Некорректная multipart-форма')));
      parser.on('close', resolve);
      req.on('data', onData);
      req.once('aborted', onAborted);
      req.once('error', onError);
      if (earlyError || req.aborted || req.destroyed) onAborted();
      else req.pipe(parser);
    });
    await Promise.all(writes);
    if (failure) throw failure;
    if (parts.length !== 2 || !parts.some((part) => part.tempPath)
      || !parts.some((part) => part.name === 'expectedVersion')) {
      throw fail('VALIDATION_ERROR', 'Прикрепите один файл и укажите expectedVersion');
    }
    return parts;
  } catch (error) {
    await Promise.all(writes);
    await rm(dir, { recursive: true, force: true });
    throw error;
  } finally {
    req.off('data', onData);
    req.off('aborted', onAborted);
    req.off('error', onError);
    req.off('error', duringSetup);
  }
}

function storagePath(uploadDir, key) {
  if (!/^[a-f0-9]{32}$/.test(key)) throw fail('SERVICE_UNAVAILABLE', 'Некорректный ключ хранилища');
  return path.join(path.resolve(uploadDir), key);
}

async function inspectSource(file, uploadDir) {
  if (file.tempPath) {
    const dir = tempDirectory(file.tempPath, uploadDir);
    const directory = await lstat(dir);
    const info = await lstat(file.tempPath);
    if (!directory.isDirectory() || directory.isSymbolicLink() || !info.isFile() || info.isSymbolicLink()) {
      throw fail('VALIDATION_ERROR', 'Некорректный временный файл');
    }
    if (info.size > MAX_FILE_BYTES) throw fail('FILE_TOO_LARGE', 'Файл слишком большой');
    const handle = await open(file.tempPath, 'r');
    const header = Buffer.alloc(16);
    try { await handle.read(header, 0, header.length, 0); } finally { await handle.close(); }
    const digest = createHash('sha256');
    for await (const chunk of createReadStream(file.tempPath)) digest.update(chunk);
    return { source: file.tempPath, size: info.size, sha256: digest.digest('hex'), mime: detectMime(header) };
  }
  if (!Buffer.isBuffer(file.content)) throw fail('VALIDATION_ERROR', 'Прикрепите файл');
  if (file.content.length > MAX_FILE_BYTES) throw fail('FILE_TOO_LARGE', 'Файл слишком большой');
  return { source: file.content, size: file.content.length,
    sha256: createHash('sha256').update(file.content).digest('hex'), mime: detectMime(file.content) };
}

let decoders = 0;
const decoderWaiters = [];
async function decodeImage(source, mime, databaseStorage = false) {
  if (decoders >= (databaseStorage ? 1 : 2)) {
    if (decoderWaiters.length >= 8) throw fail('SERVICE_UNAVAILABLE', 'Повторите загрузку позже');
    await new Promise((resolve) => decoderWaiters.push(resolve));
  } else decoders++;
  try {
    const image = sharp(source, { failOn: 'warning', limitInputPixels: MAX_IMAGE_PIXELS, animated: true });
    const metadata = await image.metadata();
    const expectedFormat = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/webp': 'webp' }[mime];
    if (metadata.format !== expectedFormat || !metadata.width || !metadata.height) {
      throw fail('UNSUPPORTED_FILE_TYPE', 'Некорректное изображение');
    }
    if (metadata.width * metadata.height > MAX_IMAGE_PIXELS) throw fail('FILE_TOO_LARGE', 'Изображение слишком большое');
    // Metadata alone accepts truncated images; decode every pixel and discard
    // the raw output. Sharp still allocates its native raw output buffer, so
    // database-storage runtimes serialize decoding to bound peak memory.
    await pipeline(image.raw(), new Writable({ write(_chunk, _encoding, callback) { callback(); } }));
  } catch (error) {
    if (['FILE_TOO_LARGE', 'UNSUPPORTED_FILE_TYPE'].includes(error.code)) throw error;
    if (/pixel limit|exceeds pixel|too large/i.test(error.message)) throw fail('FILE_TOO_LARGE', 'Изображение слишком большое');
    throw fail('UNSUPPORTED_FILE_TYPE', 'Некорректное или повреждённое изображение');
  } finally {
    const next = decoderWaiters.shift();
    if (next) next();
    else decoders--;
  }
}

export async function uploadAttachment(db, actor, ideaId, file, expectedVersion, key, requestId, uploadDir, storage) {
  let storageKey = null;
  let keepFile = false;
  let databaseStorage = false;
  try {
    const backend = resolveAttachmentStorage(storage);
    databaseStorage = backend === 'database';
    requireKey(key);
    validateVersion(expectedVersion);
    if (actor?.role !== 'CITIZEN') throw fail('NOT_FOUND', 'Не найдено');
    if (!file || typeof file.filename !== 'string' || !file.filename.trim()) {
      throw fail('VALIDATION_ERROR', 'Прикрепите файл', { file: 'Прикрепите файл' });
    }
    const info = await inspectSource(file, uploadDir);
    const hash = canonicalHash({ op: 'idea.upload', idea: ideaId, sha256: info.sha256, expectedVersion });
    if (!databaseStorage) await mkdir(uploadDir, { recursive: true, mode: 0o700 });
    let inserted = false;
    const outcome = await db.transaction(async (tx) => {
      const slot = await beginKeyedOp(tx, actor.id, 'idea.upload', key, hash);
      const row = await lockIdeaForActor(tx, actor, ideaId);
      if (slot.replay) return slot.replay;
      if (!row || row.author_id !== actor.id) throw fail('NOT_FOUND', 'Не найдено');
      if (!['DRAFT', 'NEEDS_INFO'].includes(row.status)) throw fail('INVALID_TRANSITION', 'Файл можно прикрепить к черновику или ответу на уточнение');
      if (row.version !== expectedVersion) versionConflict(row.version);
      const active = await tx.query('SELECT count(*)::int AS count FROM attachments WHERE idea_id=$1 AND removed_at IS NULL', [ideaId]);
      if (active.rows[0].count >= 3) throw fail('VALIDATION_ERROR', 'Максимум 3 активных файла', { file: 'Максимум 3 активных файла' });
      // A reservation is held before rate limiting, so simultaneous retries
      // with the same key neither decode again nor consume another quota slot.
      const retryAfter = uploadLimiter.check(`upload:${actor.id}`, 30, 3600);
      if (retryAfter) {
        const error = fail('RATE_LIMITED', 'Слишком много загрузок файлов');
        error.retryAfter = retryAfter;
        throw error;
      }
      if (!info.mime || info.size === 0) throw fail('UNSUPPORTED_FILE_TYPE', 'Недопустимый тип файла');
      if (info.mime.startsWith('image/')) await decodeImage(info.source, info.mime, databaseStorage);
      storageKey = randomBytes(16).toString('hex');
      // Filesystem mode publishes a complete file without replacing any key.
      // Database mode commits bytes and metadata in this same transaction.
      if (!databaseStorage) {
        if (file.tempPath) await link(file.tempPath, storagePath(uploadDir, storageKey));
        else await writeFile(storagePath(uploadDir, storageKey), file.content, { flag: 'wx', mode: 0o600 });
      }
      const filename = file.filename.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 255);
      const ins = await tx.query(`INSERT INTO attachments(idea_id, uploaded_by, storage_key, original_name,
        detected_mime, size_bytes, sha256, storage_backend) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [ideaId, actor.id, storageKey, filename, info.mime, info.size, info.sha256, backend]);
      if (databaseStorage) {
        const content = Buffer.isBuffer(info.source) ? info.source : await readFile(info.source);
        await tx.query('INSERT INTO attachment_blobs(attachment_id, content) VALUES($1,$2)',
          [ins.rows[0].id, content]);
      }
      const upd = await tx.query('UPDATE ideas SET version=version+1 WHERE id=$1 RETURNING version', [ideaId]);
      await tx.query(`INSERT INTO idea_events(idea_id, type, actor_id, visibility, comment_id, payload_json)
        VALUES($1,'ATTACHMENT_ADDED',$2,'PUBLIC',NULL,$3)`, [ideaId, actor.id, JSON.stringify({ attachmentId: ins.rows[0].id })]);
      await audit(tx, { regionId: row.region_id, actorId: actor.id, action: 'idea.upload', entityType: 'attachment',
        entityId: ins.rows[0].id, requestId, metadata: { ideaId, mime: info.mime, size: info.size } });
      const body = { attachment: { id: ins.rows[0].id, originalName: filename, mime: info.mime, sizeBytes: info.size }, ideaVersion: upd.rows[0].version };
      await finishKeyedOp(tx, actor.id, 'idea.upload', key, 201, body);
      inserted = true;
      return { status: 201, body };
    });
    keepFile = inserted;
    return outcome;
  } finally {
    if (storageKey && !databaseStorage && !keepFile) {
      // A lost COMMIT response is ambiguous. Keep a file if its metadata exists
      // or the DB cannot answer; maintenance can later remove a proven orphan.
      const reference = await db.query('SELECT 1 FROM attachments WHERE storage_key=$1 AND removed_at IS NULL', [storageKey])
        .catch(() => null);
      if (reference && reference.rows.length === 0) await unlink(storagePath(uploadDir, storageKey)).catch(() => {});
    }
    if (file?.tempPath) await cleanupMultipart([file], uploadDir);
  }
}

export async function deleteAttachment(db, actor, ideaId, attachmentId, expectedVersion, key, requestId, uploadDir) {
  requireKey(key);
  validateVersion(expectedVersion);
  if (actor?.role !== 'CITIZEN') throw fail('NOT_FOUND', 'Не найдено');
  const hash = canonicalHash({ op: 'idea.attachment-delete', idea: ideaId, attachment: attachmentId, expectedVersion });
  let removedKey = null;
  const outcome = await db.transaction(async (tx) => {
    const slot = await beginKeyedOp(tx, actor.id, 'idea.attachment-delete', key, hash);
    const idea = await lockIdeaForActor(tx, actor, ideaId);
    if (slot.replay) return slot.replay;
    if (!idea || idea.author_id !== actor.id) throw fail('NOT_FOUND', 'Не найдено');
    if (idea.status !== 'DRAFT') throw fail('INVALID_TRANSITION', 'Файл можно удалить только из черновика');
    if (idea.version !== expectedVersion) versionConflict(idea.version);
    const att = await tx.query('SELECT * FROM attachments WHERE id=$1 AND idea_id=$2', [attachmentId, ideaId]);
    if (!att.rows[0] || att.rows[0].removed_at || att.rows[0].uploaded_by !== actor.id) throw fail('NOT_FOUND', 'Не найдено');
    await tx.query('UPDATE attachments SET removed_at=now() WHERE id=$1', [attachmentId]);
    await tx.query('DELETE FROM attachment_blobs WHERE attachment_id=$1', [attachmentId]);
    const upd = await tx.query('UPDATE ideas SET version=version+1 WHERE id=$1 RETURNING version', [ideaId]);
    await tx.query(`INSERT INTO idea_events(idea_id, type, actor_id, visibility, payload_json)
      VALUES($1,'ATTACHMENT_REMOVED',$2,'PUBLIC',$3)`, [ideaId, actor.id, JSON.stringify({ attachmentId })]);
    await audit(tx, { regionId: idea.region_id, actorId: actor.id, action: 'idea.attachment-delete',
      entityType: 'attachment', entityId: attachmentId, requestId, metadata: { ideaId } });
    const body = { ideaVersion: upd.rows[0].version };
    await finishKeyedOp(tx, actor.id, 'idea.attachment-delete', key, 200, body);
    if (att.rows[0].storage_backend !== 'database') removedKey = att.rows[0].storage_key;
    return { status: 200, body };
  });
  if (removedKey) await unlink(storagePath(uploadDir, removedKey)).catch(() => {});
  return outcome;
}

export async function downloadAttachment(db, actor, attachmentId) {
  const att = await db.query('SELECT * FROM attachments WHERE id=$1', [attachmentId]);
  const row = att.rows[0];
  if (!row || row.removed_at) throw fail('NOT_FOUND', 'Не найдено');
  await loadIdeaForActor(db, actor, row.idea_id);
  const meta = { storageKey: row.storage_key, mime: row.detected_mime, filename: row.original_name, size: row.size_bytes };
  if (row.storage_backend === 'database') {
    // Fetch private bytes only after the existing object-level policy succeeds.
    const blob = await db.query(`SELECT b.content FROM attachment_blobs b
      JOIN attachments a ON a.id=b.attachment_id WHERE b.attachment_id=$1 AND a.removed_at IS NULL`, [attachmentId]);
    if (!blob.rows[0]) throw fail('NOT_FOUND', 'Не найдено');
    meta.content = Buffer.from(blob.rows[0].content);
  }
  return meta;
}
