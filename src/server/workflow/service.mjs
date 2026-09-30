// Staff workflow services (B-04): assignment, status transitions, comments,
// admin reroute, clarification answers. Every mutation is one transaction
// over status + comment + event + audit + notification (invariant 10).
// Version check and idempotency slot come first, in that order: a stored
// success replays before the version check; a new body with the same key
// is a conflict.
import {
  canonicalHash, requireKey, beginKeyedOp, finishKeyedOp,
} from '../ideas/idempotency.mjs';
import { versionConflict } from '../ideas/service.mjs';
import { cleanText, codePoints, LIMITS } from '../ideas/validate.mjs';
import { lockIdeaForActor, requireStaff, requireAdmin, staffListScope } from '../policies/scopes.mjs';
import { isTransitionAllowed, REQUIRES_PUBLIC_COMMENT, REQUIRES_ASSIGNEE, REROUTE_FROM } from '../../contracts/transitions.mjs';
import { RESOLUTION_TYPES, IDEA_STATUSES, CATEGORY_CODES } from '../../contracts/enums.mjs';
import { loadRoutingEngine, buildCatalogSnapshot } from '../routing/adapter.mjs';
import { audit, notify } from '../audit/log.mjs';
import { requestFields, positiveVersion, uuidField, booleanField } from '../ideas/request-validation.mjs';
import { recordPublishedStatus } from '../showcase/service.mjs';

function bad(what, fields) {
  const err = new Error(what);
  err.code = 'VALIDATION_ERROR';
  err.fields = fields;
  throw err;
}

function invalidTransition(message = 'Недопустимый переход статуса') {
  const err = new Error(message);
  err.code = 'INVALID_TRANSITION';
  throw err;
}

function checkCommentLength(body, min, max, field = 'publicComment') {
  const v = cleanText(body);
  if (typeof body !== 'string' || codePoints(v) < min || codePoints(v) > max) {
    bad('Проверьте текст сообщения', { [field]: `Текст: ${min}–${max} символов` });
  }
  return v;
}

// Staff-visible idea with row lock; region/org enforced by the policy layer.
async function lockedStaffIdea(tx, actor, ideaId) {
  return lockIdeaForActor(tx, actor, ideaId);
}

async function staffName(tx, userId) {
  if (!userId) return null;
  const row = await tx.query('SELECT display_name FROM users WHERE id=$1', [userId]);
  return row.rows[0]?.display_name || null;
}

async function activeStaffInOrg(tx, userId, orgId, regionId) {
  const row = await tx.query(
    'SELECT id, role, active FROM users WHERE id=$1 AND organization_id=$2 AND region_id=$3',
    [userId, orgId, regionId]);
  const u = row.rows[0];
  if (!u || !u.active || (u.role !== 'STAFF' && u.role !== 'ADMIN')) {
    bad('Некорректный ответственный', { assigneeId: 'Сотрудник не найден в текущей организации' });
  }
  return u;
}

async function orgStaffIds(tx, orgId) {
  const rows = await tx.query(
    `SELECT id FROM users WHERE organization_id=$1 AND active AND role IN ('STAFF','ADMIN')`,
    [orgId]);
  return rows.rows.map((r) => r.id);
}

