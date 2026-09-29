// D-01: manual route correction by staff/admin (01 FR-07).
// Organization comes from the catalog only; the reason is validated here
// and travels in its own field (never embedded into explanation text).
import { describe, expect, it } from 'vitest';
import { manualReroute } from '../../../src/domain/routing/rules.js';
import { RoutingInputError, type CatalogSnapshot } from '../../../src/domain/routing/types.js';

const catalog: CatalogSnapshot = {
  ruleVersion: 'rules-v1',
  territories: [{ code: 'DEMO_SEMEY', active: true }],
  organizations: [
    { code: 'DEMO_TRANSPORT', name: 'Демо: направление транспорта', active: true, isTriage: false },
    { code: 'DEMO_TRIAGE', name: 'Демо: центр цифровых инициатив', active: true, isTriage: true },
    { code: 'DEMO_OLD', name: 'Закрытое направление', active: false, isTriage: false },
  ],
  rules: [],
};

const REASON = 'Текст указывает на транспортную тему: светофоры и дорога.';

describe('manual reroute', () => {
  it('accepts a catalog organization with a valid reason', () => {
    const decision = manualReroute(
      { organizationCode: 'DEMO_TRANSPORT', effectiveCategoryCode: 'TRANSPORT', reason: REASON },
      catalog,
    );
    expect(decision.source).toBe('HUMAN');
    expect(decision.mode).toBe('ASSIGNED');
    expect(decision.organizationCode).toBe('DEMO_TRANSPORT');
    expect(decision.reason).toBe(REASON);
    expect(decision.reasonCodes).toContain('MANUAL_REROUTE');
    expect(decision.explanation).not.toContain(REASON);
  });

  it('routes to triage mode when the target org is the triage center', () => {
    const decision = manualReroute(
      { organizationCode: 'DEMO_TRIAGE', effectiveCategoryCode: 'OTHER', reason: REASON },
      catalog,
    );
    expect(decision.mode).toBe('TRIAGE');
  });

  it('rejects a free-text organization (must come from the catalog)', () => {
    expect(() =>
      manualReroute({ organizationCode: 'Акимат лично', effectiveCategoryCode: 'TRANSPORT', reason: REASON }, catalog),
    ).toThrowError(RoutingInputError);
  });

  it('rejects an inactive organization', () => {
    expect(() =>
      manualReroute({ organizationCode: 'DEMO_OLD', effectiveCategoryCode: 'TRANSPORT', reason: REASON }, catalog),
    ).toThrowError(RoutingInputError);
  });

  it('rejects a missing or too-short reason (10..1000 chars)', () => {
    expect(() =>
      manualReroute({ organizationCode: 'DEMO_TRANSPORT', effectiveCategoryCode: 'TRANSPORT', reason: 'Ок' }, catalog),
    ).toThrowError(RoutingInputError);
    expect(() =>
      manualReroute({ organizationCode: 'DEMO_TRANSPORT', effectiveCategoryCode: 'TRANSPORT', reason: '   ' }, catalog),
    ).toThrowError(RoutingInputError);
  });

  it('keeps the prior band only for the same category', () => {
    const same = manualReroute(
      {
        organizationCode: 'DEMO_TRANSPORT',
        effectiveCategoryCode: 'TRANSPORT',
        reason: REASON,
        priorCategoryCode: 'TRANSPORT',
        priorConfidenceBand: 'HIGH',
      },
      catalog,
    );
    expect(same.confidenceBand).toBe('HIGH');
    const changed = manualReroute(
      {
        organizationCode: 'DEMO_TRANSPORT',
        effectiveCategoryCode: 'TRANSPORT',
        reason: REASON,
        priorCategoryCode: 'ECOLOGY',
        priorConfidenceBand: 'HIGH',
      },
      catalog,
    );
    expect(changed.confidenceBand).toBe('LOW');
  });
});
