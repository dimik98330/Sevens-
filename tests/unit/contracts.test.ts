import { describe, expect, it } from "vitest";
import {
  CategoryCode,
  errEnvelope,
  IdeaStatus,
  okEnvelope,
  problemSchema,
  requestedCategorySchema,
  Role,
  titleSchema,
} from "../../src/contracts";

describe("contract enums", () => {
  it("keeps the six user-facing statuses without renaming", () => {
    expect(IdeaStatus).toContain("RECEIVED");
    expect(IdeaStatus).toContain("UNDER_REVIEW");
    expect(IdeaStatus).toContain("NEEDS_INFO");
    expect(IdeaStatus).toContain("IN_PROGRESS");
    expect(IdeaStatus).toContain("COMPLETED");
    expect(IdeaStatus).toContain("REJECTED");
  });

  it("has exactly three roles", () => {
    expect([...Role].sort()).toEqual(["ADMIN", "CITIZEN", "STAFF"]);
  });

  it("never accepts the literal AUTO string as a category", () => {
    expect((CategoryCode as readonly string[]).includes("AUTO")).toBe(false);
    expect(requestedCategorySchema.safeParse(null).success).toBe(true);
    expect(requestedCategorySchema.safeParse("AUTO").success).toBe(false);
    expect(requestedCategorySchema.safeParse("TRANSPORT").success).toBe(true);
  });
});

describe("form validation (FR-02 limits)", () => {
  it("rejects a short title, accepts a valid one", () => {
    expect(titleSchema.safeParse("Тест").success).toBe(false);
    expect(titleSchema.safeParse("Умные светофоры у школы").success).toBe(true);
  });

  it("trims before measuring", () => {
    const r = titleSchema.safeParse("   Умные светофоры у школы   ");
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toBe("Умные светофоры у школы");
  });

  it("requires a substantive problem description", () => {
    expect(problemSchema.safeParse("Плохо всё.").success).toBe(false);
    expect(
      problemSchema.safeParse(
        "Возле школы дорога требует внимания к безопасности детей утром.",
      ).success,
    ).toBe(true);
  });
});

describe("API envelope (03 §5)", () => {
  it("wraps success as data + meta.requestId", () => {
    const env = okEnvelope({ id: "x", version: 3 }, "req_1");
    expect(env.data).toEqual({ id: "x", version: 3 });
    expect(env.meta.requestId).toBe("req_1");
  });

  it("wraps errors as error.code/message + meta.requestId", () => {
    const env = errEnvelope("VALIDATION_ERROR", "Проверьте форму", "req_2", {
      solution: "Минимум 30 символов",
    });
    expect(env.error.code).toBe("VALIDATION_ERROR");
    expect(env.error.fields?.solution).toContain("30");
    expect(env.meta.requestId).toBe("req_2");
  });
});
