// B-owned database client. Production: pg Pool over DATABASE_URL.
// Local/dev/test: PGlite (a real PostgreSQL engine) via PGLITE_DIR or memory.
// Both expose the same minimal interface: { query, close, kind }.
import pg from 'pg';

const { Pool } = pg;

export async function openDatabase(options = {}) {
  const databaseUrl = options.databaseUrl || process.env.DATABASE_URL;
  if (databaseUrl) {
    const pool = new Pool({ connectionString: databaseUrl });
    // Fail fast when the database is unreachable.
    await pool.query('SELECT 1');
    return {
      kind: 'pg',
      query: (text, params) => pool.query(text, params || []),
      close: () => pool.end(),
    };
  }
  const { PGlite } = await import('@electric-sql/pglite');
  const { mkdirSync } = await import('node:fs');
  const dataDir = options.pgliteDir || process.env.PGLITE_DIR;
  if (dataDir) mkdirSync(dataDir, { recursive: true });
  const db = new PGlite(dataDir);
  await db.waitReady;
  return {
    kind: 'pglite',
    query: (text, params) => db.query(text, params || []),
    close: () => db.close(),
  };
}

export async function withTransaction(db, fn) {
  await db.query('BEGIN');
  try {
    const result = await fn(db);
    await db.query('COMMIT');
    return result;
  } catch (err) {
    try { await db.query('ROLLBACK'); } catch {}
    throw err;
  }
}
