#!/usr/bin/env node
// B-owned migration runner. Applies db/migrations/*.sql in filename order,
// tracking applied versions in schema_migrations. Rerunnable (INT-01).
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../src/server/db/client.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(here, '..', 'db', 'migrations');

// Split SQL text into top-level statements. Aware of dollar-quoted bodies,
// single/double-quoted strings and -- / /* */ comments, so function bodies
// with inner semicolons stay intact. PGlite (like the extended PG protocol)
// accepts one statement per query call.
export function splitStatements(sql) {
  const statements = [];
  let current = '';
  let i = 0;
  let quote = null; // "'", '"', or '$tag$'
  let lineComment = false;
  let blockComment = false;
  while (i < sql.length) {
    const ch = sql[i];
    const next2 = sql.slice(i, i + 2);
    if (lineComment) {
      current += ch;
      if (ch === '\n') lineComment = false;
      i++;
      continue;
    }
    if (blockComment) {
      current += ch;
      if (next2 === '*/') { current += sql[i + 1]; i += 2; blockComment = false; continue; }
      i++;
      continue;
    }
    if (quote) {
      current += ch;
      if (quote === "'" && ch === "'") {
        if (sql[i + 1] === "'") { current += sql[i + 1]; i += 2; continue; }
        quote = null; i++; continue;
      }
      if (quote === '"' && ch === '"') { quote = null; i++; continue; }
      if (quote.startsWith('$') && sql.startsWith(quote, i)) {
        current += quote.slice(1); i += quote.length - 1; quote = null; i++; continue;
      }
      i++;
      continue;
    }
    if (next2 === '--') { lineComment = true; current += ch; i++; continue; }
    if (next2 === '/*') { blockComment = true; current += ch; i++; continue; }
    if (ch === "'" || ch === '"') { quote = ch; current += ch; i++; continue; }
    if (ch === '$') {
      const m = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(sql.slice(i));
      if (m) { quote = m[0]; current += quote; i += quote.length; continue; }
      current += ch; i++; continue;
    }
    if (ch === ';') {
      current += ch;
      if (current.trim() !== ';') statements.push(current);
      current = '';
      i++;
      continue;
    }
    current += ch;
    i++;
  }
  if (current.trim()) statements.push(current);
  return statements;
}

export async function migrate(db) {
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  return db.transaction(async (tx) => {
    // Serializes separate PostgreSQL init processes, including first creation
    // of the ledger. PGlite's native transaction already serializes callers.
    if (db.kind === 'pg') await tx.query('SELECT pg_advisory_xact_lock(1936029285, 1)');
    await tx.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    const applied = new Set(
      (await tx.query('SELECT version FROM schema_migrations')).rows.map((r) => r.version)
    );
    const fresh = [];
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = readFileSync(path.join(migrationsDir, file), 'utf8');
      try {
        for (const stmt of splitStatements(sql)) await tx.query(stmt);
        await tx.query('INSERT INTO schema_migrations(version) VALUES($1)', [file]);
      } catch (err) {
        throw new Error(`Migration ${file} failed: ${err.message}`, { cause: err });
      }
      fresh.push(file);
    }
    return { applied: files.filter((f) => applied.has(f)), fresh };
  });
}

const runAsScript = process.argv[1] && path.resolve(process.argv[1]) === path.join(here, 'migrate.mjs');
if (runAsScript) {
  const db = await openDatabase();
  try {
    const result = await migrate(db);
    console.log(JSON.stringify({ backend: db.kind, ...result }));
  } finally {
    await db.close();
  }
}
