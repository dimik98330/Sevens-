"use client";

// DEV-ONLY mock строго по схемам 03 §5 (envelopes B: data+meta.requestId,
// error{code,message,fields?}+meta). Не шипается как backend: C-04 полностью
// обходит его настоящим /api/v1 B (флаг NEXT_PUBLIC_ABAI_MOCK=0 / ?mock=0).
// Маршрут считает движок D (routeIdea) на статическом срезе каталога из
// fixtures/demo-seed.json; файл только читает D-модуль, не меняет его.
import type { CatalogSnapshot, RoutingDecision } from "@/domain/routing/types";
import type { IdeaStatus } from "@/contracts";
import { newIdempotencyKey } from "./api-client";
import { previewRoute } from "./route-preview";

export function defaultMockMode(): boolean {
  // Явный флаг побеждает всегда. Без флага mock включён только вне production:
  // финальный запуск идёт в настоящий backend и никогда не подменяется mock.
  const flag = process.env.NEXT_PUBLIC_ABAI_MOCK;
  if (flag !== undefined) return flag !== "0";
  return process.env.NODE_ENV !== "production";
}

export function currentMockMode(): boolean {
  if (typeof window === "undefined") return defaultMockMode();
  const q = new URLSearchParams(window.location.search);
  if (q.has("mock")) return q.get("mock") !== "0";
  if (q.has("api")) return false;
  const stored = sessionStorage.getItem("abai.useMock");
  if (stored !== null) return stored !== "0";
  return defaultMockMode();
}

// Срез каталога: территории/организации/правила demo-seed (syntheticOnly).
// Экспортирован для C-02 (submit в mock) и тестов выравнивания с движком D.
export const DEV_CATALOG: CatalogSnapshot = {
  ruleVersion: "rules-v1",
  territories: [
    { code: "DEMO_SEMEY", active: true },
    { code: "DEMO_LOCALITY", active: true },
  ],
  organizations: [
    { code: "DEMO_TRANSPORT", name: "Демо: направление транспорта", active: true, isTriage: false },
    { code: "DEMO_UTILITIES", name: "Демо: направление ЖКХ", active: true, isTriage: false },
    { code: "DEMO_ECOLOGY", name: "Демо: направление экологии", active: true, isTriage: false },
    { code: "DEMO_SOCIAL", name: "Демо: социальное направление", active: true, isTriage: false },
    { code: "DEMO_SAFETY", name: "Демо: направление безопасности", active: true, isTriage: false },
    { code: "DEMO_TRIAGE", name: "Демо: центр цифровых инициатив", active: true, isTriage: true },
  ],
  rules: [
    { categoryCode: "TRANSPORT", organizationCode: "DEMO_TRANSPORT", territoryCode: null, priority: 100, active: true },
    { categoryCode: "UTILITIES", organizationCode: "DEMO_UTILITIES", territoryCode: null, priority: 100, active: true },
    { categoryCode: "ECOLOGY", organizationCode: "DEMO_ECOLOGY", territoryCode: null, priority: 100, active: true },
    { categoryCode: "EDUCATION", organizationCode: "DEMO_SOCIAL", territoryCode: null, priority: 100, active: true },
    { categoryCode: "HEALTH", organizationCode: "DEMO_SOCIAL", territoryCode: null, priority: 100, active: true },
    { categoryCode: "TOURISM", organizationCode: "DEMO_SOCIAL", territoryCode: null, priority: 100, active: true },
    { categoryCode: "ACCESSIBILITY", organizationCode: "DEMO_SOCIAL", territoryCode: null, priority: 100, active: true },
    { categoryCode: "SAFETY", organizationCode: "DEMO_SAFETY", territoryCode: null, priority: 100, active: true },
    { categoryCode: "OTHER", organizationCode: "DEMO_TRIAGE", territoryCode: null, priority: 100, active: true },
  ],
};

export interface MockIdea {
  id: string;
  publicNumber: string | null;
  version: number;
  title: string;
  problem: string;
  solution: string;
  expectedBenefit: string;
  requestedCategoryCode: string | null;
  effectiveCategoryCode: string | null;
  territoryCode: string | null;
  locationText: string;
  status: IdeaStatus;
  organizationCode: string | null;
  assignee: { id: string; name: string } | null;
  authorId: string;
  submittedAt: string | null;
  updatedAt: string;
  resolutionType: string | null;
  routing: RoutingDecision | null;
  attachments: Array<{ id: string; originalName: string; mime: string; sizeBytes: number; createdAt: string }>;
  timeline: Array<{ id: string; at: string; actor: string; text: string }>;
  comments: Array<{ id: string; visibility: "PUBLIC" | "INTERNAL"; author: string; body: string; at: string }>;
}

