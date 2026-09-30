#!/usr/bin/env node
// Dry-run by default. Apply requires demo/test mode, an exact upload directory
// confirmation and an exact database-name confirmation. Never follows symlinks.
import { readdir, lstat, realpath, unlink, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../src/server/db/client.mjs';

export const MINIMUM_CLEANUP_AGE_MS = 60 * 60 * 1000;

export async function cleanupStorage({ db, uploadDir, apply = false,
  confirmUploadDir, confirmDatabase, environment = process.env.APP_ENV,
  now = new Date(), minimumAgeMs = MINIMUM_CLEANUP_AGE_MS } = {}) {
  if (!db || !uploadDir || !path.isAbsolute(uploadDir)) throw new Error('An explicit absolute uploadDir and database are required');
  const resolved = path.resolve(uploadDir);
  if (resolved === path.parse(resolved).root || resolved === path.resolve(process.cwd())) throw new Error('Refusing root/workspace directory');
  if (!Number.isFinite(minimumAgeMs) || minimumAgeMs < MINIMUM_CLEANUP_AGE_MS) throw new Error('Minimum cleanup age is one hour');
  const rootInfo = await lstat(resolved);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink() || await realpath(resolved) !== resolved) throw new Error('Upload directory must be a real directory without symlink ancestors');
  const database = (await db.query('SELECT current_database() AS name')).rows[0].name;
  if (apply && (!['demo', 'test'].includes(environment)
    || typeof confirmUploadDir !== 'string' || !path.isAbsolute(confirmUploadDir)
    || path.resolve(confirmUploadDir) !== resolved || confirmDatabase !== database)) {
    throw new Error('Apply requires APP_ENV=demo/test and exact upload-directory/database confirmations');
  }
  const timestamp = new Date(now);
  if (!Number.isFinite(timestamp.getTime())) throw new Error('Invalid cleanup timestamp');
  const cutoff = timestamp.getTime() - minimumAgeMs;
  const active = new Set((await db.query('SELECT storage_key FROM attachments WHERE removed_at IS NULL')).rows.map((row) => row.storage_key));
  const stale = [];
  const temporary = [];
  for (const entry of await readdir(resolved, { withFileTypes: true })) {
    if (!entry.isFile() || !/^[a-f0-9]{32}$/.test(entry.name) || active.has(entry.name)) continue;
    const target = path.join(resolved, entry.name);
    const info = await lstat(target);
    if (info.isFile() && !info.isSymbolicLink() && info.mtimeMs < cutoff) stale.push(entry.name);
  }
  const tempRoot = path.join(resolved, '.tmp');
  const tempInfo = await lstat(tempRoot).catch((error) => { if (error.code !== 'ENOENT') throw error; });
  if (tempInfo?.isDirectory() && !tempInfo.isSymbolicLink()) {
    for (const entry of await readdir(tempRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^u-[A-Za-z0-9_-]+$/.test(entry.name)) continue;
      const target = path.join(tempRoot, entry.name);
      const directory = await lstat(target);
      if (directory.isSymbolicLink() || directory.mtimeMs >= cutoff) continue;
      const children = await readdir(target, { withFileTypes: true });
      // Only our own closed temp shape is eligible. Unknown content is left.
      if (children.length > 1 || children.some((child) => child.name !== 'file' || !child.isFile())) continue;
      if (children.length) {
        const fileInfo = await lstat(path.join(target, 'file'));
        if (fileInfo.isSymbolicLink() || fileInfo.mtimeMs >= cutoff) continue;
      }
      temporary.push(entry.name);
    }
  }
  const expiredSessions = (await db.query(`SELECT count(*)::int AS count FROM sessions
    WHERE expires_at <= $1 OR revoked_at < $2`, [timestamp.toISOString(), new Date(cutoff).toISOString()])).rows[0].count;
  const expiredIdempotency = (await db.query('SELECT count(*)::int AS count FROM idempotency_records WHERE expires_at <= $1', [timestamp.toISOString()])).rows[0].count;
  const report = { mode: apply ? 'apply' : 'dry-run', database, uploadDir: resolved,
    orphanFiles: stale, staleTempDirectories: temporary, expiredSessions, expiredIdempotency,
    removedFiles: 0, removedTempDirectories: 0, removedSessions: 0, removedIdempotency: 0 };
  if (!apply) return report;
  for (const key of stale) {
    // Recheck the current reference immediately before unlinking.
    const reference = await db.query('SELECT 1 FROM attachments WHERE storage_key=$1 AND removed_at IS NULL', [key]);
    if (reference.rows.length) continue;
    const target = path.join(resolved, key);
    const info = await lstat(target).catch((error) => { if (error.code !== 'ENOENT') throw error; });
    if (info?.isFile() && !info.isSymbolicLink() && info.mtimeMs < cutoff) {
      await unlink(target);
      report.removedFiles++;
    }
  }
  for (const name of temporary) {
    const target = path.join(tempRoot, name);
    const info = await lstat(target).catch((error) => { if (error.code !== 'ENOENT') throw error; });
    if (!info?.isDirectory() || info.isSymbolicLink() || info.mtimeMs >= cutoff) continue;
    const children = await readdir(target, { withFileTypes: true });
    if (children.length > 1 || children.some((child) => child.name !== 'file' || !child.isFile())) continue;
    if (children.length && (await lstat(path.join(target, 'file'))).mtimeMs >= cutoff) continue;
    await rm(target, { recursive: true });
    report.removedTempDirectories++;
  }
  await db.transaction(async (tx) => {
    const sessions = await tx.query('DELETE FROM sessions WHERE expires_at <= $1 OR revoked_at < $2 RETURNING id',
      [timestamp.toISOString(), new Date(cutoff).toISOString()]);
    const keys = await tx.query('DELETE FROM idempotency_records WHERE expires_at <= $1 RETURNING id', [timestamp.toISOString()]);
    report.removedSessions = sessions.rows.length;
    report.removedIdempotency = keys.rows.length;
  });
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const allowed = new Set(['--apply', '--upload-dir', '--confirm-upload-dir', '--confirm-database']);
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!allowed.has(arg)) throw new Error('Unknown cleanup argument');
    if (arg === '--apply') options.apply = true;
    else {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error('Missing cleanup argument value');
      options[{ '--upload-dir': 'uploadDir', '--confirm-upload-dir': 'confirmUploadDir', '--confirm-database': 'confirmDatabase' }[arg]] = value;
    }
  }
  if (!process.env.DATABASE_URL) throw new Error('An explicit DATABASE_URL is required; no ambient PGlite fallback');
  options.uploadDir ||= process.env.UPLOAD_DIR;
  const db = await openDatabase({ databaseUrl: process.env.DATABASE_URL });
  try { console.log(JSON.stringify(await cleanupStorage({ db, ...options }), null, 2)); }
  finally { await db.close(); }
}
