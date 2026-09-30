// Frozen synthetic labels precede v2 implementation/output inspection. This
// suite guards unsafe assignment; semantic quality is reported by the evaluator.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { routeIdea as routeV1 } from '../../../src/domain/routing/rules';
import { routeIdea as routeV2 } from '../../../src/domain/routing/rules-v2';
import { parseWrite } from '../../../src/contracts/requests.mjs';
import { loadRoutingDataset, syntheticRoutingCatalog, evaluateRoutingDataset,
  evaluateRoutingDatasetAsync, evaluatePredictions } from '../../../scripts/evaluate-routing.mjs';

const sample = loadRoutingDataset();
const catalog = syntheticRoutingCatalog();
const FROZEN_HASH = '7a64b84a0e3bbd7559f5a946b00d557fe4c3f677db404fe490ec7ca257426090';
const getCase = (language: string, number: number) => sample.cases.find((c: { id: string }) => c.id === `V2-${language.toUpperCase()}-${String(number).padStart(2, '0')}`);
const prediction = (detectedCategoryCode: string, effectiveCategoryCode: string, mode: string, organizationCode: string, confidenceBand = 'MEDIUM') => ({
  detectedCategoryCode, effectiveCategoryCode, mode, organizationCode, confidenceBand, ruleVersion: 'rules-v2',
});

describe('frozen independent v2 validation labels', () => {
  it('freezes 90 cases, 30 per language, all categories and scenario groups before model output', () => {
    const source = readFileSync(new URL('../../../fixtures/routing-v2-validation.json', import.meta.url));
    expect(createHash('sha256').update(source).digest('hex')).toBe(FROZEN_HASH);
    expect(sample.cases).toHaveLength(90);
    expect(sample.nativeKazakhReviewPerformed).toBe(false);
    for (const language of ['ru', 'kk', 'mixed']) {
      const cases = sample.cases.filter((c: { language: string }) => c.language === language);
      expect(cases).toHaveLength(30);
      expect(new Set(cases.flatMap((c: { gold: { detectedCategories: string[] } }) => c.gold.detectedCategories)).size).toBe(9);
    }
    const splits = new Map<string, Set<string>>();
    for (const c of sample.cases) {
      if (!splits.has(c.groupId)) splits.set(c.groupId, new Set());
      splits.get(c.groupId)!.add(c.split);
    }
    for (const group of splits.values()) expect(group.size).toBe(1);
  });

  it('distinguishes municipal pickup from recycling; unresolved waste scope must be triaged', () => {
    for (const language of ['ru', 'kk', 'mixed']) {
      expect(getCase(language, 4).gold.detectedCategories).toEqual(['UTILITIES']);
      expect(getCase(language, 10).gold.detectedCategories).toEqual(['ECOLOGY']);
      expect(getCase(language, 30).gold.detectedCategories).toEqual(['UTILITIES', 'ECOLOGY', 'OTHER']);
      expect(getCase(language, 30).gold.mustTriage).toBe(true);
    }
  });

  for (const c of sample.cases) {
    it(`${c.id}: never automatically assigns a wrong topic/organization or a mandatory triage case`, () => {
      const decision = routeV2(c.input, catalog);
      expect(['HIGH', 'MEDIUM', 'LOW']).toContain(decision.confidenceBand);
      expect(decision.catalogVersion).toBe('rules-v1');
      expect(decision.ruleVersion).toBe('rules-v2');
      if (decision.mode === 'ASSIGNED') {
        expect(c.gold.mustTriage, c.id + ': expected human triage').toBe(false);
        expect(c.gold.detectedCategories, c.id + ': assigned category contradicts intended action').toContain(decision.effectiveCategoryCode);
        expect(c.gold.assignedOrganizationCodes, c.id + ': wrong organization').toContain(decision.organizationCode);
      } else {
        expect(decision.mode).toBe('TRIAGE');
        expect(decision.organizationCode).toBe('DEMO_TRIAGE');
      }
      if (c.input.requestedCategoryCode !== null) expect(decision.effectiveCategoryCode).toBe(c.input.requestedCategoryCode);
    });
  }

  it('never automatically routes the three disclosed v1 negation failures to their refused transport topic', () => {
    for (const language of ['ru', 'kk', 'mixed']) {
      const c = getCase(language, 28);
      const decision = routeV2(c.input, catalog);
      expect(decision.mode !== 'ASSIGNED' || c.gold.detectedCategories.includes(decision.effectiveCategoryCode)).toBe(true);
      expect(decision.mode !== 'ASSIGNED' || decision.organizationCode !== 'DEMO_TRANSPORT').toBe(true);
    }
  });

  it('never assigns away from the positive action; the local fallback may safely abstain', () => {
    for (const language of ['ru', 'kk', 'mixed']) {
      for (const number of [2, 3, 5, 6, 12, 14, 17, 24]) {
        const c = getCase(language, number);
        const decision = routeV2(c.input, catalog);
        if (decision.mode === 'ASSIGNED') {
          expect(c.gold.detectedCategories, c.id).toContain(decision.detectedCategoryCode);
          expect(c.gold.detectedCategories, c.id).toContain(decision.effectiveCategoryCode);
        } else {
          expect(decision.mode).toBe('TRIAGE');
          expect(decision.organizationCode).toBe('DEMO_TRIAGE');
        }
      }
      const refused = routeV2(getCase(language, 29).input, catalog);
      expect(refused.mode).toBe('TRIAGE');
    }
  });

  it('preserves the conflicting author category and triages even when fallback semantic evidence is absent', () => {
    for (const language of ['ru', 'kk', 'mixed']) {
      const decision = routeV2(getCase(language, 18).input, catalog);
      expect(decision.effectiveCategoryCode).toBe('TRANSPORT');
      expect(decision.mode).toBe('TRIAGE');
      expect(decision.organizationCode).toBe('DEMO_TRIAGE');
    }
  });

  it('refuses nested caller overrides at the public write-schema boundary', () => {
    const { territoryCode, ...input } = getCase('ru', 1).input;
    void territoryCode;
    const territoryId = '11111111-1111-4111-8111-111111111111';
    for (const field of ['manualOverride', 'routing', 'classifier', 'model']) {
      const override = { ...input, territoryId, [field]: { categoryCode: 'SAFETY', mode: 'ASSIGNED', organizationCode: 'ADMIN' } };
      expect(() => parseWrite('preview', override)).toThrow();
      expect(() => parseWrite('draft', override)).toThrow();
    }
  });
});

