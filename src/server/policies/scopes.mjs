// Object-level policies (06 section 3). Every read/write resolves rights from
// the database on the current request; lists are pre-scoped in SQL, never
// filtered in memory after a full fetch. Foreign objects map to 404.

export function notFound() {
  const err = new Error('Не найдено');
  err.code = 'NOT_FOUND';
  throw err;
}

export function forbidden(message = 'Нет доступа') {
  const err = new Error(message);
  err.code = 'FORBIDDEN';
  throw err;
}

// Load the idea row visible to this actor, or throw 404 (same shape whether
// the row is missing or foreign — no existence oracle).
export async function loadIdeaForActor(db, actor, ideaId) {
  const row = await db.query('SELECT * FROM ideas WHERE id=$1', [ideaId]);
  const idea = row.rows[0];
  if (!idea) notFound();
  if (actor.role === 'CITIZEN') {
    if (idea.author_id !== actor.id) notFound();
    return idea;
  }
  if (idea.region_id !== actor.regionId) notFound();
  if (actor.role === 'STAFF') {
    if (idea.organization_id !== actor.organizationId) notFound();
    return idea;
  }
  // ADMIN: region scope only.
  return idea;
}

// Citizen DTO must never leak staff internals or other authors (03 section 4).
export function citizenIdeaView(idea, extras = {}) {
  const {
    organization_id, assignee_id, author_id, ...rest
  } = idea;
  void organization_id;
  void author_id;
  return {
    ...rest,
    assigneeDisplayName: extras.assigneeDisplayName || null,
    organizationCode: extras.organizationCode || null,
  };
}

export function staffIdeaView(idea, extras = {}) {
  return {
    ...idea,
    authorDisplayName: extras.authorDisplayName || null,
    authorEmail: extras.authorEmail || null,
    assigneeDisplayName: extras.assigneeDisplayName || null,
  };
}

// Staff list scope: current organization only; ADMIN passes an explicit org.
export function staffListScope(actor, queryOrgId) {
  if (actor.role === 'STAFF') return actor.organizationId;
  if (actor.role === 'ADMIN') {
    if (!queryOrgId) forbidden('Укажите организацию');
    return queryOrgId;
  }
  forbidden();
}

export function requireStaff(actor) {
  if (actor.role !== 'STAFF' && actor.role !== 'ADMIN') forbidden();
}

export function requireAdmin(actor) {
  if (actor.role !== 'ADMIN') forbidden();
}
