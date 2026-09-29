// D-01: supplementary edge cases (fixtures/routing-edge-cases.json).
// E01+E02 were proposed by a read-only subagent from 04 and verified
// personally against the engine; E03+E10 are D-authored from 04.
// Behavior checks only, not an accuracy benchmark.
import { describe, expect, it } from 'vitest';
import {
  assertCaseDeterministic,
  assertCaseRouted,
  assertEvidenceConsistent,
  loadCases,
  loadCatalogFromSeed,
} from './fixture-harness';

const catalog = loadCatalogFromSeed();
const cases = loadCases('../../../fixtures/routing-edge-cases.json');

describe('rules-v1 edge cases', () => {
  it('covers negation, typo, mixed RU+KK and conflict edges', () => {
    expect(cases.length).toBeGreaterThanOrEqual(10);
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
