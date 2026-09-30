// Real-PG tests require an explicit disposable database. Never use ambient
// DATABASE_URL and never reset/drop an existing schema or database.
import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDatabase } from '../../../../src/server/db/client.mjs';
import { migrate } from '../../../../scripts/migrate.mjs';
import { seed } from '../../../../scripts/seed.mjs';

const SCHEMA_PATTERN = /^sevens_backend_[0-9a-f]{24}$/;
export const TEST_PASSWORD = 'synthetic-PG-test-password-12';

export function disposableTestUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Invalid BACKEND_PG_TEST_URL'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || url.pathname !== '/sevens_backend_test') {
    throw new Error('BACKEND_PG_TEST_URL must target the disposable sevens_backend_test database');
  }
  return url;
}

function quotedSchema(schema) {
  if (!SCHEMA_PATTERN.test(schema)) throw new Error('Refusing an unexpected test schema');
  return `"${schema}"`;
}

export async function disposableDatabase({ prepare = true } = {}) {
  const url = disposableTestUrl(process.env.BACKEND_PG_TEST_URL);
  const schema = `sevens_backend_${randomBytes(12).toString('hex')}`;
  const admin = new pg.Pool({ connectionString: url.toString(), connectionTimeoutMillis: 5000,
    statement_timeout: 10000, max: 2 });
  let db;
  let created = false;
  let uploadDir;
  const close = async () => {
    try {
      await db?.close();
      if (created) {
        // Both the URL and the fresh random schema are validated again before
        // cleanup. This is the only DROP used by this suite.
        disposableTestUrl(process.env.BACKEND_PG_TEST_URL);
        await admin.query(`DROP SCHEMA ${quotedSchema(schema)} CASCADE`);
        created = false;
      }
    } finally {
      await admin.end();
      if (uploadDir) {
        const resolved = path.resolve(uploadDir);
        const tempRoot = path.resolve(tmpdir()) + path.sep;
        if (!resolved.startsWith(tempRoot) || !path.basename(resolved).startsWith('sevens-backend-pg-')) {
          throw new Error('Refusing an unexpected upload test directory');
        }
        await rm(resolved, { recursive: true, force: true });
      }
    }
  };
  try {
    await admin.query(`CREATE SCHEMA ${quotedSchema(schema)}`);
    created = true;
    const scoped = new URL(url);
    scoped.searchParams.set('options', `-c search_path=${schema}`);
    db = await openDatabase({ databaseUrl: scoped.toString() });
    uploadDir = await mkdtemp(path.join(tmpdir(), 'sevens-backend-pg-'));
    if (prepare) {
      await migrate(db);
      await seed(db, { demoPassword: TEST_PASSWORD });
    }
    return { db, schema, uploadDir, close,
      openPeer: () => openDatabase({ databaseUrl: scoped.toString() }) };
  } catch (error) {
    try { await close(); } catch { /* retain the original setup error */ }
    throw error;
  }
}

export function interceptQueries(db, intercept) {
  const wrap = (executor, transactional) => async (text, params = []) =>
    intercept({ text, params, transactional, run: () => executor.query(text, params) });
  return {
    kind: db.kind,
    query: wrap(db, false),
    transaction: (fn) => db.transaction((tx) => fn({ query: wrap(tx, true) })),
  };
}

export function pauseIdeaLock(db, ideaId, { afterLock = false } = {}) {
  let release;
  let signal;
  let paused = false;
  const gate = new Promise((resolve) => { release = resolve; });
  const started = new Promise((resolve) => { signal = resolve; });
  const intercepted = interceptQueries(db, async ({ text, params, transactional, run }) => {
    if (!paused && transactional && /SELECT \* FROM ideas WHERE id=\$1 FOR UPDATE/.test(text)
      && params[0] === ideaId) {
      paused = true;
      const locked = afterLock ? await run() : undefined;
      signal();
      await gate;
      return afterLock ? locked : run();
    }
    return run();
  });
  return {
    db: intercepted, release,
    started: async () => {
      let timer;
      try {
        await Promise.race([started, new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('Idea row-lock barrier was not reached')), 5000);
        })]);
      } finally { clearTimeout(timer); }
    },
  };
}
