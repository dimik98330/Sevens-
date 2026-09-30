// Citizen idea services: draft create/patch, submit with routing decision.
// Row lock + expectedVersion inside one transaction. Optional LLM analysis
// runs before the transaction and is bound to the locked text by its hash.
import { validateDraftPatch, validateSubmitFields, cleanText } from './validate.mjs';
import {
  canonicalHash, requireKey, beginKeyedOp, finishKeyedOp,
} from './idempotency.mjs';
import { loadRoutingEngine, buildCatalogSnapshot, prepareClassification, routePrepared } from '../routing/adapter.mjs';
import { semanticClassifier } from '../routing/semantic.mjs';
import { audit, notify } from '../audit/log.mjs';
import { CONSENT_VERSION } from '../../contracts/enums.mjs';
import { lockIdeaForActor, forbidden } from '../policies/scopes.mjs';
import { requestFields, positiveVersion, uuidField, booleanField } from './request-validation.mjs';
import { submitLimiter } from '../auth/rateLimit.mjs';

export function versionConflict(current) {
  const err = new Error('Карточка изменилась: обновите данные');
  err.code = 'VERSION_CONFLICT';
  err.currentVersion = current;
  throw err;
}

function requireCitizen(actor) {
  if (actor.role !== 'CITIZEN') forbidden();
}

async function checkTerritory(db, territoryId, regionId) {
  if (!territoryId) return;
  const row = await db.query(
    'SELECT id, active FROM territories WHERE id=$1 AND region_id=$2',
    [territoryId, regionId]);
  if (row.rows.length === 0 || !row.rows[0].active) {
    const err = new Error('Проверьте заполнение формы');
    err.code = 'VALIDATION_ERROR';
    err.fields = { territoryId: 'Территория вне активного справочника' };
    throw err;
  }
}

export async function createDraft(db, actor, body, key, requestId) {
  requireCitizen(actor);
  requireKey(key);
  const hash = canonicalHash({ op: 'idea.create', body });
  const patch = validateDraftPatch(body);
  return db.transaction(async (tx) => {
    const slot = await beginKeyedOp(tx, actor.id, 'idea.create', key, hash);
    if (slot.replay) {
      await lockIdeaForActor(tx, actor, slot.replay.body.id);
      return slot.replay;
    }
    await checkTerritory(tx, patch.territory_id, actor.regionId);
    const ins = await tx.query(
      `INSERT INTO ideas(region_id, author_id, title, problem, solution, expected_benefit,
         requested_category_code, territory_id, location_text, location_geometry, status)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,'DRAFT')
       RETURNING id, version`,
      [actor.regionId, actor.id, patch.title || '', patch.problem || '', patch.solution || '',
        patch.expectedBenefit ?? null, patch.requested_category_code ?? null,
        patch.territory_id ?? null, patch.locationText ?? null,
        patch.locationGeometry == null ? null : JSON.stringify(patch.locationGeometry)]);
    const idea = ins.rows[0];
    await tx.query(
      `INSERT INTO idea_events(idea_id, type, actor_id, visibility, payload_json)
       VALUES($1,'CREATED',$2,'PUBLIC','{}')`,
      [idea.id, actor.id]);
    await audit(tx, {
      regionId: actor.regionId, actorId: actor.id, action: 'idea.create',
      entityType: 'idea', entityId: idea.id, requestId,
    });
    const response = { status: 201, body: { id: idea.id, version: idea.version } };
    await finishKeyedOp(tx, actor.id, 'idea.create', key, response.status, response.body);
    return response;
  });
}

