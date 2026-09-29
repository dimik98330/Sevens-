// Secure attachments (06 section 6): multipart with byte caps, magic-byte
// type check, image pixel cap, random storage keys outside any public dir,
// access-checked download. Original names never build paths.
import { randomBytes, createHash } from 'node:crypto';
import { writeFile, unlink, mkdir } from 'node:fs/promises';
import path from 'node:path';
import {
  canonicalHash, findReplay, requireKey, beginKeyedOp, finishKeyedOp,
} from '../ideas/idempotency.mjs';
import { versionConflict } from '../ideas/service.mjs';
import { loadIdeaForActor } from '../policies/scopes.mjs';
import { audit } from '../audit/log.mjs';

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 20_000_000;

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function detectMime(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_MAGIC)) return 'image/png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString() === 'RIFF'
    && buffer.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString() === '%PDF-') return 'application/pdf';
  return null;
}

export function imageDimensions(buffer, mime) {
  try {
    if (mime === 'image/png' && buffer.length >= 24) {
      return { w: buffer.readUInt32BE(16), h: buffer.readUInt32BE(20) };
    }
    if (mime === 'image/jpeg') {
      let i = 2;
      while (i + 8 < buffer.length) {
        if (buffer[i] !== 0xff) break;
        const marker = buffer[i + 1];
        const len = buffer.readUInt16BE(i + 2);
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { h: buffer.readUInt16BE(i + 5), w: buffer.readUInt16BE(i + 7) };
        }
        i += 2 + len;
      }
      return null;
    }
    if (mime === 'image/webp' && buffer.length >= 30) {
      const chunk = buffer.subarray(12, 16).toString();
      if (chunk === 'VP8 ' && buffer.length >= 30) {
        const w = buffer.readUInt16LE(26) & 0x3fff;
        const h = buffer.readUInt16LE(28) & 0x3fff;
        return { w, h };
      }
      if (chunk === 'VP8L' && buffer.length >= 25) {
        const b = buffer.readUInt32LE(21);
        return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 };
      }
      if (chunk === 'VP8X' && buffer.length >= 30) {
        const w = buffer.readUIntBE(24, 3) + 1;
        const h = buffer.readUIntBE(27, 3) + 1;
        return { w, h };
      }
    }
  } catch {
    return null;
  }
  return null;
}

export function parseMultipartBody(buffer, boundary) {
  const parts = [];
  const delimiter = Buffer.from('--' + boundary);
  let start = 0;
  const slices = [];
  for (;;) {
    const idx = buffer.indexOf(delimiter, start);
    if (idx === -1) break;
    slices.push({ from: start, to: idx });
    start = idx + delimiter.length;
    if (buffer.subarray(start, start + 2).toString() === '--') break;
  }
  for (let n = 1; n < slices.length; n++) {
    let chunk = buffer.subarray(slices[n].from, slices[n].to);
    if (chunk[0] === 0x0d && chunk[1] === 0x0a) chunk = chunk.subarray(2);
    if (chunk[chunk.length - 2] === 0x0d && chunk[chunk.length - 1] === 0x0a) {
      chunk = chunk.subarray(0, chunk.length - 2);
    }
    const headerEnd = chunk.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;
    const headers = chunk.subarray(0, headerEnd).toString('latin1');
    const content = chunk.subarray(headerEnd + 4);
    const nameMatch = /name="([^"]*)"/.exec(headers);
    const fileMatch = /filename="([^"]*)"/.exec(headers);
    parts.push({
      name: nameMatch?.[1],
      filename: fileMatch?.[1],
      contentType: /content-type:\s*([^\r\n]+)/i.exec(headers)?.[1]?.trim(),
      content: Buffer.from(content),
    });
  }
  return parts;
}

