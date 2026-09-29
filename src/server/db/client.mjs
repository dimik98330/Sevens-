// B-owned database client. Production: pg Pool over DATABASE_URL.
// Local/dev/test: PGlite (a real PostgreSQL engine) via PGLITE_DIR or memory.
// Both expose the same minimal interface: { query, transaction, close, kind }.
//
// transaction() checks out ONE connection for the whole unit of work: on pg
// it uses pool.connect() + release (BEGIN/COMMIT via pool.query would land on
// different pooled connections and would NOT be atomic); on PGlite it wraps
// the single connection. Review note A/B-01-CHANGES-(1).
import pg from 'pg';

const { Pool } = pg;

function pgliteTransaction(db) {
  return async (fn) => {
    await db.query('BEGIN');
    try {
      const result = await fn(db);
      await db.query('COMMIT');
      return result;
    } catch (err) {
      try { await db.query('ROLLBACK'); } catch {}
      throw err;
    }
  };
}

export async function openDatabase(options = {}) {
  const databaseUrl = options.databaseUrl || process.env.DATABASE_URL;
  if (databaseUrl) {
    const pool = new Pool({ connectionString: databaseUrl });
    // Fail fast when the database is unreachable.
    await pool.query('SELECT 1');
    return {
      kind: 'pg',
      query: (text, params) => pool.query(text, params || []),
      transaction: async (fn) => {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const scoped = { query: (text, params) => client.query(text, params || []) };
          const result = await fn(scoped);
          await client.query('COMMIT');
          return result;
        } catch (err) {
          try { await client.query('ROLLBACK'); } catch {}
          throw err;
        } finally {
          client.release();
        }
      },
      close: () => pool.end(),
    };
  }
  const { PGlite } = await import('@electric-sql/pglite');
  const { mkdirSync } = await import('node:fs');
  const dataDir = options.pgliteDir || process.env.PGLITE_DIR;
  if (dataDir) mkdirSync(dataDir, { recursive: true });
  const db = new PGlite(dataDir);
  await db.waitReady;
  const query = (text, params) => db.query(text, params || []);
  const handle = { kind: 'pglite', query, close: () => db.close() };
  handle.transaction = pgliteTransaction(handle);
  return handle;
}

export async function withTransaction(db, fn) {
  return db.transaction(fn);
}
