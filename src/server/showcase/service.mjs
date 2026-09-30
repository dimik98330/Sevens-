// Private submissions are never projected directly: this module reads only
// explicitly consented, staff-approved publication text and a dedicated ledger.
import { lockIdeaForActor, loadIdeaForActor, requireStaff, forbidden, notFound } from '../policies/scopes.mjs';
import { requestFields, uuidField, validationError } from '../ideas/request-validation.mjs';
import { audit, notify } from '../audit/log.mjs';
import { publicationVersion, requestPublicationBody, reviewPublicationBody,
  safePublicText, showcaseQuery } from './validation.mjs';

function citizen(actor) {
  if (!actor) { const error = new Error('Требуется вход'); error.code = 'UNAUTHENTICATED'; throw error; }
  if (actor.role !== 'CITIZEN') forbidden();
}
function invalid(message) { const error = new Error(message); error.code = 'INVALID_TRANSITION'; throw error; }

const publicationView = (row) => row ? {
  state: row.state, title: row.title, problem: row.problem, solution: row.solution,
  expectedBenefit: row.expected_benefit, moderationNote: row.moderation_note,
  publishedAt: row.published_at, version: row.version, authorConsent: row.author_consent,
} : { state: 'PRIVATE', title: '', problem: '', solution: '', expectedBenefit: null,
  moderationNote: null, publishedAt: null, version: 0, authorConsent: false };

async function publication(tx, ideaId, lock = false) {
  return (await tx.query(`SELECT * FROM idea_publications WHERE idea_id=$1${lock ? ' FOR UPDATE' : ''}`, [ideaId])).rows[0];
}
async function authorIdea(tx, actor, ideaId) {
  citizen(actor);
  const idea = await lockIdeaForActor(tx, actor, ideaId);
  if (idea.author_id !== actor.id) notFound();
  return idea;
}
async function writeAudit(tx, idea, actor, action, requestId) {
  await audit(tx, { regionId: idea.region_id, actorId: actor.id, action,
    entityType: 'idea_publication', entityId: idea.id, requestId });
}

export async function getPublication(db, actor, ideaId) {
  uuidField(ideaId, 'ideaId');
  await loadIdeaForActor(db, actor, ideaId);
  return publicationView(await publication(db, ideaId));
}

export async function requestPublication(db, actor, ideaId, body, requestId) {
  uuidField(ideaId, 'ideaId');
  const text = requestPublicationBody(body);
  return db.transaction(async (tx) => {
    const idea = await authorIdea(tx, actor, ideaId);
    if (idea.status === 'DRAFT') invalid('Сначала отправьте идею на рассмотрение');
    const current = await publication(tx, ideaId, true);
    publicationVersion(body, current?.version || 0);
    if (current?.state === 'PENDING' && current.author_consent
      && current.title === text.title && current.problem === text.problem
      && current.solution === text.solution && current.expected_benefit === text.expectedBenefit) {
      return publicationView(current);
    }
    const result = await tx.query(`INSERT INTO idea_publications
      (idea_id,state,title,problem,solution,expected_benefit,author_consent)
      VALUES($1,'PENDING',$2,$3,$4,$5,TRUE)
      ON CONFLICT(idea_id) DO UPDATE SET state='PENDING',title=$2,problem=$3,solution=$4,
        expected_benefit=$5,author_consent=TRUE,moderation_note=NULL,moderated_by=NULL,
        published_at=NULL,updated_at=now(),version=idea_publications.version+1 RETURNING *`,
    [ideaId, text.title, text.problem, text.solution, text.expectedBenefit]);
    // Moderation work belongs to the private staff card. Use an existing
    // notification kind so pending cards never link to the public showcase.
    const source = await tx.query(`INSERT INTO idea_events(idea_id,type,actor_id,visibility,payload_json)
      VALUES($1,'COMMENT_INTERNAL',$2,'INTERNAL',$3) RETURNING id`,
    [ideaId, actor.id, JSON.stringify({ publicationState: 'PENDING' })]);
    const reviewers = await tx.query(`SELECT id FROM users
      WHERE region_id=$1 AND active
        AND (role='ADMIN' OR (role='STAFF' AND organization_id=$2))`,
    [idea.region_id, idea.organization_id]);
    for (const reviewer of reviewers.rows) {
      await notify(tx, { recipientId: reviewer.id, ideaId, eventId: source.rows[0].id,
        kind: 'PUBLIC_REPLY', title: idea.public_number
          ? `Идея ${idea.public_number}: нужна проверка публикации`
          : 'Идея: нужна проверка публикации' });
    }
    await writeAudit(tx, idea, actor, 'showcase.request', requestId);
    return publicationView(result.rows[0]);
  });
}