export async function assignIdea(db, actor, ideaId, body, key, requestId) {
  requireStaff(actor);
  uuidField(ideaId, 'ideaId');
  requestFields(body, ['expectedVersion', 'assigneeId'], ['expectedVersion', 'assigneeId']);
  positiveVersion(body.expectedVersion);
  uuidField(body.assigneeId, 'assigneeId', { nullable: true });
  requireKey(key);
  const hash = canonicalHash({ op: 'idea.assign', idea: ideaId, body });
  return db.transaction(async (tx) => {
    const slot = await beginKeyedOp(tx, actor.id, 'idea.assign', key, hash);
    const idea = await lockedStaffIdea(tx, actor, ideaId);
    if (slot.replay) return slot.replay;
    if (idea.version !== body.expectedVersion) versionConflict(idea.version);
    if (idea.status === 'COMPLETED' || idea.status === 'REJECTED') {
      invalidTransition('Терминальный статус: назначение запрещено');
    }
    let assigneeId = body.assigneeId ?? null;
    if (assigneeId === null && idea.status === 'NEEDS_INFO') {
      bad('Сначала назначьте другого ответственного', {
        assigneeId: 'Нельзя снять ответственного, пока ожидается ответ автора',
      });
    }
    if (assigneeId !== null) {
      if (actor.role === 'STAFF' && idea.organization_id !== actor.organizationId) {
        const err = new Error('Нет доступа');
        err.code = 'FORBIDDEN';
        throw err;
      }
      await activeStaffInOrg(tx, assigneeId, idea.organization_id, idea.region_id);
    }
    const upd = await tx.query(
      'UPDATE ideas SET assignee_id=$1, version=version+1 WHERE id=$2 RETURNING version',
      [assigneeId, ideaId]);
    const ev = await tx.query(
      `INSERT INTO idea_events(idea_id, type, actor_id, visibility, payload_json)
       VALUES($1,$2,$3,'INTERNAL',$4) RETURNING id`,
      [ideaId, assigneeId ? 'ASSIGNED' : 'UNASSIGNED', actor.id, assigneeId
        ? JSON.stringify({ assigneeId })
        : JSON.stringify({ unassigned: true })]);
    await audit(tx, {
      regionId: idea.region_id, actorId: actor.id,
      action: assigneeId ? 'idea.assign' : 'idea.unassign',
      entityType: 'idea', entityId: ideaId, requestId, metadata: { assigneeId },
    });
    if (assigneeId && assigneeId !== actor.id) {
      await notify(tx, {
        recipientId: assigneeId, ideaId, eventId: ev.rows[0].id,
        kind: 'ASSIGNED', title: `Назначена идея ${idea.public_number}`,
      });
    }
    const responseBody = {
      id: ideaId, version: upd.rows[0].version,
      assigneeId, assigneeDisplayName: await staffName(tx, assigneeId),
    };
    await finishKeyedOp(tx, actor.id, 'idea.assign', key, 200, responseBody);
    return { status: 200, body: responseBody };
  });
}

