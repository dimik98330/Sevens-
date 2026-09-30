import { describe, expect, it } from "vitest";
import { buildKnowledge, fallbackReply, pageForPath } from "@/features/assistant/catalog.mjs";

describe("assistant explains the public showcase", () => {
  it("recognizes both public routes", () => {
    expect(pageForPath("/dashboard")).toBe("dashboard");
    expect(pageForPath("/dashboard/123")).toBe("dashboard-detail");
  });
  it("describes opt-in publication without claiming private ideas are open", () => {
    const knowledge = buildKnowledge("GUEST");
    expect(knowledge).toContain("/dashboard");
    expect(knowledge).toContain("согласия автора");
    expect(knowledge).not.toContain("Нет публичного каталога чужих идей");
  });
  it("offers guests only permitted navigation for supporting ideas", () => {
    const result = fallbackReply("Как поддержать идею?", "GUEST", {page:"home",targets:[]}, "ru");
    expect(result.actions.some((action) => action.path === "/dashboard")).toBe(true);
    expect(result.actions.some((action) => action.path === "/login")).toBe(true);
    expect(result.actions.every((action) => action.kind === "navigate" && !action.path?.startsWith("/staff"))).toBe(true);
    expect(result.mode).toBe("guide");
  });
  it("explains following in the selected language", () => {
    expect(fallbackReply("follow", "CITIZEN", {page:"dashboard",targets:[]}, "en").answer).toContain("follow its updates");
    expect(fallbackReply("қолдау", "GUEST", {page:"dashboard",targets:[]}, "kk").answer).toContain("тұрғын ретінде");
  });
});