export function readMultipart(req, maxTotal = MAX_FILE_BYTES + 65536) {
  return new Promise((resolve, reject) => {
    const ctype = req.headers['content-type'] || '';
    const m = /boundary=(?:"([^"]+)"|([^\s;]+))/.exec(ctype);
    if (!m) {
      const err = new Error('Ожидается multipart');
      err.code = 'VALIDATION_ERROR';
      reject(err);
      return;
    }
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > maxTotal) {
        const err = new Error('Файл слишком большой');
        err.code = 'FILE_TOO_LARGE';
        reject(err);
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(parseMultipartBody(Buffer.concat(chunks), m[1] || m[2])));
    req.on('error', reject);
  });
}

function storagePath(uploadDir, key) {
  const resolved = path.resolve(uploadDir, key);
  if (!resolved.startsWith(path.resolve(uploadDir) + path.sep)) {
    throw new Error('Invalid storage key');
  }
  return resolved;
}

export async function uploadAttachment(db, actor, ideaId, file, expectedVersion, key, requestId, uploadDir) {
  requireKey(key);
  if (!file || !file.filename) {
    const err = new Error('Прикрепите файл');
    err.code = 'VALIDATION_ERROR';
    err.fields = { file: 'Прикрепите файл' };
    throw err;
  }
  if (file.content.length > MAX_FILE_BYTES) {
    const err = new Error('Файл слишком большой');
    err.code = 'FILE_TOO_LARGE';
    throw err;
  }
  const mime = detectMime(file.content);
  if (!mime) {
    const err = new Error('Недопустимый тип файла');
    err.code = 'UNSUPPORTED_FILE_TYPE';
    throw err;
  }
  if (mime.startsWith('image/')) {
    const dims = imageDimensions(file.content, mime);
    if (dims && dims.w * dims.h > MAX_IMAGE_PIXELS) {
      const err = new Error('Изображение слишком большое');
      err.code = 'FILE_TOO_LARGE';
      throw err;
    }
  }
  const sha256 = createHash('sha256').update(file.content).digest('hex');
  const hash = canonicalHash({ op: 'idea.upload', idea: ideaId, sha256, expectedVersion });
  const replay = await findReplay(db, actor.id, 'idea.upload', key, hash);
  if (replay) return replay;

  // The file hits the disk before the transaction commits; a rollback
  // removes it best-effort (INT-08), and a sweeper must ignore live keys.
  await mkdir(uploadDir, { recursive: true });
  const storageKey = randomBytes(16).toString('hex');
  await writeFile(storagePath(uploadDir, storageKey), file.content);
  let keepFile = false;
  try {
    const outcome = await db.transaction(async (tx) => {
      const slot = await beginKeyedOp(tx, actor.id, 'idea.upload', key, hash);
      if (slot.replay) return slot.replay;
      const locked = await tx.query('SELECT * FROM ideas WHERE id=$1 FOR UPDATE', [ideaId]);
      const idea = locked.rows[0];
      if (!idea || idea.author_id !== actor.id) {
        const err = new Error('Не найдено');
        err.code = 'NOT_FOUND';
        throw err;
      }
      if (idea.status !== 'DRAFT' && idea.status !== 'NEEDS_INFO') {
        const err = new Error('Файл можно прикрепить к черновику или ответу на уточнение');
        err.code = 'INVALID_TRANSITION';
        throw err;
      }
      if (idea.version !== expectedVersion) versionConflict(idea.version);
      const ins = await tx.query(
        `INSERT INTO attachments(idea_id, uploaded_by, storage_key, original_name,
           detected_mime, size_bytes, sha256)
         VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [ideaId, actor.id, storageKey, file.filename.slice(0, 255), mime,
          file.content.length, sha256]);
      const upd = await tx.query(
        'UPDATE ideas SET version=version+1 WHERE id=$1 RETURNING version', [ideaId]);
      await tx.query(
        `INSERT INTO idea_events(idea_id, type, actor_id, visibility, comment_id, payload_json)
         VALUES($1,'ATTACHMENT_ADDED',$2,'PUBLIC',NULL,$3)`,
        [ideaId, actor.id, JSON.stringify({ attachmentId: ins.rows[0].id })]);
      await audit(tx, {
        regionId: idea.region_id, actorId: actor.id, action: 'idea.upload',
        entityType: 'attachment', entityId: ins.rows[0].id, requestId,
        metadata: { ideaId, mime, size: file.content.length },
      });
      const responseBody = {
        attachment: {
          id: ins.rows[0].id, originalName: file.filename.slice(0, 255),
          mime, sizeBytes: file.content.length,
        },
        ideaVersion: upd.rows[0].version,
      };
      await finishKeyedOp(tx, actor.id, 'idea.upload', key, 201, responseBody);
      keepFile = true;
      return { status: 201, body: responseBody };
    });
    return outcome;
  } finally {
    // Rollback or replay must not leave an orphan file behind (INT-08).
    if (!keepFile) {
      try { await unlink(storagePath(uploadDir, storageKey)); } catch {}
    }
  }
}

export async function deleteAttachment(db, actor, ideaId, attachmentId, expectedVersion, key, requestId, uploadDir) {
  requireKey(key);
  const hash = canonicalHash({ op: 'idea.attachment-delete', idea: ideaId, attachment: attachmentId, expectedVersion });
  const replay = await findReplay(db, actor.id, 'idea.attachment-delete', key, hash);
  if (replay) return replay;
  let removedKey = null;
  const outcome = await db.transaction(async (tx) => {
    const slot = await beginKeyedOp(tx, actor.id, 'idea.attachment-delete', key, hash);
    if (slot.replay) return slot.replay;
    const locked = await tx.query('SELECT * FROM ideas WHERE id=$1 FOR UPDATE', [ideaId]);
    const idea = locked.rows[0];
    if (!idea || idea.author_id !== actor.id) {
      const err = new Error('Не найдено');
      err.code = 'NOT_FOUND';
      throw err;
    }
    if (idea.status !== 'DRAFT') {
      const err = new Error('Файл можно удалить только из черновика');
      err.code = 'INVALID_TRANSITION';
      throw err;
    }
    if (idea.version !== expectedVersion) versionConflict(idea.version);
    const att = await tx.query(
      'SELECT * FROM attachments WHERE id=$1 AND idea_id=$2', [attachmentId, ideaId]);
    if (att.rows.length === 0 || att.rows[0].removed_at
      || att.rows[0].uploaded_by !== actor.id) {
      const err = new Error('Не найдено');
      err.code = 'NOT_FOUND';
      throw err;
    }
    await tx.query('UPDATE attachments SET removed_at=now() WHERE id=$1', [attachmentId]);
    const upd = await tx.query(
      'UPDATE ideas SET version=version+1 WHERE id=$1 RETURNING version', [ideaId]);
    await tx.query(
      `INSERT INTO idea_events(idea_id, type, actor_id, visibility, payload_json)
       VALUES($1,'ATTACHMENT_REMOVED',$2,'PUBLIC',$3)`,
      [ideaId, actor.id, JSON.stringify({ attachmentId })]);
    await audit(tx, {
      regionId: idea.region_id, actorId: actor.id, action: 'idea.attachment-delete',
      entityType: 'attachment', entityId: attachmentId, requestId, metadata: { ideaId },
    });
    const responseBody = { ideaVersion: upd.rows[0].version };
    await finishKeyedOp(tx, actor.id, 'idea.attachment-delete', key, 200, responseBody);
    removedKey = att.rows[0].storage_key;
    return { status: 200, body: responseBody };
  });
  // File removal is best-effort AFTER the soft delete commits.
  if (removedKey) {
    try { await unlink(storagePath(uploadDir, removedKey)); } catch {}
  }
  return outcome;
}

export async function downloadAttachment(db, actor, attachmentId) {
  const att = await db.query('SELECT * FROM attachments WHERE id=$1', [attachmentId]);
  const row = att.rows[0];
  if (!row || row.removed_at) {
    const err = new Error('Не найдено');
    err.code = 'NOT_FOUND';
    throw err;
  }
  // Ownership/region/org verified through the parent idea (SEC-04/SEC-12).
  const idea = await loadIdeaForActor(db, actor, row.idea_id);
  void idea;
  return {
    storageKey: row.storage_key,
    mime: row.detected_mime,
    filename: row.original_name,
    size: row.size_bytes,
  };
}
