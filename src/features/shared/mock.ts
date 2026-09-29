"use client";

// DEV-ONLY mock строго по схемам 03 §5 (envelopes B: data+meta.requestId,
// error{code,message,fields?}+meta). Не шипается как backend: C-04 полностью
// обходит его настоящим /api/v1 B (флаг NEXT_PUBLIC_ABAI_MOCK=0 / ?mock=0).
// Маршрут считает движок D (routeIdea) на статическом срезе каталога из
// fixtures/demo-seed.json; файл только читает D-модуль, не меняет его.
import type { CatalogSnapshot, RoutingDecision } from "@/domain/routing/types";
import type { IdeaStatus } from "@/contracts";
import { newIdempotencyKey } from "./api-client";

export function defaultMockMode(): boolean {
  return (process.env.NEXT_PUBLIC_ABAI_MOCK ?? "1") !== "0";
}

export function currentMockMode(): boolean {
  if (typeof window === "undefined") return defaultMockMode();
  const q = new URLSearchParams(window.location.search);
  if (q.has("mock")) return q.get("mock") !== "0";
  if (q.has("api")) return false;
  return (sessionStorage.getItem("abai.useMock") ?? (process.env.NEXT_PUBLIC_ABAI_MOCK ?? "1")) !== "0";
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
  requestedCategoryCode: string | null;
  effectiveCategoryCode: string | null;
  territoryCode: string | null;
  status: IdeaStatus;
  organizationCode: string | null;
  assignee: { id: string; name: string } | null;
  authorId: string;
  submittedAt: string | null;
  updatedAt: string;
  resolutionType: string | null;
  routing: RoutingDecision | null;
  timeline: Array<{ id: string; at: string; actor: string; text: string }>;
  comments: Array<{ id: string; visibility: "PUBLIC" | "INTERNAL"; author: string; body: string; at: string }>;
}

const now = () => new Date().toISOString();
const reqId = () => `req_mock_${Math.random().toString(36).slice(2, 8)}`;

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
    requestedCategoryCode: null,
    effectiveCategoryCode: o.routing.effectiveCategoryCode,
    territoryCode: "DEMO_SEMEY",
    status: o.status,
    organizationCode: o.routing.organizationCode,
    assignee: o.status === "RECEIVED" ? null : { id: "u-staff-triage", name: "Демо-сотрудник" },
    authorId: "u-citizen-1",
    submittedAt: now(),
    updatedAt: now(),
    resolutionType: o.res ?? null,
    routing: o.routing,
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

class Store {
  meUser: MockUser | null = null;
  ideas: MockIdea[] = seedIdeas();
  users: MockUser[] = [
    { id: "u-citizen-1", displayName: "Демо-житель 1", email: "citizen1@example.test", role: "CITIZEN", organizationId: null },
    { id: "u-staff-transport", displayName: "Демо-сотрудник: transport", email: "transport@example.test", role: "STAFF", organizationId: "DEMO_TRANSPORT" },
    { id: "u-admin", displayName: "Демо-администратор", email: "admin@example.test", role: "ADMIN", organizationId: null },
  ];

  me(): MockUser | null {
    return this.meUser;
  }

  catalogs() {
    return {
      data: {
        categories: ["TRANSPORT", "UTILITIES", "EDUCATION", "ECOLOGY", "SAFETY", "HEALTH", "TOURISM", "ACCESSIBILITY", "OTHER"],
        territories: [
          { code: "DEMO_SEMEY", nameRu: "Семей — демонстрационная территория" },
          { code: "DEMO_LOCALITY", nameRu: "Демо-населённый пункт" },
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
    return { data: { ...u, csrfToken: "mock-csrf" }, meta: { requestId: reqId() } };
  }

  logout() {
    this.meUser = null;
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
    if (
      staff &&
      this.meUser?.role === "STAFF" &&
      it!.organizationCode !== this.meUser.organizationId
    )
      fail(404, "NOT_FOUND", "Страница недоступна или у вас нет доступа к этой идее");
    return it!;
  }

  // createDraft/patchDraft/submit приезжают с C-02 (мастер подачи).
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

  notifications() {
    this.needAuth();
    return [
      { id: "n1", ideaId: "idea-003", title: "Сотрудник задал уточняющий вопрос по идее ABAI-2026-000096", readAt: null as string | null, at: now() },
      { id: "n2", ideaId: "idea-004", title: "Статус идеи ABAI-2026-000088: Завершена", readAt: null as string | null, at: now() },
    ];
  }

  key(): string {
    return newIdempotencyKey();
  }
}

export const mockStore = new Store();
