// Creates ONLY the named disposable backend verification container.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const name = 'sevens-backend-20260930-pg';
const folder = path.resolve('.data/backend-verification');
const envFile = path.join(folder, 'postgres.env');
mkdirSync(folder, { recursive: true });
let settings;
if (existsSync(envFile)) {
  settings = Object.fromEntries(readFileSync(envFile, 'utf8').trim().split('\n').map((line) => {
    const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1)];
  }));
} else {
  settings = { POSTGRES_DB: 'sevens_backend_test', POSTGRES_USER: 'sevens_backend_test',
    POSTGRES_PASSWORD: randomBytes(24).toString('hex') };
  writeFileSync(envFile, Object.entries(settings).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', { mode: 0o600 });
}
const docker = (args) => execFileSync('docker', args, { encoding: 'utf8', windowsHide: true, stdio: ['ignore','pipe','pipe'] }).trim();
let inspected;
try { inspected = JSON.parse(docker(['inspect', name]))[0]; } catch {}
if (inspected && inspected.Config.Labels?.['sevens.backend-verification'] !== '2026-09-30') {
  throw new Error('Refusing to operate on a container without this task label');
}
if (!inspected) docker(['run','-d','--name',name,'--label','sevens.backend-verification=2026-09-30',
  '--env-file',envFile,'-p','127.0.0.1::5432','postgres:17']);
else if (!inspected.State.Running) docker(['start',name]);
const deadline = Date.now() + 30_000;
while (true) {
  try { docker(['exec',name,'pg_isready','-U',settings.POSTGRES_USER,'-d',settings.POSTGRES_DB]); break; }
  catch { if (Date.now() >= deadline) throw new Error('Verification PostgreSQL unavailable'); await new Promise((r) => setTimeout(r,500)); }
}
const port = docker(['port',name,'5432/tcp']).split(':').at(-1);
const url = `postgresql://${settings.POSTGRES_USER}:${settings.POSTGRES_PASSWORD}@127.0.0.1:${port}/${settings.POSTGRES_DB}`;
writeFileSync(path.join(folder,'connection.env'), `BACKEND_PG_TEST_URL=${url}\n`, { mode: 0o600 });
console.log(JSON.stringify({ container:name, database:settings.POSTGRES_DB, port:Number(port), connectionFile:'.data/backend-verification/connection.env' }));
