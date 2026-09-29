// D-01: deterministic rules-v1 routing engine (04 sections 3-6).
// Pure function: same input + same catalog => same decision. No Date.now,
// no Math.random, no I/O, no network, no AI key. Stable key order and
// sorted tags/evidence keep JSON output byte-stable for idempotency hashes.

import { CATEGORY_CODES, CATEGORY_NAMES_RU, DIGITAL_MARKERS, FEATURES, RULE_VERSION } from './features';
import { containsPhrase, normalizeText, tokenize } from './normalize';
import {
  RoutingInputError,
  type CatalogSnapshot,
  type CategoryCode,
  type ConfidenceBand,
  type ManualRouteDecision,
  type ManualRouteInput,
  type RoutingDecision,
  type RoutingEvidence,
  type RoutingInput,
  type RoutingContext,
} from './types';

const DIGITAL_SET = new Set<string>(DIGITAL_MARKERS);

function isCategoryCode(value: unknown): value is CategoryCode {
  return typeof value === 'string' && (CATEGORY_CODES as readonly string[]).includes(value);
}

function codePoints(value: string): number {
  return [...value].length;
}

function validateInput(input: RoutingInput): void {
  for (const field of ['title', 'problem', 'solution'] as const) {
    if (typeof input[field] !== 'string') {
      throw new RoutingInputError(field, 'Поле должно быть строкой');
    }
  }
  const requested: unknown = input.requestedCategoryCode;
  if (requested !== null && !isCategoryCode(requested)) {
    // Includes the literal 'AUTO': it must be converted to null by C
    // and rejected by B with 400, never silently routed.
    throw new RoutingInputError(
      'requestedCategoryCode',
      'Недопустимая категория: ожидается null (AUTO) или код справочника',
    );
  }
  if (typeof input.territoryCode !== 'string' || input.territoryCode.trim() === '') {
    throw new RoutingInputError('territoryCode', 'Территория обязательна');
  }
}

interface CatalogIndex {
  orgByCode: Map<string, { name: string; active: boolean; isTriage: boolean }>;
  triageCode: string | null;
}

function indexCatalog(catalog: CatalogSnapshot, overrides: RoutingContext): CatalogIndex {
  const disabled = new Set(overrides.disabledOrganizationCodes ?? []);
  const orgByCode = new Map<string, { name: string; active: boolean; isTriage: boolean }>();
  let triageCode: string | null = null;
  for (const org of catalog.organizations) {
    const active = org.active && !disabled.has(org.code);
    orgByCode.set(org.code, { name: org.name, active, isTriage: org.isTriage });
    if (active && org.isTriage && triageCode === null) triageCode = org.code;
  }
  return { orgByCode, triageCode };
}

type RouteTarget =
  | { kind: 'org'; organizationCode: string }
  | { kind: 'conflict' }
  | { kind: 'unavailable' }
  | { kind: 'no-route' };

function resolveTarget(
  category: CategoryCode,
  territoryCode: string,
  catalog: CatalogSnapshot,
  index: CatalogIndex,
  overrides: RoutingContext,
): RouteTarget {
  if (overrides.conflictingCategoryRoute === category) return { kind: 'conflict' };
  const candidates = catalog.rules.filter(
    (r) => r.active && r.categoryCode === category && (r.territoryCode === null || r.territoryCode === territoryCode),
  );
  if (candidates.length === 0) return { kind: 'no-route' };
  // Specificity first (exact territory beats region-wide), then priority.
  // A tie on both with different organizations is a configuration conflict:
  // never pick by SQL order or at random (04 section 2).
  const ranked = candidates
    .map((r) => ({ rule: r, rank: r.territoryCode === null ? 1 : 0 }))
    .sort((a, b) => a.rank - b.rank || b.rule.priority - a.rule.priority);
  const best = ranked[0];
  if (!best) return { kind: 'no-route' };
  const tied = ranked.filter((c) => c.rank === best.rank && c.rule.priority === best.rule.priority);
  const orgs = new Set(tied.map((c) => c.rule.organizationCode));
  if (orgs.size > 1) return { kind: 'conflict' };
  const org = index.orgByCode.get(best.rule.organizationCode);
  if (!org || !org.active) return { kind: 'unavailable' };
  return { kind: 'org', organizationCode: best.rule.organizationCode };
}

function confidenceBand(topScore: number, secondScore: number): ConfidenceBand {
  if (topScore >= 3 && topScore - secondScore >= 2) return 'HIGH';
  if (topScore >= 2) return 'MEDIUM';
  return 'LOW';
}

// Citizen-facing confidence wording for C (04 section 4). Never a percent.
export function confidenceLabel(band: ConfidenceBand): string {
  if (band === 'HIGH') return 'определено уверенно';
  if (band === 'MEDIUM') return 'стоит проверить';
  return 'нужен специалист';
}

function quoteList(labels: readonly string[]): string {
  return labels.map((l) => `«${l}»`).join(', ');
}

