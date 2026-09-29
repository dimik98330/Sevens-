// D-01: shared harness for JSON routing fixtures (subset semantics for
// tags/reasonCodes: fixtures list required entries, the engine may add
// SMART_CITY or warnings). Not a *.test.ts file: not picked up by vitest.
import { readFileSync } from 'node:fs';
import { expect } from 'vitest';
import { routeIdea } from '../../../src/domain/routing/rules';
import type {
  CatalogSnapshot,
  CategoryCode,
  RoutingContext,
} from '../../../src/domain/routing/types';

export interface FixtureCase {
  id: string;
  input: {
    title: string;
    problem: string;
    solution: string;
    requestedCategoryCode: CategoryCode | null;
    territoryCode: string;
  };
  expected: {
    effectiveCategoryCode: CategoryCode;
    organizationCode: string;
    mode: 'ASSIGNED' | 'TRIAGE';
    confidenceBand: 'HIGH' | 'MEDIUM' | 'LOW';
    requiredTags?: string[];
    requiredReasonCodes?: string[];
  };
  contextOverrides?: {
    disabledOrganizationCodes?: string[];
    conflictingCategoryRoute?: CategoryCode;
  };
}

export function loadCatalogFromSeed(): CatalogSnapshot {
  const seed = JSON.parse(
    readFileSync(new URL('../../../fixtures/demo-seed.json', import.meta.url), 'utf-8'),
  ) as {
    territories: { code: string }[];
    organizations: { code: string; name: string; isTriage: boolean }[];
    routingRules: {
      categoryCode: CategoryCode;
      organizationCode: string;
      territoryCode: string | null;
      priority: number;
      active: boolean;
    }[];
  };
  return {
    ruleVersion: 'rules-v1',
    territories: seed.territories.map((t) => ({ code: t.code, active: true })),
    organizations: seed.organizations.map((o) => ({
      code: o.code,
      name: o.name,
      active: true,
      isTriage: o.isTriage,
    })),
    rules: seed.routingRules.map((r) => ({
      categoryCode: r.categoryCode,
      organizationCode: r.organizationCode,
      territoryCode: r.territoryCode,
      priority: r.priority,
      active: r.active,
    })),
  };
}

export function loadCases(relativePath: string): FixtureCase[] {
  const raw = JSON.parse(readFileSync(new URL(relativePath, import.meta.url), 'utf-8')) as {
    ruleVersion: string;
    cases: FixtureCase[];
  };
  if (raw.ruleVersion !== 'rules-v1') throw new Error(`fixtures target a different rule version: ${relativePath}`);
  return raw.cases;
}

export function overridesOf(c: FixtureCase): RoutingContext {
  return {
    disabledOrganizationCodes: c.contextOverrides?.disabledOrganizationCodes,
    conflictingCategoryRoute: c.contextOverrides?.conflictingCategoryRoute,
  };
}

export function assertCaseRouted(c: FixtureCase, catalog: CatalogSnapshot): void {
  const first = routeIdea(c.input, catalog, overridesOf(c));
  expect(first.source).toBe('RULES');
  expect(first.ruleVersion).toBe('rules-v1');
  expect(first.effectiveCategoryCode).toBe(c.expected.effectiveCategoryCode);
  expect(first.organizationCode).toBe(c.expected.organizationCode);
  expect(first.mode).toBe(c.expected.mode);
  expect(first.confidenceBand).toBe(c.expected.confidenceBand);
  for (const tag of c.expected.requiredTags ?? []) {
    expect(first.tags).toContain(tag);
  }
  for (const code of c.expected.requiredReasonCodes ?? []) {
    expect(first.reasonCodes).toContain(code);
  }
  expect(first.explanation.trim().length).toBeGreaterThan(0);
}

export function assertCaseDeterministic(c: FixtureCase, catalog: CatalogSnapshot): void {
  const a = routeIdea({ ...c.input }, catalog, overridesOf(c));
  const b = routeIdea({ ...c.input }, catalog, overridesOf(c));
  expect(JSON.stringify(b)).toBe(JSON.stringify(a));
}

export function assertEvidenceConsistent(cases: FixtureCase[], catalog: CatalogSnapshot): void {
  for (const c of cases) {
    const decision = routeIdea(c.input, catalog, overridesOf(c));
    const ids = decision.evidence.map((e) => e.featureId);
    expect(new Set(ids).size).toBe(ids.length);
    const sums = new Map<CategoryCode, number>();
    for (const e of decision.evidence) {
      sums.set(e.categoryCode, (sums.get(e.categoryCode) ?? 0) + e.weight);
    }
    expect(Object.fromEntries(sums)).toEqual(decision.scores);
  }
}
