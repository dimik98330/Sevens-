import { describe, expect, it } from "vitest";
import { threadFromTimeline } from "@/features/shared/data";

describe("comment attribution from server timeline", () => {
  it("preserves the real name, role and sender ID for both sides", () => {
    const rows = threadFromTimeline([
      { id: "question", visibility: "PUBLIC", body: "Уточните, пожалуйста, расположение перехода.", createdAt: "2026-09-30T10:00:00Z", authorId: "staff-id", authorDisplayName: "Айгуль Садыкова", authorRole: "STAFF", commentKind: "CLARIFICATION_QUESTION" },
      { id: "answer", visibility: "PUBLIC", body: "Переход находится рядом с главным входом школы.", createdAt: "2026-09-30T10:05:00Z", authorId: "resident-id", authorDisplayName: "Арман Омаров", authorRole: "CITIZEN", commentKind: "CLARIFICATION_ANSWER" },
    ], false);
    expect(rows.map((r) => [r.author, r.authorRole, r.authorId, r.kind])).toEqual([
      ["Айгуль Садыкова", "STAFF", "staff-id", "CLARIFICATION_QUESTION"],
      ["Арман Омаров", "CITIZEN", "resident-id", "CLARIFICATION_ANSWER"],
    ]);
  });
  it("never turns internal or unlabelled events into public messages", () => {
    const events = [
      { id: "private", visibility: "INTERNAL", body: "Только коллегам", authorDisplayName: "Сотрудник", authorRole: "STAFF" },
      { id: "unknown", body: "Видимость не подтверждена" },
    ];
    expect(threadFromTimeline(events, false)).toEqual([]);
    expect(threadFromTimeline(events, true).map((r) => r.id)).toEqual(["private"]);
  });
  it("does not display truncated UUIDs as legacy author names", () => {
    const row = threadFromTimeline([{ id: "legacy", actorId: "12345678-abcd-abcd-abcd-123456789012", visibility: "PUBLIC", body: "Принято", type: "COMMENT_PUBLIC" }], true)[0];
    expect(row?.author).toBe("");
    expect(row?.authorRole).toBeNull();
    expect(row?.authorId).toBeUndefined();
  });
  it("an internal comment linked to a public event remains an internal staff note", () => {
    const events = [{ id: "mismatched", visibility: "PUBLIC", commentVisibility: "INTERNAL", body: "Для коллег", authorRole: "STAFF" }];
    expect(threadFromTimeline(events, false)).toEqual([]);
    expect(threadFromTimeline(events, true)[0]?.visibility).toBe("INTERNAL");
  });
  it("a public comment linked to an internal event also stays staff-only", () => {
    const events = [{ id: "hidden-event", visibility: "INTERNAL", commentVisibility: "PUBLIC", body: "Скрытый от жителя текст", authorRole: "STAFF" }];
    expect(threadFromTimeline(events, false)).toEqual([]);
    expect(threadFromTimeline(events, true)[0]?.visibility).toBe("INTERNAL");
  });
  it("ignores unknown roles and retains body text and source order", () => {
    const rows = threadFromTimeline([{ id: "second", visibility: "PUBLIC", authorRole: "SUPERUSER", body: "Строка 1\nСтрока 2" }, { id: "first", visibility: "PUBLIC", body: "Другой ответ" }], true);
    expect(rows.map((r) => r.id)).toEqual(["second", "first"]);
    expect(rows[0]?.authorRole).toBeNull();
    expect(rows[0]?.body).toBe("Строка 1\nСтрока 2");
  });
});
