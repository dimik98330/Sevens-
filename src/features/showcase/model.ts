import { CategoryCode, IdeaStatus } from "@/contracts";
import type { PublicIdea } from "@/contracts/showcase";

export type ShowcaseSort = "popular" | "newest" | "updated";
export interface ShowcaseFilters {
  q: string; category: string; territoryId: string; status: string;
  sort: ShowcaseSort; following: boolean; page: number;
}
export const INITIAL_FILTERS: ShowcaseFilters = { q: "", category: "", territoryId: "", status: "", sort: "popular", following: false, page: 1 };
const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

export function parseShowcaseFilters(params: Pick<URLSearchParams, "get">): ShowcaseFilters {
  const category = params.get("category") || "";
  const status = params.get("status") || "";
  const territoryId = params.get("territory") || "";
  const sort = params.get("sort");
  const page = Number(params.get("page") || 1);
  return {
    q: Array.from((params.get("q") || "").normalize("NFC").trim()).slice(0, 100).join(""),
    category: CategoryCode.includes(category as typeof CategoryCode[number]) ? category : "",
    territoryId: uuid.test(territoryId) ? territoryId : "",
    status: status !== "DRAFT" && IdeaStatus.includes(status as typeof IdeaStatus[number]) ? status : "",
    sort: sort === "newest" || sort === "updated" ? sort : "popular",
    following: params.get("following") === "true", page: Number.isSafeInteger(page) && page > 0 && page <= 1_000_000 ? page : 1,
  };
}

export function showcaseQuery(filters: ShowcaseFilters, forApi = false): string {
  const params = new URLSearchParams();
  for (const key of ["q", "category", "status"] as const) if (filters[key]) params.set(key, filters[key]);
  if (filters.territoryId) params.set("territory", filters.territoryId);
  if (filters.sort !== "popular") params.set("sort", filters.sort);
  if (filters.following) params.set("following", "true");
  if (filters.page > 1) params.set("page", String(filters.page));
  if (forApi) params.set("pageSize", "9");
  return params.toString();
}

export function safeDashboardBack(value: string | null): string {
  if (!value || !value.startsWith("/dashboard?") || value.includes("#")) return "/dashboard";
  return `/dashboard?${showcaseQuery(parseShowcaseFilters(new URLSearchParams(value.slice(11))))}`;
}

export type StageState = "done" | "current" | "future" | "skipped" | "paused" | "negative";
export function publicStages(idea: Pick<PublicIdea, "status" | "resolutionType">): StageState[] {
  switch (idea.status) {
    case "RECEIVED": return ["current", "future", "future", "future"];
    case "UNDER_REVIEW": return ["done", "current", "future", "future"];
    case "NEEDS_INFO": return ["done", "paused", "future", "future"];
    case "IN_PROGRESS": return ["done", "done", "current", "future"];
    case "REJECTED": return ["done", "done", "skipped", "negative"];
    case "COMPLETED": return ["done", "done", idea.resolutionType === "IMPLEMENTED" ? "done" : "skipped", "done"];
  }
}

export function hasShowcaseFilters(filters: ShowcaseFilters): boolean {
  return !!(filters.q || filters.category || filters.territoryId || filters.status);
}
