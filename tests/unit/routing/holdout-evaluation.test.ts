import { describe, expect, it } from 'vitest';
import { evaluateRoutingHoldout, loadRoutingHoldout, syntheticRoutingCatalog } from '../../../scripts/evaluate-routing.mjs';
import { routeIdea } from '../../../src/domain/routing/rules';
import type { RoutingDecision, RoutingInput, CatalogSnapshot } from '../../../src/domain/routing/types';

const sample = loadRoutingHoldout();
const catalog = syntheticRoutingCatalog() as CatalogSnapshot;

describe('manually labelled routing diagnostic sample', () => {
  it('contains exactly 40 new cases split 15 RU / 15 KK / 10 mixed with manual intent rationales', () => {
    expect(sample.cases).toHaveLength(40);
    const totals = Object.fromEntries(['ru', 'kk', 'mixed'].map((language) => [language,
      sample.cases.filter((c: { language: string }) => c.language === language).length]));
    expect(totals).toEqual({ ru: 15, kk: 15, mixed: 10 });
    expect(new Set(sample.cases.map((c: { id: string }) => c.id)).size).toBe(40);
    const phenomena = new Set(sample.cases.flatMap((c: { phenomena: string[] }) => c.phenomena));
    for (const feature of ['negation', 'typo', 'conflict', 'ambiguity', 'non_digital']) expect(phenomena).toContain(feature);
    for (const c of sample.cases) {
      expect(c.rationale.trim()).not.toBe('');
      expect(c.input.requestedCategoryCode === null || typeof c.input.requestedCategoryCode === 'string').toBe(true);
    }
    expect(sample.purpose).toContain('No classifier tuning');
  });

  it('routes every diagnostic case deterministically without requiring every manual label to match', () => {
    for (const c of sample.cases) {
      const first = routeIdea(c.input, catalog);
      expect(routeIdea({ ...c.input }, structuredClone(catalog))).toEqual(first);
    }
    const report = evaluateRoutingHoldout(sample.cases, catalog, routeIdea);
    expect(report.overall.total).toBe(40);
    expect(report.overall.categoryMatches + report.mismatches.length).toBe(40);
    expect(report.overall.categoryMatchRate).toBe(report.overall.categoryMatches / 40);
    expect(report.overall.triageRate).toBe(report.overall.triageCount / 40);
    expect(report.wrongHighRouteCaseIds).toHaveLength(report.overall.wrongHighRoutes);
    for (const metric of ['total', 'categoryMatches', 'triageCount', 'wrongHighRoutes'] as const) {
      expect(Object.values(report.byLanguage).reduce((sum, bucket) => sum + bucket[metric], 0)).toBe(report.overall[metric]);
    }
  });

  it('counts HIGH assigned errors separately from category conflicts safely sent to triage', () => {
    const cases = ['ru', 'kk', 'mixed'].map((language, index) => ({
      id: `count-${index}`, language, categoryCode: 'ECOLOGY', phenomena: [], input: { index },
    }));
    const fakeRoute = (input: RoutingInput) => {
      const index = (input as unknown as { index: number }).index;
      return {
        effectiveCategoryCode: index === 0 ? 'ECOLOGY' : 'TRANSPORT',
        confidenceBand: 'HIGH', mode: index === 1 ? 'TRIAGE' : 'ASSIGNED',
      } as RoutingDecision;
    };
    const report = evaluateRoutingHoldout(cases, catalog, fakeRoute);
    expect(report.overall).toEqual({
      total: 3, categoryMatches: 1, triageCount: 1, wrongHighRoutes: 1,
      categoryMatchRate: 1 / 3, triageRate: 1 / 3,
    });
    expect(report.wrongHighRouteCaseIds).toEqual(['count-2']);
    expect(report.byLanguage.ru.categoryMatches).toBe(1);
    expect(report.byLanguage.kk.triageCount).toBe(1);
    expect(report.byLanguage.mixed.wrongHighRoutes).toBe(1);
  });

  it('reports empty samples as zero counts with unavailable rates', () => {
    const report = evaluateRoutingHoldout([], catalog, routeIdea);
    expect(report.overall).toEqual({
      total: 0, categoryMatches: 0, triageCount: 0, wrongHighRoutes: 0,
      categoryMatchRate: null, triageRate: null,
    });
    expect(report.mismatches).toEqual([]);
  });
});