const now = () => new Date().toISOString();
const reqId = () => `req_mock_${Math.random().toString(36).slice(2, 8)}`;

// C-03: organizationId — мок-UUID вида org-<CODE>; маппинг код<->id только dev
// (production: UUID из справочника B).
const ORG_IDS: Record<string, string> = {
  DEMO_TRANSPORT: "org-DEMO_TRANSPORT",
  DEMO_UTILITIES: "org-DEMO_UTILITIES",
  DEMO_ECOLOGY: "org-DEMO_ECOLOGY",
  DEMO_SOCIAL: "org-DEMO_SOCIAL",
  DEMO_SAFETY: "org-DEMO_SAFETY",
  DEMO_TRIAGE: "org-DEMO_TRIAGE",
};
const CODE_BY_ORG_ID: Record<string, string> = Object.fromEntries(Object.entries(ORG_IDS).map(([k, v]) => [v, k]));

const STAFF_USERS = [
  { id: "u-staff-transport", displayName: "Демо-сотрудник: transport", email: "transport@example.test", organizationId: ORG_IDS.DEMO_TRANSPORT },
  { id: "u-staff-triage", displayName: "Демо-сотрудник: triage", email: "triage@example.test", organizationId: ORG_IDS.DEMO_TRIAGE },
];

const TRANSITIONS: Record<string, string[]> = {
  RECEIVED: ["UNDER_REVIEW"],
  UNDER_REVIEW: ["NEEDS_INFO", "IN_PROGRESS", "REJECTED", "COMPLETED"],
  NEEDS_INFO: ["UNDER_REVIEW"],
  IN_PROGRESS: ["NEEDS_INFO", "COMPLETED", "REJECTED"],
  COMPLETED: [],
  REJECTED: [],
};


