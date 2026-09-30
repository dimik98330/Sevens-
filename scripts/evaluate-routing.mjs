#!/usr/bin/env node
// Read-only rules-v1 diagnostic evaluator. No provider, API or database.
// Match rates describe this synthetic labelled sample, not field accuracy.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const languages = ['ru', 'kk', 'mixed'];
const categories = ['TRANSPORT', 'UTILITIES', 'EDUCATION', 'ECOLOGY', 'SAFETY', 'HEALTH', 'TOURISM', 'ACCESSIBILITY', 'OTHER'];

export function loadRoutingHoldout(file = path.join(root, 'fixtures', 'routing-holdout.json')) {
  const sample = JSON.parse(readFileSync(file, 'utf8'));
  if (sample.schemaVersion !== 1 || sample.ruleVersion !== 'rules-v1' || sample.syntheticOnly !== true
      || !Array.isArray(sample.cases)) throw new Error('Unsupported synthetic holdout schema');
  const ids = new Set();
  for (const c of sample.cases) {
    if (!c.id || ids.has(c.id) || !languages.includes(c.language) || !categories.includes(c.categoryCode)
        || typeof c.rationale !== 'string' || !c.rationale.trim()
        || !Array.isArray(c.phenomena) || !c.input
        || ['title', 'problem', 'solution'].some((field) => typeof c.input[field] !== 'string')) {
      throw new Error(`Invalid or duplicate labelled case: ${c.id || '(missing id)'}`);
    }
    ids.add(c.id);
  }
  return sample;
}

export function syntheticRoutingCatalog(file = path.join(root, 'fixtures', 'demo-seed.json')) {
  const seed = JSON.parse(readFileSync(file, 'utf8'));
  if (seed.syntheticOnly !== true) throw new Error('Evaluator accepts only the synthetic catalog');
  return {
    ruleVersion: /** @type {'rules-v1'} */ ('rules-v1'),
    territories: seed.territories.map((t) => ({ code: t.code, active: t.active !== false })),
    organizations: seed.organizations.map((o) => ({
      code: o.code, name: o.name, active: o.active !== false, isTriage: Boolean(o.isTriage),
    })),
    rules: seed.routingRules.map((r) => ({
      categoryCode: r.categoryCode, organizationCode: r.organizationCode,
      territoryCode: r.territoryCode ?? null, priority: r.priority, active: r.active !== false,
    })),
  };
}

function emptyCounts() {
  return { total: 0, categoryMatches: 0, triageCount: 0, wrongHighRoutes: 0 };
}

function addRates(counts) {
  return {
    ...counts,
    categoryMatchRate: counts.total ? counts.categoryMatches / counts.total : null,
    triageRate: counts.total ? counts.triageCount / counts.total : null,
  };
}

// route is injected so unit tests evaluate the canonical TypeScript source,
// while the CLI evaluates the very same compiled engine used by the backend.
export function evaluateRoutingHoldout(cases, catalog, route) {
  const overall = emptyCounts();
  const byLanguage = Object.fromEntries(languages.map((language) => [language, emptyCounts()]));
  const mismatches = [];
  const wrongHighRouteCaseIds = [];
  for (const c of cases) {
    if (!byLanguage[c.language] || !categories.includes(c.categoryCode)) {
      throw new Error(`Unsupported manual label/language: ${c.id}`);
    }
    const decision = route(c.input, catalog);
    const matches = decision.effectiveCategoryCode === c.categoryCode;
    const triage = decision.mode === 'TRIAGE';
    // A HIGH disagreement sent to human triage is not a confidently wrong
    // automatic route. Count only HIGH decisions that actually assign an org.
    const wrongHighRoute = !matches && decision.confidenceBand === 'HIGH' && decision.mode === 'ASSIGNED';
    for (const bucket of [overall, byLanguage[c.language]]) {
      bucket.total++;
      if (matches) bucket.categoryMatches++;
      if (triage) bucket.triageCount++;
      if (wrongHighRoute) bucket.wrongHighRoutes++;
    }
    if (!matches) {
      mismatches.push({
        id: c.id, language: c.language, labelledCategoryCode: c.categoryCode,
        predictedCategoryCode: decision.effectiveCategoryCode, mode: decision.mode,
        confidenceBand: decision.confidenceBand, phenomena: c.phenomena,
      });
    }
    if (wrongHighRoute) wrongHighRouteCaseIds.push(c.id);
  }
  return {
    ruleVersion: catalog.ruleVersion,
    sampleKind: 'manually-labelled synthetic diagnostic; not calibrated field accuracy',
    overall: addRates(overall),
    byLanguage: Object.fromEntries(languages.map((language) => [language, addRates(byLanguage[language])])),
    wrongHighRouteCaseIds, mismatches,
  };
}

