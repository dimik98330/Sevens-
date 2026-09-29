// D-01: fixtures/routing-cases.json behavior checks (ROUTE-01..07 + R-cases).
// These fixtures verify code behavior; they are NOT an accuracy benchmark
// (04 section 11).
import { describe, expect, it } from 'vitest';
import {
  assertCaseDeterministic,
  assertCaseRouted,
  assertEvidenceConsistent,
  loadCases,
  loadCatalogFromSeed,
} from './fixture-harness.js';

const catalog = loadCatalogFromSeed();
const cases = loadCases('../../../fixtures/routing-cases.json');

describe('rules-v1 fixtures', () => {
  it('covers the documented minimum set', () => {
    expect(cases.length).toBeGreaterThanOrEqual(20);
  });

  for (const c of cases) {
    it(`${c.id}: routes as documented`, () => {
      assertCaseRouted(c, catalog);
    });

    it(`${c.id}: is deterministic`, () => {
      assertCaseDeterministic(c, catalog);
    });
  }

  it('keeps evidence consistent with scores (each feature counted once)', () => {
    assertEvidenceConsistent(cases, catalog);
  });
});
