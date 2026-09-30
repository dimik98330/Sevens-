// Isolated, persistent synthetic preview. Never connects to the working PostgreSQL.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { openDatabase } from '../src/server/db/client.mjs';
import { createServer, appConfig } from '../src/server/http/app.mjs';
import { migrate } from './migrate.mjs';
import { seed } from './seed.mjs';

const origin = 'http://localhost:3101';
const apiUrl = 'http://127.0.0.1:18082';
const previewDir = path.resolve('.data/showcase-preview');
await mkdir(previewDir, { recursive: true });
const credentialsFile = path.join(previewDir, 'credentials.json');
const credentials = existsSync(credentialsFile)
  ? JSON.parse(await readFile(credentialsFile, 'utf8'))
  : { password: randomBytes(18).toString('hex'), resident: 'citizen2@example.test', author: 'citizen1@example.test', staff: 'transport@example.test' };
await writeFile(credentialsFile, JSON.stringify(credentials, null, 2), { mode: 0o600 });
process.env.APP_ENV = 'test';
process.env.CLASSIFIER_MODE = 'rules';
process.env.CLASSIFIER_LOCAL_ENABLED = 'false';
process.env.ASSISTANT_ENABLED = 'false';
const db = await openDatabase({ databaseUrl: null, pgliteDir: path.join(previewDir, 'postgres') });
await migrate(db);
await seed(db, { demoPassword: credentials.password });
const server = createServer(db, { ...appConfig(), origin, secureCookies: false,
  uploadDir: path.join(previewDir, 'uploads'), logRequests: false,
  assistant: { enabled: false } });
await new Promise((resolve, reject) => {
  server.once('error', reject); server.listen(18082, '127.0.0.1', resolve);
});

