import { describe, expect, it } from "vitest";
import { mapTimeline, normalizeAuthResponse, normalizeCatalogs, resolveTerritoryId, store, threadFromTimeline } from "@/features/shared/data";

// C-04: клиент шлёт настоящий B те же идентификаторы, что B отдаёт в каталогах.
// d37aeab: GET /api/v1/catalogs territories несут id UUID; territoryId черновика —
// это catalogs[].id. Здесь — mock-зеркало формы и единое правило разрешения.
describe("C-04 real-mode identifiers", () => {
  it("catalogs territories carry id UUID alongside code/kind/nameRu", async () => {
    const { data } = (await store.catalogs()) as {
      data: { territories: Array<{ id?: string; code: string; kind?: string; nameRu: string }> };
    };
    expect(data.territories.length).toBeGreaterThan(0);
    for (const t of data.territories) {
      expect(t.code).toBeTruthy();
      expect(t.nameRu).toBeTruthy();
      expect(t.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    }
  });

  it("catalogs normalize real category objects to code strings (no React #31)", () => {
    const norm = normalizeCatalogs({
      categories: [{ code: "TRANSPORT", nameRu: "Транспорт", nameKk: "Көлік" }, "OTHER"],
      territories: [{ id: "5abbde34-eafa-5253-a6de-2e804e2d90d3", code: "DEMO_SEMEY", kind: "LOCALITY", nameRu: "Семей" }],
      ruleVersion: "rules-v1",
      consentVersion: "consent-v1",
    });
    expect(norm.categories).toEqual(["TRANSPORT", "OTHER"]);
    expect(norm.territories[0]?.id).toBe("5abbde34-eafa-5253-a6de-2e804e2d90d3");
    for (const c of norm.categories) expect(typeof c).toBe("string");
  });

  it("wizard resolves territoryId from catalogs id, code only as fallback", () => {
    expect(resolveTerritoryId({ id: "5abbde34-0000-4000-8000-000000000001", code: "DEMO_SEMEY" })).toBe(
      "5abbde34-0000-4000-8000-000000000001",
    );
    expect(resolveTerritoryId({ code: "DEMO_SEMEY" })).toBe("DEMO_SEMEY");
  });

  it("login/register normalize the real nested {user, csrfToken} to flat shape", () => {
    const nested = normalizeAuthResponse({
      user: { id: "u1", displayName: "Сотрудник", role: "STAFF", organizationId: "org-1" },
      csrfToken: "csrf-1",
    });
    expect(nested.role).toBe("STAFF");
    expect(nested.organizationId).toBe("org-1");
    expect(nested.csrfToken).toBe("csrf-1");
    const flat = normalizeAuthResponse({
      id: "u2",
      displayName: "Житель",
      role: "CITIZEN",
      organizationId: null,
      csrfToken: "csrf-2",
    });
    expect(flat.role).toBe("CITIZEN");
    expect(flat.organizationId).toBeNull();
  });

  it("timeline maps real event types to Russian rows", () => {
    const rows = mapTimeline(
      [
        { id: "e1", createdAt: "2026-09-29T10:00:00Z", actorId: "6cb6167b-f8d1-5b56-90ff-7c9c12a13a3c", type: "STATUS_CHANGED", fromStatus: "RECEIVED", toStatus: "UNDER_REVIEW", visibility: "PUBLIC", commentId: null, payload: {} },
        { id: "e2", createdAt: "2026-09-29T11:00:00Z", actorId: "6cb6167b-f8d1-5b56-90ff-7c9c12a13a3c", type: "COMMENT_PUBLIC", visibility: "PUBLIC", commentId: "c1", payload: {} },
      ],
      true,
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]?.text).toContain("На рассмотрении");
    expect(rows[1]?.text).toBe("Публичный ответ специалиста");
    expect(rows[0]?.actor).toBe("6cb6167b");
    const citizen = mapTimeline([{ id: "e1", type: "STATUS_CHANGED", fromStatus: "RECEIVED", toStatus: "NEEDS_INFO" }], false);
    expect(citizen[0]?.actor).toBeUndefined();
    expect(citizen[0]?.text).toContain("ужны уточнения");
    const sys = mapTimeline(
      [{ id: "a", type: "CREATED" }, { id: "b", type: "ATTACHMENT_ADDED" }, { id: "c", type: "SUBMITTED" }, { id: "d", type: "REROUTED" }],
      false,
    );
    expect(sys.map((r) => r.text)).toEqual([
      "Создан черновик",
      "Прикреплён файл",
      "Идея зарегистрирована на платформе",
      "Маршрут изменён",
    ]);
  });

  it("thread carries body from timeline events (B 49d2427 shape)", () => {
    const thread = threadFromTimeline(
      [
        { id: "e1", createdAt: "2026-09-29T10:00:00Z", actorId: "staff-uuid-1", type: "COMMENT_PUBLIC", visibility: "PUBLIC", body: "Принято в работу." },
        { id: "e2", createdAt: "2026-09-29T11:00:00Z", actorId: "staff-uuid-1", type: "COMMENT_INTERNAL", visibility: "INTERNAL", body: "Для коллег." },
        { id: "e3", createdAt: "2026-09-29T12:00:00Z", actorId: "staff-uuid-1", type: "STATUS_CHANGED", visibility: "PUBLIC", fromStatus: "RECEIVED", toStatus: "UNDER_REVIEW", body: null },
      ],
      true,
    );
    expect(thread).toHaveLength(2);
    expect(thread[0]).toMatchObject({ visibility: "PUBLIC", body: "Принято в работу." });
    expect(thread[1]).toMatchObject({ visibility: "INTERNAL", body: "Для коллег." });
  });

  it("staff queue maps UI unassigned=1 to the real assignee=unassigned sentinel", async () => {
    await store.login({ email: "transport@example.test", password: "x" });
    const { data } = (await store.staffList({ unassigned: "1" })) as {
      data: Array<{ assignee: unknown }>;
    };
    expect(data.length).toBeGreaterThan(0);
    expect(data.every((i) => !i.assignee)).toBe(true);
  });
});