function buildExplanation(args: {
  effective: CategoryCode;
  requested: CategoryCode | null;
  topCategory: CategoryCode | null;
  band: ConfidenceBand;
  matchedLabels: string[];
  tagCategories: CategoryCode[];
  mode: 'ASSIGNED' | 'TRIAGE';
  orgName: string;
  triageReason: string | null;
}): string {
  const parts: string[] = [];
  const effectiveName = CATEGORY_NAMES_RU[args.effective].toLowerCase();
  if (args.matchedLabels.length > 0) {
    parts.push(`Признаки ${quoteList(args.matchedLabels)} указывают на тему «${effectiveName}».`);
  } else {
    parts.push(`Уверенных тематических признаков нет, установлена тема «${effectiveName}».`);
  }
  if (args.tagCategories.length > 0) {
    const names = args.tagCategories.map((c) => `«${CATEGORY_NAMES_RU[c].toLowerCase()}»`).join(', ');
    parts.push(`Дополнительно учтены темы: ${names}.`);
  }
  if (args.requested !== null && args.requested !== args.effective) {
    parts.push(`Ваш выбор («${CATEGORY_NAMES_RU[args.requested].toLowerCase()}») сохранён.`);
  }
  if (args.mode === 'ASSIGNED') {
    parts.push(`Направлено в ${args.orgName}.`);
  } else if (args.triageReason !== null) {
    parts.push(args.triageReason);
  } else {
    parts.push('Передано в центр разбора: маршрут уточнит сотрудник.');
  }
  return parts.join(' ');
}

function triageSentence(kind: RouteTarget['kind'], requested: CategoryCode | null, top: CategoryCode | null): string {
  if (kind === 'conflict') {
    return 'Конфигурация правил неоднозначна: маршрут уточнит сотрудник.';
  }
  if (requested !== null && top !== null && requested !== top) {
    return (
      `Выбор автора («${CATEGORY_NAMES_RU[requested].toLowerCase()}») отличается от уверенного вывода ` +
      `правил («${CATEGORY_NAMES_RU[top].toLowerCase()}»): маршрут уточнит сотрудник.`
    );
  }
  return 'Для темы нет доступного направления: маршрут уточнит сотрудник.';
}

