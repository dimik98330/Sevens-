#!/usr/bin/env node
// Minimal Node-compatible client for the team_bus.py SQLite journal.
// Same schema/semantics (leases, SHA checks, messages). Used because no
// working Python exists on this machine. Does not modify team_bus.py.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite');

const AGENTS = ['A', 'B', 'C', 'D'];
const LEASE_SECONDS = 900;
const SCHEMA = `
CREATE TABLE IF NOT EXISTS tasks (
 id TEXT PRIMARY KEY, owner TEXT NOT NULL, title TEXT NOT NULL,
 dependencies TEXT NOT NULL, reviewer TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'TODO', lease_token TEXT, lease_until REAL,
 commit_sha TEXT, summary TEXT, integration_sha TEXT, updated REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
 id INTEGER PRIMARY KEY AUTOINCREMENT, sender TEXT NOT NULL, recipient TEXT NOT NULL,
 kind TEXT NOT NULL, task_id TEXT, body TEXT NOT NULL, created REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS acknowledgements (
 message_id INTEGER NOT NULL REFERENCES messages(id), agent TEXT NOT NULL,
 created REAL NOT NULL, PRIMARY KEY (message_id, agent)
);
CREATE TABLE IF NOT EXISTS reviews (
 id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL REFERENCES tasks(id),
 reviewer TEXT NOT NULL, commit_sha TEXT NOT NULL, verdict TEXT NOT NULL,
 body TEXT NOT NULL, created REAL NOT NULL
);`;

