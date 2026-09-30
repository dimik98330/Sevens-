// Public product guidance only. Never put user records or secrets in this module:
// it is shared by the browser and the server, whose session determines the role.
import ui from '../../locales/ui.json' with { type: 'json' };
const english = (text) => ui[text]?.en ?? text;
export const ASSISTANT_PAGES = ['home', 'how', 'dashboard', 'dashboard-detail', 'login', 'register', 'my', 'idea-new', 'idea-detail', 'notifications', 'staff', 'staff-detail', 'settings'];
export const ASSISTANT_TARGETS = ['home-process', 'citizen-filters', 'idea-draft-save', 'idea-problem', 'idea-solution', 'idea-territory', 'idea-location-map', 'idea-materials', 'idea-review', 'idea-dialog', 'idea-history', 'citizen-clarification', 'staff-filters', 'staff-assignment', 'staff-status-actions', 'staff-public-reply', 'staff-internal-note', 'admin-reroute', 'auth-email', 'auth-password', 'auth-register'];

export function pageForPath(pathname) {
  if (pathname === '/') return 'home';
  if (/^\/dashboard\//.test(pathname)) return 'dashboard-detail';
  if (pathname === '/ideas/new') return 'idea-new';
  if (/^\/ideas\//.test(pathname)) return 'idea-detail';
  if (/^\/staff\//.test(pathname)) return 'staff-detail';
  return ASSISTANT_PAGES.includes(pathname.slice(1)) ? pathname.slice(1) : 'home';
}

const navigation = [
  ['open-home', '/', 'На главную', 'Басты бетке', ['GUEST', 'CITIZEN', 'STAFF', 'ADMIN']],
  ['open-dashboard', '/dashboard', 'Идеи региона', 'Аймақ идеялары', ['GUEST', 'CITIZEN', 'STAFF', 'ADMIN']],
  ['open-how', '/how', 'Как работает Sevens', 'Sevens қалай жұмыс істейді', ['GUEST', 'CITIZEN', 'STAFF', 'ADMIN']],
  ['open-login', '/login', 'Войти в кабинет', 'Кабинетке кіру', ['GUEST']],
  ['open-register', '/register', 'Создать аккаунт жителя', 'Тұрғын аккаунтын ашу', ['GUEST']],
  ['open-my', '/my', 'Открыть мои идеи', 'Идеяларымды ашу', ['CITIZEN']],
  ['open-new', '/ideas/new', 'Предложить идею', 'Идея ұсыну', ['CITIZEN']],
  ['open-notifications', '/notifications', 'Открыть уведомления', 'Хабарламаларды ашу', ['CITIZEN', 'STAFF', 'ADMIN']],
  ['open-staff', '/staff', 'Открыть очередь', 'Кезекті ашу', ['STAFF', 'ADMIN']],
];
// Every selector is derived from these fixed target IDs, never model output.
const highlights = [
  ['home-process', 'Показать этапы', 'Кезеңдерді көрсету', ['home', 'how'], ['GUEST', 'CITIZEN', 'STAFF', 'ADMIN']],
  ['auth-email', 'Показать поле email', 'Email өрісін көрсету', ['login', 'register'], ['GUEST']],
  ['auth-password', 'Показать поле пароля', 'Құпиясөз өрісін көрсету', ['login', 'register'], ['GUEST']],
  ['auth-register', 'Показать регистрацию', 'Тіркелуді көрсету', ['login', 'register'], ['GUEST']],
  ['citizen-filters', 'Показать поиск и фильтры', 'Іздеу мен сүзгілерді көрсету', ['my'], ['CITIZEN']],
  ['idea-draft-save', 'Показать сохранение черновика', 'Жобаны сақтауды көрсету', ['idea-new'], ['CITIZEN']],
  ['idea-problem', 'Показать описание проблемы', 'Мәселені сипаттау өрісі', ['idea-new'], ['CITIZEN']],
  ['idea-solution', 'Показать предлагаемое решение', 'Ұсынылған шешім өрісі', ['idea-new'], ['CITIZEN']],
  ['idea-territory', 'Показать выбор территории', 'Аумақты таңдауды көрсету', ['idea-new'], ['CITIZEN']],
  ['idea-location-map', 'Показать карту', 'Картаны көрсету', ['idea-new', 'idea-detail', 'staff-detail'], ['CITIZEN', 'STAFF', 'ADMIN']],
  ['idea-materials', 'Показать материалы', 'Материалдарды көрсету', ['idea-new', 'idea-detail', 'staff-detail'], ['CITIZEN', 'STAFF', 'ADMIN']],
  ['idea-review', 'Показать проверку перед отправкой', 'Жіберу алдындағы тексеру', ['idea-new'], ['CITIZEN']],
  ['idea-dialog', 'Показать ответы', 'Жауаптарды көрсету', ['idea-detail'], ['CITIZEN']],
  ['idea-history', 'Показать историю', 'Тарихты көрсету', ['idea-detail', 'staff-detail'], ['CITIZEN', 'STAFF', 'ADMIN']],
  ['citizen-clarification', 'Показать ответ на уточнение', 'Нақтылауға жауап беру', ['idea-detail'], ['CITIZEN']],
  ['staff-filters', 'Показать фильтры очереди', 'Кезек сүзгілерін көрсету', ['staff'], ['STAFF', 'ADMIN']],
  ['staff-assignment', 'Показать ответственного', 'Жауапты маманды көрсету', ['staff-detail'], ['STAFF', 'ADMIN']],
  ['staff-status-actions', 'Показать смену статуса', 'Мәртебені өзгертуді көрсету', ['staff-detail'], ['STAFF', 'ADMIN']],
  ['staff-public-reply', 'Показать ответ жителю', 'Тұрғынға жауапты көрсету', ['staff-detail'], ['STAFF', 'ADMIN']],
  ['staff-internal-note', 'Показать внутреннюю заметку', 'Ішкі жазбаны көрсету', ['staff-detail'], ['STAFF', 'ADMIN']],
  ['admin-reroute', 'Показать исправление маршрута', 'Бағытты түзетуді көрсету', ['staff-detail'], ['ADMIN']],
];

export function availableActions(role, context, language = 'ru') {
  const actor = ['CITIZEN', 'STAFF', 'ADMIN'].includes(role) ? role : 'GUEST';
  const page = context?.page ?? 'home';
  const targets = Array.isArray(context?.targets) ? context.targets : [];
  const lang = language === 'kk' ? 3 : 2;
  const routes = navigation.filter((x) => x[4].includes(actor) && pageForPath(x[1]) !== page)
    .map((x) => ({ id: x[0], kind: 'navigate', label: x[lang], path: x[1] }));
  const focus = highlights.filter((x) => x[3].includes(page) && x[4].includes(actor) && targets.includes(x[0]))
    .map((x) => ({ id: `show-${x[0]}`, kind: 'highlight', label: x[language === 'kk' ? 2 : 1], target: x[0] }));
  return [...routes, ...focus].map(action => language === 'en' ? { ...action, label: english(action.label) } : action);
}

const publicKnowledge = `Sevens — платформа идей жителей для развития области Абай. Семей — визуальный контекст, сервис охватывает область. Прототип демонстрирует процесс; действующее подключение государственных систем и сроки рассмотрения не заявлены.
Сайт поддерживает русский, казахский и английский. Главная /: «Предложить идею», «Как устроен Sevens». /how: четыре этапа и значения статусов. /dashboard — «Идеи региона»: общая лента безопасных карточек после согласия автора и проверки сотрудника. Гость может читать; житель после входа может поддерживать чужие идеи и подписываться на обновления. В карточке /dashboard/[id] есть открытый статус, история и отдельно опубликованный ответ. Исходные идеи, файлы и личный диалог не становятся общедоступными автоматически. Нет страницы восстановления пароля или отдельного административного кабинета. /settings — технический экран разработки; не направляй туда обычного пользователя.
Вход /login: email и пароль. Регистрация /register только для жителя: имя и фамилия, email, пароль 12–128 символов. Доступ сотруднику предоставляет администратор. После входа житель попадает в /my, сотрудник и администратор в /staff; безопасная целевая страница из параметра next восстанавливается после входа с учётом роли.
Мастер /ideas/new состоит из трех шагов. Шаг 1 «Проблема и решение»: название 10–120 символов, проблема и решение минимум по 30 символов, польза необязательна. Шаг 2 «Место и материалы»: обязательная территория, необязательный ориентир до 300 символов; домашний адрес не нужен. Категория автоматически или выбирается. До 3 файлов JPG/JPEG, PNG, WebP, PDF, каждый до 5 MiB. Шаг 3: проверить описание, согласие и отправить. Номер означает успешную регистрацию только после ответа сервера. До отправки можно сохранять черновик, продолжить его из «Мои идеи».
Карта 2ГИС предлагает точку, участок улицы и зону. Выделение нужно подтвердить или отменить перед сохранением и переходом. При недоступной карте можно указать территорию и текстовый ориентир. Не считай видимое выделение уже сохраненным. Если есть несохраненный текст, сначала покажи кнопку сохранения; сам не сохраняй.
Маршрутизация идей сейчас основана на правилах с уточнением специалистом. OpenAI-помощник помогает пользоваться сайтом, он не рассматривает идеи и не определяет решения органов.
«Мои идеи» /my: только свои записи, поиск по номеру/названию и фильтр по статусу. Для черновика «Продолжить», для отправленной идеи открыть карточку. Карточка содержит направление, статус, материалы, PUBLIC-диалог, историю и ответ. /notifications: новые ответы, запросы уточнений, изменения статуса и ссылки на карточку.
Статусы: DRAFT «Черновик» — не отправлена; RECEIVED «Получена» — зарегистрирована; UNDER_REVIEW «На рассмотрении» — изучается; NEEDS_INFO «Нужны уточнения» — нужен ответ жителя; IN_PROGRESS «В работе»; COMPLETED «Завершена» — есть результат; REJECTED «Отклонена» — есть причина. Завершение не обязательно означает построенный объект: возможны итоговый ответ, план пилота, внедрение, передача во внешнюю систему.
При NEEDS_INFO житель открывает карточку и отвечает в поле «Ваш ответ» (10–3000 символов), затем отправляет ответ. Исходная идея сохраняется, статус возвращается в UNDER_REVIEW. Не сообщай фактический статус записи пользователя: у тебя нет ее содержимого или доступа к БД.`;
const staffKnowledge = `Инструкции сотруднику/администратору: /staff — очередь с поиском, категорией, статусом, территорией, наличием ответственного, по 20 записей; ADMIN дополнительно фильтрует организацию. Возврат из карточки сохраняет фильтры.
Карточка /staff/[id]: назначение ответственного, смена статуса, PUBLIC-ответ, отдельная INTERNAL-заметка. Публичный ответ видит житель; внутренняя заметка жителю не показывается. Не помещай внутренние сведения в публичный ответ.
Переходы: RECEIVED → UNDER_REVIEW; UNDER_REVIEW → NEEDS_INFO | IN_PROGRESS | REJECTED | COMPLETED; NEEDS_INFO → UNDER_REVIEW; IN_PROGRESS → NEEDS_INFO | COMPLETED | REJECTED. COMPLETED и REJECTED — конечные. Для рассмотрения/работы нужен ответственный; при первом взятии можно назначить себя. Для NEEDS_INFO/REJECTED/COMPLETED и перехода сотрудника NEEDS_INFO → UNDER_REVIEW нужен PUBLIC-комментарий 20–2000 символов. Объясняй только доступные переходы, не выполняй их. ADMIN может исправить маршрут только у незавершенной идеи (не COMPLETED/REJECTED); это сбрасывает ответственного.`;
export function buildKnowledge(role) {
  return publicKnowledge + (role === 'STAFF' || role === 'ADMIN' ? '\n' + staffKnowledge : '');
}

const topics = {
  start: {
    ru: 'Sevens помогает предложить улучшение для области Абай и следить за рассмотрением. Войдите или зарегистрируйтесь как житель, затем нажмите «Предложить идею». Опишите проблему и решение, укажите место, проверьте и отправьте.',
    kk: 'Sevens Абай облысын жақсарту туралы идея ұсынуға және оның қаралуын бақылауға көмектеседі. Кіріңіз не тұрғын ретінде тіркеліңіз, содан кейін «Предложить идею» түймесін басыңыз. Мәселе мен шешімді сипаттап, орнын көрсетіңіз, тексеріп жіберіңіз.',
    actions: ['open-new', 'open-login', 'open-register', 'open-how', 'show-home-process'],
  },
  login: {
    ru: 'В разделе «Войти» укажите email и пароль. Если аккаунта нет, выберите «Зарегистрироваться как житель». После входа откроется ваш кабинет. Учётную запись сотрудника предоставляет администратор.',
    kk: '«Войти» бөлімінде email мен құпиясөзді енгізіңіз. Аккаунт болмаса, «Зарегистрироваться как житель» сілтемесін таңдаңыз. Кірген соң кабинет ашылады. Маман аккаунтын әкімші береді.',
    actions: ['open-login', 'open-register', 'show-auth-email', 'show-auth-register'],
  },
  map: {
    ru: 'На шаге «Место и материалы» выберите территорию. На карте отметьте точку, участок улицы или зону и подтвердите выделение. Если карта недоступна, укажите текстовый ориентир. Завершите редактирование карты перед сохранением или переходом дальше.',
    kk: '«Место и материалы» қадамында аумақты таңдаңыз. Картада нүктені, көше бөлігін не аймақты белгілеп, таңдауды растаңыз. Карта қолжетімсіз болса, орынды мәтінмен сипаттаңыз. Сақтау не келесі қадамға өту алдында картадағы өңдеуді аяқтаңыз.',
    actions: ['show-idea-location-map', 'show-idea-territory', 'open-new', 'open-login'],
  },
  files: {
    ru: 'Материалы добавляются на втором шаге. Можно приложить до 3 файлов: JPG, PNG, WebP или PDF, каждый до 5 МБ. Дождитесь подтверждения загрузки; вложения необязательны.',
    kk: 'Материалдар екінші қадамда қосылады. JPG, PNG, WebP немесе PDF форматында 3 файлға дейін тіркеуге болады; әрқайсысы 5 МБ-тан аспауы керек. Жүктеу расталғанын күтіңіз. Файл тіркеу міндетті емес.',
    actions: ['show-idea-materials', 'open-new', 'open-login'],
  },
  draft: {
    ru: 'Нажмите «Сохранить черновик» в мастере. Затем найти его можно в «Мои идеи» и продолжить заполнение. Сохранение подтверждается сервером. Если выделение на карте ещё редактируется, сначала подтвердите или отмените его.',
    kk: 'Шеберде «Сохранить черновик» түймесін басыңыз. Оны кейін «Мои идеи» бөлімінен тауып, толтыруды жалғастыра аласыз. Сақтауды сервер растайды. Картадағы таңдау өңделіп жатса, алдымен оны растаңыз не болдырмаңыз.',
    actions: ['show-idea-draft-save', 'open-my', 'open-login'],
  },
  clarification: {
    ru: 'При статусе «Нужны уточнения» откройте свою идею и найдите запрос специалиста в диалоге. Напишите ответ в поле уточнения и отправьте. После успешного ответа идея вернётся на рассмотрение.',
    kk: '«Нужны уточнения» мәртебесінде өз идеяңызды ашып, диалогтан маманның сұрағын табыңыз. Нақтылау өрісіне жауап жазып жіберіңіз. Сәтті жіберілгеннен кейін идея қайта қарауға өтеді.',
    actions: ['show-citizen-clarification', 'show-idea-dialog', 'open-my', 'open-login'],
  },
  status: {
    ru: 'Статус и ответы находятся в карточке вашей идеи: откройте «Мои идеи», найдите предложение и откройте его. «Получена» — зарегистрирована, «На рассмотрении» — изучается, «Нужны уточнения» — ждут вашего ответа. «Завершена» означает результат рассмотрения, а не обязательно реализацию объекта.',
    kk: 'Мәртебе мен жауаптар идея карточкасында: «Мои идеи» бөлімінен ұсынысыңызды тауып ашыңыз. «Получена» — тіркелді, «На рассмотрении» — зерттелуде, «Нужны уточнения» — жауабыңыз қажет. «Завершена» қарау нәтижесін білдіреді, нысанның міндетті түрде салынғанын білдірмейді.',
    actions: ['show-idea-dialog', 'show-idea-history', 'open-my', 'open-login', 'open-how'],
  },
  queue: {
    ru: 'В очереди найдите идею по номеру или названию. Используйте фильтры категории, статуса, территории и ответственного. Откройте карточку для дальнейших действий; при возврате фильтры сохранятся.',
    kk: 'Кезекте идеяны нөмірі не атауы бойынша табыңыз. Санат, мәртебе, аумақ және жауапты маман сүзгілерін пайдаланыңыз. Әрі қарай әрекет ету үшін карточканы ашыңыз; қайтқанда сүзгілер сақталады.',
    actions: ['show-staff-filters', 'open-staff'],
  },
  assignment: {
    ru: 'В карточке сотрудника выберите ответственного. Для перехода к рассмотрению или работе ответственный обязателен; при первом взятии можно назначить себя. Затем используйте доступные действия статуса.',
    kk: 'Маман карточкасында жауапты қызметкерді таңдаңыз. Қарауға немесе жұмысқа өту үшін жауапты маман қажет; алғаш қабылдағанда өзіңізді тағайындай аласыз. Содан кейін қолжетімді мәртебе әрекеттерін пайдаланыңыз.',
    actions: ['show-staff-assignment', 'show-staff-status-actions', 'open-staff'],
  },
  staffReply: {
    ru: '«Ответ жителю» — публичный комментарий, который увидит автор идеи. «Внутренняя заметка» доступна только сотрудникам. Для запроса уточнений, завершения и отклонения нужен публичный комментарий; внутреннюю информацию оставляйте в отдельной форме.',
    kk: '«Ответ жителю» — идея авторына көрінетін жария жауап. «Внутренняя заметка» тек мамандарға қолжетімді. Нақтылау сұрауы, аяқтау және қабылдамау үшін жария түсініктеме қажет; ішкі ақпаратты бөлек формаға жазыңыз.',
    actions: ['show-staff-public-reply', 'show-staff-internal-note', 'show-staff-status-actions', 'open-staff'],
  },
  staffStatus: {
    ru: 'В карточке используйте блок смены статуса. Из «Получена» можно перейти на рассмотрение, затем запросить уточнения, взять в работу, завершить или отклонить. Для рассмотрения и работы нужен ответственный. Для уточнения, завершения и отклонения требуется публичный комментарий. «Завершена» и «Отклонена» — конечные статусы.',
    kk: 'Карточкада мәртебені өзгерту блогын пайдаланыңыз. «Получена» мәртебесінен қарауға өтіп, кейін нақтылау сұрауға, жұмысқа алуға, аяқтауға не қабылдамауға болады. Қарау мен жұмыс үшін жауапты маман қажет. Нақтылау, аяқтау және қабылдамау үшін жария түсініктеме керек. «Завершена» және «Отклонена» — соңғы мәртебелер.',
    actions: ['show-staff-status-actions', 'show-staff-assignment', 'show-staff-public-reply', 'open-staff'],
  },
  notifications: {
    ru: 'Откройте «Уведомления»: там появляются ответы, запросы уточнений и изменения статуса. Нажмите уведомление, чтобы перейти к соответствующей карточке идеи.',
    kk: '«Уведомления» бөлімін ашыңыз: онда жауаптар, нақтылау сұраулары және мәртебе өзгерістері пайда болады. Тиісті идея карточкасына өту үшін хабарламаны басыңыз.',
    actions: ['open-notifications', 'open-my', 'open-staff', 'open-login'],
  },
};

export function quickQuestions(role, context, language = 'ru') {
  if (language === 'en') return quickQuestions(role, context, 'ru').map(english);
  const kk = language === 'kk';
  if (role === 'STAFF' || role === 'ADMIN') return kk ? ['Идеяны кезектен қалай табамын?', 'Жауапты маманды қалай тағайындаймын?', 'Жария жауап пен ішкі жазбаның айырмасы қандай?'] : ['Как найти идею в очереди?', 'Как назначить ответственного?', 'Чем ответ отличается от внутренней заметки?'];
  if (context?.page === 'idea-new') return kk ? ['Жобаны қалай сақтаймын?', 'Картада орынды қалай белгілеймін?', 'Қандай файлдар тіркей аламын?'] : ['Как сохранить черновик?', 'Как отметить место на карте?', 'Какие файлы можно приложить?'];
  if (context?.page === 'idea-detail') return kk ? ['Мәртебе нені білдіреді?', 'Нақтылауға қалай жауап беремін?', 'Жауапты қайдан көремін?'] : ['Что означает статус?', 'Как ответить на уточнение?', 'Где посмотреть ответ?'];
  return kk ? ['Идеяны қалай ұсынамын?', 'Кабинетке қалай кіремін?', 'Идеяның мәртебесін қайдан көремін?'] : ['Как предложить идею?', 'Как войти в кабинет?', 'Где посмотреть статус идеи?'];
}

const englishTopics = {
  start: 'Sevens helps you suggest improvements for Abai Region and follow their review. Sign in or create a resident account, then choose Suggest an idea. Describe the problem and solution, add a location, review and submit.',
  login: 'Enter your email and password on the Sign in page. If you do not have an account, choose Create account. Your account opens after signing in. Staff access is provided by an administrator.',
  map: 'On the Location and attachments step, choose a territory. Mark a point, street section or area on the map and confirm it. If the map is unavailable, enter a landmark. Finish or cancel map editing before saving or continuing.',
  files: 'Add attachments on the second step. You can upload up to 3 JPG, PNG, WebP or PDF files, each up to 5 MB. Wait for the upload confirmation. Attachments are optional.',
  draft: 'Choose Save draft in the form. Find it later in My ideas to continue. Saving is confirmed by the server. Confirm or cancel any active map selection first.',
  clarification: 'When your idea needs clarification, open its card and read the specialist’s question. Enter your reply and send it. After a successful reply, the idea returns to review.',
  status: 'Open My ideas and select a proposal to see its status and replies. Received means registered; Under review means a specialist is reviewing it; Needs clarification means your reply is needed. Completed refers to the review result, which may differ from physical implementation.',
  queue: 'Find an idea by reference number or title in the review queue. Filter by status, category, territory or assignment, then open the card. Returning to the queue preserves your filters.',
  assignment: 'Open the idea card and use the assignee section. Choose an available specialist or assign yourself where allowed. A responsible specialist is required to start review or work.',
  staffReply: 'A public reply is visible to the resident. An internal note is only for staff. Use the separate fields and keep internal information out of public replies.',
  staffStatus: 'Use the available status actions in the idea card. Some transitions require an assignee and a public explanation of at least 20 characters. Completed and Rejected are final states.',
  notifications: 'Open Notifications to see replies, requests for details and status changes. Select a notification to open the corresponding idea card.',
};

export function fallbackReply(message, role, context, language = 'ru') {
  const q = String(message).toLocaleLowerCase();
  if (/лайк|поддерж|витрин|общая лента|слеж|подпис|follow|support|public feed|like|қолдау|жазыл/.test(q)
    || (context.page?.startsWith('dashboard') && /статус|этап|ответ|status|reply|жауап|мәртебе/.test(q))) {
    const allowed = availableActions(role, context, language);
    return { answer: language === 'en'
      ? 'Regional ideas shows cards published with author consent and staff review. Sign in as a resident to support an idea or follow its updates. The public card shows its status and separately published reply; private conversations stay private.'
      : language === 'kk'
      ? '«Аймақ идеялары» бөлімінде автордың келісімімен және қызметкер тексергеннен кейін жарияланған карточкалар бар. Идеяны қолдау немесе жаңалықтарына жазылу үшін тұрғын ретінде кіріңіз. Карточкада мәртебе мен ашық жауап көрсетіледі; жеке диалог жарияланбайды.'
      : 'В «Идеях региона» есть карточки, опубликованные с согласием автора после проверки сотрудника. Войдите как житель, чтобы поддержать идею или следить за обновлениями. В открытой карточке видны этап рассмотрения и отдельно опубликованный ответ; личный диалог остаётся в кабинете.',
      actions: ['open-dashboard','open-login','open-notifications'].map((id) => allowed.find((action) => action.id === id)).filter(Boolean).slice(0,3),
      followups: quickQuestions(role, context, language), language, mode: 'guide' };
  }
  const staff = role === 'STAFF' || role === 'ADMIN';
  let topic = 'start';
  if (/войти|вход|регистр|парол|кіру|кірем|тіркел|құпиясөз|sign.?in|log.?in|register|account|password/.test(q)) topic = 'login';
  else if (/карт|место|территор|орын|белгіле|аумақ|map|location|territory/.test(q)) topic = 'map';
  else if (/файл|фото|материал|тірке|file|photo|attach/.test(q)) topic = 'files';
  else if (/чернов|сохран|жоба|сақта|draft|save/.test(q)) topic = 'draft';
  else if (/уведом|хабарлам|notification/.test(q)) topic = 'notifications';
  else if (staff && /ответствен|назнач|жауапты|тағайын|assign|specialist/.test(q)) topic = 'assignment';
  else if (staff && /статус|переход|уточнен|мәртебе|нақтыла|status|transition|clarif/.test(q)) topic = 'staffStatus';
  else if (staff && /ответ|внутрен|заметк|публич|жителю|ішкі|жария|жазба|жауап|reply|internal|note|public/.test(q)) topic = 'staffReply';
  else if (staff && /очеред|фильтр|кезек|сүзгі|queue|filter/.test(q)) topic = 'queue';
  else if (/уточнен|нақтыла|clarif|request for details/.test(q)) topic = 'clarification';
  else if (/статус|ответ|найти|мои|мәртебе|жауап|қайдан|status|reply|find|my ideas/.test(q)) topic = 'status';
  const selected = topics[topic];
  const allowed = availableActions(role, context, language);
  const answer = language === 'en' ? englishTopics[topic] : language === 'kk'
    ? selected.kk.replace(/«([^»]+)»/g, (_, label) => `«${ui[label]?.kk ?? label}»`) : selected.ru;
  return { answer,
    actions: selected.actions.map((id) => allowed.find((a) => a.id === id)).filter(Boolean).slice(0, 3),
    followups: quickQuestions(role, context, language), language, mode: 'guide' };
}
