// API-only, resumable synthetic showcase data. Dry-run is the default.
// No database access, password changes, resets or invented counters.
import { createHash, createHmac } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

export const SHOWCASE_DEMO_MARKER = 'SHOWCASE-DEMO-V1';
export const SHOWCASE_DEMO_EXAMPLES = [
  {
    key: 'STOPS', category: 'TRANSPORT', territoryCodes: ['DEMO_SEMEY'], status: 'IN_PROGRESS', supporters: [0, 1, 2],
    title: 'Тёплые остановки с понятным расписанием в Семее',
    problem: 'Зимой ожидание автобуса на открытой остановке особенно тяжело для пожилых людей и родителей с детьми. На табличках сложно понять маршрут и время следующего рейса.',
    solution: 'Начать с пилота на двух загруженных остановках: поставить защищённые от ветра павильоны, скамейки, освещение и крупные схемы маршрутов. Добавить электронное табло прибытия и дублировать расписание на бумаге, чтобы оно было доступно без смартфона.',
    expectedBenefit: 'Комфортное ожидание транспорта в холодное время и понятные пересадки. Эффект пилота можно оценить по отзывам пассажиров и времени ожидания.',
    reply: 'Демонстрационный ответ: предложение принято в работу для оценки пилота. Следующий шаг — сравнить пассажиропоток и варианты оснащения остановок. Закупка и установка в реальном городе не подтверждены.',
  },
  {
    key: 'LIGHT', category: 'UTILITIES', territoryCodes: ['KATO_101810000', 'DEMO_SEMEY'], status: 'UNDER_REVIEW', supporters: [0, 1],
    title: 'Светлый вечерний маршрут от остановки до двора',
    problem: 'На пешеходных дорожках после захода солнца встречаются тёмные участки. Даже при работающих фонарях свет может перекрываться деревьями, поэтому людям трудно различать покрытие и препятствия.',
    solution: 'Проверить уличное освещение вдоль одного вечернего маршрута, заменить неисправные светильники на LED и направить свет на тротуар. Предусмотреть датчики неисправности и понятный номер опоры для сообщения о поломке. После настройки проверить яркость вместе с жителями.',
    expectedBenefit: 'Равномерное освещение пешеходного пути, быстрая диагностика поломок и возможность оценить расход электроэнергии до расширения проекта.',
    reply: 'Демонстрационный ответ: идея рассматривается. В сценарии сначала проверяется схема освещения и выбирается короткий участок для обследования. Реальное обследование и выполнение работ пока не подтверждены.',
  },
  {
    key: 'RIVER', category: 'ACCESSIBILITY', territoryCodes: ['DEMO_SEMEY'], status: 'COMPLETED', supporters: [0, 1, 2],
    title: 'Набережная Иртыша, доступная для каждого',
    problem: 'Прогулочный маршрут бывает неудобен для человека на коляске и семьи с детской коляской: ступени разрывают путь, а места для отдыха расположены далеко друг от друга.',
    solution: 'Создать непрерывный доступный участок набережной: плавные пандусы вместо разрывов маршрута, ровное нескользкое покрытие, тактильные указатели и скамейки с местом рядом для коляски. Добавить тень от посадок у зон отдыха. Проверить проект вместе с пользователями колясок до строительных работ.',
    expectedBenefit: 'Самостоятельные прогулки без помощи на ступенях и удобные места отдыха для людей разного возраста. Посадки добавят тень в тёплые дни.',
    reply: 'Демонстрационный ответ: рассмотрение завершено с разъяснением требований к доступному маршруту. В реальном проекте потребуются обследование, согласование и бюджет. Статус означает предоставленный ответ, а не построенную набережную.',
  },
  {
    key: 'WATER', category: 'UTILITIES', territoryCodes: ['KATO_103230100', 'DEMO_LOCALITY'], status: 'RECEIVED', supporters: [1, 2],
    title: 'Надёжная подача воды и открытый график ремонта в селе',
    problem: 'При перебоях водоснабжения в небольшом населённом пункте людям сложно заранее подготовить запас воды. Информация о плановых работах доходит не до всех, а место утечки не всегда удаётся быстро определить.',
    solution: 'Провести пилот контроля давления на сельском водопроводе и учёта аварийных отключений. Публиковать понятный график ремонта на общем стенде и в цифровом канале, указывать ожидаемое время восстановления и обновлять его при изменениях. По данным датчиков сначала ремонтировать участки с повторяющимися утечками.',
    expectedBenefit: 'Раннее обнаружение потерь воды и понятное информирование о ремонте. Пилот позволит сравнить число перебоев и время восстановления подачи.',
    reply: 'Демонстрационный ответ: предложение зарегистрировано. В учебном сценарии предстоит уточнить схему сети и доступность оборудования. Сообщение не является сведением о реальной аварии или объявлением коммунальной службы.',
  },
];

