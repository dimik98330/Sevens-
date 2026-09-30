// API-only showcase seeding is tested against a fresh in-memory PGlite.
// Never reads ambient DATABASE_URL or the hosted service.
import { after, before, it } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../../../src/server/db/client.mjs';
import { createServer } from '../../../src/server/http/app.mjs';
import { migrate } from '../../../scripts/migrate.mjs';
import { seed } from '../../../scripts/seed.mjs';
import { seedShowcaseDemo, SHOWCASE_DEMO_EXAMPLES, demoText } from '../../../scripts/seed-showcase-demo.mjs';
import { publicationText } from '../../../src/server/showcase/validation.mjs';

const PASSWORD = 'isolated-showcase-admin-password';
let db, server, origin;
before(async () => {
  db = await openDatabase({ databaseUrl: null, pgliteDir: null });
  await migrate(db);
  await seed(db, { demoPassword: PASSWORD });
  server = createServer(db, { origin: 'http://127.0.0.1', demoLoginEnabled: true,
    secureCookies: false, logRequests: false, classifier: { enabled: false }, assistant: { enabled: false } });
  // createServer captures config; a fetch wrapper sends the configured Origin.
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await db?.close();
});
const fetchImpl = (url, opts) => fetch(url, { ...opts, headers: { ...opts.headers, origin: 'http://127.0.0.1' } });
const options = () => ({ origin, staffPassword: PASSWORD, fetchImpl, spacingMs: 0 });

it('all examples pass the public privacy and length rules', () => {
  for (const example of SHOWCASE_DEMO_EXAMPLES) {
    assert.deepEqual(publicationText(demoText(example)), demoText(example));
    assert.match(demoText(example).problem, /Демонстрационный пример/);
    assert.equal(demoText(example).problem.includes('SHOWCASE-DEMO-V1'), false);
    assert.match(example.reply, /Демонстрационный ответ/);
  }
});

it('dry-run sends only GET and creates no accounts or ideas', async () => {
  const users = (await db.query('SELECT count(*)::int AS n FROM users')).rows[0].n;
  const methods = [];
  const result = await seedShowcaseDemo({ ...options(), fetchImpl: (url, opts) => {
    methods.push(opts.method);
    return fetchImpl(url, opts);
  } });
  assert.equal(result.dryRun, true);
  assert.equal(result.plannedIdeas.length, 4);
  assert.deepEqual(methods, ['GET', 'GET', 'GET']);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM users')).rows[0].n, users);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM ideas')).rows[0].n, 0);
});

it('seeds four publications with real demo supports and resumes without duplication', async () => {
  const usersBefore = (await db.query('SELECT id,password_hash,display_name FROM users ORDER BY id')).rows;
  const preserved = (await db.query(`INSERT INTO ideas(region_id,author_id,title,problem,solution)
    SELECT region_id,id,'Existing private idea','Existing private problem','Existing private solution'
    FROM users WHERE email_normalized='citizen1@example.test' RETURNING *`)).rows[0];
  const first = await seedShowcaseDemo({ ...options(), apply: true });
  assert.equal(first.ideas.length, 4);
  assert.deepEqual(first.summary, { published: 4, inProgress: 1, completed: 1, totalSupports: 10 });
  assert.deepEqual(first.ideas.map((idea) => idea.supportCount), [3, 2, 3, 2]);
  assert.deepEqual(first.ideas.map((idea) => idea.category), ['TRANSPORT', 'UTILITIES', 'ACCESSIBILITY', 'UTILITIES']);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM users WHERE email_normalized LIKE 'showcase-demo-v1-%'")).rows[0].n, 4);
  const snapshot = (await db.query('SELECT count(*)::int AS n FROM idea_events')).rows[0].n;
  const second = await seedShowcaseDemo({ ...options(), apply: true });
  assert.deepEqual(second.ideas.map((idea) => idea.id), first.ideas.map((idea) => idea.id));
  assert.deepEqual(second.summary, first.summary);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM ideas')).rows[0].n, 5);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM idea_events')).rows[0].n, snapshot);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM showcase_events WHERE type='REPLY'")).rows[0].n, 4);
  for (const original of usersBefore) {
    assert.deepEqual((await db.query('SELECT id,password_hash,display_name FROM users WHERE id=$1', [original.id])).rows[0], original);
  }
  const leakedSecrets = JSON.stringify(first);
  assert.equal(leakedSecrets.includes(PASSWORD), false);
  assert.equal(leakedSecrets.includes('csrfToken'), false);
  assert.deepEqual((await db.query('SELECT * FROM ideas WHERE id=$1', [preserved.id])).rows[0], preserved);
  const publicList = await fetch(origin + '/api/v1/showcase');
  assert.equal((await publicList.text()).includes('SHOWCASE-DEMO-V1'), false);
});