async function request(method, endpoint, actor, body) {
  const headers = { origin, 'content-type': 'application/json', 'idempotency-key': randomUUID() };
  if (actor) { headers.cookie = actor.cookie; headers['x-csrf-token'] = actor.csrf; }
  const response = await fetch(apiUrl + endpoint, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result = await response.json();
  if (!response.ok) throw new Error(`Synthetic preview ${method} ${endpoint}: ${response.status} ${result.error?.code}`);
  return { response, ...result };
}
async function login(email) {
  const result = await request('POST', '/api/v1/auth/login', null, { email, password: credentials.password });
  return { cookie: result.response.headers.get('set-cookie').split(';')[0], csrf: result.data.csrfToken };
}
const seedMarker = path.join(previewDir, 'showcase-seeded.json');
if (!existsSync(seedMarker)) {
  const author = await login(credentials.author);
  const resident = await login(credentials.resident);
  const examples = [
    { title: 'Умные светофоры для безопасного пути в школу', category: 'TRANSPORT',
      problem: 'В часы пик переходить дорогу рядом со школами сложно: потоки транспорта и пешеходов пересекаются.',
      solution: 'Установить адаптивные светофоры и датчики пешеходного потока, чтобы сделать переходы безопаснее.',
      expectedBenefit: 'Безопасный маршрут к школе и меньше ожидания на переходах.', status: 'IN_PROGRESS',
      reply: 'В демонстрационном процессе рассмотрено предложение о безопасных переходах. Сейчас готовится оценка возможного пилота.' },
    { title: 'Датчики качества воздуха в городских кварталах', category: 'ECOLOGY',
      problem: 'Жителям сложно сравнить качество воздуха в разных частях города и понять, когда загрязнение становится сильнее.',
      solution: 'Разместить датчики загрязнения воздуха и показать измерения на понятной карте экологического мониторинга.',
      expectedBenefit: 'Открытая информация об окружающей среде и наблюдение за изменениями.', status: 'RECEIVED' },
    { title: 'Удобный контроль городского освещения', category: 'UTILITIES',
      problem: 'О неисправных уличных фонарях узнают поздно, и часть пешеходных маршрутов долго остаётся без освещения.',
      solution: 'Установить систему мониторинга уличного освещения, чтобы датчики сообщали о неисправных фонарях.',
      expectedBenefit: 'Более безопасные вечерние маршруты и быстрая проверка неисправностей.', status: 'COMPLETED',
      reply: 'Рассмотрение демонстрационной идеи завершено с ответом. Предложение сохранено для оценки; установка оборудования не подтверждена.' },
  ];
  const ids = [];
  for (const example of examples) {
    const catalogs = (await request('GET', '/api/v1/catalogs')).data;
    const territory = catalogs.territories.find((item) => item.code === 'DEMO_SEMEY') ?? catalogs.territories[0];
    const text = { title: example.title, problem: example.problem, solution: example.solution, expectedBenefit: example.expectedBenefit };
    const created = await request('POST', '/api/v1/ideas', author, { ...text, requestedCategoryCode: example.category, territoryId: territory.id });
    const id = created.data.id;
    await request('POST', `/api/v1/ideas/${id}/submit`, author, { expectedVersion: created.data.version, consentAccepted: true });
    const assigned = (await db.query('SELECT u.email_normalized FROM users u JOIN ideas i ON i.organization_id=u.organization_id WHERE i.id=$1 AND u.role=\'STAFF\' AND u.active ORDER BY u.id LIMIT 1', [id])).rows[0];
    const staff = await login(assigned.email_normalized);
    await request('PUT', `/api/v1/ideas/${id}/publication`, author, { ...text, consentAccepted: true, expectedVersion: 0 });
    let publication = (await request('GET', `/api/v1/ideas/${id}/publication`, staff)).data;
    await request('POST', `/api/v1/ideas/${id}/publication/review`, staff, { ...text, decision: 'PUBLISH', moderationNote: '', expectedVersion: publication.version });
    await request('PUT', `/api/v1/showcase/${id}/support`, resident, {});
    await request('PUT', `/api/v1/showcase/${id}/follow`, resident, {});
    if (example.status !== 'RECEIVED') {
      let idea = (await request('GET', `/api/v1/ideas/${id}`, staff)).data;
      await request('POST', `/api/v1/ideas/${id}/status`, staff, { expectedVersion: idea.version, toStatus: 'UNDER_REVIEW', takeOwnership: true });
      idea = (await request('GET', `/api/v1/ideas/${id}`, staff)).data;
      await request('POST', `/api/v1/ideas/${id}/status`, staff, { expectedVersion: idea.version, toStatus: example.status,
        ...(example.status === 'COMPLETED' ? { resolutionType: 'ANSWER_PROVIDED', publicComment: 'Подготовлен ответ на демонстрационное предложение; реализация пока не подтверждена.' } : {}) });
    }
    if (example.reply) {
      publication = (await request('GET', `/api/v1/ideas/${id}/publication`, staff)).data;
      await request('POST', `/api/v1/ideas/${id}/publication/replies`, staff, { body: example.reply, expectedVersion: publication.version });
    }
    ids.push(id);
  }
  await writeFile(seedMarker, JSON.stringify({ ids, synthetic: true }, null, 2));
}
const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', '3101'], {
  env: { ...process.env, APP_ENV: 'demo', NEXT_PUBLIC_ABAI_MOCK: '0',
    SEVENS_BUILD_DIR: '.next-showcase', API_INTERNAL_URL: apiUrl, APP_ORIGIN: origin },
  stdio: 'inherit', windowsHide: true,
});
console.log(JSON.stringify({ origin: `${origin}/dashboard`, isolated: true, credentialsFile, syntheticSeed: seedMarker }));
let stopped = false;
async function stop() {
  if (stopped) return; stopped = true; child.kill();
  process.stdin.pause();
  await new Promise((resolve) => server.close(resolve)); await db.close();
}
process.on('SIGTERM', stop); process.on('SIGINT', stop);
process.stdin.setEncoding('utf8');
process.stdin.on('data', (value) => { if (value.includes('stop') || value.includes('\u0003')) void stop(); });
process.stdin.resume();
child.on('exit', () => { void stop(); });