export async function changeStatus(db, actor, ideaId, body, key, requestId) {
  requireStaff(actor);
  uuidField(ideaId, 'ideaId');
  requestFields(body, ['expectedVersion', 'toStatus', 'publicComment', 'resolutionType', 'takeOwnership'],
    ['expectedVersion', 'toStatus']);
  positiveVersion(body.expectedVersion);
  if (!IDEA_STATUSES.includes(body.toStatus)) bad('Некорректный статус', { toStatus: 'Выберите статус из справочника' });
  if (body.takeOwnership !== undefined) booleanField(body.takeOwnership, 'takeOwnership');
  if (body.publicComment !== undefined) checkCommentLength(body.publicComment, LIMITS.statusComment.min, LIMITS.statusComment.max);
  if (body.resolutionType !== undefined && (body.toStatus !== 'COMPLETED' || !RESOLUTION_TYPES.includes(body.resolutionType))) {
    bad('Некорректный тип результата', { resolutionType: 'Тип результата допускается только при завершении' });
  }
  requireKey(key);
  const hash = canonicalHash({ op: 'idea.status', idea: ideaId, body });
  const toStatus = body?.toStatus;
  return db.transaction(async (tx) => {
    const slot = await beginKeyedOp(tx, actor.id, 'idea.status', key, hash);
    const idea = await lockedStaffIdea(tx, actor, ideaId);
    if (slot.replay) return slot.replay;
    if (idea.version !== body.expectedVersion) versionConflict(idea.version);
    if (!isTransitionAllowed(idea.status, toStatus)) invalidTransition();

    // takeOwnership: RECEIVED -> UNDER_REVIEW assigns self atomically.
    let assigneeId = idea.assignee_id;
    if (body.takeOwnership === true) {
      if (idea.status !== 'RECEIVED' || toStatus !== 'UNDER_REVIEW') {
        invalidTransition('takeOwnership допустим только для RECEIVED -> UNDER_REVIEW');
      }
      await activeStaffInOrg(tx, actor.id, idea.organization_id, idea.region_id);
      assigneeId = actor.id;
    }
    if (assigneeId) {
      // A previously assigned account may have been disabled or moved since
      // assignment. Return a field error before the SQL guard would raise 503.
      await activeStaffInOrg(tx, assigneeId, idea.organization_id, idea.region_id);
    }
    if (REQUIRES_ASSIGNEE.has(toStatus) && !assigneeId) {
      bad('Нужен ответственный', { assigneeId: 'Назначьте ответственного или возьмите на себя' });
    }
    let publicCommentId = null;
    let publicCommentBody = null;
    const needsReason = idea.status === 'NEEDS_INFO' && toStatus === 'UNDER_REVIEW';
    if (REQUIRES_PUBLIC_COMMENT.has(toStatus) || needsReason || body.publicComment !== undefined) {
      publicCommentBody = checkCommentLength(body.publicComment,
        LIMITS.statusComment.min, LIMITS.statusComment.max);
      const kind = toStatus === 'NEEDS_INFO' ? 'CLARIFICATION_QUESTION' : 'STATUS_COMMENT';
      const ins = await tx.query(
        `INSERT INTO comments(idea_id, author_id, visibility, kind, body)
         VALUES($1,$2,'PUBLIC',$3,$4) RETURNING id`,
        [ideaId, actor.id, kind, publicCommentBody]);
      publicCommentId = ins.rows[0].id;
    }
    let resolutionType = null;
    if (toStatus === 'COMPLETED') {
      if (!RESOLUTION_TYPES.includes(body.resolutionType)) {
        bad('Укажите тип результата', { resolutionType: 'Выберите тип результата' });
      }
      resolutionType = body.resolutionType;
    }
    const upd = await tx.query(
      `UPDATE ideas SET status=$1, assignee_id=$2, resolution_type=$3, version=version+1
       WHERE id=$4 RETURNING version`,
      [toStatus, assigneeId, resolutionType, ideaId]);
    if (body.takeOwnership === true && assigneeId !== idea.assignee_id) {
      await tx.query(
        `INSERT INTO idea_events(idea_id, type, actor_id, visibility, payload_json)
         VALUES($1,'ASSIGNED',$2,'INTERNAL',$3)`,
        [ideaId, actor.id, JSON.stringify({ assigneeId, takeOwnership: true })]);
    }
    const ev = await tx.query(
      `INSERT INTO idea_events(idea_id, type, actor_id, visibility, from_status, to_status, comment_id, payload_json)
       VALUES($1,$2,$3,'PUBLIC',$4,$5,$6,$7) RETURNING id`,
      [ideaId,
        toStatus === 'NEEDS_INFO' ? 'CLARIFICATION_REQUESTED' : 'STATUS_CHANGED',
        actor.id, idea.status, toStatus, publicCommentId,
        JSON.stringify(resolutionType ? { resolutionType } : {})]);
    // Author-facing notification for every status move.
    const kind = toStatus === 'NEEDS_INFO' ? 'CLARIFICATION_REQUESTED' : 'STATUS_CHANGED';
    await notify(tx, {
      recipientId: idea.author_id, ideaId, eventId: ev.rows[0].id,
      kind, title: `Идея ${idea.public_number}: новый статус`,
    });
    await recordPublishedStatus(tx, { ideaId, toStatus, eventId: ev.rows[0].id });
    // New assignee (via takeOwnership by someone else is self; direct set is
    // the assignment endpoint) is notified through the assignment path.
    await audit(tx, {
      regionId: idea.region_id, actorId: actor.id, action: 'idea.status',
      entityType: 'idea', entityId: ideaId, requestId,
      metadata: { from: idea.status, to: toStatus, resolutionType },
    });
    const responseBody = {
      id: ideaId, status: toStatus, version: upd.rows[0].version,
      assigneeId, assigneeDisplayName: await staffName(tx, assigneeId),
    };
    await finishKeyedOp(tx, actor.id, 'idea.status', key, 200, responseBody);
    return { status: 200, body: responseBody };
  });
}