export async function withdrawPublication(db, actor, ideaId, body, requestId) {
  uuidField(ideaId, 'ideaId');
  requestFields(body || {}, ['expectedVersion']);
  return db.transaction(async (tx) => {
    const idea = await authorIdea(tx, actor, ideaId);
    const current = await publication(tx, ideaId, true);
    if (!current) return publicationView(null);
    if (body?.expectedVersion !== undefined) publicationVersion(body, current.version);
    if (current.state === 'PRIVATE') return publicationView(current);
    const result = await tx.query(`UPDATE idea_publications SET state='PRIVATE',author_consent=FALSE,
      published_at=NULL,updated_at=now(),version=version+1 WHERE idea_id=$1 RETURNING *`, [ideaId]);
    await writeAudit(tx, idea, actor, 'showcase.withdraw', requestId);
    return publicationView(result.rows[0]);
  });
}

export async function reviewPublication(db, actor, ideaId, body, requestId) {
  requireStaff(actor); uuidField(ideaId, 'ideaId');
  const text = reviewPublicationBody(body);
  return db.transaction(async (tx) => {
    const idea = await lockIdeaForActor(tx, actor, ideaId);
    const current = await publication(tx, ideaId, true);
    if (!current) notFound();
    publicationVersion(body, current.version);
    if (current.state !== 'PENDING') invalid('Публикация не ожидает проверки');
    if (body.decision === 'PUBLISH' && (!current.author_consent || idea.status === 'DRAFT')) {
      invalid('Публикация требует согласия автора и отправленной идеи');
    }
    const result = await tx.query(`UPDATE idea_publications SET state=$2,title=$3,problem=$4,solution=$5,
      expected_benefit=$6,moderation_note=$7,moderated_by=$8,
      published_at=CASE WHEN $2='PUBLISHED' THEN now() ELSE NULL END,
      updated_at=now(),version=version+1 WHERE idea_id=$1 RETURNING *`,
    [ideaId, body.decision === 'PUBLISH' ? 'PUBLISHED' : 'REJECTED', text.title, text.problem,
      text.solution, text.expectedBenefit, text.moderationNote, actor.id]);
    if (body.decision === 'PUBLISH') {
      await tx.query(`INSERT INTO showcase_events(idea_id,type,status) VALUES($1,'PUBLISHED',$2)`, [ideaId, idea.status]);
    }
    const state = result.rows[0].state;
    const source = await tx.query(`INSERT INTO idea_events(idea_id,type,actor_id,visibility,payload_json)
      VALUES($1,'COMMENT_PUBLIC',$2,'PUBLIC',$3) RETURNING id`,
    [ideaId, actor.id, JSON.stringify({ publicationState: state })]);
    await notify(tx, { recipientId: idea.author_id, ideaId, eventId: source.rows[0].id,
      kind: 'PUBLIC_REPLY', title: `Идея ${idea.public_number || ''}: ${state === 'PUBLISHED'
        ? 'опубликована в «Идеях региона»' : 'публикация возвращена на подготовку'}` });
    await writeAudit(tx, idea, actor, 'showcase.review', requestId);
    return publicationView(result.rows[0]);
  });
}

// Notification text and ledger fields never copy private comments or payloads.
export async function notifyFollowers(tx, { ideaId, eventId }) {
  await tx.query(`INSERT INTO notifications(recipient_id,idea_id,source_event_id,kind,title)
    SELECT f.user_id,i.id,$2,'SHOWCASE_UPDATE','Обновление публичной идеи'
    FROM idea_follows f JOIN ideas i ON i.id=f.idea_id
    JOIN idea_publications p ON p.idea_id=i.id AND p.state='PUBLISHED'
    JOIN users u ON u.id=f.user_id AND u.active AND u.role='CITIZEN'
    WHERE i.id=$1 AND f.user_id<>i.author_id
    ON CONFLICT(source_event_id,recipient_id) DO NOTHING`, [ideaId, eventId]);
}

