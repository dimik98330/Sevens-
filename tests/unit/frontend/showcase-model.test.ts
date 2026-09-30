import { describe, expect, it } from "vitest";
import { parseShowcaseFilters, publicStages, safeDashboardBack, showcaseQuery } from "@/features/showcase/model";

describe("public showcase navigation", () => {
  it("round-trips search, real territory UUID, sort, followed tab and pagination", () => {
    const query = "q=Жарық&category=UTILITIES&territory=f06bbf6c-99af-4441-a333-9263377debc1&status=IN_PROGRESS&sort=updated&following=true&page=3";
    const filters = parseShowcaseFilters(new URLSearchParams(query));
    expect(filters.territoryId).toBe("f06bbf6c-99af-4441-a333-9263377debc1");
    expect(filters.following).toBe(true);
    expect(parseShowcaseFilters(new URLSearchParams(showcaseQuery(filters)))).toEqual(filters);
    expect(new URLSearchParams(showcaseQuery(filters, true)).get("pageSize")).toBe("9");
  });
  it("discards private draft status, territory codes, invalid enums and unsafe pages", () => {
    expect(parseShowcaseFilters(new URLSearchParams("category=secret&territory=DEMO_SEMEY&status=DRAFT&sort=sql&page=-1"))).toMatchObject({ category: "", territoryId: "", status: "", sort: "popular", page: 1 });
  });
  it("only returns to the local public list and canonicalizes its filters", () => {
    expect(safeDashboardBack("https://attacker.test")).toBe("/dashboard");
    expect(safeDashboardBack("//attacker.test/dashboard")).toBe("/dashboard");
    expect(safeDashboardBack("/ideas/private")).toBe("/dashboard");
    expect(safeDashboardBack("/dashboard?following=true&page=2&unknown=secret")).toBe("/dashboard?following=true&page=2");
  });
});

describe("truthful public status stages", () => {
  it("does not imply implementation when review ends with a final answer or planned pilot", () => {
    expect(publicStages({ status: "COMPLETED", resolutionType: "ANSWER_PROVIDED" })).toEqual(["done", "done", "skipped", "done"]);
    expect(publicStages({ status: "COMPLETED", resolutionType: "PILOT_PLANNED" })[2]).toBe("skipped");
    expect(publicStages({ status: "COMPLETED", resolutionType: "IMPLEMENTED" })[2]).toBe("done");
  });
  it("distinguishes clarification, active work and rejection", () => {
    expect(publicStages({ status: "NEEDS_INFO", resolutionType: null })[1]).toBe("paused");
    expect(publicStages({ status: "IN_PROGRESS", resolutionType: null })[2]).toBe("current");
    expect(publicStages({ status: "REJECTED", resolutionType: null })).toEqual(["done", "done", "skipped", "negative"]);
  });
});
