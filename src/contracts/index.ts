import { z } from "zod";

// Single source of truth for enums — 03_DATA_API_CONTRACTS §2.
// JSON uses camelCase; DB uses snake_case. `AUTO` exists only in the form:
// on the API, requestedCategoryCode: null means automatic routing.

export const Role = ["CITIZEN", "STAFF", "ADMIN"] as const;
export type Role = (typeof Role)[number];

export const IdeaStatus = [
  "DRAFT",
  "RECEIVED",
  "UNDER_REVIEW",
  "NEEDS_INFO",
  "IN_PROGRESS",
  "COMPLETED",
  "REJECTED",
] as const;
export type IdeaStatus = (typeof IdeaStatus)[number];

export const CategoryCode = [
  "TRANSPORT",
  "UTILITIES",
  "EDUCATION",
  "ECOLOGY",
  "SAFETY",
  "HEALTH",
  "TOURISM",
  "ACCESSIBILITY",
  "OTHER",
] as const;
export type CategoryCode = (typeof CategoryCode)[number];

export const CommentVisibility = ["PUBLIC", "INTERNAL"] as const;
export type CommentVisibility = (typeof CommentVisibility)[number];

export const RoutingMode = ["ASSIGNED", "TRIAGE"] as const;
export type RoutingMode = (typeof RoutingMode)[number];

export const ConfidenceBand = ["HIGH", "MEDIUM", "LOW"] as const;
export type ConfidenceBand = (typeof ConfidenceBand)[number];

export const ResolutionType = [
  "ANSWER_PROVIDED",
  "PILOT_PLANNED",
  "IMPLEMENTED",
  "FORWARDED_EXTERNALLY",
] as const;
export type ResolutionType = (typeof ResolutionType)[number];

export const ErrorCode = [
  "VALIDATION_ERROR",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "CSRF_INVALID",
  "NOT_FOUND",
  "VERSION_CONFLICT",
  "INVALID_TRANSITION",
  "IDEMPOTENCY_CONFLICT",
  "FILE_TOO_LARGE",
  "UNSUPPORTED_FILE_TYPE",
  "RATE_LIMITED",
  "SERVICE_UNAVAILABLE",
] as const;
export type ErrorCode = (typeof ErrorCode)[number];

export const RoleSchema = z.enum(Role);
export const IdeaStatusSchema = z.enum(IdeaStatus);
export const CategoryCodeSchema = z.enum(CategoryCode);
export const CommentVisibilitySchema = z.enum(CommentVisibility);
export const RoutingModeSchema = z.enum(RoutingMode);
export const ConfidenceBandSchema = z.enum(ConfidenceBand);
export const ResolutionTypeSchema = z.enum(ResolutionType);

// FR-02 limits. Strings are validated after trim; NFC-normalized.
// Lengths are counted in Unicode code points, not UTF-16 units.
export function normalizeText(value: string): string {
  return value.normalize("NFC").trim();
}

export function codePointLength(value: string): number {
  return Array.from(value.normalize("NFC")).length;
}

function boundedText(minCp: number, maxCp: number, field: string) {
  return z
    .string()
    .transform((s) => s.normalize("NFC").trim())
    .refine(
      (s) => {
        const n = Array.from(s).length;
        return n >= minCp && n <= maxCp;
      },
      { message: `${field}: нужно ${minCp}–${maxCp} символов` },
    );
}

function optionalText(maxCp: number, field: string) {
  return z
    .string()
    .max(8000, { message: `${field}: слишком длинный текст` })
    .transform((s) => s.normalize("NFC").trim())
    .refine((s) => Array.from(s).length <= maxCp, {
      message: `${field}: максимум ${maxCp} символов`,
    })
    .optional();
}

export const titleSchema = boundedText(10, 120, "Название");
export const problemSchema = boundedText(30, 3000, "Описание проблемы");
export const solutionSchema = boundedText(30, 3000, "Предлагаемое решение");
export const benefitSchema = optionalText(1000, "Ожидаемая польза");
export const locationTextSchema = optionalText(300, "Место подробнее");

// Optional on draft writes, nullable on reads. Omitted PATCH preserves the
// stored shape; null clears it. Server enforces exact shape, topology and
// full inclusion in Abai. See docs/design/location-contract.md.
export type LocationPosition = [longitude: number, latitude: number];
export type LocationGeometry =
  | { type: "Point"; coordinates: LocationPosition }
  | { type: "LineString"; coordinates: LocationPosition[] }
  | { type: "Polygon"; coordinates: [LocationPosition[]] };

// null = AUTO (author lets the rules decide). The literal string "AUTO"
// must never be sent to the API.
export const requestedCategorySchema = z.union([
  CategoryCodeSchema,
  z.null(),
]);

export interface RoutingPreviewInput {
  title: string; problem: string; solution: string;
  requestedCategoryCode: CategoryCode | null; territoryId: string;
}
export interface RoutingPreviewResult {
  source: "RULES"; ruleVersion: string; effectiveCategoryCode: CategoryCode;
  organizationCode: string; mode: RoutingMode; confidenceBand: ConfidenceBand;
  tags: string[]; reasonCodes: string[]; explanation: string;
  detectedCategoryCode?: CategoryCode | null;
  catalogVersion?: string;
  classificationSource?: "MODEL" | "RULES";
  classifierStatus?: "READY" | "FALLBACK";
  classificationMethod?: "LLM" | "LOCAL_ML" | "RULES";
}
export interface AnalyticsSummary {
  total: number; byStatus: Partial<Record<IdeaStatus, number>>;
  byCategory: Partial<Record<CategoryCode, number>>;
  unassigned: number; triage: number; medianFirstReviewSeconds: number | null;
}
export interface ListMeta {
  requestId: string; page: number; pageSize: number; total: number;
  unreadCount?: number;
}

// API envelope — 03 §5.
export function okEnvelope<T>(data: T, requestId: string) {
  return { data, meta: { requestId } };
}

export function errEnvelope(
  code: ErrorCode,
  message: string,
  requestId: string,
  fields?: Record<string, string>,
) {
  return {
    error: { code, message, ...(fields ? { fields } : {}) },
    meta: { requestId },
  };
}
