import { describe, expect, it } from "vitest";
import { parseApiError, newIdempotencyKey } from "@/features/shared/api-client";
import { TRANSITIONS, isTransitionAllowed, REQUIRES_PUBLIC_COMMENT } from "@/contracts/transitions.mjs";
import { confidenceLabel, routeIdea } from "@/domain/routing/rules";
import { DEV_CATALOG } from "@/features/shared/mock";
import ru from "@/locales/ru.json";

// C-01: клиент говорит на замороженных контрактах A/B/D, своих статусов не выдумывает.
describe("api-client error mapping (03 §5)", () => {
  it("parses 409 VERSION_CONFLICT with fields", () => {
    const e = parseApiError(409, {
      error: { code: "VERSION_CONFLICT", message: "x" },
      meta: { requestId: "req_1" },
    });
    expect(e.code).toBe("VERSION_CONFLICT");
    expect(e.http).toBe(409);
    expect(e.requestId).toBe("req_1");
  });

  it("keeps 401/403/404 distinguishable for UI states", () => {
    expect(parseApiError(401, { error: { code: "UNAUTHENTICATED", message: "m" } }).code).toBe("UNAUTHENTICATED");
    expect(parseApiError(403, { error: { code: "FORBIDDEN", message: "m" } }).code).toBe("FORBIDDEN");
    expect(parseApiError(404, { error: { code: "NOT_FOUND", message: "m" } }).code).toBe("NOT_FOUND");
  });

  it("generates unique idempotency keys per intent", () => {
    expect(newIdempotencyKey()).not.toBe(newIdempotencyKey());
  });
});

describe("transitions mirror (01 §12)", () => {
  it("shows only allowed buttons, never the full enum", () => {
    expect(TRANSITIONS.RECEIVED).toEqual(["UNDER_REVIEW"]);
    expect(isTransitionAllowed("RECEIVED", "COMPLETED")).toBe(false);
    expect(isTransitionAllowed("UNDER_REVIEW", "NEEDS_INFO")).toBe(true);
    expect(isTransitionAllowed("COMPLETED", "REJECTED")).toBe(false);
  });

  it("requires a public comment where the contract says so", () => {
    expect(REQUIRES_PUBLIC_COMMENT.has("NEEDS_INFO")).toBe(true);
    expect(REQUIRES_PUBLIC_COMMENT.has("COMPLETED")).toBe(true);
    expect(REQUIRES_PUBLIC_COMMENT.has("UNDER_REVIEW")).toBe(false);
  });
});

describe("routing labels (04 §4)", () => {
  it("renders confidence as words, never percents", () => {
    expect(confidenceLabel("HIGH")).toBe("определено уверенно");
    expect(confidenceLabel("MEDIUM")).toBe("стоит проверить");
    expect(confidenceLabel("LOW")).toBe("нужен специалист");
  });

  it("dev mock catalog routes the flagship case like D engine (R01)", () => {
    const r = routeIdea(
      {
        title: "Умные светофоры рядом со школой",
        problem: "Возле школы дорога требует внимания к безопасности детей.",
        solution: "Установить умные светофоры и датчики загруженности дороги.",
        requestedCategoryCode: null,
        territoryCode: "DEMO_SEMEY",
      },
      DEV_CATALOG,
    );
    expect(r.effectiveCategoryCode).toBe("TRANSPORT");
    expect(r.mode).toBe("ASSIGNED");
    expect(r.confidenceBand).toBe("HIGH");
  });

  it("covers all six user-facing statuses in ru.json", () => {
    for (const s of ["RECEIVED", "UNDER_REVIEW", "NEEDS_INFO", "IN_PROGRESS", "COMPLETED", "REJECTED"]) {
      expect((ru.statuses as Record<string, string>)[s]).toBeTruthy();
    }
  });
});
