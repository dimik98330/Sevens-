// Move verified legacy uploads into durable PostgreSQL without deleting files.
// DATABASE_URL points at the restored cloud database; UPLOAD_DIR at the local
// source uploads. Rerunning checks existing blobs instead of replacing them.
import { readFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { openDatabase } from '../src/server/db/client.mjs';

if (!process.env.DATABASE_URL || !process.env.UPLOAD_DIR) {
  throw new Error('Set DATABASE_URL and the absolute source UPLOAD_DIR');
}
if (!path.isAbsolute(process.env.UPLOAD_DIR)) throw new Error('UPLOAD_DIR must be absolute');
const db = await openDatabase();
let imported = 0;
let verified = 0;
try {
  const rows = (await db.query(`SELECT id,storage_key,size_bytes,sha256,storage_backend
    FROM attachments WHERE removed_at IS NULL ORDER BY id`)).rows;
  for (const row of rows) {
    if (!/^[a-f0-9]{32}$/.test(row.storage_key)) throw new Error('Invalid stored upload key');
    let bytes;
    if (row.storage_backend === 'database') {
      bytes = (await db.query('SELECT content FROM attachment_blobs WHERE attachment_id=$1', [row.id])).rows[0]?.content;
    } else {
      const file = path.join(process.env.UPLOAD_DIR, row.storage_key);
      const info = await lstat(file);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error('Upload source must be a regular file');
      bytes = await readFile(file);
    }
    if (!bytes || bytes.length !== Number(row.size_bytes)
      || createHash('sha256').update(bytes).digest('hex') !== row.sha256) {
      throw new Error(`Attachment integrity check failed: ${row.id}`);
    }
    if (row.storage_backend === 'database') { verified++; continue; }
    await db.transaction(async (tx) => {
      const locked = (await tx.query('SELECT storage_backend,removed_at FROM attachments WHERE id=$1 FOR UPDATE', [row.id])).rows[0];
      if (locked.removed_at) throw new Error('Attachment changed during import');
      await tx.query('INSERT INTO attachment_blobs(attachment_id,content) VALUES($1,$2) ON CONFLICT (attachment_id) DO NOTHING', [row.id,bytes]);
      const stored = (await tx.query('SELECT content FROM attachment_blobs WHERE attachment_id=$1', [row.id])).rows[0]?.content;
      if (!stored || !Buffer.from(stored).equals(bytes)) throw new Error('Existing cloud blob does not match source');
      await tx.query("UPDATE attachments SET storage_backend='database' WHERE id=$1", [row.id]);
    });
    imported++;
  }
  console.log(JSON.stringify({ imported, verified, activeAttachments: rows.length }));
} finally { await db.close(); }