// Schema v2 deliberately separates intent from the final author/category and
// catalog policy. The old loader/evaluator above remain byte-shape compatible.
export function loadRoutingDataset(file = path.join(root, 'fixtures', 'routing-v2-validation.json')) {
  const sample = JSON.parse(readFileSync(file, 'utf8'));
  if (sample.schemaVersion === 1) return loadRoutingHoldout(file);
  if (sample.schemaVersion !== 2 || sample.syntheticOnly !== true || !sample.datasetVersion
    || !Array.isArray(sample.cases)) throw new Error('Unsupported synthetic evaluation schema');
  const ids = new Set();
  const groups = new Map();
  for (const c of sample.cases) {
    if (!c.id || ids.has(c.id) || !languages.includes(c.language) || !c.groupId || !c.split
      || !Array.isArray(c.phenomena) || !c.gold || typeof c.gold.mustTriage !== 'boolean'
      || !Array.isArray(c.gold.detectedCategories) || !c.gold.detectedCategories.length
      || !Array.isArray(c.gold.effectiveCategories) || !c.gold.effectiveCategories.length
      || !Array.isArray(c.gold.assignedOrganizationCodes)
      || [...c.gold.detectedCategories, ...c.gold.effectiveCategories].some((code) => !categories.includes(code))
      || typeof c.rationale !== 'string' || !c.rationale.trim()
      || !c.input || ['title', 'problem', 'solution'].some((field) => typeof c.input[field] !== 'string')) {
      throw new Error(`Invalid evaluation case: ${c.id || '(missing id)'}`);
    }
    if (groups.has(c.groupId) && groups.get(c.groupId) !== c.split) throw new Error(`Scenario group crosses splits: ${c.groupId}`);
    groups.set(c.groupId, c.split);
    ids.add(c.id);
  }
  return sample;
}

function labelledGold(c, catalog) {
  if (c.gold) return c.gold;
  // Legacy diagnostics never labelled routing-policy gold. Conflicting author
  // choices are preserved, but must be triaged instead of called topic errors.
  const author = c.input.requestedCategoryCode;
  const mustTriage = c.categoryCode === 'OTHER' || (author !== null && author !== c.categoryCode);
  return {
    detectedCategories: [c.categoryCode],
    effectiveCategories: author !== null ? [author] : [c.categoryCode, 'OTHER'],
    mustTriage,
    assignedOrganizationCodes: catalog.rules.filter((rule) => rule.active && rule.categoryCode === c.categoryCode
      && (rule.territoryCode === null || rule.territoryCode === c.input.territoryCode))
      .map((rule) => rule.organizationCode),
  };
}

function detectedCategory(decision) {
  if (Object.hasOwn(decision, 'detectedCategory')) return decision.detectedCategory ?? 'OTHER';
  if (Object.hasOwn(decision, 'detectedCategoryCode')) return decision.detectedCategoryCode ?? 'OTHER';
  // v1 exposes no semantic hypothesis: use its unique top dictionary score,
  // never the applied author category. This is a declared surrogate, not ML.
  const ranked = Object.entries(decision.scores || {}).filter(([code, score]) => categories.includes(code) && score > 0)
    .sort((a, b) => b[1] - a[1]);
  return !ranked.length || ranked[1]?.[1] === ranked[0][1] ? 'OTHER' : ranked[0][0];
}

