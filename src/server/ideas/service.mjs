// Citizen idea services: draft create/patch, submit with routing decision.
// Row lock + expectedVersion inside one transaction; no external AI on this
// path (P0). Point-in-time reads return the stored version for conflicts.
import { validateDraftPatch, validateSubmitFields, cleanText } from './validate.mjs';
import {
  canonicalHash, findReplay, requireKey, beginKeyedOp, finishKeyedOp,
} from './idempotency.mjs';
import { loadRoutingEngine, buildCatalogSnapshot } from '../routing/adapter.mjs';
import { audit, notify } from '../audit/log.mjs';
import { CONSENT_VERSION } from '../../contracts/enums.mjs';

export function versionConflict(current) {
  const err = new Error('Карточка изменилась: обновите данные');
  err.code = 'VERSION_CONFLICT';
  err.currentVersion = current;
  throw err;
}

async function ownDraft(db, actor, ideaId) {
  const row = await db.query('SELECT * FROM ideas WHERE id=$1', [ideaId]);
  const idea = row.rows[0];
  if (!idea || idea.author_id !== actor.id) {
    const err = new Error('Не найдено');
    err.code = 'NOT_FOUND';
    throw err;
  }
  return idea;
}

async function checkTerritory(db, territoryId) {
  if (!territoryId) return;
  const row = await db.query('SELECT id, active FROM territories WHERE id=$1', [territoryId]);
  if (row.rows.length === 0 || !row.rows[0].active) {
    const err = new Error('Проверьте заполнение формы');
    err.code = 'VALIDATION_ERROR';
    err.fields = { territoryId: 'Территория вне активного справочника' };
    throw err;
  }
}

export async function createDraft(db, actor, body, key, requestId) {
  requireKey(key);
  const hash = canonicalHash({ op: 'idea.create', body });
  const replay = await findReplay(db, actor.id, 'idea.create', key, hash);
  if (replay) return replay;
  const patch = validateDraftPatch(body || {});
  await checkTerritory(db, patch.territory_id);
  return db.transaction(async (tx) => {
    const slot = await beginKeyedOp(tx, actor.id, 'idea.create', key, hash);
    if (slot.replay) return slot.replay;
    const ins = await tx.query(
      `INSERT INTO ideas(region_id, author_id, title, problem, solution, expected_benefit,
         requested_category_code, territory_id, location_text, status)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'DRAFT')
       RETURNING id, version`,
      [actor.regionId, actor.id, patch.title || '', patch.problem || '', patch.solution || '',
        patch.expectedBenefit ?? null, patch.requested_category_code ?? null,
        patch.territory_id ?? null, patch.locationText ?? null]);
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
  const patch = validateDraftPatch(body || {});
  if (typeof body.expectedVersion !== 'number') {
    const err = new Error('Требуется expectedVersion');
    err.code = 'VALIDATION_ERROR';
    err.fields = { expectedVersion: 'Обновите карточку и повторите' };
    throw err;
  }
  return db.transaction(async (tx) => {
    const locked = await tx.query('SELECT * FROM ideas WHERE id=$1 FOR UPDATE', [ideaId]);
    const idea = locked.rows[0];
    if (!idea || idea.author_id !== actor.id) {
      const err = new Error('Не найдено');
      err.code = 'NOT_FOUND';
      throw err;
    }
    if (idea.status !== 'DRAFT') {
      const err = new Error('Отправленная идея не редактируется');
      err.code = 'INVALID_TRANSITION';
      throw err;
    }
    if (idea.version !== body.expectedVersion) versionConflict(idea.version);
    await checkTerritory(tx, patch.territory_id);
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

export async function submitIdea(db, actor, ideaId, body, key, requestId) {
  requireKey(key);
  const hash = canonicalHash({ op: 'idea.submit', idea: ideaId, body });
  const replay = await findReplay(db, actor.id, 'idea.submit', key, hash);
  if (replay) return replay;
  if (body?.consentAccepted !== true) {
    const err = new Error('Проверьте заполнение формы');
    err.code = 'VALIDATION_ERROR';
    err.fields = { consentAccepted: 'Необходимо согласие' };
    throw err;
  }
  if (typeof body?.expectedVersion !== 'number') {
    const err = new Error('Требуется expectedVersion');
    err.code = 'VALIDATION_ERROR';
    err.fields = { expectedVersion: 'Обновите карточку и повторите' };
    throw err;
  }
  const draft = await ownDraft(db, actor, ideaId);
  if (draft.status !== 'DRAFT') {
    const err = new Error('Идея уже отправлена');
    err.code = 'INVALID_TRANSITION';
    throw err;
  }
  // Full validation on the submitted text BEFORE routing.
  const { title, problem, solution } = validateSubmitFields(draft);

  // Routing runs BEFORE the transaction on the submitted text version (D-01).
  const engine = await loadRoutingEngine();
  const snapshot = await buildCatalogSnapshot(db, draft.region_id);
  const terr = await db.query('SELECT code FROM territories WHERE id=$1', [draft.territory_id]);
  let decision;
  try {
    decision = engine.routeIdea({
      title, problem, solution,
      requestedCategoryCode: draft.requested_category_code,
      territoryCode: terr.rows[0]?.code,
    }, snapshot);
  } catch (e) {
    if (e && (e.name === 'RoutingInputError' || e.code === 'ROUTING_INPUT')) {
      const err = new Error('Проверьте заполнение формы');
      err.code = 'VALIDATION_ERROR';
      err.fields = { [e.field || 'territoryId']: e.message };
      throw err;
    }
    throw e;
  }
  const orgRow = await db.query(
    'SELECT id FROM organizations WHERE code=$1 AND region_id=$2',
    [decision.organizationCode, draft.region_id]);
  if (orgRow.rows.length === 0) {
    const err = new Error('Сервис временно недоступен');
    err.code = 'SERVICE_UNAVAILABLE';
    throw err;
  }

  return db.transaction(async (tx) => {
    const slot = await beginKeyedOp(tx, actor.id, 'idea.submit', key, hash);
    if (slot.replay) return slot.replay;
    const locked = await tx.query('SELECT * FROM ideas WHERE id=$1 FOR UPDATE', [ideaId]);
    const idea = locked.rows[0];
    if (!idea || idea.author_id !== actor.id || idea.status !== 'DRAFT') {
      const err = new Error('Идея уже отправлена');
      err.code = 'INVALID_TRANSITION';
      throw err;
    }
    if (idea.version !== body.expectedVersion) versionConflict(idea.version);

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
         explanation, rule_version)
       VALUES($1,'RULES',$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [ideaId, decision.mode, decision.effectiveCategoryCode, orgRow.rows[0].id,
        JSON.stringify(decision.tags), decision.confidenceBand,
        JSON.stringify(decision.scores), JSON.stringify(decision.reasonCodes),
        decision.explanation, decision.ruleVersion]);
    const ev = await tx.query(
      `INSERT INTO idea_events(idea_id, type, actor_id, visibility, from_status, to_status, payload_json)
       VALUES($1,'SUBMITTED',$2,'PUBLIC','DRAFT','RECEIVED',$3) RETURNING id`,
      [ideaId, actor.id, JSON.stringify({ publicNumber })]);
    await notify(tx, {
      recipientId: actor.id, ideaId, eventId: ev.rows[0].id,
      kind: 'IDEA_REGISTERED', title: `Идея ${publicNumber} зарегистрирована`,
    });
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
      },
    };
    await finishKeyedOp(tx, actor.id, 'idea.submit', key, 200, responseBody);
    return { status: 200, body: responseBody };
  });
}

export { cleanText };
