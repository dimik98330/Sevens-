import { describe, expect, it } from "vitest";
import { resolveTerritoryId, store } from "@/features/shared/data";

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

  it("wizard resolves territoryId from catalogs id, code only as fallback", () => {
    expect(resolveTerritoryId({ id: "5abbde34-0000-4000-8000-000000000001", code: "DEMO_SEMEY" })).toBe(
      "5abbde34-0000-4000-8000-000000000001",
    );
    expect(resolveTerritoryId({ code: "DEMO_SEMEY" })).toBe("DEMO_SEMEY");
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
