// Local live B API server for development, DTO checks (C-04) and the full
// citizen -> idea -> staff scenario against real API.
// Usage: DATABASE_URL=... API_HOST=0.0.0.0 node scripts/serve.mjs [port]
// Set API_BOOTSTRAP=true only for an isolated local stand. Compose uses init.
// Credentials come only from the environment; never commit them.
import { createServer } from '../src/server/http/app.mjs';
import { openDatabase } from '../src/server/db/client.mjs';
import { importAbaiTerritories } from './import-abai-territories.mjs';
import { loadRoutingEngine } from '../src/server/routing/adapter.mjs';

const port = Number(process.argv[2] || process.env.API_PORT || 18080);
const host = process.env.API_HOST || '127.0.0.1';
if (!process.env.DATABASE_URL && process.env.API_ALLOW_PGLITE !== 'true') {
  throw new Error('DATABASE_URL is required for a persistent API; PGlite needs API_ALLOW_PGLITE=true');
}
if (process.env.API_BOOTSTRAP === 'true' && !['demo', 'test'].includes(process.env.APP_ENV)) {
  throw new Error('API_BOOTSTRAP is permitted only for APP_ENV=demo/test');
}
if (process.env.API_PROXY_SECRET && process.env.API_PROXY_SECRET.length < 32) {
  throw new Error('API_PROXY_SECRET must contain at least 32 characters');
}
const db = await openDatabase();
if (process.env.API_BOOTSTRAP === 'true') {
  const { migrate } = await import('./migrate.mjs');
  await migrate(db);
  if (process.env.DEMO_PASSWORD) {
    const { seed } = await import('./seed.mjs');
    await seed(db, { demoPassword: process.env.DEMO_PASSWORD });
    await importAbaiTerritories(db);
    console.log('seeded demo catalog');
  }
}
await loadRoutingEngine();
const server = createServer(db);
await new Promise((resolve) => server.listen(port, host, resolve));
console.log(`B API on ${host}:${port} (backend=${db.kind})`);

let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log(JSON.stringify({ event: 'shutdown', signal }));
  const deadline = setTimeout(() => {
    server.closeAllConnections();
    process.exit(1);
  }, 10_000);
  deadline.unref();
  server.closeIdleConnections();
  try {
    await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    await db.close();
    clearTimeout(deadline);
  } catch {
    process.exitCode = 1;
  }
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