export async function addComment(db, actor, ideaId, body, key, requestId) {
  requireStaff(actor);
  uuidField(ideaId, 'ideaId');
  requestFields(body, ['expectedVersion', 'visibility', 'body'], ['expectedVersion', 'visibility', 'body']);
  positiveVersion(body.expectedVersion);
  requireKey(key);
  const hash = canonicalHash({ op: 'idea.comment', idea: ideaId, body });
  const visibility = body?.visibility;
  if (visibility !== 'PUBLIC' && visibility !== 'INTERNAL') {
    bad('Некорректная видимость', { visibility: 'PUBLIC или INTERNAL' });
  }
  const min = visibility === 'PUBLIC' ? LIMITS.statusComment.min : 1;
  const text = checkCommentLength(body.body, min, LIMITS.statusComment.max, 'body');
  return db.transaction(async (tx) => {
    const slot = await beginKeyedOp(tx, actor.id, 'idea.comment', key, hash);
    const idea = await lockedStaffIdea(tx, actor, ideaId);
    if (slot.replay) return slot.replay;
    if (idea.version !== body.expectedVersion) versionConflict(idea.version);
    const ins = await tx.query(
      `INSERT INTO comments(idea_id, author_id, visibility, kind, body)
       VALUES($1,$2,$3,'NOTE',$4) RETURNING id, created_at`,
      [ideaId, actor.id, visibility, text]);
    const upd = await tx.query(
      'UPDATE ideas SET version=version+1 WHERE id=$1 RETURNING version', [ideaId]);
    const ev = await tx.query(
      `INSERT INTO idea_events(idea_id, type, actor_id, visibility, comment_id, payload_json)
       VALUES($1,$2,$3,$4,$5,'{}') RETURNING id`,
      [ideaId, visibility === 'PUBLIC' ? 'COMMENT_PUBLIC' : 'COMMENT_INTERNAL',
        actor.id, visibility, ins.rows[0].id]);
    if (visibility === 'PUBLIC') {
      await notify(tx, {
        recipientId: idea.author_id, ideaId, eventId: ev.rows[0].id,
        kind: 'PUBLIC_REPLY', title: `Идея ${idea.public_number}: новый ответ`,
      });
    }
    await audit(tx, {
      regionId: idea.region_id, actorId: actor.id, action: 'idea.comment',
      entityType: 'comment', entityId: ins.rows[0].id, requestId,
      metadata: { ideaId, visibility },
    });
    const responseBody = {
      id: ins.rows[0].id, ideaVersion: upd.rows[0].version,
      createdAt: ins.rows[0].created_at,
    };
    await finishKeyedOp(tx, actor.id, 'idea.comment', key, 201, responseBody);
    return { status: 201, body: responseBody };
  });
}