// Canned routing decisions дословно повторяют expectedRouting из
// fixtures/demo-seed.json (проверено тестом c01 против движка D: R01).
function seedIdeas(): MockIdea[] {
  const mk = (o: {
    id: string; n: string; title: string; problem: string; solution: string;
    status: IdeaStatus; comment?: string; res?: string;
    routing: RoutingDecision;
  }): MockIdea => ({
    id: o.id,
    publicNumber: o.n,
    version: 3,
    title: o.title,
    problem: o.problem,
    solution: o.solution,
    expectedBenefit: "",
    requestedCategoryCode: null,
    effectiveCategoryCode: o.routing.effectiveCategoryCode,
    territoryCode: "DEMO_SEMEY",
    locationText: "",
    status: o.status,
    organizationCode: o.routing.organizationCode,
    assignee: o.status === "RECEIVED" ? null : { id: "u-staff-triage", name: "Демо-сотрудник" },
    authorId: "u-citizen-1",
    submittedAt: now(),
    updatedAt: now(),
    resolutionType: o.res ?? null,
    routing: o.routing,
    attachments: [],
    timeline: [{ id: `e-${o.id}`, at: now(), actor: "Демо-житель 1", text: "Идея зарегистрирована на платформе." }],
    comments: o.comment
      ? [{ id: `c-${o.id}`, visibility: "PUBLIC", author: "Демо-сотрудник", body: o.comment, at: now() }]
      : [],
  });
  const route = (
    effectiveCategoryCode: RoutingDecision["effectiveCategoryCode"],
    organizationCode: string,
    mode: RoutingDecision["mode"],
    confidenceBand: RoutingDecision["confidenceBand"],
    tags: string[],
    explanation: string,
    reasonCodes: string[] = [],
  ): RoutingDecision => ({
    source: "RULES",
    ruleVersion: "rules-v1",
    effectiveCategoryCode,
    organizationCode,
    mode,
    confidenceBand,
    tags,
    scores: {},
    evidence: [],
    reasonCodes,
    explanation,
  });
  return [
    mk({
      id: "idea-001", n: "ABAI-2026-000101",
      title: "Умные светофоры рядом со школой",
      problem: "Возле школы дорога требует внимания к безопасности детей. Синтетический пример.",
      solution: "Установить умные светофоры и датчики загруженности дороги.",
      status: "RECEIVED",
      routing: route(
        "TRANSPORT", "DEMO_TRANSPORT", "ASSIGNED", "HIGH",
        ["EDUCATION", "SAFETY", "SMART_CITY"],
        "Признаки «светофор» и «дорога» указывают на транспорт. Школа и безопасность учтены как дополнительные темы. Направлено в демонстрационную очередь транспорта.",
      ),
    }),
    mk({
      id: "idea-003", n: "ABAI-2026-000096",
      title: "Электронный дневник",
      problem: "Школа хочет удобный электронный дневник. Синтетический пример.",
      solution: "Приложение для учебных уведомлений.",
      status: "NEEDS_INFO",
      comment: "Уточните, какие действия должен поддерживать сервис и кому они будут полезны.",
      routing: route(
        "EDUCATION", "DEMO_SOCIAL", "ASSIGNED", "HIGH",
        ["SMART_CITY"],
        "Признаки электронного дневника указывают на образование. Направлено в демонстрационное социальное направление.",
      ),
    }),
    mk({
      id: "idea-004", n: "ABAI-2026-000088",
      title: "Запись к врачу",
      problem: "Очередь в поликлинике требует понятной организации. Синтетический пример.",
      solution: "Добавить онлайн-запись к врачу.",
      status: "COMPLETED",
      res: "ANSWER_PROVIDED",
      comment: "Предоставлен демонстрационный итоговый ответ: для дальнейшего обсуждения нужно уточнить состав функций.",
      routing: route(
        "HEALTH", "DEMO_SOCIAL", "ASSIGNED", "HIGH",
        ["SMART_CITY"],
        "Признаки записи к врачу указывают на здравоохранение. Направлено в демонстрационное социальное направление.",
      ),
    }),
    mk({
      id: "idea-005", n: "ABAI-2026-000111",
      title: "Сделать регион удобнее",
      problem: "Есть идея улучшения повседневной жизни. Синтетический пример.",
      solution: "Подробности пока необходимо обсудить.",
      status: "RECEIVED",
      routing: route(
        "OTHER", "DEMO_TRIAGE", "TRIAGE", "LOW",
        [],
        "Текст не даёт уверенного направления: идея передана в демонстрационный центр разбора направлений. Специалист уточнит маршрут.",
        ["DIGITAL_COMPONENT_NOT_CLEAR"],
      ),
    }),
  ];
}

interface MockUser {
  id: string;
  displayName: string;
  email: string;
  role: "CITIZEN" | "STAFF" | "ADMIN";
  organizationId: string | null;
}

function fail(http: number, code: string, message: string, fields?: Record<string, string>): never {
  throw new ApiMockError({ http, code, message, fields: fields ?? {} });
}

export class ApiMockError extends Error {
  readonly detail: { http: number; code: string; message: string; fields: Record<string, string> };
  constructor(detail: { http: number; code: string; message: string; fields: Record<string, string> }) {
    super(detail.message);
    this.name = "ApiMockError";
    this.detail = detail;
  }
}

const MOCK_USER_KEY = "abai.mockUser";

class Store {
  meUser: MockUser | null = null;
  ideas: MockIdea[] = seedIdeas();
  nextNumber = 124;

  private persist(): void {
    if (typeof window === "undefined") return;
    // DEV-ONLY: демо-сессия переживает навигацию. Только синтетические
    // seed-личности; настоящий backend использует httpOnly-cookie (B).
    if (this.meUser) sessionStorage.setItem(MOCK_USER_KEY, JSON.stringify(this.meUser));
    else sessionStorage.removeItem(MOCK_USER_KEY);
  }

  private restore(): void {
    if (typeof window === "undefined" || this.meUser) return;
    try {
      const raw = sessionStorage.getItem(MOCK_USER_KEY);
      if (raw) {
        const u = JSON.parse(raw) as MockUser;
        if (u && typeof u.email === "string") this.meUser = u;
      }
    } catch {
      // битый ключ игнорируем
    }
  }
  users: MockUser[] = [
    { id: "u-citizen-1", displayName: "Демо-житель 1", email: "citizen1@example.test", role: "CITIZEN", organizationId: null },
    { id: "u-staff-transport", displayName: "Демо-сотрудник: transport", email: "transport@example.test", role: "STAFF", organizationId: ORG_IDS.DEMO_TRANSPORT as string },
    { id: "u-admin", displayName: "Демо-администратор", email: "admin@example.test", role: "ADMIN", organizationId: null },
  ];