function selectiveCounts() {
  return { total: 0, semanticMatches: 0, effectiveCategoryMatches: 0, policyMatches: 0,
    assignedCount: 0, wrongAssignedCount: 0, wrongHighAssignedCount: 0,
    triageCount: 0, triageRequiredCount: 0, unsafeAssignmentCount: 0, unavailableCount: 0 };
}

function selectiveRates(counts) {
  return { ...counts,
    semanticMatchRate: counts.total ? counts.semanticMatches / counts.total : null,
    policyMatchRate: counts.total ? counts.policyMatches / counts.total : null,
    coverage: counts.total ? counts.assignedCount / counts.total : null,
    selectiveRisk: counts.assignedCount ? counts.wrongAssignedCount / counts.assignedCount : null,
    triageRate: counts.total ? counts.triageCount / counts.total : null,
    unsafeAssignmentRate: counts.triageRequiredCount ? counts.unsafeAssignmentCount / counts.triageRequiredCount : null };
}

export function evaluatePredictions(cases, catalog, predictions) {
  const indexed = new Map();
  if (Array.isArray(predictions)) {
    for (const item of predictions) {
      if (!item.id || indexed.has(item.id)) throw new Error('Prediction IDs must be unique');
      indexed.set(item.id, item);
    }
  } else {
    for (const [id, decision] of Object.entries(predictions || {})) indexed.set(id, { id, decision });
  }
  const overall = selectiveCounts();
  const byLanguage = Object.fromEntries(languages.map((language) => [language, selectiveCounts()]));
  const byAuthorChoice = { auto: selectiveCounts(), authorSelected: selectiveCounts() };
  const byPhenomenon = {};
  const confusion = {};
  const mismatches = [];
  const versions = new Set();
  const triageOrganizations = new Set(catalog.organizations.filter((organization) => organization.active && organization.isTriage).map((organization) => organization.code));
  for (const c of cases) {
    if (!byLanguage[c.language]) throw new Error(`Unknown case language: ${c.id}`);
    const prediction = indexed.get(c.id);
    if (!prediction) throw new Error(`Missing prediction: ${c.id}`);
    const d = prediction.decision;
    const unavailable = Boolean(prediction.errorCode) || !d || !['ASSIGNED', 'TRIAGE'].includes(d.mode);
    const gold = labelledGold(c, catalog);
    const detected = unavailable ? null : detectedCategory(d);
    const semantic = !unavailable && gold.detectedCategories.includes(detected);
    const effective = !unavailable && gold.effectiveCategories.includes(d.effectiveCategoryCode);
    const assigned = !unavailable && d.mode === 'ASSIGNED';
    const triage = !unavailable && d.mode === 'TRIAGE';
    const wrongAssigned = assigned && (gold.mustTriage || !gold.detectedCategories.includes(d.effectiveCategoryCode)
      || !gold.assignedOrganizationCodes.includes(d.organizationCode));
    const policy = !unavailable && effective && (triage ? triageOrganizations.has(d.organizationCode) : !wrongAssigned);
    const buckets = [overall, byLanguage[c.language], byAuthorChoice[c.input.requestedCategoryCode === null ? 'auto' : 'authorSelected']];
    for (const phenomenon of c.phenomena || []) {
      byPhenomenon[phenomenon] ||= selectiveCounts();
      buckets.push(byPhenomenon[phenomenon]);
    }
    for (const bucket of buckets) {
      bucket.total++;
      if (semantic) bucket.semanticMatches++;
      if (effective) bucket.effectiveCategoryMatches++;
      if (policy) bucket.policyMatches++;
      if (assigned) bucket.assignedCount++;
      if (wrongAssigned) bucket.wrongAssignedCount++;
      if (wrongAssigned && d.confidenceBand === 'HIGH') bucket.wrongHighAssignedCount++;
      if (triage) bucket.triageCount++;
      if (gold.mustTriage) bucket.triageRequiredCount++;
      if (gold.mustTriage && assigned) bucket.unsafeAssignmentCount++;
      if (unavailable) bucket.unavailableCount++;
    }
    const label = gold.detectedCategories.length === 1 ? gold.detectedCategories[0] : 'MULTIPLE_ACCEPTABLE';
    confusion[label] ||= {};
    const predicted = detected ?? 'UNAVAILABLE';
    confusion[label][predicted] = (confusion[label][predicted] || 0) + 1;
    if (d?.ruleVersion) versions.add(d.ruleVersion);
    if (!semantic || !policy || unavailable) mismatches.push({ id: c.id, language: c.language,
      semanticMatch: semantic, policyMatch: policy, expectedDetectedCategories: gold.detectedCategories,
      expectedEffectiveCategories: gold.effectiveCategories, mustTriage: gold.mustTriage,
      detectedCategory: detected, effectiveCategory: d?.effectiveCategoryCode ?? null,
      organizationCode: d?.organizationCode ?? null, mode: d?.mode ?? null,
      confidenceBand: d?.confidenceBand ?? null, phenomena: c.phenomena,
      ...(unavailable ? { errorCode: prediction.errorCode || 'INVALID_PREDICTION' } : {}) });
  }
  return { schemaVersion: 2, sampleKind: 'synthetic validation/regression; native Kazakh review not performed; not field accuracy',
    catalogVersion: catalog.ruleVersion, ruleVersions: [...versions],
    semanticV1Note: 'For v1 only, semantic prediction is a unique highest dictionary score; missing/tied evidence maps to OTHER.',
    overall: selectiveRates(overall),
    byLanguage: Object.fromEntries(Object.entries(byLanguage).map(([key, value]) => [key, selectiveRates(value)])),
    byAuthorChoice: Object.fromEntries(Object.entries(byAuthorChoice).map(([key, value]) => [key, selectiveRates(value)])),
    byPhenomenon: Object.fromEntries(Object.entries(byPhenomenon).map(([key, value]) => [key, selectiveRates(value)])),
    confusion, mismatches };
}

