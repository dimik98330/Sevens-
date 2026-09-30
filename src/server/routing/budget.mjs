// Atomic shared admission before any paid request. Locks exist only for this
// short counter transaction; the provider is called after it has committed.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const CLASSIFIER_GLOBAL_HOURLY_LIMIT = 100;
export const CLASSIFIER_ACTOR_HOURLY_LIMIT = 50;

export async function admitClassificationCall(db, { actorId } = {}) {
  if (typeof actorId !== 'string' || !UUID.test(actorId)) return false;
  return db.transaction(async (tx) => {
    // Every instance takes global then actor locks in the same order. Empty
    // bucket rows expire immediately; the hour starts on first admission.
    await tx.query(`INSERT INTO classifier_global_budget(singleton) VALUES(TRUE)
      ON CONFLICT(singleton) DO NOTHING`);
    const global = (await tx.query(`SELECT used_calls, expires_at > now() AS active_window
      FROM classifier_global_budget WHERE singleton=TRUE FOR UPDATE`)).rows[0];
    const globalCalls = global.active_window ? global.used_calls : 0;
    if (globalCalls >= CLASSIFIER_GLOBAL_HOURLY_LIMIT) return false;

    await tx.query(`INSERT INTO classifier_actor_budget(actor_id)
      SELECT id FROM users WHERE id=$1 AND active
      ON CONFLICT(actor_id) DO NOTHING`, [actorId]);
    const actor = (await tx.query(`SELECT b.used_calls, b.expires_at > now() AS active_window
      FROM classifier_actor_budget b JOIN users u ON u.id=b.actor_id AND u.active
      WHERE b.actor_id=$1 FOR UPDATE OF b`, [actorId])).rows[0];
    if (!actor) return false;
    const actorCalls = actor.active_window ? actor.used_calls : 0;
    if (actorCalls >= CLASSIFIER_ACTOR_HOURLY_LIMIT) return false;

    await tx.query(`UPDATE classifier_global_budget SET used_calls=$1,
      expires_at=CASE WHEN expires_at > now() THEN expires_at ELSE now()+interval '1 hour' END
      WHERE singleton=TRUE`, [globalCalls + 1]);
    await tx.query(`UPDATE classifier_actor_budget SET used_calls=$1,
      expires_at=CASE WHEN expires_at > now() THEN expires_at ELSE now()+interval '1 hour' END
      WHERE actor_id=$2`, [actorCalls + 1, actorId]);
    return true;
  });
}
