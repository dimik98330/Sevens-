// Minimal deterministic context guard/fallback plus the shared routing policy
// for a validated pretrained-model classification. No network or database.
import { CATEGORY_CODES, CATEGORY_NAMES_RU } from './features';
import { FEATURES_V2, DIGITAL_MARKERS_V2 } from './features-v2';
import { extractContext, occurrenceState, ACTION_CUE, DEFICIT_CUE } from './context';
import { confidenceBand, indexCatalog, resolveTarget, validateInput } from './rules';
import {
  RoutingInputError, type RoutingInput, type RoutingDecision, type CatalogSnapshot,
  type RoutingContext, type CategoryCode, type ConfidenceBand, type EvidenceOccurrence,
  type ClassificationAnalysis, type RoutingEvidence,
} from './types';

export interface AnalyzedClassification {
  detectedCategoryCode: CategoryCode | null;
  confidenceBand: ConfidenceBand;
  secondaryCategories?: CategoryCode[];
  scores?: Partial<Record<CategoryCode, number>>;
  reasonCodes?: string[];
  needsReview?: boolean;
  digitalComponent?: boolean;
  digitalFound?: boolean;
  explanation?: string; // Deliberately not interpolated into public text.
  analysis?: ClassificationAnalysis;
}

function editOne(a: string, b: string): boolean {
  const x = [...a], y = [...b];
  if (Math.abs(x.length - y.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (x.length > y.length) i++;
    else if (y.length > x.length) j++;
    else { i++; j++; }
  }
  return edits + (i < x.length || j < y.length ? 1 : 0) === 1;
}

const dictionary = new Map<string, Set<string>>();
for (const feature of FEATURES_V2) {
  for (const word of [...feature.tokens, ...feature.phrases.flat()]) {
    if ([...word].length < 6) continue;
    const ids = dictionary.get(word) ?? new Set<string>();
    ids.add(feature.id); dictionary.set(word, ids);
  }
}

function fuzzyAlternatives(word: string): Set<string> {
  if ([...word].length < 6 || dictionary.has(word)) return new Set();
  const candidates = [...dictionary].filter(([canonical]) => editOne(word, canonical));
  const ids = new Set(candidates.flatMap(([, features]) => [...features]));
  return ids.size === 1 ? new Set(candidates.map(([canonical]) => canonical)) : new Set();
}

const support: Partial<Record<CategoryCode, RegExp>> = {
  TRANSPORT: /пешеход|перекрест|машин|транспорт|көлік|қиылыс|жүргізуш|қозғалыс/u,
  ACCESSIBILITY: /пандус|лестниц|ступен|коляск|арба|баспалдақ|кедергісіз/u,
  HEALTH: /пациент|врач|дәрігер|емхана/u,
  UTILITIES: /воды|водоснабж|құбыр|есептегіш/u,
  ECOLOGY: /загрязн|выброс|эколог|қалдық|ластан/u,
};
const fieldRank = { solution: 3, title: 2, problem: 1 };

export function analyzeRoutingText(input: RoutingInput): ClassificationAnalysis {
  validateInput(input);
  const clauses = extractContext(input);
  const occurrences: EvidenceOccurrence[] = [];
  let digitalFound = false;
  for (const clause of clauses) {
    const fuzzy = clause.tokens.map((token) => fuzzyAlternatives(token.value));
    for (let i = 0; i < clause.tokens.length; i++) {
      if (DIGITAL_MARKERS_V2.has(clause.tokens[i]!.value)
        && ['REQUEST', 'PROBLEM'].includes(occurrenceState(clause, i, i))) digitalFound = true;
    }
    for (const feature of FEATURES_V2) {
      const patterns = [...feature.tokens.map((token) => [token]), ...feature.phrases];
      for (const pattern of patterns) {
        for (let first = 0; first + pattern.length <= clause.tokens.length; first++) {
          let edits = 0, matches = true;
          for (let j = 0; j < pattern.length; j++) {
            const token = clause.tokens[first + j]!.value;
            if (token === pattern[j]) continue;
            if (fuzzy[first + j]!.has(pattern[j]!)) edits++;
            else { matches = false; break; }
          }
          if (!matches || edits > 1) continue;
          if (edits && !support[feature.category]?.test(clause.text)) continue;
          const last = first + pattern.length - 1;
          const state = occurrenceState(clause, first, last, feature.id === 'school');
          const occurrence: EvidenceOccurrence = {
            featureId: feature.id, categoryCode: feature.category, weight: feature.weight,
            field: clause.field, start: clause.tokens[first]!.start, end: clause.tokens[last]!.end,
            clause: clause.index, state, match: edits ? 'FUZZY' : 'EXACT',
          };
          if (!occurrences.some((o) => o.featureId === occurrence.featureId && o.field === occurrence.field
            && o.start === occurrence.start && o.end === occurrence.end)) occurrences.push(occurrence);
        }
      }
    }
  }
  occurrences.sort((a, b) => fieldRank[b.field] - fieldRank[a.field] || a.start - b.start
    || a.featureId.localeCompare(b.featureId, 'en'));
  const active = occurrences.filter((o) => o.state === 'REQUEST' || o.state === 'PROBLEM');
  const strongest = new Map<string, EvidenceOccurrence>();
  for (const occurrence of active) {
    const prior = strongest.get(occurrence.featureId);
    if (!prior || (prior.match === 'FUZZY' && occurrence.match === 'EXACT')
      || (prior.match === occurrence.match && fieldRank[occurrence.field] > fieldRank[prior.field])) {
      strongest.set(occurrence.featureId, occurrence);
    }
  }
  const scores: Partial<Record<CategoryCode, number>> = {};
  for (const occurrence of strongest.values()) scores[occurrence.categoryCode] =
    (scores[occurrence.categoryCode] ?? 0) + occurrence.weight;
  const strong = [...strongest.values()].filter((o) => o.weight >= 3);
  const tier = Math.max(0, ...strong.map((o) => fieldRank[o.field]));
  const focused = new Set(strong.filter((o) => fieldRank[o.field] === tier).map((o) => o.categoryCode));
  const ranked = CATEGORY_CODES.filter((code) => (scores[code] ?? 0) > 0 && (!focused.size || focused.has(code)))
    .sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0) || a.localeCompare(b, 'en'));
  const detectedCategoryCode = ranked[0] ?? null;
  let band = confidenceBand(scores[ranked[0]!] ?? 0, scores[ranked[1]!] ?? 0);
  const exactStrong = strong.some((o) => o.categoryCode === detectedCategoryCode && o.match === 'EXACT');
  if (!exactStrong && band === 'HIGH') band = 'MEDIUM';
  const reasonCodes: string[] = [];
  if (occurrences.some((o) => o.state === 'EXCLUDED')) reasonCodes.push('EXCLUDED_TOPIC_IGNORED');
  if (occurrences.some((o) => o.state === 'BACKGROUND')) reasonCodes.push('BACKGROUND_TOPIC_IGNORED');
  if (occurrences.some((o) => o.match === 'FUZZY')) reasonCodes.push('FUZZY_MATCH');
  if (occurrences.some((o) => o.state === 'UNCERTAIN' && o.weight >= 3)) reasonCodes.push('POLARITY_UNRESOLVED');
  if (focused.size > 1) reasonCodes.push('MULTIPLE_PRIMARY_TOPICS');
  const multiGoal = /(?:две|два|оба|несколько)\s+(?:независим\p{L}*|отдельн\p{L}*|разн\p{L}*)|одинаково\s+важны|равнозначн\p{L}*|екі\s+тәуелсіз|бірдей\s+маңызды/u
    .test([input.title, input.problem, input.solution].join(' ').toLowerCase());
  if (multiGoal && Object.keys(scores).length > 1 && !reasonCodes.includes('MULTIPLE_PRIMARY_TOPICS')) {
    reasonCodes.push('MULTIPLE_PRIMARY_TOPICS');
  }
  const affirmedStrong = strong.some((o) => {
    if (o.categoryCode !== detectedCategoryCode || o.match !== 'EXACT') return false;
    const text = clauses.find((c) => c.index === o.clause)!.text;
    return ACTION_CUE.test(text) || (o.state === 'PROBLEM' && DEFICIT_CUE.test(text))
      || (o.field === 'title' && ACTION_CUE.test(input.solution.toLowerCase()) && digitalFound);
  });
  if (band === 'HIGH' && !affirmedStrong) {
    band = 'MEDIUM'; reasonCodes.push('REQUEST_SUPPORT_WEAK');
  }
  const needsReview = reasonCodes.includes('POLARITY_UNRESOLVED') || reasonCodes.includes('MULTIPLE_PRIMARY_TOPICS');
  if (needsReview && band === 'HIGH') band = 'MEDIUM';
  const secondaryCategories = CATEGORY_CODES.filter((code) => code !== detectedCategoryCode
    && occurrences.some((o) => o.categoryCode === code && (o.state === 'REQUEST' || o.state === 'PROBLEM'
      || (o.featureId === 'school' && o.state === 'BACKGROUND'))));
  return { sourceInternal: 'RULES_V2', occurrences, detectedCategoryCode, secondaryCategories,
    confidenceBand: band, needsReview, reasonCodes, scores, digitalFound };
}