export function evaluateRoutingDataset(cases, catalog, route) {
  const predictions = cases.map((c) => {
    try {
      const decision = route(c.input, catalog);
      if (decision?.then) throw new Error('Use evaluateRoutingDatasetAsync for async classifiers');
      return { id: c.id, decision };
    } catch (error) {
      if (/evaluateRoutingDatasetAsync/.test(error.message)) throw error;
      return { id: c.id, errorCode: error.code || error.name || 'PREDICTION_FAILED' };
    }
  });
  return evaluatePredictions(cases, catalog, predictions);
}

// Model/network callers inject a function; this module installs no models and
// creates no API/DB data. One request in flight by default, maximum two.
export async function evaluateRoutingDatasetAsync(cases, catalog, route,
  { concurrency = 1, minIntervalMs = 1000, timeoutMs = 30000 } = {}) {
  if (![1, 2].includes(concurrency) || !Number.isSafeInteger(minIntervalMs) || minIntervalMs < 0
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new Error('Invalid bounded evaluator options');
  const predictions = [];
  let index = 0, nextStart = 0, stopped = false;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (!stopped && index < cases.length) {
      const c = cases[index++];
      const wait = Math.max(0, nextStart - Date.now());
      nextStart = Math.max(Date.now(), nextStart) + minIntervalMs;
      if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
      if (stopped) break;
      const controller = new AbortController();
      let timer;
      try {
        const timeout = new Promise((_resolve, reject) => { timer = setTimeout(() => {
          controller.abort(); const error = new Error('Classifier deadline exceeded'); error.code = 'PREDICTION_TIMEOUT'; reject(error);
        }, timeoutMs); });
        const decision = await Promise.race([route(c.input, catalog, { signal: controller.signal, caseId: c.id }), timeout]);
        predictions.push({ id: c.id, decision });
      } catch (error) {
        if (error.code === 'PREDICTION_TIMEOUT') {
          // A provider may ignore cancellation. Stop scheduling any more work
          // rather than silently exceed the requested in-flight bound.
          stopped = true;
          throw error;
        }
        if (error.code === 'RATE_LIMITED' || error.status === 429) {
          stopped = true;
          const blocked = new Error('Evaluation stopped on provider rate limit'); blocked.code = 'RATE_LIMITED'; throw blocked;
        }
        predictions.push({ id: c.id, errorCode: error.code || error.name || 'PREDICTION_FAILED' });
      } finally { clearTimeout(timer); }
    }
  }));
  return { ...evaluatePredictions(cases, catalog, predictions), predictions };
}