describe('selective evaluation and model injection', () => {
  it('counts wrongly assigned MEDIUM/LOW as risk and separates author policy from semantic intent', () => {
    const c = getCase('ru', 18);
    const assigned = evaluatePredictions([c], catalog, [{ id: c.id, decision: prediction('HEALTH', 'TRANSPORT', 'ASSIGNED', 'DEMO_TRANSPORT', 'LOW') }]);
    expect(assigned.overall.semanticMatches).toBe(1);
    expect(assigned.overall.effectiveCategoryMatches).toBe(1);
    expect(assigned.overall.wrongAssignedCount).toBe(1);
    expect(assigned.overall.wrongHighAssignedCount).toBe(0);
    expect(assigned.overall.unsafeAssignmentCount).toBe(1);
    expect(assigned.overall.selectiveRisk).toBe(1);
    expect(assigned.byAuthorChoice.authorSelected.total).toBe(1);
    const safe = evaluatePredictions([c], catalog, [{ id: c.id, decision: prediction('HEALTH', 'TRANSPORT', 'TRIAGE', 'DEMO_TRIAGE') }]);
    expect(safe.overall.policyMatches).toBe(1);
    expect(safe.overall.coverage).toBe(0);
    expect(safe.overall.selectiveRisk).toBeNull();
  });

  it('uses a declared dictionary-score semantic surrogate for v1 and requires every case ID', () => {
    const c = getCase('ru', 18);
    const report = evaluateRoutingDataset([c], catalog, routeV1);
    expect(report.overall.total).toBe(1);
    expect(report.semanticV1Note).toContain('dictionary');
    expect(() => evaluatePredictions([c], catalog, [])).toThrow('Missing prediction');
    expect(() => evaluatePredictions([c], catalog, [{ id: c.id, decision: {} }, { id: c.id, decision: {} }])).toThrow('unique');
  });

  it('injects asynchronous predictions with bounded concurrency and reports failures separately', async () => {
    const cases = [getCase('ru', 1), getCase('kk', 1), getCase('mixed', 1)];
    let running = 0, peak = 0;
    const report = await evaluateRoutingDatasetAsync(cases, catalog, async (_input: unknown, _catalog: unknown, context: { caseId: string }) => {
      running++; peak = Math.max(peak, running);
      await Promise.resolve();
      running--;
      if (context.caseId.includes('KK')) throw Object.assign(new Error('Unavailable'), { code: 'MODEL_UNAVAILABLE' });
      return prediction('TRANSPORT', 'TRANSPORT', 'ASSIGNED', 'DEMO_TRANSPORT');
    }, { concurrency: 1, minIntervalMs: 0, timeoutMs: 1000 });
    expect(peak).toBe(1);
    expect(report.overall.total).toBe(3);
    expect(report.overall.unavailableCount).toBe(1);
    expect(report.overall.assignedCount).toBe(2);
    expect(report.overall.coverage).toBe(2 / 3);
    expect(report.predictions).toHaveLength(3);
  });

  it('stops provider calls on 429 instead of continuing the dataset', async () => {
    let calls = 0;
    await expect(evaluateRoutingDatasetAsync(sample.cases.slice(0, 3), catalog, async () => {
      calls++; throw Object.assign(new Error('Limited'), { status: 429 });
    }, { concurrency: 1, minIntervalMs: 0, timeoutMs: 1000 })).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(calls).toBe(1);
  });

  it('aborts and stops scheduling on deadline even if a model ignores cancellation', async () => {
    let calls = 0, aborted = false;
    await expect(evaluateRoutingDatasetAsync(sample.cases.slice(0, 3), catalog,
      async (_input: unknown, _catalog: unknown, context: { signal: AbortSignal }) => {
        calls++;
        context.signal.addEventListener('abort', () => { aborted = true; }, { once: true });
        return new Promise(() => {});
      }, { concurrency: 1, minIntervalMs: 0, timeoutMs: 10 })).rejects.toMatchObject({ code: 'PREDICTION_TIMEOUT' });
    expect(calls).toBe(1);
    expect(aborted).toBe(true);
  });
});