export async function recordPublishedStatus(tx, { ideaId, toStatus, eventId }) {
  const current = await publication(tx, ideaId, true);
  if (!current || current.state !== 'PUBLISHED') return;
  await tx.query(`INSERT INTO showcase_events(idea_id,type,status) VALUES($1,'STATUS_CHANGED',$2)`, [ideaId, toStatus]);
  await tx.query('UPDATE idea_publications SET updated_at=now(),version=version+1 WHERE idea_id=$1', [ideaId]);
  await notifyFollowers(tx, { ideaId, eventId });
}

export async function publishReply(db, actor, ideaId, body, requestId) {
  requireStaff(actor); uuidField(ideaId, 'ideaId');
  requestFields(body, ['body', 'expectedVersion'], ['body', 'expectedVersion']);
  const text = safePublicText(body.body, 'body', 20, 2000);
  return db.transaction(async (tx) => {
    const idea = await lockIdeaForActor(tx, actor, ideaId);
    const current = await publication(tx, ideaId, true);
    if (!current || current.state !== 'PUBLISHED') notFound();
    publicationVersion(body, current.version);
    const event = await tx.query(`INSERT INTO showcase_events(idea_id,type,body,status)
      VALUES($1,'REPLY',$2,$3) RETURNING id`, [ideaId, text, idea.status]);
    const source = await tx.query(`INSERT INTO idea_events(idea_id,type,actor_id,visibility,payload_json)
      VALUES($1,'COMMENT_PUBLIC',$2,'PUBLIC',$3) RETURNING id`,
    [ideaId, actor.id, JSON.stringify({ showcaseEventId: event.rows[0].id })]);
    const result = await tx.query('UPDATE idea_publications SET updated_at=now(),version=version+1 WHERE idea_id=$1 RETURNING *', [ideaId]);
    await notifyFollowers(tx, { ideaId, eventId: source.rows[0].id });
    await notify(tx, { recipientId: idea.author_id, ideaId, eventId: source.rows[0].id,
      kind: 'SHOWCASE_UPDATE', title: 'Обновление публичной идеи' });
    await writeAudit(tx, idea, actor, 'showcase.reply', requestId);
    return publicationView(result.rows[0]);
  });
}

const CARD_SELECT = `SELECT i.id,i.public_number AS "publicNumber",p.title,p.problem,p.solution,
  p.expected_benefit AS "expectedBenefit",i.effective_category_code AS "categoryCode",
  i.territory_id AS "territoryId",t.name_ru AS "territoryName",o.name AS "organizationName",
  i.status,i.resolution_type AS "resolutionType",p.published_at AS "publishedAt",p.updated_at AS "updatedAt",
  (SELECT count(*)::int FROM idea_supports s WHERE s.idea_id=i.id) AS "supportCount",
  EXISTS(SELECT 1 FROM idea_supports s WHERE s.idea_id=i.id AND s.user_id=$1) AS "isSupported",
  EXISTS(SELECT 1 FROM idea_follows f WHERE f.idea_id=i.id AND f.user_id=$1) AS "isFollowing",
  coalesce(i.author_id=$1,FALSE) AS "isAuthor",
  (SELECT jsonb_build_object('body',e.body,'createdAt',e.created_at) FROM showcase_events e
    WHERE e.idea_id=i.id AND e.type='REPLY' AND e.created_at>=p.published_at
    ORDER BY e.created_at DESC,e.id DESC LIMIT 1) AS "latestReply"
  FROM idea_publications p JOIN ideas i ON i.id=p.idea_id
  LEFT JOIN territories t ON t.id=i.territory_id LEFT JOIN organizations o ON o.id=i.organization_id`;
const VISIBLE = "p.state='PUBLISHED' AND p.author_consent AND i.status<>'DRAFT'";