export function routeIdea(
  input: RoutingInput,
  catalog: CatalogSnapshot,
  overrides: RoutingContext = {},
): RoutingDecision {
  validateInput(input);
  if (catalog.ruleVersion !== RULE_VERSION) {
    throw new RoutingInputError('ruleVersion', 'Неизвестная версия правил маршрутизации');
  }
  const territory = catalog.territories.find((t) => t.code === input.territoryCode);
  if (!territory || !territory.active) {
    // Unknown territory is a 400 form-validation case (B keeps the draft);
    // the router must not invent a route for it (04 section 4).
    throw new RoutingInputError('territoryCode', 'Территория вне активного справочника');
  }
  const index = indexCatalog(catalog, overrides);
  if (index.triageCode === null) {
    throw new Error('routing catalog misconfigured: no active triage organization');
  }
  const triageCode = index.triageCode;

  const fields = [input.title, input.problem, input.solution];
  const docs = fields.map((f) => ({ normalized: normalizeText(f), tokens: tokenize(normalizeText(f)) }));
  const tokenSet = new Set<string>();
  for (const doc of docs) for (const token of doc.tokens) tokenSet.add(token);

  const evidence: RoutingEvidence[] = [];
  const scores = new Map<CategoryCode, number>();
  for (const feature of FEATURES) {
    let hit = false;
    for (const alias of feature.tokens) {
      if (tokenSet.has(alias)) {
        hit = true;
        break;
      }
    }
    if (!hit) {
      for (const doc of docs) {
        let found = false;
        for (const phrase of feature.phrases) {
          if (containsPhrase(doc.tokens, phrase)) {
            found = true;
            break;
          }
        }
        if (found) {
          hit = true;
          break;
        }
      }
    }
    if (hit) {
      evidence.push({ featureId: feature.id, categoryCode: feature.category, weight: feature.weight });
      scores.set(feature.category, (scores.get(feature.category) ?? 0) + feature.weight);
    }
  }
  evidence.sort((a, b) => (a.featureId < b.featureId ? -1 : a.featureId > b.featureId ? 1 : 0));

  let digitalFound = false;
  for (const token of tokenSet) {
    if (DIGITAL_SET.has(token)) {
      digitalFound = true;
      break;
    }
  }

  const ranked = CATEGORY_CODES.map((code) => ({ code, score: scores.get(code) ?? 0 }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  const top = ranked[0] ?? null;
  const second = ranked[1] ?? null;
  const band = confidenceBand(top?.score ?? 0, second?.score ?? 0);
  const topCategory: CategoryCode | null = top ? top.code : null;

  const requested = input.requestedCategoryCode;
  const reasonCodes: string[] = [];
  let effective: CategoryCode;
  let routed: RouteTarget;

  if (requested === null) {
    if (band === 'HIGH' && topCategory !== null) {
      effective = topCategory;
      routed = resolveTarget(effective, input.territoryCode, catalog, index, overrides);
    } else {
      effective = 'OTHER';
      routed = { kind: 'org', organizationCode: triageCode };
    }
  } else if (requested === 'OTHER') {
    effective = 'OTHER';
    routed = { kind: 'org', organizationCode: triageCode };
  } else if (band === 'HIGH' && topCategory !== null && topCategory !== requested) {
    // The author's choice is preserved; the conflict goes to triage (04 section 4).
    effective = requested;
    routed = { kind: 'org', organizationCode: triageCode };
    reasonCodes.push('CATEGORY_CONFLICT');
  } else {
    effective = requested;
    routed = resolveTarget(effective, input.territoryCode, catalog, index, overrides);
  }

  let mode: 'ASSIGNED' | 'TRIAGE';
  let organizationCode: string;
  let triageReason: string | null = null;
  if (routed.kind === 'org') {
    if (routed.organizationCode === triageCode) {
      mode = 'TRIAGE';
      organizationCode = triageCode;
      triageReason =
        reasonCodes.includes('CATEGORY_CONFLICT') || (requested !== null && requested !== topCategory && band === 'HIGH')
          ? triageSentence('org', requested, topCategory)
          : 'Передано в центр разбора: маршрут уточнит сотрудник.';
      if (reasonCodes.length === 0 && requested !== null && requested !== topCategory && band === 'HIGH') {
        reasonCodes.push('CATEGORY_CONFLICT');
      }
    } else {
      mode = 'ASSIGNED';
      organizationCode = routed.organizationCode;
    }
  } else {
    mode = 'TRIAGE';
    organizationCode = triageCode;
    if (routed.kind === 'conflict') reasonCodes.push('RULE_CONFIGURATION_CONFLICT');
    if (routed.kind === 'unavailable') reasonCodes.push('ORGANIZATION_INACTIVE');
    if (routed.kind === 'no-route') reasonCodes.push('NO_MATCHING_ROUTE');
    triageReason = triageSentence(routed.kind, requested, topCategory);
  }
  if (!digitalFound) reasonCodes.push('DIGITAL_COMPONENT_NOT_CLEAR');

  const tagCategories = ranked.filter((s) => s.code !== effective).map((s) => s.code);
  const tags = [...tagCategories];
  if (digitalFound) tags.push('SMART_CITY');

  const scoresOut: Partial<Record<CategoryCode, number>> = {};
  for (const code of CATEGORY_CODES) {
    const value = scores.get(code);
    if (value !== undefined && value > 0) scoresOut[code] = value;
  }

  const labelById = new Map(FEATURES.map((f) => [f.id, f.label] as const));
  const matchedLabels = evidence.map((e) => labelById.get(e.featureId) ?? e.featureId);
  const orgName = index.orgByCode.get(organizationCode)?.name ?? organizationCode;
  const explanation = buildExplanation({
    effective,
    requested,
    topCategory,
    band,
    matchedLabels,
    tagCategories,
    mode,
    orgName,
    triageReason,
  });

  return {
    source: 'RULES',
    ruleVersion: RULE_VERSION,
    effectiveCategoryCode: effective,
    organizationCode,
    mode,
    confidenceBand: band,
    tags,
    scores: scoresOut,
    evidence,
    reasonCodes,
    explanation,
  };
}

// Manual correction by staff/admin (01 FR-07): the new organization comes
// from the catalog only, the 10..1000-char reason travels in its own field
// (B persists it to history), and the previous assignee reset + status rules
// stay in B's service, not here.
export function manualReroute(input: ManualRouteInput, catalog: CatalogSnapshot): ManualRouteDecision {
  if (!isCategoryCode(input.effectiveCategoryCode)) {
    throw new RoutingInputError('effectiveCategoryCode', 'Недопустимая категория');
  }
  const org = catalog.organizations.find((o) => o.code === input.organizationCode);
  if (!org || !org.active) {
    throw new RoutingInputError('organizationCode', 'Организация вне активного справочника');
  }
  if (typeof input.reason !== 'string' || codePoints(input.reason.trim()) < 10 || codePoints(input.reason) > 1000) {
    throw new RoutingInputError('reason', 'Причина: 10–1000 символов');
  }
  const mode: 'ASSIGNED' | 'TRIAGE' = org.isTriage ? 'TRIAGE' : 'ASSIGNED';
  const sameCategory = input.priorCategoryCode === input.effectiveCategoryCode;
  const band: ConfidenceBand = sameCategory && input.priorConfidenceBand ? input.priorConfidenceBand : 'LOW';
  return {
    source: 'HUMAN',
    ruleVersion: RULE_VERSION,
    effectiveCategoryCode: input.effectiveCategoryCode,
    organizationCode: input.organizationCode,
    mode,
    confidenceBand: band,
    reasonCodes: ['MANUAL_REROUTE'],
    reason: input.reason,
    explanation:
      `Маршрут исправлен сотрудником: установлена тема ` +
      `«${CATEGORY_NAMES_RU[input.effectiveCategoryCode].toLowerCase()}», направление — ${org.name}. ` +
      `Причина зафиксирована в истории.`,
  };
}
