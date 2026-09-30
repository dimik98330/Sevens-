import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RouteCard } from "@/components/ui/RouteCard";
import { api } from "@/features/shared/api-client";
import { store, type ServerRoutingPreviewResult } from "@/features/shared/data";
import { RoutingPreviewController, serverPreviewInput, type PreviewState } from "@/features/shared/use-routing-preview";
import type { RoutingPreviewInput } from "@/contracts";

const territoryId = "11111111-1111-4111-8111-111111111111";
const draft = { title: "Умные светофоры возле школы", problem: "Возле школы дорога перегружена, детям опасно переходить улицу.",
  solution: "Установить умные светофоры и датчики загруженности дороги возле школы.", requested: "AUTO", territoryId };
const catalog = { categories: ["TRANSPORT", "UTILITIES"], territories: [{ id: territoryId }] };
const input = serverPreviewInput(draft, catalog) as RoutingPreviewInput;
const route: ServerRoutingPreviewResult = { source: "RULES", ruleVersion: "hybrid-v2", effectiveCategoryCode: "TRANSPORT",
  detectedCategoryCode: "TRANSPORT", organizationCode: "DEMO_TRANSPORT", mode: "ASSIGNED", confidenceBand: "HIGH",
  tags: [], reasonCodes: [], explanation: "Текст идеи относится к транспорту.", classificationSource: "MODEL", classifierStatus: "READY" };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("paid routing preview admission and cancellation", () => {
  it("requires all server text bounds, a real catalog UUID and an accepted category", () => {
    expect(input.requestedCategoryCode).toBeNull();
    expect(serverPreviewInput({ ...draft, requested: "UTILITIES" }, catalog)?.requestedCategoryCode).toBe("UTILITIES");
    expect(serverPreviewInput(draft, null)).toBeNull();
    expect(serverPreviewInput({ ...draft, territoryId: "DEMO_SEMEY" },
      { ...catalog, territories: [{ id: "DEMO_SEMEY" }] })).toBeNull();
    expect(serverPreviewInput({ ...draft, territoryId: "22222222-2222-4222-8222-222222222222" }, catalog)).toBeNull();
    for (const [field, value] of [["title", "short"], ["title", "a".repeat(121)],
      ["problem", "a".repeat(29)], ["solution", "a".repeat(3001)], ["requested", "TYPO"]]) {
      expect(serverPreviewInput({ ...draft, [field as string]: value }, catalog)).toBeNull();
    }
  });

  it("does not request before review or for incomplete input, and coalesces changes for 500ms", async () => {
    vi.useFakeTimers();
    const load = vi.fn().mockResolvedValue(route);
    const states: PreviewState[] = [];
    const controller = new RoutingPreviewController(load, (state) => states.push(state));
    controller.update(input, false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(load).not.toHaveBeenCalled();
    controller.update(null, true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(load).not.toHaveBeenCalled();
    expect(states.at(-1)?.status).toBe("incomplete");
    controller.update(input, true);
    await vi.advanceTimersByTimeAsync(400);
    controller.update({ ...input, title: "Обновлённое название идеи" }, true);
    await vi.advanceTimersByTimeAsync(499);
    expect(load).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(load).toHaveBeenCalledOnce();
    expect(load.mock.calls[0]?.[0].title).toBe("Обновлённое название идеи");
    expect(states.at(-1)?.status).toBe("ready");
    controller.dispose();
  });

  it("ignores stale responses even when transport ignores abort, and cancels on leaving/unmount", async () => {
    vi.useFakeTimers();
    const first = deferred<ServerRoutingPreviewResult>();
    const second = deferred<ServerRoutingPreviewResult>();
    const third = deferred<ServerRoutingPreviewResult>();
    const load = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockReturnValueOnce(third.promise);
    const states: PreviewState[] = [];
    const controller = new RoutingPreviewController(load, (state) => states.push(state));
    controller.update(input, true);
    await vi.advanceTimersByTimeAsync(500);
    const firstSignal = load.mock.calls[0]?.[1] as AbortSignal;
    controller.update({ ...input, requestedCategoryCode: "UTILITIES" }, true);
    expect(firstSignal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(500);
    const newer = { ...route, effectiveCategoryCode: "UTILITIES" as const };
    second.resolve(newer);
    await vi.advanceTimersByTimeAsync(0);
    first.resolve(route);
    await vi.advanceTimersByTimeAsync(0);
    expect(states.at(-1)?.route).toEqual(newer);
    controller.update(input, true);
    await vi.advanceTimersByTimeAsync(500);
    const thirdSignal = load.mock.calls[2]?.[1] as AbortSignal;
    controller.update(input, false);
    expect(thirdSignal.aborted).toBe(true);
    const count = states.length;
    controller.dispose();
    third.reject(new Error("late network failure"));
    await vi.advanceTimersByTimeAsync(0);
    expect(states).toHaveLength(count);
    expect(states.at(-1)?.status).toBe("idle");
  });

  it("network failures publish unavailable without a locally invented route", async () => {
    vi.useFakeTimers();
    const states: PreviewState[] = [];
    const controller = new RoutingPreviewController(vi.fn().mockRejectedValue(new Error("network")), (state) => states.push(state));
    controller.update(input, true);
    await vi.advanceTimersByTimeAsync(500);
    expect(states.at(-1)).toEqual({ status: "unavailable", route: null });
    controller.dispose();
  });

  it("data facade always calls the real preview endpoint and forwards its AbortSignal", async () => {
    const signal = new AbortController().signal;
    const post = vi.spyOn(api, "post").mockResolvedValue({ data: route, meta: { preview: true } });
    const result = await store.routingPreview(input, signal);
    expect(post).toHaveBeenCalledExactlyOnceWith("/api/v1/ideas/routing-preview", input, { signal });
    expect(result.data.ruleVersion).toBe("hybrid-v2");
  });
});

describe("route evidence displayed to citizens", () => {
  it("keeps detected confidence separate from the author's different applied category", () => {
    const html = renderToStaticMarkup(createElement(RouteCard, { route: { ...route, effectiveCategoryCode: "UTILITIES", mode: "TRIAGE" } }));
    expect(html).toContain("Категория заявки:");
    expect(html).toContain("ЖКХ");
    expect(html).toContain("Тема по тексту:");
    expect(html).toContain("Транспорт");
    expect(html).toContain("Уверенность подсказки:");
    expect(html).toContain("Категория заявки отличается от подсказки");
    expect(html).not.toContain("Выбранная вами");
    expect(html).not.toMatch(/\d+%/);
  });

  it("null detected topic claims no confidence for the author's category and states fallback plainly", () => {
    const html = renderToStaticMarkup(createElement(RouteCard, { route: {
      ...route, detectedCategoryCode: null, classifierStatus: "FALLBACK", classificationSource: "RULES",
    } }));
    expect(html).toContain("нужна оценка специалиста");
    expect(html).toContain("подсказка построена по правилам");
    expect(html).not.toContain("Уверенность подсказки:");
    expect(html).not.toContain("определено уверенно");
  });

  it("automatic triage does not invent an author category choice or multiple requested goals", () => {
    const html=renderToStaticMarkup(createElement(RouteCard,{route:{...route,
      effectiveCategoryCode:"OTHER",detectedCategoryCode:"UTILITIES",mode:"TRIAGE"}}));
    expect(html).toContain("Направление требует уточнения");
    expect(html).not.toContain("Выбранная вами");
    expect(html).not.toContain("Несколько направлений");
  });

  it("human rerouting does not claim a specialist's category was chosen by the author", () => {
    const html = renderToStaticMarkup(createElement(RouteCard, { route: {
      ...route, source: "HUMAN", effectiveCategoryCode: "UTILITIES",
    } }));
    expect(html).toContain("Категория уточнена сотрудником");
    expect(html).not.toContain("Выбранная вами категория сохранена");
  });
});