  me(): MockUser | null {
    this.restore();
    return this.meUser;
  }

  catalogs() {
    return {
      data: {
        categories: ["TRANSPORT", "UTILITIES", "EDUCATION", "ECOLOGY", "SAFETY", "HEALTH", "TOURISM", "ACCESSIBILITY", "OTHER"],
        territories: [
          {
            id: "5abbde34-0000-4000-8000-000000000001",
            code: "DEMO_SEMEY",
            kind: "LOCALITY",
            nameRu: "Семей — демонстрационная территория",
          },
          {
            id: "5abbde34-0000-4000-8000-000000000002",
            code: "DEMO_LOCALITY",
            kind: "LOCALITY",
            nameRu: "Демо-населённый пункт",
          },
        ],
        ruleVersion: "rules-v1",
        consentVersion: "consent-v1",
      },
      meta: { requestId: reqId() },
    };
  }

  login(body: { email?: string; password?: string }) {
    const email = (body.email ?? "").trim().toLowerCase();
    const u = this.users.find((x) => x.email === email);
    if (!u || (body.password ?? "").length < 1) fail(401, "UNAUTHENTICATED", "Неверный email или пароль");
    this.meUser = u!;
    this.persist();
    return { data: { ...u, csrfToken: "mock-csrf" }, meta: { requestId: reqId() } };
  }

  register(body: { displayName?: string; email?: string; password?: string; consentAccepted?: boolean }) {
    if (!body.consentAccepted) fail(400, "VALIDATION_ERROR", "Проверьте заполнение формы", { consentAccepted: "Нужно согласие" });
    if ((body.password ?? "").length < 12)
      fail(400, "VALIDATION_ERROR", "Проверьте заполнение формы", { password: "Пароль: минимум 12 символов" });
    const email = (body.email ?? "").trim().toLowerCase();
    if (this.users.some((u) => u.email === email))
      fail(400, "VALIDATION_ERROR", "Проверьте заполнение формы", { email: "Этот email уже используется" });
    const u: MockUser = {
      id: `u-${Math.random().toString(36).slice(2, 8)}`,
      displayName: (body.displayName ?? "").trim() || "Житель",
      email,
      role: "CITIZEN", // роль всегда назначает сервер (01 §5)
      organizationId: null,
    };
    this.users.push(u);
    this.meUser = u;
    this.persist();
    return { data: { ...u, csrfToken: "mock-csrf" }, meta: { requestId: reqId() } };
  }

  logout() {
    this.meUser = null;
    this.persist();
    return { data: {}, meta: { requestId: reqId() } };
  }

  private needAuth(): MockUser {
    if (!this.meUser) fail(401, "UNAUTHENTICATED", "Нужно войти, чтобы продолжить");
    return this.meUser!;
  }

  private ideaOr404(id: string, staff = false): MockIdea {
    const it = this.ideas.find((x) => x.id === id);
    if (!it) fail(404, "NOT_FOUND", "Страница недоступна или у вас нет доступа к этой идее");
    if (!staff && this.meUser?.role === "CITIZEN" && it!.authorId !== this.meUser.id)
      fail(404, "NOT_FOUND", "Страница недоступна или у вас нет доступа к этой идее");
    if (staff && this.meUser?.role === "STAFF") {
      const myCode = CODE_BY_ORG_ID[this.meUser.organizationId ?? ""];
      if (it!.organizationCode !== myCode)
        fail(404, "NOT_FOUND", "Страница недоступна или у вас нет доступа к этой идее");
    }
    return it!;
  }

  // Черновик и подача (C-02). Маршрут считает dev-preview на словаре D;
  // production-решение всегда приходит с сервера B (03 §9).
  createDraft(body: { title?: string; problem?: string; solution?: string; expectedBenefit?: string }) {
    const me = this.needAuth();
    const d: MockIdea = {
      id: `idea-${Math.random().toString(36).slice(2, 8)}`,
      publicNumber: null,
      version: 1,
      title: body.title ?? "",
      problem: body.problem ?? "",
      solution: body.solution ?? "",
      expectedBenefit: body.expectedBenefit ?? "",
      requestedCategoryCode: null,
      effectiveCategoryCode: null,
      territoryCode: null,
      locationText: "",
      status: "DRAFT",
      organizationCode: null,
      assignee: null,
      authorId: me.id,
      submittedAt: null,
      updatedAt: now(),
      resolutionType: null,
      routing: null,
      attachments: [],
      timeline: [],
      comments: [],
    };
    this.ideas.unshift(d);
    return { data: { id: d.id, version: 1 }, meta: { requestId: reqId() } };
  }