export async function updateDraft(db, actor, ideaId, body, requestId) {
  requireCitizen(actor);
  uuidField(ideaId, 'ideaId');
  const patch = validateDraftPatch(body, { withVersion: true });
  return db.transaction(async (tx) => {
    const idea = await lockIdeaForActor(tx, actor, ideaId);
    if (idea.version !== body.expectedVersion) versionConflict(idea.version);
    if (idea.status !== 'DRAFT') {
      const err = new Error('Отправленная идея не редактируется');
      err.code = 'INVALID_TRANSITION';
      throw err;
    }
    await checkTerritory(tx, patch.territory_id, actor.regionId);
    const sets = [];
    const params = [];
    const map = {
      title: 'title', problem: 'problem', solution: 'solution',
      expectedBenefit: 'expected_benefit', locationText: 'location_text',
    };
    for (const [patchKey, column] of Object.entries(map)) {
      if (patch[patchKey] !== undefined) {
        params.push(patch[patchKey]);
        sets.push(`${column}=$${params.length}`);
      }
    }
    if (patch.requested_category_code !== undefined) {
      params.push(patch.requested_category_code);
      sets.push(`requested_category_code=$${params.length}`);
    }
    if (patch.territory_id !== undefined) {
      params.push(patch.territory_id);
      sets.push(`territory_id=$${params.length}`);
    }
    if (patch.locationGeometry !== undefined) {
      params.push(patch.locationGeometry === null ? null : JSON.stringify(patch.locationGeometry));
      sets.push(`location_geometry=$${params.length}::jsonb`);
    }
    const textChanged = ['title', 'problem', 'solution'].some((k) => patch[k] !== undefined);
    sets.push(textChanged ? 'content_revision=content_revision+1' : 'content_revision=content_revision');
    sets.push('version=version+1');
    params.push(ideaId);
    const updated = await tx.query(
      `UPDATE ideas SET ${sets.join(', ')} WHERE id=$${params.length} RETURNING version`,
      params);
    return { status: 200, body: { id: ideaId, version: updated.rows[0].version } };
  });
}

