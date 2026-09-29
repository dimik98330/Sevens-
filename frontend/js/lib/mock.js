// DEV-ONLY mock строго по схемам 03. Не шипается как backend: до выпуска UI
// переключается на настоящий backend B (?api= или sessionStorage abai.apiBase + useMock=0).
import { decideRoute } from './routing.js';
import { newIdempotencyKey } from './contracts.js';

const now = () => new Date().toISOString();
let seq = 124;
const reqId = () => 'req_mock_' + Math.random().toString(36).slice(2, 8);
const ok = (data, extraMeta) => ({ data, meta: { requestId: reqId(), ...(extraMeta ?? {}) } });
const fail = (http, code, message, fields) => {
  const e = new Error(message); e.detail = { http, code, message, fields: fields ?? {} }; throw e;
};

const TERRITORIES = [
  { id: 't-semey', code: 'DEMO_SEMEY', nameRu: 'Семей — демонстрационная территория', kind: 'LOCALITY', active: true },
  { id: 't-local', code: 'DEMO_LOCALITY', nameRu: 'Демо-населённый пункт', kind: 'LOCALITY', active: true },
];
const CATS = ['TRANSPORT', 'UTILITIES', 'EDUCATION', 'ECOLOGY', 'SAFETY', 'HEALTH', 'TOURISM', 'ACCESSIBILITY', 'OTHER'];
const ORGS = {
  DEMO_TRANSPORT: 'Демо: направление транспорта', DEMO_UTILITIES: 'Демо: направление ЖКХ',
  DEMO_ECOLOGY: 'Демо: направление экологии', DEMO_SOCIAL: 'Демо: социальное направление',
  DEMO_SAFETY: 'Демо: направление безопасности', DEMO_TRIAGE: 'Демо: центр цифровых инициатив',
};
const STAFF = [
  { id: 'u-staff-transport', displayName: 'Демо-сотрудник: transport', email: 'transport@example.test', org: 'DEMO_TRANSPORT' },
  { id: 'u-staff-triage', displayName: 'Демо-сотрудник: triage', email: 'triage@example.test', org: 'DEMO_TRIAGE' },
];