  patchDraft(id: string, body: Record<string, unknown>) {
    const me = this.needAuth();
    const it = this.ideas.find((x) => x.id === id);
    if (!it || it.authorId !== me.id) fail(404, "NOT_FOUND", "Страница недоступна или у вас нет доступа к этой идее");
    if (it!.status !== "DRAFT") fail(409, "INVALID_TRANSITION", "Черновик уже отправлен");
    if (body.expectedVersion !== it!.version)
      fail(409, "VERSION_CONFLICT", "Карточка обновлена. Обновите данные и повторите.");
    for (const k of ["title", "problem", "solution", "expectedBenefit", "requestedCategoryCode", "locationText"] as const) {
      if (k in body) (it as unknown as Record<string, unknown>)[k] = body[k];
    }
    // Dev mapping: territoryId — UUID из catalogs[].id (d37aeab; mock
    // зеркалит форму B). Mock хранит значение как есть.
    if ("territoryId" in body) it!.territoryCode = body.territoryId as string;
    it!.version += 1;
    it!.updatedAt = now();
    return { data: { id: it!.id, version: it!.version }, meta: { requestId: reqId() } };
  }

  submit(id: string, body: { expectedVersion: number; consentAccepted: boolean }) {
    const me = this.needAuth();
    const it = this.ideas.find((x) => x.id === id);
    if (!it || it.authorId !== me.id) fail(404, "NOT_FOUND", "Страница недоступна или у вас нет доступа к этой идее");
    if (it.status !== "DRAFT")
      return {
        data: { id: it.id, publicNumber: it.publicNumber, status: it.status, version: it.version, routing: it.routing },
        meta: { requestId: reqId() },
      };
    if (body.expectedVersion !== it.version)
      fail(409, "VERSION_CONFLICT", "Карточка обновлена. Обновите данные и повторите.");
    const fields: Record<string, string> = {};
    if (it.title.trim().length < 10) fields.title = "Название короче 10 символов";
    if (it.problem.trim().length < 30) fields.problem = "Нужно минимум 30 символов";
    if (it.solution.trim().length < 30) fields.solution = "Нужно минимум 30 символов";
    if (!it.territoryCode) fields.territoryCode = "Выберите территорию из справочника";
    if (!body.consentAccepted) fields.consentAccepted = "Нужно согласие";
    if (Object.keys(fields).length) fail(400, "VALIDATION_ERROR", "Проверьте заполнение формы", fields);
    const routing = previewRoute({
      title: it.title,
      problem: it.problem,
      solution: it.solution,
      requestedCategoryCode: (it.requestedCategoryCode as RoutingDecision["effectiveCategoryCode"]) ?? null,
      territoryCode: it.territoryCode ?? "DEMO_SEMEY",
    });
    it.effectiveCategoryCode = routing.effectiveCategoryCode;
    it.organizationCode = routing.organizationCode;
    it.routing = routing;
    it.status = "RECEIVED";
    it.publicNumber = `ABAI-2026-${String(this.nextNumber++).padStart(6, "0")}`;
    it.submittedAt = now();
    it.version += 1;
    it.updatedAt = now();
    it.timeline.push({ id: `e-${Date.now()}`, at: now(), actor: me.displayName, text: "Идея зарегистрирована на платформе." });
    return {
      data: { id: it.id, publicNumber: it.publicNumber, status: it.status, version: it.version, routing },
      meta: { requestId: reqId() },
    };
  }

