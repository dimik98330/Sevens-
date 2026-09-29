// D-01: input/output contract of the deterministic routing engine (rules-v1).
// Pure data types only. The engine never touches the database, clock or network:
// B passes a catalog snapshot, the engine returns a decision, B persists it.

export type CategoryCode =
  | 'TRANSPORT'
  | 'UTILITIES'
  | 'EDUCATION'
  | 'ECOLOGY'
  | 'SAFETY'
  | 'HEALTH'
  | 'TOURISM'
  | 'ACCESSIBILITY'
  | 'OTHER';

export type RoutingMode = 'ASSIGNED' | 'TRIAGE';
export type ConfidenceBand = 'HIGH' | 'MEDIUM' | 'LOW';

export interface RoutingInput {
  title: string;
  problem: string;
  solution: string;
  // Null means AUTO (03 section 2). The literal string 'AUTO' must never
  // reach the engine: C converts it to null, B rejects it as 400.
  requestedCategoryCode: CategoryCode | null;
  territoryCode: string;
}

export interface CatalogTerritory {
  code: string;
  active: boolean;
}

export interface CatalogOrganization {
  code: string;
  name: string;
  active: boolean;
  isTriage: boolean;
}

export interface CatalogRoutingRule {
  categoryCode: CategoryCode;
  organizationCode: string;
  territoryCode: string | null;
  priority: number;
  active: boolean;
}

// Snapshot owned by B (repository adaptation). Exactly one active triage
// organization per region is expected (03 section 3.1).
export interface CatalogSnapshot {
  ruleVersion: 'rules-v1';
  territories: CatalogTerritory[];
  organizations: CatalogOrganization[];
  rules: CatalogRoutingRule[];
}

export interface RoutingEvidence {
  featureId: string;
  categoryCode: CategoryCode;
  weight: number;
}

export interface RoutingDecision {
  source: 'RULES';
  ruleVersion: 'rules-v1';
  effectiveCategoryCode: CategoryCode;
  organizationCode: string;
  mode: RoutingMode;
  confidenceBand: ConfidenceBand;
  tags: string[];
  scores: Partial<Record<CategoryCode, number>>;
  evidence: RoutingEvidence[];
  reasonCodes: string[];
  // Plain-text RU explanation built from dictionary labels and catalog names
  // only. Never contains user input. C must still render it as a text node.
  explanation: string;
}

// Optional routing context per A-01 DECISION (required by fixtures R12/R13
// and 04 section 2). Test-harness-only knobs mirroring `contextOverrides`
// in routing-cases.json: never populated from production requests, and the
// engine behaves identically when the argument is omitted.
export interface RoutingContext {
  disabledOrganizationCodes?: string[];
  conflictingCategoryRoute?: CategoryCode;
}

export interface ManualRouteInput {
  organizationCode: string;
  effectiveCategoryCode: CategoryCode;
  // 10..1000 Unicode code points, stored by B in history, not embedded
  // into `explanation` so the explanation stays free of user text.
  reason: string;
  priorCategoryCode?: CategoryCode;
  priorConfidenceBand?: ConfidenceBand;
}

export interface ManualRouteDecision {
  source: 'HUMAN';
  ruleVersion: 'rules-v1';
  effectiveCategoryCode: CategoryCode;
  organizationCode: string;
  mode: RoutingMode;
  confidenceBand: ConfidenceBand;
  reasonCodes: string[];
  reason: string;
  explanation: string;
}

// Thrown for caller-side problems. B maps it to 400 VALIDATION_ERROR with
// `errors.fields[field]` so the form can point at the exact field.
export class RoutingInputError extends Error {
  declare field: string;

  constructor(field: string, message: string) {
    super(message);
    this.name = 'RoutingInputError';
    this.field = field;
  }
}