export async function rerouteIdea(db, actor, ideaId, body, key, requestId) {
  requireAdmin(actor);
  uuidField(ideaId, 'ideaId');
  requestFields(body, ['expectedVersion', 'organizationId', 'effectiveCategoryCode', 'reason'],
    ['expectedVersion', 'organizationId', 'reason']);
  positiveVersion(body.expectedVersion);
  uuidField(body.organizationId, 'organizationId');
  if (body.effectiveCategoryCode !== undefined && !CATEGORY_CODES.includes(body.effectiveCategoryCode)) {
    bad('Некорректная категория', { effectiveCategoryCode: 'Выберите категорию из справочника' });
  }
  checkCommentLength(body.reason, LIMITS.rerouteReason.min, LIMITS.rerouteReason.max, 'reason');
  requireKey(key);
  const hash = canonicalHash({ op: 'idea.reroute', idea: ideaId, body });
  return db.transaction(async (tx) => {
    const slot = await beginKeyedOp(tx, actor.id, 'idea.reroute', key, hash);
    const idea = await lockedStaffIdea(tx, actor, ideaId);
    if (slot.replay) return slot.replay;
    if (idea.version !== body.expectedVersion) versionConflict(idea.version);
    if (!REROUTE_FROM.has(idea.status)) {
      invalidTransition('Перенаправление из терминального статуса запрещено');
    }
    // The new organization comes from the catalog only (FR-07).
    const org = await tx.query(
      'SELECT id, code, name, active FROM organizations WHERE id=$1 AND region_id=$2',
      [body.organizationId, idea.region_id]);
    if (org.rows.length === 0 || !org.rows[0].active) {
      bad('Некорректная организация', { organizationId: 'Организация вне активного справочника' });
    }
    const engine = await loadRoutingEngine();
    const snapshot = await buildCatalogSnapshot(tx, idea.region_id);
    let decision;
    try {
      decision = engine.manualReroute({
        effectiveCategoryCode: body.effectiveCategoryCode ?? idea.effective_category_code,
        organizationCode: org.rows[0].code,
        reason: body.reason,
        priorCategoryCode: idea.effective_category_code,
        priorConfidenceBand: null,
      }, snapshot);
    } catch (e) {
      bad('Проверьте данные перенаправления', {
        reason: e.message, effectiveCategoryCode: e.message, organizationId: e.message,
      });
    }
    const orgChanged = org.rows[0].id !== idea.organization_id;
    const upd = await tx.query(
      `UPDATE ideas SET organization_id=$1, effective_category_code=$2,
         assignee_id=CASE WHEN $3 THEN NULL ELSE assignee_id END,
         version=version+1 WHERE id=$4 RETURNING version`,
      [org.rows[0].id, decision.effectiveCategoryCode, orgChanged, ideaId]);
    await tx.query(
      `INSERT INTO routing_decisions(idea_id, source, mode, effective_category_code,
         organization_id, tags_json, confidence_band, scores_json, reason_codes_json,
         explanation, rule_version, actor_id)
       VALUES($1,'HUMAN',$2,$3,$4,'[]',$5,'{}',$6,$7,$8,$9)`,
      [ideaId, decision.mode, decision.effectiveCategoryCode, org.rows[0].id,
        decision.confidenceBand, JSON.stringify(decision.reasonCodes),
        decision.explanation, decision.ruleVersion, actor.id]);
    const ev = await tx.query(
      `INSERT INTO idea_events(idea_id, type, actor_id, visibility, payload_json)
       VALUES($1,'REROUTED',$2,'PUBLIC',$3) RETURNING id`,
      [ideaId, actor.id, JSON.stringify({
        fromOrganizationId: idea.organization_id,
        toOrganizationId: org.rows[0].id,
        reason: body.reason,
      })]);
    await notify(tx, {
      recipientId: idea.author_id, ideaId, eventId: ev.rows[0].id,
      kind: 'REROUTED', title: `Идея ${idea.public_number}: изменён маршрут`,
    });
    await audit(tx, {
      regionId: idea.region_id, actorId: actor.id, action: 'idea.reroute',
      entityType: 'idea', entityId: ideaId, requestId,
      metadata: { toOrganization: org.rows[0].code, orgChanged },
    });
    const responseBody = {
      id: ideaId, status: idea.status, version: upd.rows[0].version,
      organizationId: org.rows[0].id,
      effectiveCategoryCode: decision.effectiveCategoryCode,
    };
    await finishKeyedOp(tx, actor.id, 'idea.reroute', key, 200, responseBody);
    return { status: 200, body: responseBody };
  });
}