function seedIdeas() {
  const mk = (o) => ({
    id: o.id, publicNumber: o.n, version: 3, contentRevision: 1,
    title: o.title, problem: o.problem, solution: o.solution, expectedBenefit: '',
    requestedCategoryCode: null, effectiveCategoryCode: o.cat, territoryId: 't-semey',
    locationText: '', status: o.status, organizationCode: o.org,
    assignee: o.assignee ?? null, authorId: 'u-citizen-1', submittedAt: now(), createdAt: now(), updatedAt: now(),
    resolutionType: o.res ?? null, attachments: [], consentVersion: 'v1',
    routing: { source: 'RULES', mode: o.mode, effectiveCategoryCode: o.cat, organizationCode: o.org, tags: o.tags ?? [], confidenceBand: o.band ?? 'HIGH', ruleVersion: 'rules-v1', explanation: o.expl },
    timeline: [
      { id: 'e1', type: 'SUBMITTED', at: now(), actor: 'Демо-житель 1', text: 'Идея зарегистрирована на платформе.' },
      ...(o.status !== 'RECEIVED' ? [{ id: 'e2', type: 'STATUS', at: now(), actor: o.assignee?.name ?? 'Демо-сотрудник', text: `Статус: ${o.status}` }] : []),
    ],
    comments: o.comment ? [{ id: 'c1', visibility: 'PUBLIC', author: 'Демо-сотрудник', body: o.comment, at: now() }] : [],
  });
  return [
    mk({ id: 'idea-001', n: 'ABAI-2026-000101', title: 'Умные светофоры рядом со школой', problem: 'Возле школы дорога требует внимания к безопасности детей. Синтетический пример.', solution: 'Установить умные светофоры и датчики загруженности дороги.', cat: 'TRANSPORT', org: 'DEMO_TRANSPORT', status: 'RECEIVED', mode: 'ASSIGNED', tags: ['EDUCATION', 'SAFETY', 'SMART_CITY'], expl: 'Признаки «светофор» и «дорога» указывают на транспорт. Школа и безопасность — дополнительные темы.' }),
    mk({ id: 'idea-002', n: 'ABAI-2026-000102', title: 'Контроль утечки воды', problem: 'Утечки воды обнаруживаются поздно. Синтетический пример.', solution: 'Поставить датчики и счётчики воды для уведомлений.', cat: 'UTILITIES', org: 'DEMO_UTILITIES', status: 'UNDER_REVIEW', mode: 'ASSIGNED', assignee: { id: 'u-staff-triage', name: 'Демо-сотрудник: utilities' }, expl: 'Признаки утечки воды указывают на ЖКХ.' }),
    mk({ id: 'idea-003', n: 'ABAI-2026-000096', title: 'Электронный дневник', problem: 'Школа хочет удобный электронный дневник. Синтетический пример.', solution: 'Приложение для учебных уведомлений.', cat: 'EDUCATION', org: 'DEMO_SOCIAL', status: 'NEEDS_INFO', mode: 'ASSIGNED', assignee: { id: 'u-staff-triage', name: 'Демо-сотрудник: social' }, comment: 'Уточните, какие действия должен поддерживать сервис и кому они будут полезны.' }),
    mk({ id: 'idea-004', n: 'ABAI-2026-000088', title: 'Запись к врачу', problem: 'Очередь в поликлинике требует понятной организации. Синтетический пример.', solution: 'Добавить онлайн-запись к врачу.', cat: 'HEALTH', org: 'DEMO_SOCIAL', status: 'COMPLETED', mode: 'ASSIGNED', res: 'ANSWER_PROVIDED', assignee: { id: 'u-staff-triage', name: 'Демо-сотрудник: social' }, comment: 'Предоставлен демонстрационный итоговый ответ: для дальнейшего обсуждения нужно уточнить состав функций.' }),
    mk({ id: 'idea-005', n: 'ABAI-2026-000111', title: 'Сделать регион удобнее', problem: 'Есть идея улучшения повседневной жизни. Синтетический пример.', solution: 'Подробности пока необходимо обсудить.', cat: 'OTHER', org: 'DEMO_TRIAGE', status: 'RECEIVED', mode: 'TRIAGE', band: 'LOW', expl: 'Текст не даёт уверенного направления: идея передана в демонстрационный центр разбора направлений.' }),
  ];
}

