import { describe, expect, it } from "vitest";
import { getIdeaGuidance, getIdeaRoutingContext } from "@/features/shared/idea-guidance";

describe("current responsibility in citizen and staff cabinets", () => {
  it("asks the author to act only for a draft or a clarification request", () => {
    expect(getIdeaGuidance("DRAFT").actor).toBe("AUTHOR");
    expect(getIdeaGuidance("NEEDS_INFO").actor).toBe("AUTHOR");
    expect(getIdeaGuidance("NEEDS_INFO").citizenActionLabel).toBe("Ответить на вопрос");
    for (const status of ["RECEIVED", "UNDER_REVIEW", "IN_PROGRESS"] as const) {
      expect(getIdeaGuidance(status).actor).toBe("STAFF");
    }
    for (const status of ["COMPLETED", "REJECTED"] as const) {
      expect(getIdeaGuidance(status).actor).toBe("DONE");
    }
  });

  it("keeps the actual assigned destination even when it differs from the topic", () => {
    const idea = { effectiveCategoryCode: "TRANSPORT", organizationCode: "DEMO_TRIAGE",
      assigneeDisplayName: "Айдана", routing: { explanation: "Направление уточнено после проверки." } };
    expect(getIdeaRoutingContext(idea)).toEqual({ organizationCode: "DEMO_TRIAGE",
      assigneeName: "Айдана", explanation: "Направление уточнено после проверки." });
  });

  it("does not invent a destination or a person when the API exposes neither", () => {
    const idea = { effectiveCategoryCode: "TRANSPORT", organizationCode: null, assigneeDisplayName: null };
    expect(getIdeaRoutingContext(idea)).toEqual({ organizationCode: null, assigneeName: null, explanation: null });
  });

  it("supports the existing detail route and mock assignee without displaying identifiers", () => {
    expect(getIdeaRoutingContext({ routing: { organizationCode: "DEMO_ECOLOGY", explanation: "  Окружающая среда. " },
      assignee: { name: " Марат " } })).toEqual({ organizationCode: "DEMO_ECOLOGY", assigneeName: "Марат",
      explanation: "Окружающая среда." });
  });
});