// Author reply to a clarification request (FR-09). NEEDS_INFO -> UNDER_REVIEW.
// Without an assignee this is allowed ONLY after a reroute moved the card:
// such cards are explicitly visible in the new org's "unassigned" filter.
export async function answerClarification(db, actor, ideaId, body, key, requestId) {
  if (actor.role !== 'CITIZEN') {
    const err = new Error('Нет доступа');
    err.code = 'FORBIDDEN';
    throw err;
  }
  uuidField(ideaId, 'ideaId');
  requestFields(body, ['expectedVersion', 'body'], ['expectedVersion', 'body']);
  positiveVersion(body.expectedVersion);
  requireKey(key);
  const hash = canonicalHash({ op: 'idea.clarify', idea: ideaId, body });
  const text = checkCommentLength(body.body,
    LIMITS.clarification.min, LIMITS.clarification.max, 'body');
  return db.transaction(async (tx) => {
    const slot = await beginKeyedOp(tx, actor.id, 'idea.clarify', key, hash);
    const idea = await lockIdeaForActor(tx, actor, ideaId);
    if (slot.replay) return slot.replay;
    if (idea.version !== body.expectedVersion) versionConflict(idea.version);
    if (idea.status !== 'NEEDS_INFO') invalidTransition('Уточнение сейчас не запрашивается');
    if (!idea.assignee_id) {
      const rerouted = await tx.query(
        `SELECT 1 FROM idea_events
         WHERE idea_id=$1 AND type='REROUTED'
           AND created_at > (SELECT max(created_at) FROM idea_events
             WHERE idea_id=$1 AND type='CLARIFICATION_REQUESTED')`,
        [ideaId]);
      if (rerouted.rows.length === 0) {
        bad('Нет ответственного', { assigneeId: 'Дождитесь назначения сотрудника' });
      }
    }
    const ins = await tx.query(
      `INSERT INTO comments(idea_id, author_id, visibility, kind, body)
       VALUES($1,$2,'PUBLIC','CLARIFICATION_ANSWER',$3) RETURNING id`,
      [ideaId, actor.id, text]);
    const upd = await tx.query(
      `UPDATE ideas SET status='UNDER_REVIEW', content_revision=content_revision+1,
         version=version+1 WHERE id=$1 RETURNING version`,
      [ideaId]);
    const ev = await tx.query(
      `INSERT INTO idea_events(idea_id, type, actor_id, visibility, from_status, to_status, comment_id, payload_json)
       VALUES($1,'CLARIFICATION_ANSWERED',$2,'PUBLIC','NEEDS_INFO','UNDER_REVIEW',$3,'{}') RETURNING id`,
      [ideaId, actor.id, ins.rows[0].id]);
    await recordPublishedStatus(tx, { ideaId, toStatus: 'UNDER_REVIEW', eventId: ev.rows[0].id });
    // Notify the assignee, or the whole current org when unassigned.
    const recipients = idea.assignee_id
      ? [idea.assignee_id]
      : await orgStaffIds(tx, idea.organization_id);
    for (const recipientId of recipients) {
      await notify(tx, {
        recipientId, ideaId, eventId: ev.rows[0].id,
        kind: 'PUBLIC_REPLY', title: `Идея ${idea.public_number}: ответ автора`,
      });
    }
    await audit(tx, {
      regionId: idea.region_id, actorId: actor.id, action: 'idea.clarify',
      entityType: 'idea', entityId: ideaId, requestId, metadata: {},
    });
    const responseBody = {
      id: ideaId, status: 'UNDER_REVIEW', version: upd.rows[0].version,
    };
    await finishKeyedOp(tx, actor.id, 'idea.clarify', key, 200, responseBody);
    return { status: 200, body: responseBody };
  });
}

const SORTABLE = {
  createdAt: 'i.created_at', updatedAt: 'i.updated_at', submittedAt: 'i.submitted_at',
  publicNumber: 'i.public_number', title: 'i.title',
};