// The pretrained model provides a topic recommendation. This function alone
// applies the existing author-choice policy and the live organization matrix.
export function routeAnalyzed(input: RoutingInput, catalog: CatalogSnapshot,
  classification: AnalyzedClassification, overrides: RoutingContext = {}): RoutingDecision {
  validateInput(input);
  if (catalog.ruleVersion !== 'rules-v1') throw new RoutingInputError('ruleVersion', 'Неизвестная версия справочника');
  if (!catalog.territories.some((t) => t.code === input.territoryCode && t.active)) {
    throw new RoutingInputError('territoryCode', 'Территория вне активного справочника');
  }
  const detected = classification.detectedCategoryCode;
  if (detected !== null && !CATEGORY_CODES.includes(detected)) {
    throw new RoutingInputError('detectedCategoryCode', 'Недопустимая категория анализа');
  }
  if (!['HIGH', 'MEDIUM', 'LOW'].includes(classification.confidenceBand)) {
    throw new RoutingInputError('confidenceBand', 'Некорректная определённость анализа');
  }
  const index = indexCatalog(catalog, overrides);
  if (!index.triageCode) throw new Error('routing catalog misconfigured: no active triage organization');
  const sourceInternal = classification.analysis?.sourceInternal ?? 'MODEL';
  const secondary = CATEGORY_CODES.filter((code) => classification.secondaryCategories?.includes(code) && code !== detected);
  const needsReview = classification.needsReview === true || detected === null || classification.confidenceBand !== 'HIGH';
  const band = needsReview && classification.confidenceBand === 'HIGH' ? 'MEDIUM' : classification.confidenceBand;
  const reasons = new Set((classification.reasonCodes ?? []).filter((r) => /^[A-Z0-9_]{1,64}$/.test(r)));
  const requested = input.requestedCategoryCode;
  const conflict = requested !== null && requested !== 'OTHER' && detected !== null && detected !== requested
    && band === 'HIGH';
  if (conflict) reasons.add('CATEGORY_CONFLICT');
  if (needsReview) reasons.add('CLASSIFICATION_NEEDS_REVIEW');
  const effective: CategoryCode = requested ?? (band === 'HIGH' && detected !== null ? detected : 'OTHER');
  let target = needsReview || conflict || effective === 'OTHER'
    ? { kind: 'org' as const, organizationCode: index.triageCode }
    : resolveTarget(effective, input.territoryCode, catalog, index, overrides);
  if (target.kind !== 'org') {
    if (target.kind === 'conflict') reasons.add('RULE_CONFIGURATION_CONFLICT');
    if (target.kind === 'unavailable') reasons.add('ORGANIZATION_INACTIVE');
    if (target.kind === 'no-route') reasons.add('NO_MATCHING_ROUTE');
    target = { kind: 'org', organizationCode: index.triageCode };
  }
  const mode = target.organizationCode === index.triageCode ? 'TRIAGE' : 'ASSIGNED';
  const digitalFound = classification.digitalFound ?? classification.digitalComponent ?? false;
  if (!digitalFound) reasons.add('DIGITAL_COMPONENT_NOT_CLEAR');
  const tags = CATEGORY_CODES.filter((code) => code !== effective && (secondary.includes(code) || code === detected));
  const allTags: string[] = [...tags];
  if (digitalFound) allTags.push('SMART_CITY');
  const scoreValues: Partial<Record<CategoryCode, number>> = {};
  for (const code of CATEGORY_CODES) {
    const value = classification.scores?.[code];
    if (value !== undefined) {
      if (!Number.isFinite(value) || value < 0) throw new RoutingInputError('scores', 'Некорректные баллы анализа');
      scoreValues[code] = value;
    }
  }
  const evidence: RoutingEvidence[] = [];
  for (const occurrence of classification.analysis?.occurrences ?? []) {
    if ((occurrence.state === 'REQUEST' || occurrence.state === 'PROBLEM')
      && !evidence.some((e) => e.featureId === occurrence.featureId)) {
      evidence.push({ featureId: occurrence.featureId, categoryCode: occurrence.categoryCode, weight: occurrence.weight });
    }
  }
  evidence.sort((a, b) => a.featureId.localeCompare(b.featureId, 'en'));
  const reasonCodes = [...reasons].sort();
  const analysis: ClassificationAnalysis = {
    sourceInternal, ...(classification.analysis?.occurrences ? { occurrences: classification.analysis.occurrences } : {}),
    detectedCategoryCode: detected, secondaryCategories: secondary, confidenceBand: band,
    needsReview, reasonCodes, scores: scoreValues, digitalFound,
  };
  const explanation = [
    detected === null ? 'Основная тема не определена: нужен специалист.'
      : `По содержанию определена тема «${CATEGORY_NAMES_RU[detected].toLowerCase()}».`,
    conflict ? `Выбор автора («${CATEGORY_NAMES_RU[requested!].toLowerCase()}») сохранён; обнаружен конфликт категорий.` : '',
    mode === 'TRIAGE' ? 'Передано в центр разбора: маршрут уточнит сотрудник.'
      : `Направлено в ${index.orgByCode.get(target.organizationCode)?.name ?? target.organizationCode}.`,
  ].filter(Boolean).join(' ');
  return { source: 'RULES', ruleVersion: sourceInternal === 'MODEL' ? 'hybrid-v2' : 'rules-v2',
    catalogVersion: 'rules-v1', detectedCategoryCode: detected, analysis,
    effectiveCategoryCode: effective, organizationCode: target.organizationCode, mode,
    confidenceBand: band, tags: allTags, scores: scoreValues, evidence, reasonCodes, explanation };
}

export function routeIdeaV2(input: RoutingInput, catalog: CatalogSnapshot, overrides: RoutingContext = {}): RoutingDecision {
  const analysis = analyzeRoutingText(input);
  return routeAnalyzed(input, catalog, { ...analysis, analysis }, overrides);
}
export const routeIdea = routeIdeaV2;