  clarify(id: string, body: { body: string; expectedVersion: number }) {
    const me = this.needAuth();
    const it = this.ideas.find((x) => x.id === id);
    if (!it || it.authorId !== me.id) fail(404, "NOT_FOUND", "Страница недоступна или у вас нет доступа к этой идее");
    if (it!.status !== "NEEDS_INFO") fail(409, "INVALID_TRANSITION", "Уточнение сейчас не запрашивается");
    if (body.expectedVersion !== it!.version)
      fail(409, "VERSION_CONFLICT", "Карточка обновлена. Обновите данные и повторите.");
    if (body.body.trim().length < 10)
      fail(400, "VALIDATION_ERROR", "Проверьте заполнение формы", { body: "Ответ — минимум 10 символов" });
    it!.comments.push({ id: `c-${Date.now()}`, visibility: "PUBLIC", author: me.displayName, body: body.body.trim(), at: now() });
    it!.timeline.push({ id: `e-${Date.now()}`, at: now(), actor: me.displayName, text: "Автор дополнил идею." });
    it!.status = "UNDER_REVIEW";
    it!.version += 1;
    it!.updatedAt = now();
    return { data: { id: it!.id, version: it!.version, status: it!.status }, meta: { requestId: reqId() } };
  }

  attach(id: string, file: { name: string; size: number; type: string }, expectedVersion: number) {
    const me = this.needAuth();
    const it = this.ideas.find((x) => x.id === id);
    if (!it || it.authorId !== me.id) fail(404, "NOT_FOUND", "Страница недоступна или у вас нет доступа к этой идее");
    if (expectedVersion !== it!.version)
      fail(409, "VERSION_CONFLICT", "Карточка обновлена. Обновите данные и повторите.");
    if (it!.attachments.length >= 3)
      fail(400, "VALIDATION_ERROR", "Максимум 3 активных файла", { file: "Удалите один файл перед загрузкой" });
    if (file.size > 5 * 1024 * 1024) fail(413, "FILE_TOO_LARGE", "Файл больше 5 MiB");
    if (!["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(file.type))
      fail(415, "UNSUPPORTED_FILE_TYPE", "Этот формат не поддерживается. Выберите JPG, PNG, WebP или PDF");
    const att = { id: `a-${Date.now()}`, originalName: file.name, mime: file.type, sizeBytes: file.size, createdAt: now() };
    it!.attachments.push(att);
    it!.version += 1;
    return { data: { attachment: att, ideaVersion: it!.version }, meta: { requestId: reqId() } };
  }

  mine(params: { q?: string; status?: string }) {
    const me = this.needAuth();
    let list = this.ideas.filter((x) => x.authorId === me.id);
    if (params.status) list = list.filter((x) => x.status === params.status);
    if (params.q) {
      const s = params.q.toLowerCase();
      list = list.filter((x) => `${x.title} ${x.problem} ${x.solution} ${x.publicNumber ?? ""}`.toLowerCase().includes(s));
    }
    return { data: list, meta: { requestId: reqId(), page: 1, pageSize: 20, total: list.length } };
  }

  get(id: string, staffView: boolean) {
    this.needAuth();
    const it = this.ideaOr404(id, staffView);
    if (!staffView && this.meUser?.role === "CITIZEN") {
      return {
        data: { ...it, comments: it.comments.filter((c) => c.visibility === "PUBLIC") },
        meta: { requestId: reqId() },
      };
    }
    return { data: it, meta: { requestId: reqId() } };
  }

  deleteAttachment(id: string, attachmentId: string, expectedVersion: number) {
    const me = this.needAuth();
    const it = this.ideas.find((x) => x.id === id);
    if (!it || it.authorId !== me.id) fail(404, "NOT_FOUND", "Страница недоступна или у вас нет доступа к этой идее");
    if (expectedVersion !== it!.version)
      fail(409, "VERSION_CONFLICT", "Карточка обновлена. Обновите данные и повторите.");
    const ix = it!.attachments.findIndex((a) => a.id === attachmentId);
    if (ix < 0) fail(404, "NOT_FOUND", "Страница недоступна или у вас нет доступа к этой идее");
    it!.attachments.splice(ix, 1);
    it!.version += 1;
    return { data: { id: it!.id, version: it!.version }, meta: { requestId: reqId() } };
  }

  notifications() {
    this.needAuth();
    return [
      { id: "n1", ideaId: "idea-003", kind: "NEEDS_INFO", title: "Сотрудник задал уточняющий вопрос по идее ABAI-2026-000096", readAt: null as string | null, createdAt: now() },
      { id: "n2", ideaId: "idea-004", kind: "STATUS", title: "Статус идеи ABAI-2026-000088: Завершена", readAt: null as string | null, createdAt: now() },
    ];
  }

  key(): string {
    return newIdempotencyKey();
  }


  staffList(params: Record<string, string | undefined>) {
    const me = this.needAuth();
    if (me.role === "CITIZEN") fail(403, "FORBIDDEN", "Страница недоступна или у вас нет доступа к этой идее");
    // Как настоящий B: STAFF видит свою организацию, ADMIN — выбранную (без неё 403).
    let scopeCode: string | undefined;
    if (me.role === "ADMIN") {
      if (!params.organizationId) fail(403, "FORBIDDEN", "Укажите организацию");
      scopeCode = CODE_BY_ORG_ID[params.organizationId!];
      if (!scopeCode) fail(400, "VALIDATION_ERROR", "Проверьте заполнение формы", { organizationId: "Организация только из справочника" });
    } else {
      scopeCode = CODE_BY_ORG_ID[me.organizationId ?? ""];
    }
    let list = this.ideas.filter((x) => x.status !== "DRAFT" && x.organizationCode === scopeCode);
    if (params.category) list = list.filter((x) => x.effectiveCategoryCode === params.category);
    if (params.status) list = list.filter((x) => x.status === params.status);
    if (params.q) {
      const s = params.q.toLowerCase();
      list = list.filter((x) => `${x.title} ${x.problem} ${x.solution} ${x.publicNumber ?? ""}`.toLowerCase().includes(s));
    }
    if (params.unassigned === "1" || params.assignee === "unassigned") list = list.filter((x) => !x.assignee);
    else if (params.assignee) list = list.filter((x) => x.assignee?.id === params.assignee);
    const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(params.pageSize ?? "20", 10) || 20));
    const total = list.length;
    list = list.slice((page - 1) * pageSize, page * pageSize);
    return { data: list, meta: { requestId: reqId(), page, pageSize, total } };
  }

