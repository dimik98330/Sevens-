// B-owned database client. Production: pg Pool over DATABASE_URL.
// Local/dev/test: PGlite (a real PostgreSQL engine) via PGLITE_DIR or memory.
// Both expose the same minimal interface: { query, transaction, close, kind }.
//
// transaction() checks out ONE connection for the whole unit of work: on pg
// it uses pool.connect() + release (BEGIN/COMMIT via pool.query would land on
// different pooled connections and would NOT be atomic). PGlite's native
// transaction also excludes unrelated queries from its single connection.
import pg from 'pg';

const { Pool } = pg;

export function databaseTimeouts(options = {}, env = process.env) {
  const timeout = (name, variable, fallback) => {
    const value = Number(options[name] ?? env[variable] ?? fallback);
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`${variable} must be a positive integer in milliseconds`);
    }
    return value;
  };
  return {
    connectionTimeoutMillis: timeout('connectionTimeoutMs', 'DB_CONNECTION_TIMEOUT_MS', 5000),
    statement_timeout: timeout('statementTimeoutMs', 'DB_STATEMENT_TIMEOUT_MS', 10000),
    query_timeout: timeout('queryTimeoutMs', 'DB_QUERY_TIMEOUT_MS', 15000),
    idle_in_transaction_session_timeout: timeout('idleInTransactionTimeoutMs', 'DB_IDLE_TRANSACTION_TIMEOUT_MS', 15000),
  };
}

export async function openDatabase(options = {}) {
  const databaseUrl = Object.hasOwn(options, 'databaseUrl')
    ? options.databaseUrl : process.env.DATABASE_URL;
  if (databaseUrl) {
    const pool = new Pool({ connectionString: databaseUrl, ...databaseTimeouts(options) });
    // pg removes failed idle clients itself. Handle its pool-level error so
    // a provider restart or network interruption cannot crash the whole API.
    // Provider messages may contain connection details; log only the event.
    pool.on('error', () => {
      if (process.env.LOG_LEVEL !== 'silent') console.error(JSON.stringify({ event: 'database_idle_connection_error' }));
    });
    // Fail fast when the database is unreachable.
    try {
      await pool.query('SELECT 1');
    } catch (err) {
      await pool.end();
      throw err;
    }
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
  const dataDir = Object.hasOwn(options, 'pgliteDir')
    ? options.pgliteDir : process.env.PGLITE_DIR;
  if (dataDir) mkdirSync(dataDir, { recursive: true });
  const db = new PGlite(dataDir || undefined);
  await db.waitReady;
  const query = (text, params) => db.query(text, params || []);
  const handle = { kind: 'pglite', query, close: () => db.close() };
  handle.transaction = (fn) => db.transaction((tx) => fn({
    query: (text, params) => tx.query(text, params || []),
  }));
  return handle;
}

export async function withTransaction(db, fn) {
  return db.transaction(fn);
}
