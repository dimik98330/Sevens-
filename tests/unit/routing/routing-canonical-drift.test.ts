// D-01: the routing engine mirrors CategoryCode from the canonical
// src/contracts/index.ts (OWNERSHIP rule 2) without importing zod at
// runtime. This text-level drift check fails loudly if A changes the
// canonical enum, so the mirror cannot silently diverge.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CATEGORY_CODES } from '../../../src/domain/routing/features';

function canonicalCategoryCodes(): string[] {
  const source = readFileSync(new URL('../../../src/contracts/index.ts', import.meta.url), 'utf-8');
  const block = source.match(/export const CategoryCode = \[([\s\S]*?)\] as const/);
  if (!block || !block[1]) throw new Error('canonical CategoryCode block not found');
  return [...block[1].matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]).filter((c): c is string => c !== undefined);
}

describe('routing canonical contract drift', () => {
  it('mirrors the canonical CategoryCode enum exactly', () => {
    expect([...CATEGORY_CODES].sort()).toEqual(canonicalCategoryCodes().sort());
  });
});
