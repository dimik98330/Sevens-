// B-owned adapter over D's single rules engine. The engine is compiled by
// scripts/build-routing.mjs before deployment, not on a citizen request.

import { semanticClassifier, semanticTextHash } from './semantic.mjs';
const cached = new Map();

export function activeClassifierVersion() {
  const version=process.env.ROUTING_CLASSIFIER_VERSION || 'rules-v2';
  if(!['rules-v1','rules-v2'].includes(version))throw new Error('Unsupported routing classifier version');
  return version;
}

export async function loadRoutingEngine() {
  const version=activeClassifierVersion();
  if(cached.has(version))return cached.get(version);
  const legacy=await import('../../../dist/routing/rules.mjs');
  const engine=version==='rules-v1'?legacy:{...await import('../../../dist/routing/rules-v2.mjs'),manualReroute:legacy.manualReroute};
  cached.set(version,engine);
  return engine;
}

export async function prepareClassification(input, classifier=semanticClassifier, context={}) {
  if(activeClassifierVersion()==='rules-v1')return null;
  return classifier.prepare(input,context);
}

export function routePrepared(engine,input,catalog,prepared) {
  const valid=prepared?.status==='READY' && prepared.hash===semanticTextHash(input) && engine.routeAnalyzed;
  let candidate=prepared?.result;
  if(valid) {
    const guard=engine.analyzeRoutingText(input);
    const reasons=guard.reasonCodes.filter((reason)=>['POLARITY_UNRESOLVED','MULTIPLE_PRIMARY_TOPICS'].includes(reason));
    const detected=candidate.detectedCategoryCode;
    const occurrences=(guard.occurrences||[]).filter((o)=>o.categoryCode===detected&&o.weight>=3);
    if(occurrences.length&&occurrences.every((o)=>o.state==='EXCLUDED'||o.state==='BACKGROUND')) {
      reasons.push('MODEL_CONTEXT_CONFLICT');
    }
    if(input.requestedCategoryCode&&detected!=='OTHER'&&input.requestedCategoryCode!==detected)reasons.push('CATEGORY_CONFLICT');
    if(guard.confidenceBand==='HIGH'&&!guard.needsReview
      &&guard.detectedCategoryCode&&detected!==guard.detectedCategoryCode)reasons.push('MODEL_RULES_DISAGREEMENT');
    // Municipal waste collection overlaps the demo ecology/utilities boundary.
    // An AUTO request without an explicit service scope goes to a specialist.
    const text=[input.title,input.problem,input.solution].join(' ').toLowerCase();
    const waste=/мусор|отход|контейнер|қалдық|қоқыс/u.test(text);
    const collection=/вывоз|сбор|собира|жина|тазалау|толуын/u.test(text);
    const clearScope=/раздельн|сортиров|переработ|сұрып|қайта өң|жкх|коммуналь|коммуналдық/u.test(text);
    if(!input.requestedCategoryCode&&['UTILITIES','ECOLOGY'].includes(detected)&&waste&&collection&&!clearScope)reasons.push('CATALOG_BOUNDARY_AMBIGUOUS');
    candidate={...candidate,needsReview:candidate.needsReview||reasons.length>0,
      reasonCodes:[...new Set([...(candidate.reasonCodes||[]),...reasons])]};
  }
  const decision=valid ? engine.routeAnalyzed(input,catalog,candidate) : engine.routeIdea(input,catalog);
  if(decision.ruleVersion==='rules-v1')return decision;
  const classificationSource=valid?'MODEL':'RULES';
  const classifierStatus=valid?'READY':'FALLBACK';
  const modelMetadata=valid?{model:prepared.model,semanticVersion:'semantic-v1'}:{};
  return {...decision,ruleVersion:valid?'hybrid-v2':decision.ruleVersion,
    catalogVersion:'rules-v1',classificationSource,classifierStatus,
    classificationMethod:valid?(prepared.method||'LLM'):'RULES',
    analysis:{...(decision.analysis||{}),detectedCategoryCode:decision.detectedCategoryCode??null,
      classificationSource,classifierStatus,catalogVersion:'rules-v1',...modelMetadata,
      classificationMethod:valid?(prepared.method||'LLM'):'RULES',
      ...(prepared?.reason?{fallbackReason:prepared.reason}:{})},
  };
}

// Catalog snapshot for routeIdea, built from the current DB state (B-owned).
export async function buildCatalogSnapshot(db, regionId) {
  const territories = await db.query(
    `SELECT code, active FROM territories WHERE region_id=$1`, [regionId]);
  const orgs = await db.query(
    `SELECT code, name, active, is_triage AS "isTriage" FROM organizations WHERE region_id=$1`,
    [regionId]);
  const rules = await db.query(
    `SELECT r.category_code AS "categoryCode",
            (SELECT code FROM organizations o WHERE o.id=r.organization_id) AS "organizationCode",
            (SELECT code FROM territories t WHERE t.id=r.territory_id) AS "territoryCode",
            r.priority, r.active
     FROM routing_rules r WHERE r.region_id=$1 AND r.version='rules-v1'`,
    [regionId]);
  return {
    ruleVersion: 'rules-v1',
    territories: territories.rows,
    organizations: orgs.rows,
    rules: rules.rows.map((r) => ({ ...r, territoryCode: r.territoryCode })),
  };
}
