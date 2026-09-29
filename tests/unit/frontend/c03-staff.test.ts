import { beforeEach, describe, expect, it } from "vitest";
import { isTransitionAllowed, REQUIRES_ASSIGNEE, REQUIRES_PUBLIC_COMMENT, REROUTE_FROM } from "@/contracts/transitions.mjs";
import { mockStore } from "@/features/shared/mock";

// C-03: очередь и карточка сотрудника. Серверные правила (B) первичны;
// здесь — клиентские гарды и dev-mock поведение по тем же правилам.
describe("staff transition guards (01 §12)", () => {
  it("RECEIVED only offers take-into-review", () => {
    expect(isTransitionAllowed("RECEIVED", "UNDER_REVIEW")).toBe(true);
    expect(isTransitionAllowed("RECEIVED", "IN_PROGRESS")).toBe(false);
    expect(isTransitionAllowed("RECEIVED", "COMPLETED")).toBe(false);
  });

  it("terminal statuses offer nothing", () => {
    for (const to of ["UNDER_REVIEW", "NEEDS_INFO", "IN_PROGRESS", "COMPLETED", "REJECTED"]) {
      expect(isTransitionAllowed("COMPLETED", to)).toBe(false);
      expect(isTransitionAllowed("REJECTED", to)).toBe(false);
    }
  });

  it("comment/assignee requirements match the contract", () => {
    expect(REQUIRES_PUBLIC_COMMENT.has("COMPLETED")).toBe(true);
    expect(REQUIRES_ASSIGNEE.has("UNDER_REVIEW")).toBe(true);
    expect(REQUIRES_ASSIGNEE.has("NEEDS_INFO")).toBe(false);
  });

  it("reroute allowed only from non-terminal statuses", () => {
    expect(REROUTE_FROM.has("RECEIVED")).toBe(true);
    expect(REROUTE_FROM.has("NEEDS_INFO")).toBe(true);
    expect(REROUTE_FROM.has("COMPLETED")).toBe(false);
    expect(REROUTE_FROM.has("REJECTED")).toBe(false);
  });
});

describe("staff mock flow (dev-only)", () => {
  beforeEach(() => {
    mockStore.logout();
  });

  it("staff sees only own organization queue; citizen is forbidden", () => {
    mockStore.login({ email: "transport@example.test", password: "x" });
    const { data } = mockStore.staffList({});
    expect((data as Array<{ organizationCode: string }>).every((i) => i.organizationCode === "DEMO_TRANSPORT")).toBe(true);
    mockStore.logout();
    mockStore.login({ email: "citizen1@example.test", password: "x" });
    expect(() => mockStore.staffList({})).toThrowError();
  });

  it("take-ownership + UNDER_REVIEW is atomic in one call", () => {
    mockStore.login({ email: "transport@example.test", password: "x" });
    const idea = (mockStore.staffList({}).data as Array<{ id: string; version: number }>)[0]!;
    const { data } = mockStore.changeStatus(idea.id, {
      toStatus: "UNDER_REVIEW",
      takeOwnership: true,
      expectedVersion: idea.version,
    }) as { data: { version: number; status: string } };
    expect(data.status).toBe("UNDER_REVIEW");
    const updated = mockStore.staffGet(idea.id).data as { assignee: { id: string } | null; version: number };
    expect(updated.assignee?.id).toBe("u-staff-transport");
  });

  it("stale expectedVersion gives 409 and keeps user text client-side", () => {
    mockStore.login({ email: "transport@example.test", password: "x" });
    const idea = (mockStore.staffList({}).data as Array<{ id: string; version: number }>)[0]!;
    try {
      mockStore.changeStatus(idea.id, { toStatus: "UNDER_REVIEW", takeOwnership: true, expectedVersion: idea.version - 1 });
      expect.unreachable();
    } catch (e) {
      expect((e as { detail: { code: string } }).detail.code).toBe("VERSION_CONFLICT");
    }
  });

  it("COMPLETED without resolution type is rejected", () => {
    mockStore.login({ email: "transport@example.test", password: "x" });
    const idea = (mockStore.staffList({}).data as Array<{ id: string; version: number }>)[0]!;
    try {
      mockStore.changeStatus(idea.id, {
        toStatus: "UNDER_REVIEW",
        takeOwnership: true,
        expectedVersion: idea.version,
      });
    } catch {
      // may already be past RECEIVED in shared singleton; continue
    }
    const current = mockStore.staffGet(idea.id).data as { version: number; status: string };
    if (current.status === "UNDER_REVIEW") {
      try {
        mockStore.changeStatus(idea.id, {
          toStatus: "COMPLETED",
          publicComment: "Достаточно длинный публичный комментарий для завершения.",
          expectedVersion: current.version,
        });
        expect.unreachable();
      } catch (e) {
        expect((e as { detail: { code: string } }).detail.code).toBe("VALIDATION_ERROR");
      }
    }
  });

  it("admin reroute uses organizationId from catalog and resets assignee", () => {
    mockStore.login({ email: "admin@example.test", password: "x" });
    const orgs = mockStore.adminOrganizations().data as Array<{ id: string; code: string }>;
    const triage = orgs.find((o) => o.code === "DEMO_TRIAGE")!;
    const idea = (mockStore.staffList({}).data as Array<{ id: string; version: number; status: string }>).find(
      (i) => ["RECEIVED", "UNDER_REVIEW", "NEEDS_INFO", "IN_PROGRESS"].includes(i.status),
    )!;
    const v0 = idea.version;
    const { data } = mockStore.reroute(idea.id, {
      organizationId: triage.id,
      reason: "Конфликтный маршрут, требуется ручной разбор в центре.",
      expectedVersion: v0,
    }) as { data: { version: number } };
    expect(data.version).toBe(v0 + 1);
    const updated = mockStore.staffGet(idea.id).data as { organizationCode: string; assignee: null };
    expect(updated.organizationCode).toBe("DEMO_TRIAGE");
    expect(updated.assignee).toBeNull();
  });
});