// Both the queue and analytics consume this SQL scope/filter builder. There
// is no path that aggregates a full table and then filters private rows.
function staffWhere(actor, query) {
  const orgId = staffListScope(actor, query.organizationId);
  uuidField(orgId, 'organizationId');
  if (actor.role === 'STAFF' && query.organizationId && query.organizationId !== orgId) {
    const err = new Error('Нет доступа');
    err.code = 'FORBIDDEN';
    throw err;
  }
  const params = [actor.regionId, orgId];
  let where = 'i.region_id=$1 AND i.organization_id=$2 AND i.status<>\'DRAFT\'';
  if (query.status) {
    params.push(query.status);
    where += ` AND i.status=$${params.length}`;
  }
  if (query.publication === 'pending') {
    where += " AND EXISTS(SELECT 1 FROM idea_publications p WHERE p.idea_id=i.id AND p.state='PENDING' AND p.author_consent)";
  }
  if (query.category) {
    params.push(query.category);
    where += ` AND i.effective_category_code=$${params.length}`;
  }
  if (query.territory) {
    params.push(query.territory);
    where += ` AND i.territory_id=(SELECT id FROM territories WHERE code=$${params.length} AND region_id=$1)`;
  }
  if (query.assignee === 'unassigned') where += ' AND i.assignee_id IS NULL';
  else if (query.assignee) {
    params.push(query.assignee);
    where += ` AND i.assignee_id=$${params.length}`;
  }
  if (query.dateFrom) {
    params.push(query.dateFrom);
    where += ` AND i.submitted_at >= $${params.length}`;
  }
  if (query.dateToExclusive) {
    params.push(query.dateToExclusive);
    where += ` AND i.submitted_at < $${params.length}`;
  } else if (query.dateTo) {
    params.push(query.dateTo);
    where += ` AND i.submitted_at <= $${params.length}`;
  }
  const q = [...(query.q || '')].slice(0, 100).join('');
  if (q) {
    params.push(`%${q.replace(/[\\%_]/g, '\\$&')}%`);
    const p = `$${params.length}`;
    where += ` AND (i.public_number ILIKE ${p} OR i.title ILIKE ${p} OR i.problem ILIKE ${p} OR i.solution ILIKE ${p})`;
  }
  return { where, params };
}