  staffGet(id: string) {
    this.needAuth();
    return { data: this.ideaOr404(id, true), meta: { requestId: reqId() } };
  }

  assignees() {
    const me = this.needAuth();
    const list = STAFF_USERS.filter((s) => me.role === "ADMIN" || s.organizationId === me.organizationId).map((s) => ({
      id: s.id,
      displayName: s.displayName,
    }));
    return { data: list, meta: { requestId: reqId() } };
  }

  adminOrganizations() {
    const me = this.needAuth();
    if (me.role !== "ADMIN") fail(403, "FORBIDDEN", "Страница недоступна или у вас нет доступа к этой идее");
    return {
      data: Object.entries(ORG_IDS).map(([code, oid]) => ({
        id: oid,
        code,
        name: DEV_CATALOG.organizations.find((o) => o.code === code)?.name ?? code,
      })),
      meta: { requestId: reqId() },
    };
  }

  assign(id: string, body: { assigneeId: string | null; expectedVersion: number }) {
    const me = this.needAuth();
    const it = this.ideaOr404(id, true);
    if (body.expectedVersion !== it.version)
      fail(409, "VERSION_CONFLICT", "Коллега уже изменил эту идею. Обновите карточку перед сохранением.");
    if (body.assigneeId) {
      const person = STAFF_USERS.find((s) => s.id === body.assigneeId);
      const myCode = CODE_BY_ORG_ID[me.organizationId ?? ""];
      const personCode = CODE_BY_ORG_ID[person?.organizationId ?? ""];
      if (!person || personCode !== it.organizationCode || (me.role === "STAFF" && personCode !== myCode))
        fail(400, "VALIDATION_ERROR", "Можно назначить только активного коллегу своей организации");
      it.assignee = { id: person!.id, name: person!.displayName };
    } else {
      it.assignee = null;
    }
    it.version += 1;
    it.updatedAt = now();
    it.timeline.push({
      id: `e-${Date.now()}`,
      at: now(),
      actor: me.displayName,
      text: it.assignee ? `Ответственный: ${it.assignee.name}` : "Ответственный сброшен",
    });
    return { data: { id: it.id, version: it.version }, meta: { requestId: reqId() } };
  }