function git(...args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8' }).trim();
  } catch (e) {
    throw new Error((e.stderr || e.message || 'Git command failed').trim());
  }
}
function gitCommonDir() {
  return git('rev-parse', '--path-format=absolute', '--git-common-dir');
}
function dbPath(explicit) {
  if (explicit) return path.resolve(explicit);
  return path.join(gitCommonDir(), 'team-bus', 'state.sqlite3');
}
function openDb(p, ensureInit) {
  mkdirSync(path.dirname(p), { recursive: true });
  if (!ensureInit && !existsSync(p)) {
    throw new Error('Journal not initialized; run init --tasks fixtures/team-tasks.json');
  }
  const db = new DatabaseSync(p);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=15000; PRAGMA foreign_keys=ON;');
  if (ensureInit) db.exec(SCHEMA);
  return db;
}
function commitSha(v) {
  if (!/^[a-fA-F0-9]{40}([a-fA-F0-9]{24})?$/.test(v)) {
    throw new Error('Provide a full commit SHA, not a branch or abbreviated SHA');
  }
  return git('rev-parse', '--verify', v + '^{commit}');
}
function taskRow(db, id) {
  const row = db.prepare('SELECT * FROM tasks WHERE id=?').get(id);
  if (!row) throw new Error(`Unknown task: ${id}`);
  return row;
}
function publicTask(row) {
  const d = { ...row };
  delete d.lease_token;
  d.dependencies = JSON.parse(d.dependencies);
  d.leaseExpired = d.state === 'IN_PROGRESS' && (d.lease_until || 0) <= Date.now() / 1000;
  return d;
}
function sendMsg(db, sender, to, kind, task, body) {
  if (!body.trim()) throw new Error('Message body cannot be empty');
  if (body.length > 20000) throw new Error('Message body exceeds 20000 characters');
  const r = db.prepare(
    'INSERT INTO messages(sender,recipient,kind,task_id,body,created) VALUES(?,?,?,?,?,?)'
  ).run(sender, to, kind, task || null, body, Date.now() / 1000);
  return Number(r.lastInsertRowid);
}
function requireLease(db, row, agent, token) {
  if (row.owner !== agent) throw new Error(`Task is owned by agent ${row.owner}`);
  if (row.state !== 'IN_PROGRESS' || !row.lease_token) throw new Error('Task is not IN_PROGRESS');
  const a = Buffer.from(row.lease_token);
  const b = Buffer.from(token);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error('Stale or incorrect lease token');
  if (!row.lease_until || row.lease_until <= Date.now() / 1000) {
    throw new Error('Lease expired; A must confirm the old worker stopped and reclaim');
  }
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const args = { command };
  for (let i = 0; i < rest.length; i++) {
    const k = rest[i];
    if (k.startsWith('--')) {
      const key = k.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      if (key === 'confirmStopped') { args[key] = true; continue; }
      args[key] = rest[++i];
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args.command;
  let dbPathArg = null;
  const ai = process.argv.indexOf('--db');
  if (ai !== -1) dbPathArg = process.argv[ai + 1];
  const p = dbPath(dbPathArg);
  const db = openDb(p, cmd === 'init');
  const now = () => Date.now() / 1000;
  try {
    let result;
    if (cmd === 'init') {
      const payload = JSON.parse(readFileSync(args.tasks, 'utf8'));
      if (payload.schemaVersion !== 1 || !Array.isArray(payload.tasks)) {
        throw new Error('Expected schemaVersion=1 and a tasks array');
      }
      const indexed = {};
      for (const item of payload.tasks) {
        if (typeof item !== 'object' || !/^[A-D]-[0-9]{2,}$/.test(String(item.id))) {
          throw new Error('Invalid task ID');
        }
        if (indexed[item.id]) throw new Error('Duplicate task ID');
        if (!AGENTS.includes(item.owner) || !AGENTS.includes(item.reviewer) || item.owner === item.reviewer) {
          throw new Error('Task needs an owner and a different reviewer from A/B/C/D');
        }
        if (typeof item.title !== 'string' || !item.title.trim()) throw new Error('Task title is required');
        const deps = item.dependencies;
        if (!Array.isArray(deps) || deps.some((x) => typeof x !== 'string') || new Set(deps).size !== deps.length) {
          throw new Error('Task dependencies must be a unique string array');
        }
        indexed[item.id] = item;
      }
      const visiting = new Set(), visited = new Set();
      const visit = (key) => {
        if (!indexed[key]) throw new Error(`Unknown dependency: ${key}`);
        if (visiting.has(key)) throw new Error('Dependency cycle detected');
        if (visited.has(key)) return;
        visiting.add(key);
        for (const d of indexed[key].dependencies) visit(d);
        visiting.delete(key);
        visited.add(key);
      };
      Object.keys(indexed).forEach(visit);
      let inserted = 0;
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const item of payload.tasks) {
          const def = [item.owner, item.title, JSON.stringify(item.dependencies), item.reviewer];
          const old = db.prepare('SELECT owner,title,dependencies,reviewer FROM tasks WHERE id=?').get(item.id);
          if (old) {
            if (JSON.stringify([old.owner, old.title, old.dependencies, old.reviewer]) !== JSON.stringify(def)) {
              throw new Error(`Definition conflict for ${item.id}; existing progress was not overwritten`);
            }
          } else {
            db.prepare('INSERT INTO tasks(id,owner,title,dependencies,reviewer,updated) VALUES(?,?,?,?,?,?)')
              .run(item.id, ...def, now());
            inserted++;
          }
        }
        db.exec('COMMIT');
      } catch (e) {
        try { db.exec('ROLLBACK'); } catch {}
        throw e;
      }
      const total = db.prepare('SELECT COUNT(*) AS c FROM tasks').get().c;
      result = { inserted, total };
    } else if (cmd === 'status') {
      result = { tasks: db.prepare('SELECT * FROM tasks ORDER BY id').all().map(publicTask) };
    } else if (cmd === 'inbox') {
      const limit = Math.min(Math.max(Number(args.limit || 100), 1), 1000);
      const rows = db.prepare(`SELECT m.* FROM messages m WHERE (m.recipient=? OR m.recipient='ALL')
        AND m.sender<>? AND NOT EXISTS (SELECT 1 FROM acknowledgements a WHERE a.message_id=m.id AND a.agent=?)
        ORDER BY m.id LIMIT ?`).all(args.agent, args.agent, args.agent, limit);
      result = { messages: rows };
    } else if (cmd === 'ack') {
      const ids = String(args.ids).split(',').map(Number);
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const mid of ids) {
          const row = db.prepare('SELECT * FROM messages WHERE id=?').get(mid);
          if (!row || (row.recipient !== args.agent && row.recipient !== 'ALL')) {
            throw new Error(`Message ${mid} does not exist or is not addressed to this agent`);
          }
          db.prepare('INSERT OR IGNORE INTO acknowledgements VALUES(?,?,?)').run(mid, args.agent, now());
        }
        db.exec('COMMIT');
      } catch (e) {
        try { db.exec('ROLLBACK'); } catch {}
        throw e;
      }
      result = { acknowledged: ids };
    } else if (cmd === 'post') {
      if (args.task) taskRow(db, args.task);
      result = { messageId: sendMsg(db, args.sender, args.to, args.kind, args.task, args.body) };
    } else {
      const row = taskRow(db, args.task);
      const t = now();
      if (cmd === 'claim') {
        if (row.owner !== args.agent) throw new Error(`Task is owned by agent ${row.owner}`);
        if (row.state !== 'TODO' && row.state !== 'BLOCKED') throw new Error(`Task cannot be claimed from ${row.state}`);
        const pending = JSON.parse(row.dependencies).filter((x) => taskRow(db, x).state !== 'DONE');
        if (pending.length) throw new Error('Dependencies are not integrated: ' + pending.join(', '));
        const token = randomBytes(24).toString('base64url');
        db.prepare('UPDATE tasks SET state=?,lease_token=?,lease_until=?,updated=? WHERE id=?')
          .run('IN_PROGRESS', token, t + LEASE_SECONDS, t, args.task);
        result = { task: args.task, leaseToken: token, leaseUntil: t + LEASE_SECONDS };
      } else if (cmd === 'heartbeat' || cmd === 'submit' || cmd === 'block') {
        requireLease(db, row, args.agent, args.token);
        if (cmd === 'heartbeat') {
          db.prepare('UPDATE tasks SET lease_until=?,updated=? WHERE id=?').run(t + LEASE_SECONDS, t, args.task);
          result = { task: args.task, leaseUntil: t + LEASE_SECONDS };
        } else if (cmd === 'block') {
          sendMsg(db, args.agent, 'ALL', 'BLOCKER', args.task, args.reason);
          db.prepare('UPDATE tasks SET state=?,lease_token=NULL,lease_until=NULL,summary=?,updated=? WHERE id=?')
            .run('BLOCKED', args.reason, t, args.task);
          result = publicTask(taskRow(db, args.task));
        } else {
          const sha = commitSha(args.commit);
          sendMsg(db, args.agent, row.reviewer, 'REVIEW_REQUEST', args.task, sha + '\n' + args.summary);
          db.prepare('UPDATE tasks SET state=?,lease_token=NULL,lease_until=NULL,commit_sha=?,summary=?,updated=? WHERE id=?')
            .run('REVIEW', sha, args.summary, t, args.task);
          result = publicTask(taskRow(db, args.task));
        }
      } else if (cmd === 'review') {
        if (args.agent !== row.reviewer || args.agent === row.owner) {
          throw new Error('Only the assigned independent reviewer may review');
        }
        if (row.state !== 'REVIEW' || args.commit.toLowerCase() !== row.commit_sha) {
          throw new Error('Review must match the currently submitted commit in REVIEW state');
        }
        if (!args.body.trim()) throw new Error('Review evidence is required');
        db.prepare('INSERT INTO reviews(task_id,reviewer,commit_sha,verdict,body,created) VALUES(?,?,?,?,?,?)')
          .run(args.task, args.agent, row.commit_sha, args.verdict, args.body, t);
        db.prepare('UPDATE tasks SET state=?,updated=? WHERE id=?')
          .run(args.verdict === 'PASS' ? 'APPROVED' : 'TODO', t, args.task);
        sendMsg(db, args.agent, 'ALL', 'REVIEW_RESULT', args.task, args.verdict + ' ' + row.commit_sha + '\n' + args.body);
        result = publicTask(taskRow(db, args.task));
      } else {
        throw new Error(`Unsupported command here: ${cmd}`);
      }
    }
    console.log(JSON.stringify(result, null, 2));
  } finally {
    db.close();
  }
}

try {
  main();
} catch (e) {
  console.error(JSON.stringify({ error: String(e.message || e) }));
  process.exit(1);
}
