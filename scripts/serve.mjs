// Local live B API server for development, DTO checks (C-04) and the full
// citizen -> idea -> staff scenario against real API.
// Usage: DATABASE_URL=... DEMO_PASSWORD=... node scripts/serve.mjs [port]
// (DEMO_PASSWORD optional; without it the demo seed is skipped.)
// Credentials come only from the environment; never commit them.
import { createServer } from '../src/server/http/app.mjs';
import { openDatabase } from '../src/server/db/client.mjs';
import { migrate } from './migrate.mjs';
import { seed } from './seed.mjs';

const port = Number(process.argv[2] || 18080);
const db = await openDatabase();
await migrate(db);
if (process.env.DEMO_PASSWORD) {
  await seed(db, { demoPassword: process.env.DEMO_PASSWORD });
  console.log('seeded demo catalog');
}
const server = createServer(db);
await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
console.log(`B API on http://127.0.0.1:${port} (backend=${db.kind})`);