export async function submitIdea(db, actor, ideaId, body, key, requestId, classifier=semanticClassifier) {
  requireCitizen(actor);
  uuidField(ideaId, 'ideaId');
  requestFields(body, ['expectedVersion', 'consentAccepted'], ['expectedVersion', 'consentAccepted']);
  positiveVersion(body.expectedVersion);
  booleanField(body.consentAccepted, 'consentAccepted');
  requireKey(key);
  const hash = canonicalHash({ op: 'idea.submit', idea: ideaId, body });
  if (body?.consentAccepted !== true) {
    const err = new Error('Проверьте заполнение формы');
    err.code = 'VALIDATION_ERROR';
    err.fields = { consentAccepted: 'Необходимо согласие' };
    throw err;
  }
  // Import is local; every business read and pure route uses the locked row.
  const engine = await loadRoutingEngine();
  // Provider work is outside row locks. The result is applied only if its
  // text hash still equals the authoritative locked row below.
  let prepared=null;
  if(classifier.enabled) {
    const preflight=await db.query('SELECT * FROM ideas WHERE id=$1 AND author_id=$2 AND region_id=$3',
      [ideaId,actor.id,actor.regionId]);
    const draft=preflight.rows[0];
    if(draft?.status==='DRAFT'&&draft.version===body.expectedVersion) {
      validateSubmitFields(draft);
      await checkTerritory(db,draft.territory_id,actor.regionId);
      const retryAfterSeconds=submitLimiter.retryAfter(`submit:${actor.id}`,10,3600);
      if(retryAfterSeconds){
        const error=new Error('Слишком много отправок: повторите позже');
        error.code='RATE_LIMITED';error.retryAfterSeconds=retryAfterSeconds;throw error;
      }
      prepared=await prepareClassification(draft,classifier,{actorId:actor.id});
    }
  }
  return db.transaction(async (tx) => {
    const slot = await beginKeyedOp(tx, actor.id, 'idea.submit', key, hash);
    const idea = await lockIdeaForActor(tx, actor, ideaId);
    if (slot.replay) return slot.replay;
    if (idea.version !== body.expectedVersion) versionConflict(idea.version);
    if (idea.status !== 'DRAFT') {
      const err = new Error('Идея уже отправлена');
      err.code = 'INVALID_TRANSITION';
      throw err;
    }
    const { title, problem, solution } = validateSubmitFields(idea);
    await checkTerritory(tx, idea.territory_id, idea.region_id);
    // A saved response consumes no quota. New admitted submissions do, even
    // if later infrastructure work fails, so failed requests cannot flood it.
    const retryAfterSeconds = submitLimiter.check(`submit:${actor.id}`, 10, 3600);
    if (retryAfterSeconds) {
      const err = new Error('Слишком много отправок: повторите позже');
      err.code = 'RATE_LIMITED';
      err.retryAfterSeconds = retryAfterSeconds;
      throw err;
    }
    const snapshot = await buildCatalogSnapshot(tx, idea.region_id);
    const terr = await tx.query('SELECT code FROM territories WHERE id=$1', [idea.territory_id]);
    let decision;
    try {
      decision = routePrepared(engine,{
        title, problem, solution,
        requestedCategoryCode: idea.requested_category_code,
        territoryCode: terr.rows[0]?.code,
      }, snapshot,prepared);
    } catch (error) {
      if (error && (error.name === 'RoutingInputError' || error.code === 'ROUTING_INPUT')) {
        const err = new Error('Проверьте заполнение формы');
        err.code = 'VALIDATION_ERROR';
        const field = error.field === 'territoryCode' ? 'territoryId' : error.field || 'territoryId';
        err.fields = { [field]: error.message };
        throw err;
      }
      throw error;
    }
    const orgRow = await tx.query(
      'SELECT id FROM organizations WHERE code=$1 AND region_id=$2 AND active FOR SHARE',
      [decision.organizationCode, idea.region_id]);
    if (orgRow.rows.length === 0) {
      const err = new Error('Сервис временно недоступен');
      err.code = 'SERVICE_UNAVAILABLE';
      throw err;
    }

    const seq = await tx.query(`SELECT nextval('idea_number_seq') AS n`);
    const year = new Date().getUTCFullYear();
    const publicNumber = `ABAI-${year}-${String(seq.rows[0].n).padStart(6, '0')}`;
    const upd = await tx.query(
      `UPDATE ideas SET title=$1, problem=$2, solution=$3, status='RECEIVED',
         public_number=$4, submitted_at=now(),
         effective_category_code=$5, organization_id=$6,
         consent_version=$7, consent_at=now(), version=version+1
       WHERE id=$8 RETURNING version`,
      [title, problem, solution, publicNumber, decision.effectiveCategoryCode,
        orgRow.rows[0].id, CONSENT_VERSION, ideaId]);
    await tx.query(
      `INSERT INTO routing_decisions(idea_id, source, mode, effective_category_code,
         organization_id, tags_json, confidence_band, scores_json, reason_codes_json,
         explanation, rule_version, analysis_json)
       VALUES($1,'RULES',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`,
      [ideaId, decision.mode, decision.effectiveCategoryCode, orgRow.rows[0].id,
        JSON.stringify(decision.tags), decision.confidenceBand,
        JSON.stringify(decision.scores), JSON.stringify(decision.reasonCodes),
        decision.explanation, decision.ruleVersion,decision.analysis?JSON.stringify(decision.analysis):null]);
    const ev = await tx.query(
      `INSERT INTO idea_events(idea_id, type, actor_id, visibility, from_status, to_status, payload_json)
       VALUES($1,'SUBMITTED',$2,'PUBLIC','DRAFT','RECEIVED',$3) RETURNING id`,
      [ideaId, actor.id, JSON.stringify({ publicNumber })]);
    await notify(tx, {
      recipientId: actor.id, ideaId, eventId: ev.rows[0].id,
      kind: 'IDEA_REGISTERED', title: `Идея ${publicNumber} зарегистрирована`,
    });
    const staff = await tx.query(
      `SELECT id FROM users WHERE organization_id=$1 AND region_id=$2
         AND active AND role IN ('STAFF','ADMIN')`, [orgRow.rows[0].id, idea.region_id]);
    for (const recipient of staff.rows) {
      await notify(tx, {
        recipientId: recipient.id, ideaId, eventId: ev.rows[0].id,
        kind: 'IDEA_REGISTERED', title: `Новая идея ${publicNumber} в очереди организации`,
      });
    }
    await audit(tx, {
      regionId: idea.region_id, actorId: actor.id, action: 'idea.submit',
      entityType: 'idea', entityId: ideaId, requestId,
      metadata: { publicNumber, organizationCode: decision.organizationCode },
    });
    const responseBody = {
      id: ideaId,
      publicNumber,
      status: 'RECEIVED',
      version: upd.rows[0].version,
      routing: {
        source: 'RULES',
        mode: decision.mode,
        effectiveCategoryCode: decision.effectiveCategoryCode,
        organizationCode: decision.organizationCode,
        tags: decision.tags,
        confidenceBand: decision.confidenceBand,
        ruleVersion: decision.ruleVersion,
        explanation: decision.explanation,
        detectedCategoryCode: decision.detectedCategoryCode??null,
        catalogVersion: decision.catalogVersion??'rules-v1',
        classificationSource: decision.classificationSource??'RULES',
        classifierStatus: decision.classifierStatus??'FALLBACK',
        classificationMethod: decision.classificationMethod??'RULES',
      },
    };
    await finishKeyedOp(tx, actor.id, 'idea.submit', key, 200, responseBody);
    return { status: 200, body: responseBody };
  });
}

export { cleanText };