export async function listShowcase(db, actor, params) {
  const query = showcaseQuery(params);
  if (query.following) citizen(actor);
  const values = [actor?.id || null];
  let where = VISIBLE;
  const add = (sql, value) => { values.push(value); where += ` AND ${sql.replaceAll('?', `$${values.length}`)}`; };
  if (query.q) add('(p.title ILIKE ? OR p.problem ILIKE ? OR p.solution ILIKE ?)', `%${query.q}%`);
  if (query.category) add('i.effective_category_code=?', query.category);
  if (query.territory) add('i.territory_id=?', query.territory);
  if (query.status) add('i.status=?', query.status);
  if (query.following) where += ' AND EXISTS(SELECT 1 FROM idea_follows f WHERE f.idea_id=i.id AND f.user_id=$1)';
  // count does not use actor personalization unless following is selected;
  // supply $1 through a CTE to keep parameter inference valid for every filter.
  const count = await db.query(`WITH viewer AS (SELECT $1::uuid AS id)
    SELECT count(*)::int AS total FROM idea_publications p JOIN ideas i ON i.id=p.idea_id WHERE ${where}`, values);
  const sort = { newest: 'p.published_at DESC', popular: '"supportCount" DESC,p.published_at DESC', updated: 'p.updated_at DESC' }[query.sort];
  const cards = await db.query(`${CARD_SELECT} WHERE ${where} ORDER BY ${sort},i.id
    LIMIT $${values.length + 1} OFFSET $${values.length + 2}`, [...values, query.pageSize, (query.page - 1) * query.pageSize]);
  const summary = (await db.query(`SELECT count(*)::int AS published,
    count(*) FILTER(WHERE i.status='IN_PROGRESS')::int AS "inProgress",
    count(*) FILTER(WHERE i.status='COMPLETED')::int AS completed,
    coalesce(sum((SELECT count(*) FROM idea_supports s WHERE s.idea_id=i.id)),0)::int AS "totalSupports"
    FROM idea_publications p JOIN ideas i ON i.id=p.idea_id WHERE ${VISIBLE}`)).rows[0];
  return { items: cards.rows, page: query.page, pageSize: query.pageSize, total: count.rows[0].total,
    totalPages: Math.ceil(count.rows[0].total / query.pageSize), summary };
}

export async function getShowcaseIdea(db, actor, ideaId) {
  uuidField(ideaId, 'ideaId');
  const result = await db.query(`${CARD_SELECT} WHERE ${VISIBLE} AND i.id=$2`, [actor?.id || null, ideaId]);
  if (!result.rows.length) notFound();
  const timeline = await db.query(`SELECT id,type,body,status,created_at AS "createdAt" FROM showcase_events
    WHERE idea_id=$1 AND created_at>=$2 ORDER BY created_at,id`, [ideaId, result.rows[0].publishedAt]);
  return { ...result.rows[0], timeline: timeline.rows };
}

export async function setShowcaseReaction(db, actor, ideaId, reaction, enabled) {
  citizen(actor); uuidField(ideaId, 'ideaId');
  if (!['support', 'follow'].includes(reaction) || typeof enabled !== 'boolean') validationError({ reaction: 'Некорректное действие' });
  return db.transaction(async (tx) => {
    // Locks serialize reactions with withdrawal/review and enforce visibility
    // again after a concurrent moderation commit.
    const current = await publication(tx, ideaId, true);
    if (!current || current.state !== 'PUBLISHED' || !current.author_consent) notFound();
    const idea = (await tx.query('SELECT author_id,status FROM ideas WHERE id=$1', [ideaId])).rows[0];
    if (!idea || idea.status === 'DRAFT') notFound();
    if (reaction === 'support' && idea.author_id === actor.id) forbidden('Нельзя поддержать собственную идею');
    const table = reaction === 'support' ? 'idea_supports' : 'idea_follows';
    if (enabled) await tx.query(`INSERT INTO ${table}(idea_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING`, [ideaId, actor.id]);
    else await tx.query(`DELETE FROM ${table} WHERE idea_id=$1 AND user_id=$2`, [ideaId, actor.id]);
    return (await tx.query(`SELECT
      (SELECT count(*)::int FROM idea_supports WHERE idea_id=$1) AS "supportCount",
      EXISTS(SELECT 1 FROM idea_supports WHERE idea_id=$1 AND user_id=$2) AS "isSupported",
      EXISTS(SELECT 1 FROM idea_follows WHERE idea_id=$1 AND user_id=$2) AS "isFollowing"`, [ideaId, actor.id])).rows[0];
  });
}
