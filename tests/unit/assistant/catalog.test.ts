import { describe, expect, it } from "vitest";
import { availableActions, buildKnowledge, fallbackReply } from "@/features/assistant/catalog.mjs";
import type { AssistantContext } from "@/features/assistant/types";

describe("assistant navigation boundaries", () => {
  const staffPage: AssistantContext = { page: "staff-detail", targets: ["staff-public-reply", "staff-internal-note", "staff-status-actions", "admin-reroute"] };
  it("a guest cannot obtain staff actions by claiming a staff screen", () => {
    const actions = availableActions("GUEST", staffPage, "ru");
    expect(actions.some((action) => action.path?.startsWith("/staff") || action.kind === "highlight")).toBe(false);
    expect(buildKnowledge("GUEST")).not.toContain("INTERNAL-заметка");
  });
  it("staff can find their own forms but only administrators can reroute", () => {
    expect(availableActions("STAFF", staffPage, "kk").map((a) => a.id)).toContain("show-staff-public-reply");
    expect(availableActions("STAFF", staffPage, "ru").map((a) => a.id)).not.toContain("show-admin-reroute");
    expect(availableActions("ADMIN", staffPage, "ru").map((a) => a.id)).toContain("show-admin-reroute");
  });
  it("a target must be registered on the current page and appropriate to the role", () => {
    const actions = availableActions("CITIZEN", { page: "idea-new", step: 1, targets: ["idea-problem", "staff-public-reply", "unknown-target"] }, "ru");
    expect(actions.filter((a) => a.kind === "highlight").map((a) => a.target)).toEqual(["idea-problem"]);
    expect(actions.every((a) => !a.path || a.path.startsWith("/") && !a.path.startsWith("//"))).toBe(true);
  });
  it.each(["Как отправить ответ?", "Что означает статус?", "Как ответить на уточнение?"])("staff fallback stays in the staff workflow: %s", (question) => {
    const reply = fallbackReply(question, "STAFF", staffPage, "ru");
    expect(reply.answer).not.toContain("Мои идеи");
    expect(reply.actions.some((a) => a.target?.startsWith("staff-"))).toBe(true);
    expect(reply.mode).toBe("guide");
  });
  it("Kazakh fallback explains the map and uses registered targets", () => {
    const context: AssistantContext = { page: "idea-new", step: 2, mapEditing: true, targets: ["idea-location-map", "idea-territory"] };
    const reply = fallbackReply("Картада орынды қалай белгілеймін?", "CITIZEN", context, "kk");
    expect(reply.answer).toContain("растаңыз");
    expect(reply.actions[0]?.target).toBe("idea-location-map");
    expect(reply.language).toBe("kk");
  });
});