  changeStatus(id: string, body: Record<string, unknown>) {
    const me = this.needAuth();
    const it = this.ideaOr404(id, true);
    if (body.expectedVersion !== it.version)
      fail(409, "VERSION_CONFLICT", "Коллега уже изменил эту идею. Обновите карточку перед сохранением.");
    const to = body.toStatus as string;
    if (!(TRANSITIONS[it.status] ?? []).includes(to)) fail(409, "INVALID_TRANSITION", "Этот переход сейчас недоступен");
    const comment = ((body.publicComment as string) ?? "").trim();
    if (["NEEDS_INFO", "REJECTED", "COMPLETED"].includes(to) && comment.length < 20)
      fail(400, "VALIDATION_ERROR", "Проверьте заполнение формы", { publicComment: "Публичный комментарий — минимум 20 символов" });
    if (to === "COMPLETED" && !body.resolutionType)
      fail(400, "VALIDATION_ERROR", "Проверьте заполнение формы", { resolutionType: "Выберите тип результата" });
    let assignee = it.assignee;
    if (body.takeOwnership) {
      const mine = STAFF_USERS.find((s) => s.id === me.id) ?? { id: me.id, displayName: me.displayName };
      assignee = { id: mine.id, name: mine.displayName };
    }
    if ((to === "UNDER_REVIEW" || to === "IN_PROGRESS") && !assignee)
      fail(400, "VALIDATION_ERROR", "Сначала назначьте ответственного", { assigneeId: "Нужен ответственный" });
    it.assignee = assignee;
    if (comment)
      it.comments.push({ id: `c-${Date.now()}`, visibility: "PUBLIC", author: me.displayName, body: comment, at: now() });
    it.status = to as MockIdea["status"];
    it.resolutionType = (body.resolutionType as string) ?? null;
    it.version += 1;
    it.updatedAt = now();
    it.timeline.push({ id: `e-${Date.now()}`, at: now(), actor: me.displayName, text: `Статус: ${to}` });
    return { data: { id: it.id, version: it.version, status: it.status }, meta: { requestId: reqId() } };
  }

  addComment(id: string, body: { visibility: "PUBLIC" | "INTERNAL"; body: string; expectedVersion: number }) {
    const me = this.needAuth();
    const it = this.ideaOr404(id, true);
    if (body.expectedVersion !== it.version)
      fail(409, "VERSION_CONFLICT", "Коллега уже изменил эту идею. Обновите карточку перед сохранением.");
    if (!body.body.trim()) fail(400, "VALIDATION_ERROR", "Проверьте заполнение формы", { body: "Пустое сообщение" });
    it.comments.push({ id: `c-${Date.now()}`, visibility: body.visibility, author: me.displayName, body: body.body.trim(), at: now() });
    it.version += 1;
    return { data: { id: it.id, version: it.version }, meta: { requestId: reqId() } };
  }

  reroute(id: string, body: { organizationId: string; effectiveCategoryCode?: string; reason: string; expectedVersion: number }) {
    const me = this.needAuth();
    if (me.role !== "ADMIN") fail(403, "FORBIDDEN", "Страница недоступна или у вас нет доступа к этой идее");
    const it = this.ideas.find((x) => x.id === id);
    if (!it) fail(404, "NOT_FOUND", "Страница недоступна или у вас нет доступа к этой идее");
    if (body.expectedVersion !== it!.version)
      fail(409, "VERSION_CONFLICT", "Коллега уже изменил эту идею. Обновите карточку перед сохранением.");
    if (!["RECEIVED", "UNDER_REVIEW", "NEEDS_INFO", "IN_PROGRESS"].includes(it!.status))
      fail(409, "INVALID_TRANSITION", "Перенаправление из терминального статуса запрещено");
    if ((body.reason ?? "").trim().length < 10 || (body.reason ?? "").length > 1000)
      fail(400, "VALIDATION_ERROR", "Проверьте заполнение формы", { reason: "Причина — 10–1000 символов" });
    const code = CODE_BY_ORG_ID[body.organizationId];
    if (!code) fail(400, "VALIDATION_ERROR", "Проверьте заполнение формы", { organizationId: "Организация только из справочника" });
    it!.organizationCode = code;
    if (body.effectiveCategoryCode) it!.effectiveCategoryCode = body.effectiveCategoryCode;
    it!.assignee = null;
    it!.version += 1;
    it!.timeline.push({
      id: `e-${Date.now()}`,
      at: now(),
      actor: me.displayName,
      text: `Маршрут исправлен: ${code}. Причина: ${body.reason.trim()}`,
    });
    return { data: { id: it!.id, version: it!.version }, meta: { requestId: reqId() } };
  }
}

export const mockStore = new Store();