export function createMock() {
  const state = {
    me: null,
    ideas: seedIdeas(),
    notifs: [
      { id: 'n1', ideaId: 'idea-003', kind: 'NEEDS_INFO', title: 'Сотрудник задал уточняющий вопрос по идее ABAI-2026-000096', readAt: null, at: now() },
      { id: 'n2', ideaId: 'idea-004', kind: 'STATUS', title: 'Статус идеи ABAI-2026-000088: Завершена', readAt: null, at: now() },
    ],
    idem: new Map(),
    users: [
      { id: 'u-citizen-1', displayName: 'Демо-житель 1', email: 'citizen1@example.test', role: 'CITIZEN', org: null },
      ...STAFF.map((s) => ({ id: s.id, displayName: s.displayName, email: s.email, role: 'STAFF', org: s.org })),
      { id: 'u-admin', displayName: 'Демо-администратор', email: 'admin@example.test', role: 'ADMIN', org: null },
    ],
  };
  const needAuth = () => { if (!state.me) fail(401, 'UNAUTHENTICATED', 'Нужно войти, чтобы продолжить'); };
  const ideaOr404 = (id, { staff = false } = {}) => {
    const it = state.ideas.find((x) => x.id === id);
    if (!it) fail(404, 'NOT_FOUND', 'Страница недоступна или у вас нет доступа к этой идее');
    if (!staff && state.me?.role === 'CITIZEN' && it.authorId !== state.me.id) fail(404, 'NOT_FOUND', 'Страница недоступна или у вас нет доступа к этой идее');
    if (staff && state.me?.role === 'STAFF' && it.organizationCode !== state.me.org && state.me?.role !== 'ADMIN') fail(404, 'NOT_FOUND', 'Страница недоступна или у вас нет доступа к этой идее');
    return it;
  };
  const idemGuard = (op, key, body) => {
    const h = JSON.stringify(body ?? null);
    const k = `${state.me?.id ?? 'anon'}|${op}|${key}`;
    const prev = state.idem.get(k);
    if (prev) {
      if (prev.hash !== h) fail(409, 'IDEMPOTENCY_CONFLICT', 'Повтор с тем же ключом, но другим содержимым');
      return prev.res;
    }
    return null;
  };
  const idemSave = (op, key, body, res) => state.idem.set(`${state.me?.id ?? 'anon'}|${op}|${key}`, { hash: JSON.stringify(body ?? null), res });

  return {
    state,
    catalogs() { return ok({ categories: CATS, territories: TERRITORIES, version: 'rules-v1' }); },
    me() { needAuth(); return ok({ ...state.me, csrfToken: 'mock-csrf' }); },
    register({ displayName, email, password, consentAccepted }) {
      if (!consentAccepted) fail(400, 'VALIDATION_ERROR', 'Проверьте заполнение формы', { consentAccepted: 'Нужно согласие' });
      if ((password ?? '').length < 12) fail(400, 'VALIDATION_ERROR', 'Проверьте заполнение формы', { password: 'Пароль: минимум 12 символов' });
      if (state.users.some((u) => u.email === email.trim().toLowerCase())) fail(400, 'VALIDATION_ERROR', 'Проверьте заполнение формы', { email: 'Этот email уже используется' });
      const u = { id: 'u-' + Math.random().toString(36).slice(2, 8), displayName: displayName.trim(), email: email.trim().toLowerCase(), role: 'CITIZEN', org: null };
      state.users.push(u); state.me = u;
      return ok({ ...u, csrfToken: 'mock-csrf' });
    },
    login({ email }) {
      const u = state.users.find((x) => x.email === (email ?? '').trim().toLowerCase());
      if (!u) fail(401, 'UNAUTHENTICATED', 'Неверный email или пароль');
      state.me = u; return ok({ ...u, csrfToken: 'mock-csrf' });
    },
    logout() { state.me = null; return ok({}); },
    createDraft(body, key) {
      needAuth();
      const hit = idemGuard('create-draft', key, body); if (hit) return hit;
      const d = { id: 'idea-' + Math.random().toString(36).slice(2, 8), publicNumber: null, version: 1, contentRevision: 1, title: body.title ?? '', problem: body.problem ?? '', solution: body.solution ?? '', expectedBenefit: body.expectedBenefit ?? '', requestedCategoryCode: body.requestedCategoryCode ?? null, effectiveCategoryCode: null, territoryId: body.territoryId ?? null, locationText: body.locationText ?? '', status: 'DRAFT', organizationCode: null, assignee: null, authorId: state.me.id, submittedAt: null, createdAt: now(), updatedAt: now(), resolutionType: null, attachments: [], routing: null, timeline: [], comments: [] };
      state.ideas.unshift(d);
      const res = ok({ id: d.id, version: 1 });
      idemSave('create-draft', key, body, res); return res;
    },
    patchDraft(id, body) {
      needAuth();
      const it = state.ideas.find((x) => x.id === id);
      if (!it || it.authorId !== state.me.id) fail(404, 'NOT_FOUND', 'Страница недоступна или у вас нет доступа к этой идее');
      if (it.status !== 'DRAFT') fail(409, 'INVALID_TRANSITION', 'Черновик уже отправлен');
      if (body.expectedVersion !== it.version) fail(409, 'VERSION_CONFLICT', 'Карточка обновлена. Обновите данные и повторите.');
      for (const k of ['title', 'problem', 'solution', 'expectedBenefit', 'requestedCategoryCode', 'territoryId', 'locationText']) {
        if (k in body) it[k] = body[k];
      }
      it.version += 1; it.contentRevision += 1; it.updatedAt = now();
      return ok({ id: it.id, version: it.version });
    },
    submit(id, body, key) {
      needAuth();
      const hit = idemGuard('submit', key, { id, ...body }); if (hit) return hit;
      const it = state.ideas.find((x) => x.id === id);
      if (!it || it.authorId !== state.me.id) fail(404, 'NOT_FOUND', 'Страница недоступна или у вас нет доступа к этой идее');
      if (it.status !== 'DRAFT') { const r = ok({ id: it.id, publicNumber: it.publicNumber, status: it.status, version: it.version, routing: it.routing }); idemSave('submit', key, { id, ...body }, r); return r; }
      if (body.expectedVersion !== it.version) fail(409, 'VERSION_CONFLICT', 'Карточка обновлена. Обновите данные и повторите.');
      const fields = {};
      if ((it.title.trim().length) < 10) fields.title = 'Название короче 10 символов';
      if ((it.problem.trim().length) < 30) fields.problem = 'Нужно минимум 30 символов';
      if ((it.solution.trim().length) < 30) fields.solution = 'Нужно минимум 30 символов';
      if (!it.territoryId) fields.territoryId = 'Выберите территорию из справочника';
      if (!body.consentAccepted) fields.consentAccepted = 'Нужно согласие';
      if (Object.keys(fields).length) fail(400, 'VALIDATION_ERROR', 'Проверьте заполнение формы', fields);
      const route = decideRoute({ title: it.title, problem: it.problem, solution: it.solution, requestedCategoryCode: it.requestedCategoryCode });
      it.effectiveCategoryCode = route.effectiveCategoryCode;
      it.organizationCode = route.organizationCode;
      it.routing = route;
      it.status = 'RECEIVED'; it.publicNumber = `ABAI-2026-${String(seq++).padStart(6, '0')}`;
      it.submittedAt = now(); it.version += 1;
      it.timeline.push({ id: 'e' + Date.now(), type: 'SUBMITTED', at: now(), actor: state.me.displayName, text: 'Идея зарегистрирована на платформе.' });
      state.notifs.unshift({ id: 'n' + Date.now(), ideaId: it.id, kind: 'SUBMITTED', title: `Идея ${it.publicNumber} зарегистрирована на платформе`, readAt: null, at: now() });
      const res = ok({ id: it.id, publicNumber: it.publicNumber, status: it.status, version: it.version, routing: route });
      idemSave('submit', key, { id, ...body }, res); return res;
    },
    mine({ status, q }) {
      needAuth();
      let list = state.ideas.filter((x) => x.authorId === state.me.id);
      if (status) list = list.filter((x) => x.status === status);
      if (q) { const s = q.toLowerCase(); list = list.filter((x) => (x.title + x.problem + x.solution + (x.publicNumber ?? '')).toLowerCase().includes(s)); }
      return ok(list, { page: 1, pageSize: 20, total: list.length });
    },
    staffList({ q, category, territory, status, assignee, unassigned, page = 1, pageSize = 20 }) {
      needAuth();
      if (state.me.role === 'CITIZEN') fail(403, 'FORBIDDEN', 'Страница недоступна или у вас нет доступа к этой идее');
      let list = state.ideas.filter((x) => x.status !== 'DRAFT' && (state.me.role === 'ADMIN' || x.organizationCode === state.me.org));
      if (category) list = list.filter((x) => x.effectiveCategoryCode === category);
      if (status) list = list.filter((x) => x.status === status);
      if (q) { const s = q.toLowerCase(); list = list.filter((x) => (x.title + x.problem + x.solution + (x.publicNumber ?? '')).toLowerCase().includes(s)); }
      if (unassigned === '1') list = list.filter((x) => !x.assignee);
      if (assignee) list = list.filter((x) => x.assignee?.id === assignee);
      const total = list.length;
      list = list.slice((page - 1) * pageSize, page * pageSize);
      return ok(list, { page, pageSize, total });
    },
    get(id, staffView) {
      needAuth();
      const it = ideaOr404(id, { staff: staffView || state.me.role !== 'CITIZEN' });
      if (!staffView && state.me.role === 'CITIZEN') {
        const { comments, ...rest } = it;
        return ok({ ...rest, comments: comments.filter((c) => c.visibility === 'PUBLIC') });
      }
      return ok(it);
    },
    clarify(id, body, key) {
      needAuth();
      const hit = idemGuard('clarify', key, { id, ...body }); if (hit) return hit;
      const it = ideaOr404(id);
      if (it.status !== 'NEEDS_INFO') fail(409, 'INVALID_TRANSITION', 'Уточнение сейчас не запрашивается');
      if (body.expectedVersion !== it.version) fail(409, 'VERSION_CONFLICT', 'Карточка обновлена. Обновите данные и повторите.');
      if ((body.body ?? '').trim().length < 10) fail(400, 'VALIDATION_ERROR', 'Проверьте заполнение формы', { body: 'Ответ — минимум 10 символов' });
      it.comments.push({ id: 'c' + Date.now(), visibility: 'PUBLIC', author: state.me.displayName, body: body.body.trim(), at: now() });
      it.timeline.push({ id: 'e' + Date.now(), type: 'CLARIFICATION', at: now(), actor: state.me.displayName, text: 'Автор дополнил идею.' });
      it.status = 'UNDER_REVIEW'; it.version += 1; it.contentRevision += 1;
      const res = ok({ id: it.id, version: it.version, status: it.status });
      idemSave('clarify', key, { id, ...body }, res); return res;
    },
    assign(id, body, key) {
      needAuth();
      const hit = idemGuard('assign', key, { id, ...body }); if (hit) return hit;
      const it = ideaOr404(id, { staff: true });
      if (body.expectedVersion !== it.version) fail(409, 'VERSION_CONFLICT', 'Коллега уже изменил эту идею. Обновите карточку перед сохранением.');
      const person = STAFF.find((s) => s.id === body.assigneeId);
      if (body.assigneeId && (!person || person.org !== it.organizationCode)) fail(400, 'VALIDATION_ERROR', 'Можно назначить только активного коллегу своей организации');
      it.assignee = person ? { id: person.id, name: person.displayName } : null;
      it.version += 1;
      it.timeline.push({ id: 'e' + Date.now(), type: 'ASSIGN', at: now(), actor: state.me.displayName, text: person ? `Ответственный: ${person.displayName}` : 'Ответственный сброшен' });
      const res = ok({ id: it.id, version: it.version });
      idemSave('assign', key, { id, ...body }, res); return res;
    },
    status(id, body, key) {
      needAuth();
      const hit = idemGuard('status', key, { id, ...body }); if (hit) return hit;
      const it = ideaOr404(id, { staff: true });
      if (body.expectedVersion !== it.version) fail(409, 'VERSION_CONFLICT', 'Коллега уже изменил эту идею. Обновите карточку перед сохранением.');
      const allowed = { RECEIVED: ['UNDER_REVIEW'], UNDER_REVIEW: ['NEEDS_INFO', 'IN_PROGRESS', 'REJECTED', 'COMPLETED'], NEEDS_INFO: ['UNDER_REVIEW'], IN_PROGRESS: ['NEEDS_INFO', 'COMPLETED', 'REJECTED'], COMPLETED: [], REJECTED: [] }[it.status] ?? [];
      if (!allowed.includes(body.toStatus)) fail(409, 'INVALID_TRANSITION', 'Этот переход сейчас недоступен');
      if (['NEEDS_INFO', 'REJECTED', 'COMPLETED'].includes(body.toStatus) && (body.publicComment ?? '').trim().length < 20)
        fail(400, 'VALIDATION_ERROR', 'Проверьте заполнение формы', { publicComment: 'Публичный комментарий — минимум 20 символов' });
      if (body.toStatus === 'COMPLETED' && !body.resolutionType) fail(400, 'VALIDATION_ERROR', 'Проверьте заполнение формы', { resolutionType: 'Выберите тип результата' });
      let assignee = it.assignee;
      if (body.takeOwnership) assignee = { id: state.me.id, name: state.me.displayName };
      if ((body.toStatus === 'UNDER_REVIEW' || body.toStatus === 'IN_PROGRESS') && !assignee) fail(400, 'VALIDATION_ERROR', 'Сначала назначьте ответственного', { assigneeId: 'Нужен ответственный' });
      it.assignee = assignee;
      if (body.publicComment?.trim()) it.comments.push({ id: 'c' + Date.now(), visibility: 'PUBLIC', author: state.me.displayName, body: body.publicComment.trim(), at: now() });
      it.status = body.toStatus; it.resolutionType = body.resolutionType ?? null; it.version += 1;
      it.timeline.push({ id: 'e' + Date.now(), type: 'STATUS', at: now(), actor: state.me.displayName, text: `Статус: ${body.toStatus}` });
      state.notifs.unshift({ id: 'n' + Date.now(), ideaId: it.id, kind: 'STATUS', title: `Статус идеи ${it.publicNumber}: ${body.toStatus}`, readAt: null, at: now(), forCitizen: it.authorId });
      const res = ok({ id: it.id, version: it.version, status: it.status });
      idemSave('status', key, { id, ...body }, res); return res;
    },
    comment(id, body, key) {
      needAuth();
      const hit = idemGuard('comment', key, { id, ...body }); if (hit) return hit;
      const it = ideaOr404(id, { staff: true });
      if (body.expectedVersion !== it.version) fail(409, 'VERSION_CONFLICT', 'Коллега уже изменил эту идею. Обновите карточку перед сохранением.');
      if ((body.body ?? '').trim().length < 1) fail(400, 'VALIDATION_ERROR', 'Проверьте заполнение формы', { body: 'Пустое сообщение' });
      it.comments.push({ id: 'c' + Date.now(), visibility: body.visibility, author: state.me.displayName, body: body.body.trim(), at: now() });
      it.version += 1;
      const res = ok({ id: it.id, version: it.version });
      idemSave('comment', key, { id, ...body }, res); return res;
    },
    reroute(id, body, key) {
      needAuth();
      if (state.me.role !== 'ADMIN') fail(403, 'FORBIDDEN', 'Страница недоступна или у вас нет доступа к этой идее');
      const hit = idemGuard('reroute', key, { id, ...body }); if (hit) return hit;
      const it = state.ideas.find((x) => x.id === id);
      if (!it) fail(404, 'NOT_FOUND', 'Страница недоступна или у вас нет доступа к этой идее');
      if (body.expectedVersion !== it.version) fail(409, 'VERSION_CONFLICT', 'Коллега уже изменил эту идею. Обновите карточку перед сохранением.');
      if ((body.reason ?? '').trim().length < 10) fail(400, 'VALIDATION_ERROR', 'Проверьте заполнение формы', { reason: 'Причина — минимум 10 символов' });
      if (!ORGS[body.organizationCode]) fail(400, 'VALIDATION_ERROR', 'Проверьте заполнение формы', { organizationCode: 'Организация только из справочника' });
      it.organizationCode = body.organizationCode;
      if (body.effectiveCategoryCode) it.effectiveCategoryCode = body.effectiveCategoryCode;
      it.assignee = null; it.version += 1;
      it.timeline.push({ id: 'e' + Date.now(), type: 'REROUTE', at: now(), actor: state.me.displayName, text: `Маршрут исправлен: ${ORGS[body.organizationCode]}. Причина: ${body.reason.trim()}` });
      const res = ok({ id: it.id, version: it.version });
      idemSave('reroute', key, { id, ...body }, res); return res;
    },
    attach(id, file, expectedVersion) {
      needAuth();
      const it = state.ideas.find((x) => x.id === id);
      if (!it || it.authorId !== state.me.id) fail(404, 'NOT_FOUND', 'Страница недоступна или у вас нет доступа к этой идее');
      if (expectedVersion !== it.version) fail(409, 'VERSION_CONFLICT', 'Карточка обновлена. Обновите данные и повторите.');
      if (it.attachments.filter((a) => !a.removedAt).length >= 3) fail(400, 'VALIDATION_ERROR', 'Максимум 3 активных файла', { file: 'Удалите один файл перед загрузкой' });
      if (file.size > 5 * 1024 * 1024) fail(413, 'FILE_TOO_LARGE', 'Файл больше 5 MiB');
      if (!['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(file.type)) fail(415, 'UNSUPPORTED_FILE_TYPE', 'Этот формат не поддерживается. Выберите JPG, PNG, WebP или PDF');
      const att = { id: 'a' + Date.now(), name: file.name, size: file.size, mime: file.type, at: now() };
      it.attachments.push(att); it.version += 1;
      return ok({ attachment: att, ideaVersion: it.version });
    },
    notifications() {
      needAuth();
      const mine = state.notifs.filter((n) => !n.forCitizen || n.forCitizen === state.me.id);
      return ok(mine, { page: 1, pageSize: 20, total: mine.length });
    },
    readNotif(id) { needAuth(); const n = state.notifs.find((x) => x.id === id); if (n) n.readAt = now(); return ok({}); },
    assignees() { needAuth(); return ok(STAFF.filter((s) => !state.me.org || s.org === state.me.org).map((s) => ({ id: s.id, displayName: s.displayName }))); },
    key: newIdempotencyKey,
  };
}
