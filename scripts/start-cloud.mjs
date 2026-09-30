#!/usr/bin/env node
// One Render web service: public Next server, private API, durable PostgreSQL.
// Import the preserved database before deploying; startup never seeds data.
import { spawn } from 'node:child_process';
import { cp, mkdir, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../src/server/db/client.mjs';
import { migrate } from './migrate.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const children = new Set();
let stopping = false;

export function cloudEnvironment(source = process.env) {
  if (!source.DATABASE_URL) throw new Error('DATABASE_URL is required for cloud hosting');
  const publicPort = Number(source.PORT || 10000);
  if (!Number.isSafeInteger(publicPort) || publicPort < 1 || publicPort > 65535 || publicPort === 18080) {
    throw new Error('PORT must be a valid public port different from 18080');
  }
  let origin;
  try { origin = new URL(source.APP_ORIGIN || source.RENDER_EXTERNAL_URL); }
  catch { throw new Error('APP_ORIGIN or RENDER_EXTERNAL_URL must contain the public HTTPS URL'); }
  if (origin.protocol !== 'https:' || origin.username || origin.password
    || origin.pathname !== '/' || origin.search || origin.hash) {
    throw new Error('APP_ORIGIN must be the public HTTPS origin without a path');
  }
  return {
    ...source,
    NODE_ENV: 'production',
    NEXT_TELEMETRY_DISABLED: '1',
    NEXT_PUBLIC_ABAI_MOCK: '0',
    APP_ENV: source.APP_ENV || 'demo',
    APP_ORIGIN: origin.origin,
    COOKIE_SECURE: 'true',
    API_BOOTSTRAP: 'false',
    API_ALLOW_PGLITE: 'false',
    API_HOST: '127.0.0.1',
    API_PORT: '18080',
    API_INTERNAL_URL: 'http://127.0.0.1:18080',
    ATTACHMENT_STORAGE: 'database',
    UPLOAD_DIR: path.join(tmpdir(), 'sevens-upload-staging'),
    HOSTNAME: '0.0.0.0',
    PORT: String(publicPort),
  };
}

export async function prepareStandalone(buildDirectory = '.next') {
  const build = path.resolve(root, buildDirectory);
  if (!build.startsWith(root + path.sep)) throw new Error('SEVENS_BUILD_DIR must stay inside the project');
  const relativeBuild = path.relative(root, build);
  const standalone = path.join(build, 'standalone');
  const server = path.join(standalone, 'server.js');
  try { await access(server); }
  catch { throw new Error('Standalone build is missing; run npm run build first'); }
  // Next's minimal server does not copy these folders automatically.
  await mkdir(path.join(standalone, relativeBuild), { recursive: true });
  await cp(path.join(build, 'static'), path.join(standalone, relativeBuild, 'static'), { recursive: true });
  await cp(path.join(root, 'public'), path.join(standalone, 'public'), { recursive: true });
  return server;
}

async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  const remaining = [...children];
  const exits = remaining.map((child) => new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    child.once('exit', resolve);
    child.kill('SIGTERM');
  }));
  const deadline = setTimeout(() => {
    for (const child of remaining) {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
  }, 10_000);
  await Promise.all(exits);
  clearTimeout(deadline);
}

function launch(label, script, env) {
  const child = spawn(process.execPath, [script], {
    cwd: root, env, stdio: 'inherit', windowsHide: true,
  });
  children.add(child);
  child.once('error', () => {
    children.delete(child);
    if (!stopping) {
      console.error(`Cloud ${label} could not start`);
      void shutdown(1);
    }
  });
  child.once('exit', () => {
    children.delete(child);
    if (!stopping) {
      console.error(`Cloud ${label} exited unexpectedly`);
      void shutdown(1);
    }
  });
  return child;
}

async function waitForReady(url, child, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (!stopping && Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error('Cloud process stopped during startup');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(3000, deadline - Date.now()));
    try {
      const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
      await response.arrayBuffer();
      if (response.ok) return;
    } catch { /* Readiness may fail while connections and the server start. */ }
    finally { clearTimeout(timer); }
    if (!stopping) await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Cloud service did not become ready within 60 seconds');
}

export async function startCloud() {
  const env = cloudEnvironment();
  const server = await prepareStandalone(env.SEVENS_BUILD_DIR || '.next');
  // Migrations are additive and serialized by the existing advisory lock.
  // Database failures intentionally omit credentials and provider error detail.
  let db;
  try {
    db = await openDatabase({ databaseUrl: env.DATABASE_URL });
    await migrate(db);
  } catch { throw new Error('Cloud database connection or migration failed'); }
  finally { if (db) await db.close(); }
  process.once('SIGTERM', () => { void shutdown(); });
  process.once('SIGINT', () => { void shutdown(); });
  const api = launch('API', path.join(root, 'scripts', 'serve.mjs'), env);
  await waitForReady('http://127.0.0.1:18080/api/health/ready', api);
  if (stopping) throw new Error('Cloud startup was interrupted');
  const web = launch('Next server', server, env);
  await waitForReady(`http://127.0.0.1:${env.PORT}/api/health/ready`, web);
  console.log('Cloud service is ready; data and attachments are stored in PostgreSQL');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await startCloud(); }
  catch (error) {
    console.error(error.message);
    await shutdown(1);
  }
}