export function compareRoutingDatasets(cases, catalog, baseline, candidate) {
  const oldPredictions = cases.map((c) => ({ id: c.id, decision: baseline(c.input, catalog) }));
  const newPredictions = cases.map((c) => ({ id: c.id, decision: candidate(c.input, catalog) }));
  const baselineReport = evaluatePredictions(cases, catalog, oldPredictions);
  const candidateReport = evaluatePredictions(cases, catalog, newPredictions);
  const changed = cases.flatMap((c, index) => {
    const a = oldPredictions[index].decision, b = newPredictions[index].decision;
    return a.effectiveCategoryCode === b.effectiveCategoryCode && a.mode === b.mode
      && a.organizationCode === b.organizationCode && detectedCategory(a) === detectedCategory(b) ? [] : [{ id: c.id, language: c.language,
      baseline: { detectedCategory: detectedCategory(a), effectiveCategory: a.effectiveCategoryCode, mode: a.mode, organization: a.organizationCode },
      candidate: { detectedCategory: detectedCategory(b), effectiveCategory: b.effectiveCategoryCode, mode: b.mode, organization: b.organizationCode } }];
  });
  return { baseline: baselineReport, candidate: candidateReport, changed,
    disagreementCount: changed.length, disagreementRate: cases.length ? changed.length / cases.length : null };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log('node scripts/evaluate-routing.mjs [--version rules-v1|rules-v2] [--compare] [--dataset PATH] [--predictions PATH] [--output PATH]');
    return;
  }
  const options = { version: 'rules-v1' };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--compare') { options.compare = true; continue; }
    if (!['--version', '--dataset', '--output', '--predictions'].includes(arg) || !args[index + 1] || args[index + 1].startsWith('--')) {
      throw new Error('Unknown or incomplete evaluator argument; use --help');
    }
    options[arg.slice(2)] = args[++index];
  }
  if (!['rules-v1', 'rules-v2'].includes(options.version)) throw new Error('Unknown routing engine version');
  const sample = options.dataset ? loadRoutingDataset(path.resolve(options.dataset)) : loadRoutingHoldout();
  const catalog = syntheticRoutingCatalog();
  const load = async (version) => {
    try { return (await import(version === 'rules-v1' ? '../dist/routing/rules.mjs' : '../dist/routing/rules-v2.mjs')).routeIdea; }
    catch (cause) { throw new Error(`Build the ${version} engine first: node scripts/build-routing.mjs`, { cause }); }
  };
  let report;
  if (options.predictions) {
    const predictions = JSON.parse(readFileSync(path.resolve(options.predictions), 'utf8'));
    report = evaluatePredictions(sample.cases, catalog, predictions.predictions || predictions);
  } else if (options.compare) report = compareRoutingDatasets(sample.cases, catalog, await load('rules-v1'), await load('rules-v2'));
  else if (sample.schemaVersion === 1 && options.version === 'rules-v1') {
    report = evaluateRoutingHoldout(sample.cases, catalog, await load(options.version));
  } else report = evaluateRoutingDataset(sample.cases, catalog, await load(options.version));
  report.datasetVersion = sample.datasetVersion || 'legacy-40-diagnostic';
  if (options.output) writeFileSync(path.resolve(options.output), JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify({
    sampleKind: report.sampleKind, overall: report.overall, byLanguage: report.byLanguage,
    wrongHighRouteCaseIds: report.wrongHighRouteCaseIds,
    ...(report.baseline ? { baseline: report.baseline.overall, candidate: report.candidate.overall,
      disagreementCount: report.disagreementCount, disagreementRate: report.disagreementRate } : {}),
    datasetVersion: report.datasetVersion,
    ...(options.output ? { reportPath: path.resolve(options.output) } : {}),
  }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
