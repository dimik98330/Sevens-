"use client";

import { useEffect, useState } from "react";
import { CategoryCode, type RoutingPreviewInput } from "@/contracts";
import { store, type ServerRoutingPreviewResult } from "./data";

export interface PreviewState {
  status: "idle" | "incomplete" | "waiting" | "ready" | "unavailable";
  route: ServerRoutingPreviewResult | null;
}
type LoadPreview = (input: RoutingPreviewInput, signal: AbortSignal) => Promise<ServerRoutingPreviewResult>;

// Validate full server bounds, including an actual catalog UUID. A territory
// code or a locally invented catalog must never feed production classification.
export function serverPreviewInput(
  draft: { title: string; problem: string; solution: string; requested: string; territoryId: string },
  catalog: { categories: string[]; territories: Array<{ id?: string }> } | null,
): RoutingPreviewInput | null {
  const title = draft.title.normalize("NFC").trim();
  const problem = draft.problem.normalize("NFC").trim();
  const solution = draft.solution.normalize("NFC").trim();
  const within = (text: string, min: number, max: number) => [...text].length >= min && [...text].length <= max;
  const selected = catalog?.territories.find((territory) => territory.id === draft.territoryId);
  if (!selected?.id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(selected.id)
    || !within(title, 10, 120) || !within(problem, 30, 3000) || !within(solution, 30, 3000)) return null;
  const requested = draft.requested === "AUTO" ? null : draft.requested;
  if (requested !== null && (!CategoryCode.some((code) => code === requested) || !catalog?.categories.includes(requested))) return null;
  return { title, problem, solution, territoryId: selected.id,
    requestedCategoryCode: requested as RoutingPreviewInput["requestedCategoryCode"] };
}

// The same controller is exercised in node tests: debounce, cancellation and
// generation checks protect against transports that ignore AbortSignal.
export class RoutingPreviewController {
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private abort: AbortController | undefined;
  private disposed = false;
  constructor(private load: LoadPreview, private publish: (state: PreviewState) => void, private debounceMs = 500) {}

  update(input: RoutingPreviewInput | null, enabled: boolean) {
    this.cancel();
    if (this.disposed) return;
    if (!enabled || !input) {
      this.publish({ status: enabled ? "incomplete" : "idle", route: null });
      return;
    }
    const generation = this.generation;
    const abort = new AbortController();
    this.abort = abort;
    this.publish({ status: "waiting", route: null });
    this.timer = setTimeout(async () => {
      try {
        const route = await this.load(input, abort.signal);
        if (!this.disposed && !abort.signal.aborted && this.generation === generation) {
          this.publish({ status: "ready", route });
        }
      } catch {
        if (!this.disposed && !abort.signal.aborted && this.generation === generation) {
          this.publish({ status: "unavailable", route: null });
        }
      }
    }, this.debounceMs);
  }

  private cancel() {
    this.generation++;
    clearTimeout(this.timer);
    this.abort?.abort();
  }

  dispose() { this.cancel(); this.disposed = true; }
}

export function useRoutingPreview(input: RoutingPreviewInput | null, enabled: boolean): PreviewState {
  const key = input ? JSON.stringify(input) : "";
  const [snapshot, setSnapshot] = useState<{ key: string; state: PreviewState } | null>(null);
  useEffect(() => {
    const controller = new RoutingPreviewController(
      async (body, signal) => (await store.routingPreview(body, signal)).data,
      (state) => setSnapshot({ key, state }),
    );
    controller.update(key ? JSON.parse(key) as RoutingPreviewInput : null, enabled);
    return () => controller.dispose();
  }, [key, enabled]);
  // Never paint the previous text's result while React schedules cleanup.
  if (!enabled) return { status: "idle", route: null };
  if (!key) return { status: "incomplete", route: null };
  return snapshot?.key === key ? snapshot.state : { status: "waiting", route: null };
}