export function demoText(example, { privateMarker = false } = {}) {
  return { title: example.title,
    problem: `${example.problem} Демонстрационный пример Sevens.${privateMarker ? ` ${SHOWCASE_DEMO_MARKER}-${example.key}.` : ''}`,
    solution: example.solution, expectedBenefit: example.expectedBenefit };
}

class ApiError extends Error {
  constructor(method, endpoint, response, payload) {
    // Do not include response bodies: auth requests contain secrets.
    super(`${method} ${endpoint}: HTTP ${response.status}, ${payload?.error?.code || 'INVALID_RESPONSE'}`);
    this.status = response.status;
    this.code = payload?.error?.code;
    this.retryAfter = response.headers.get('retry-after');
  }
}

export async function seedShowcaseDemo({ origin, apply = false, staffPassword = process.env.SHOWCASE_STAFF_PASSWORD || process.env.DEMO_PASSWORD,
  demoPassword = process.env.SHOWCASE_DEMO_PASSWORD, fetchImpl = fetch, spacingMs = 180, maxRequests = 150 } = {}) {
  const parsedOrigin = new URL(origin);
  if (!['http:', 'https:'].includes(parsedOrigin.protocol) || parsedOrigin.username || parsedOrigin.password
    || parsedOrigin.pathname !== '/' || parsedOrigin.search || parsedOrigin.hash) throw new Error('Pass a plain HTTP(S) origin without credentials or a path');
  origin = parsedOrigin.origin;
  let calls = 0;
  const sessions = [];
  async function api(method, endpoint, actor, body, operation) {
    if (++calls > maxRequests) throw new Error(`Stopped at the request budget (${maxRequests})`);
    if (spacingMs && calls > 1) await delay(spacingMs);
    const headers = { accept: 'application/json', origin };
    if (actor) { headers.cookie = actor.cookie; headers['x-csrf-token'] = actor.csrfToken; }
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (operation) headers['idempotency-key'] = createHash('sha256').update(`${origin}:${SHOWCASE_DEMO_MARKER}:${operation}`).digest('hex');
    const response = await fetchImpl(origin + endpoint, { method, headers, redirect: 'error', signal: AbortSignal.timeout(60_000),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    let payload;
    try { payload = await response.json(); } catch { throw new Error(`${method} ${endpoint}: response is not JSON (HTTP ${response.status})`); }
    if (!response.ok) throw new ApiError(method, endpoint, response, payload);
    return { response, ...payload };
  }
  function session(result) {
    const cookie = result.response.headers.get('set-cookie')?.split(';')[0];
    if (!cookie || !result.data?.csrfToken || !result.data.user?.id) throw new Error('Authentication did not return a complete session');
    const actor = { ...result.data.user, cookie, csrfToken: result.data.csrfToken };
    sessions.push(actor);
    return actor;
  }
  async function auth(email, password) { return session(await api('POST', '/api/v1/auth/login', null, { email, password })); }
  const catalog = (await api('GET', '/api/v1/catalogs')).data;
  const sandbox = (await api('GET', '/api/v1/auth/demo')).data;
  const before = await api('GET', '/api/v1/showcase?pageSize=24');
  if (!sandbox?.enabled) throw new Error('This script requires an explicitly enabled demo sandbox');
  const plan = SHOWCASE_DEMO_EXAMPLES.map((example) => {
    const territory = example.territoryCodes.map((code) => catalog.territories.find((item) => item.code === code)).find(Boolean);
    if (!territory || !catalog.categories.some((item) => item.code === example.category)) throw new Error(`Missing demo catalog entry for ${example.key}`);
    return { ...example, territoryId: territory.id, territoryName: territory.nameRu };
  });
  if (!apply) return { dryRun: true, origin, existingSummary: before.meta.summary, plannedIdeas: plan.map((example) => ({
    title: example.title, category: example.category, territory: example.territoryName, demoStatus: example.status,
    demoSupports: example.supporters.length, marker: `${SHOWCASE_DEMO_MARKER}-${example.key}` })),
    moderationCredentialsAvailable: Boolean(staffPassword), requests: calls };
  if (!staffPassword || [...staffPassword].length < 12 || [...staffPassword].length > 128) {
    throw new Error('Set SHOWCASE_STAFF_PASSWORD or DEMO_PASSWORD for the existing synthetic admin; no accounts or ideas were changed');
  }
  // Derived synthetic credentials are stable across reruns and never persisted.
  const password = demoPassword || createHmac('sha256', staffPassword).update(`${origin}:${SHOWCASE_DEMO_MARKER}:synthetic-accounts`).digest('hex');
  if ([...password].length < 12 || [...password].length > 128) throw new Error('SHOWCASE_DEMO_PASSWORD must contain 12..128 characters');
  const results = [];
  try {
    // Verify moderation access before creating any synthetic account or idea.
    const admin = await auth('admin@example.test', staffPassword);
    if (admin.role !== 'ADMIN' || admin.displayName !== 'Демо-администратор') throw new Error('Refusing a non-demo administrator account');
    async function syntheticCitizen(suffix, displayName) {
      const email = `showcase-demo-v1-${suffix}@example.test`;
      let actor;
      try { actor = await auth(email, password); }
      catch (error) {
        if (error.status !== 401 || error.code !== 'UNAUTHENTICATED') throw error;
        actor = session(await api('POST', '/api/v1/auth/register', null, { email, password, displayName, consentAccepted: true }));
      }
      if (actor.role !== 'CITIZEN' || actor.displayName !== displayName) throw new Error(`Refusing an existing account with unexpected identity (${suffix})`);
      return actor;
    }
    const author = await syntheticCitizen('author', 'Демо-житель — автор инфраструктурных идей');
    const supporters = [];
    for (let n = 1; n <= 3; n++) supporters.push(await syntheticCitizen(`supporter-${n}`, `Демо-житель — участник ${n}`));
    const mine = await api('GET', `/api/v1/ideas?scope=mine&pageSize=100&q=${SHOWCASE_DEMO_MARKER}`, author);
    if (mine.meta.total > 100) throw new Error('Too many matching synthetic records; stopping instead of risking duplicates');
    for (const example of plan) {
      const text = demoText(example);
      const privateText = demoText(example, { privateMarker: true });
      const matches = mine.data.filter((idea) => idea.title === text.title);
      if (matches.length > 1) throw new Error(`Duplicate synthetic record: ${example.key}`);
      let idea = matches[0];
      if (!idea) {
        idea = (await api('POST', '/api/v1/ideas', author, { ...privateText, requestedCategoryCode: example.category,
          territoryId: example.territoryId }, `create:${example.key}`)).data;
      }
      idea = (await api('GET', `/api/v1/ideas/${idea.id}`, author)).data;
      for (const field of ['title', 'problem', 'solution', 'expectedBenefit']) {
        if (idea[field] !== privateText[field]) throw new Error(`Synthetic ${example.key} was edited (${field}); preserving it and stopping`);
      }
      if (idea.status === 'DRAFT') await api('POST', `/api/v1/ideas/${idea.id}/submit`, author,
        { expectedVersion: idea.version, consentAccepted: true }, `submit:${example.key}:${idea.version}`);
      const publicationPath = `/api/v1/ideas/${idea.id}/publication`;
      let publication = (await api('GET', publicationPath, author)).data;
      if (publication.state === 'PRIVATE' && publication.version === 0) {
        publication = (await api('PUT', publicationPath, author, { ...text, consentAccepted: true, expectedVersion: 0 })).data;
      }
      for (const field of ['title', 'problem', 'solution', 'expectedBenefit']) {
        if (publication[field] !== text[field]) throw new Error(`Synthetic publication ${example.key} was edited; preserving it and stopping`);
      }
      if (publication.state === 'PENDING') publication = (await api('POST', `${publicationPath}/review`, admin,
        { ...text, expectedVersion: publication.version, decision: 'PUBLISH', moderationNote: 'Явно обозначенный демонстрационный пример без персональных данных.' })).data;
      if (publication.state !== 'PUBLISHED') throw new Error(`Synthetic publication ${example.key} is ${publication.state}; it will not be restored automatically`);
      let current = (await api('GET', `/api/v1/ideas/${idea.id}`, admin)).data;
      const stages = ['RECEIVED', 'UNDER_REVIEW', 'IN_PROGRESS', 'COMPLETED'];
      if (!stages.includes(current.status) || stages.indexOf(current.status) > stages.indexOf(example.status)) {
        throw new Error(`Synthetic ${example.key} status changed to ${current.status}; preserving it and stopping`);
      }
      if (current.status !== example.status && !current.assigneeId) {
        const assignees = (await api('GET', `/api/v1/staff/assignees?organizationId=${current.organizationId}`, admin)).data;
        const assignee = assignees.find((item) => item.displayName?.startsWith('Демо-сотрудник:'));
        if (!assignee) throw new Error(`No synthetic assignee in routed organization for ${example.key}`);
        await api('POST', `/api/v1/ideas/${idea.id}/assignment`, admin,
          { expectedVersion: current.version, assigneeId: assignee.id }, `assign:${example.key}:${current.version}`);
        current = (await api('GET', `/api/v1/ideas/${idea.id}`, admin)).data;
      }
      if (current.status === 'RECEIVED' && example.status !== 'RECEIVED') {
        await api('POST', `/api/v1/ideas/${idea.id}/status`, admin,
          { expectedVersion: current.version, toStatus: 'UNDER_REVIEW' }, `review:${example.key}:${current.version}`);
        current = (await api('GET', `/api/v1/ideas/${idea.id}`, admin)).data;
      }
      if (current.status !== example.status) {
        await api('POST', `/api/v1/ideas/${idea.id}/status`, admin, { expectedVersion: current.version, toStatus: example.status,
          ...(example.status === 'COMPLETED' ? { resolutionType: 'ANSWER_PROVIDED',
            publicComment: 'В демонстрационном сценарии предоставлен ответ о требованиях к доступной набережной. Строительство и реализация не подтверждены.' } : {}) },
        `status:${example.key}:${current.version}`);
      }
      const card = (await api('GET', `/api/v1/showcase/${idea.id}`)).data;
      if (!card.timeline.some((event) => event.type === 'REPLY' && event.body === example.reply)) {
        publication = (await api('GET', publicationPath, admin)).data;
        await api('POST', `${publicationPath}/replies`, admin, { body: example.reply, expectedVersion: publication.version });
      }
      for (const n of example.supporters) {
        await api('PUT', `/api/v1/showcase/${idea.id}/support`, supporters[n], {});
        await api('PUT', `/api/v1/showcase/${idea.id}/follow`, supporters[n], {});
      }
      const verified = (await api('GET', `/api/v1/showcase/${idea.id}`)).data;
      if (verified.supportCount < example.supporters.length || verified.status !== example.status
        || verified.latestReply?.body !== example.reply) throw new Error(`Public verification failed for ${example.key}`);
      results.push({ id: verified.id, title: verified.title, category: verified.categoryCode, status: verified.status,
        supportCount: verified.supportCount, publicUrl: `${origin}/dashboard/${verified.id}` });
    }
    const after = await api('GET', '/api/v1/showcase?pageSize=24');
    return { dryRun: false, origin, synthetic: true, ideas: results, summary: after.meta.summary, requests: calls };
  } finally {
    // Revoke only sessions created by this run, leaving existing sessions alone.
    for (const actor of sessions) {
      try { await api('POST', '/api/v1/auth/logout', actor, {}); }
      catch { /* Preserve the actionable error if cleanup hits a service limit. */ }
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('node scripts/seed-showcase-demo.mjs --origin https://example.com [--apply]\nDry-run uses GET only. Apply requires DEMO_PASSWORD (existing synthetic admin). Optional SHOWCASE_DEMO_PASSWORD sets new synthetic-account credentials. Secrets stay in environment variables.');
  } else {
    const position = args.indexOf('--origin');
    if (position < 0 || !args[position + 1] || args.some((value, index) => !['--origin', '--apply'].includes(value) && index !== position + 1)) {
      console.error('Usage: node scripts/seed-showcase-demo.mjs --origin https://example.com [--apply]');
      process.exitCode = 1;
    } else seedShowcaseDemo({ origin: args[position + 1], apply: args.includes('--apply') })
      .then((result) => console.log(JSON.stringify(result, null, 2)))
      .catch((error) => { console.error(error.message); process.exitCode = 1; });
  }
}
