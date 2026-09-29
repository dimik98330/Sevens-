// Audit + notification writers. Called inside the business transaction so a
// failed audit/notification insert rolls back the whole change (INT-02).
// Payloads never carry passwords, tokens, cookies or raw files (06 section 9).
export async function audit(db, { regionId, actorId, action, entityType, entityId, requestId, metadata }) {
  await db.query(
    `INSERT INTO audit_events(region_id, actor_id, action, entity_type, entity_id, request_id, metadata_json)
     VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [regionId, actorId || null, action, entityType, String(entityId), requestId,
      JSON.stringify(metadata || {})]);
}

export async function notify(db, { recipientId, ideaId, eventId, kind, title }) {
  await db.query(
    `INSERT INTO notifications(recipient_id, idea_id, source_event_id, kind, title)
     VALUES($1,$2,$3,$4,$5)
     ON CONFLICT (source_event_id, recipient_id) DO NOTHING`,
    [recipientId, ideaId, eventId, kind, title]);
}