// Staff queue (FR-06): current organization only; admin selects an org.
export async function listStaffQueue(db, actor, query) {
  const { where, params } = staffWhere(actor, query);
  const sort = SORTABLE[query.sort] || SORTABLE.submittedAt;
  const dir = query.dir === 'asc' ? 'ASC' : 'DESC';
  const total = await db.query(`SELECT count(*)::int AS c FROM ideas i WHERE ${where}`, params);
  const rows = await db.query(
    `SELECT i.id, i.public_number AS "publicNumber", i.title, i.status,
            i.location_geometry AS "locationGeometry",
            i.effective_category_code AS "effectiveCategoryCode",
            t.code AS "territoryCode",
            i.submitted_at AS "submittedAt", i.created_at AS "createdAt",
            i.updated_at AS "updatedAt", i.version,
            u.display_name AS "assigneeDisplayName",
            COALESCE((SELECT p.state FROM idea_publications p WHERE p.idea_id=i.id),'PRIVATE') AS "publicationState",
            (SELECT rd.mode='TRIAGE' FROM routing_decisions rd
             WHERE rd.idea_id=i.id ORDER BY rd.created_at DESC, rd.id DESC LIMIT 1) AS triage
     FROM ideas i LEFT JOIN users u ON u.id=i.assignee_id
                  LEFT JOIN territories t ON t.id=i.territory_id
     WHERE ${where} ORDER BY ${sort} ${dir}, i.id
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, query.pageSize ?? 20, ((query.page ?? 1) - 1) * (query.pageSize ?? 20)]);
  return { items: rows.rows, total: total.rows[0].c };
}

export async function analyticsSummary(db, actor, query = {}) {
  const { where, params } = staffWhere(actor, query);
  // One statement gives all totals a consistent snapshot. Median is measured
  // to the first public UNDER_REVIEW event, not to creation or last update.
  const result = await db.query(
    `WITH filtered AS (
       SELECT i.id, i.status, i.effective_category_code, i.assignee_id,
         (SELECT rd.mode='TRIAGE' FROM routing_decisions rd
          WHERE rd.idea_id=i.id ORDER BY rd.created_at DESC, rd.id DESC LIMIT 1) AS triage,
         (SELECT extract(epoch FROM min(e.created_at)-i.submitted_at)::double precision
          FROM idea_events e WHERE e.idea_id=i.id AND e.to_status='UNDER_REVIEW'
            AND e.visibility='PUBLIC') AS first_review_seconds
       FROM ideas i WHERE ${where}
     )
     SELECT count(*)::int AS total,
       count(*) FILTER (WHERE assignee_id IS NULL)::int AS unassigned,
       count(*) FILTER (WHERE triage)::int AS triage,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY first_review_seconds)
         FILTER (WHERE first_review_seconds IS NOT NULL) AS "medianFirstReviewSeconds",
       coalesce((SELECT jsonb_object_agg(status, c) FROM
         (SELECT status, count(*)::int AS c FROM filtered GROUP BY status) s), '{}'::jsonb) AS "byStatus",
       coalesce((SELECT jsonb_object_agg(effective_category_code, c) FROM
         (SELECT effective_category_code, count(*)::int AS c FROM filtered GROUP BY effective_category_code) s), '{}'::jsonb) AS "byCategory"
     FROM filtered`, params);
  const summary = result.rows[0];
  return {
    total: summary.total, byStatus: summary.byStatus, byCategory: summary.byCategory,
    unassigned: summary.unassigned, triage: summary.triage,
    medianFirstReviewSeconds: summary.medianFirstReviewSeconds == null
      ? null : Number(summary.medianFirstReviewSeconds),
  };
}

export async function listAssignees(db, actor, organizationId) {
  if (actor.role === 'STAFF' && organizationId !== actor.organizationId) {
    const err = new Error('Нет доступа');
    err.code = 'FORBIDDEN';
    throw err;
  }
  if (actor.role !== 'STAFF' && actor.role !== 'ADMIN') {
    const err = new Error('Нет доступа');
    err.code = 'FORBIDDEN';
    throw err;
  }
  const rows = await db.query(
    `SELECT u.id, u.display_name AS "displayName" FROM users u
     JOIN organizations o ON o.id=u.organization_id
     WHERE u.organization_id=$1 AND o.region_id=$2 AND u.active
       AND u.role IN ('STAFF','ADMIN') ORDER BY u.display_name, u.id`,
    [organizationId, actor.regionId]);
  return rows.rows;
}

export async function listOrganizations(db, actor) {
  requireAdmin(actor);
  const rows = await db.query(
    `SELECT id, code, name, is_triage AS "isTriage", active FROM organizations
     WHERE region_id=$1 ORDER BY code`,
    [actor.regionId]);
  return rows.rows;
}

export async function listNotifications(db, actor, { unreadOnly, page, pageSize }) {
  const params = [actor.id];
  let where = 'recipient_id=$1';
  if (unreadOnly) where += ' AND read_at IS NULL';
  const total = await db.query(
    `SELECT count(*)::int AS c FROM notifications WHERE ${where}`, params);
  const unread = await db.query(
    'SELECT count(*)::int AS c FROM notifications WHERE recipient_id=$1 AND read_at IS NULL', params);
  const rows = await db.query(
    `SELECT id, idea_id AS "ideaId", kind, title,
            read_at AS "readAt", created_at AS "createdAt"
     FROM notifications WHERE ${where}
     ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3`,
    [actor.id, pageSize, (page - 1) * pageSize]);
  return { items: rows.rows, total: total.rows[0].c, unreadCount: unread.rows[0].c };
}

export async function readNotification(db, actor, notificationId) {
  const row = await db.query(
    'SELECT id, recipient_id FROM notifications WHERE id=$1', [notificationId]);
  if (row.rows.length === 0 || row.rows[0].recipient_id !== actor.id) {
    const err = new Error('Не найдено');
    err.code = 'NOT_FOUND';
    throw err;
  }
  // Idempotent: reading twice stays 204.
  await db.query('UPDATE notifications SET read_at=coalesce(read_at, now()) WHERE id=$1',
    [notificationId]);
}
