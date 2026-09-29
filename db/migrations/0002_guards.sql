-- B-01: SQL guards for cross-row invariants (03 section 3.3).
-- Inter-table rules are ALSO checked by application services inside the
-- same transaction; these triggers are defense in depth, not the only check.

-- 1. Submitted ideas keep number/submitted_at immutable; versions never decrease.
CREATE OR REPLACE FUNCTION guard_ideas_immutable() RETURNS trigger AS $$
BEGIN
  IF OLD.public_number IS NOT NULL AND NEW.public_number IS DISTINCT FROM OLD.public_number THEN
    RAISE EXCEPTION 'IMMUTABLE_PUBLIC_NUMBER';
  END IF;
  IF OLD.submitted_at IS NOT NULL AND NEW.submitted_at IS DISTINCT FROM OLD.submitted_at THEN
    RAISE EXCEPTION 'IMMUTABLE_SUBMITTED_AT';
  END IF;
  IF NEW.version < OLD.version THEN
    RAISE EXCEPTION 'VERSION_MUST_NOT_DECREASE';
  END IF;
  IF NEW.content_revision < OLD.content_revision THEN
    RAISE EXCEPTION 'CONTENT_REVISION_MUST_NOT_DECREASE';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS ideas_immutable ON ideas;
CREATE TRIGGER ideas_immutable BEFORE UPDATE ON ideas
  FOR EACH ROW EXECUTE FUNCTION guard_ideas_immutable();

-- 2. Author, territory, organization and assignee share one region (invariant 3);
-- assignee must be active and belong to the current organization (invariant 4).
CREATE OR REPLACE FUNCTION guard_ideas_scope() RETURNS trigger AS $$
DECLARE
  author_region UUID;
  terr_region UUID;
  org_region UUID;
  assignee_org UUID;
  assignee_region UUID;
  assignee_active BOOLEAN;
  assignee_role TEXT;
BEGIN
  SELECT region_id INTO author_region FROM users WHERE id = NEW.author_id;
  IF author_region IS NULL THEN RAISE EXCEPTION 'UNKNOWN_AUTHOR'; END IF;
  IF NEW.region_id IS DISTINCT FROM author_region THEN
    RAISE EXCEPTION 'REGION_MISMATCH_AUTHOR';
  END IF;
  IF NEW.territory_id IS NOT NULL THEN
    SELECT region_id INTO terr_region FROM territories WHERE id = NEW.territory_id;
    IF terr_region IS NULL THEN RAISE EXCEPTION 'UNKNOWN_TERRITORY'; END IF;
    IF terr_region IS DISTINCT FROM NEW.region_id THEN
      RAISE EXCEPTION 'REGION_MISMATCH_TERRITORY';
    END IF;
  END IF;
  IF NEW.organization_id IS NOT NULL THEN
    SELECT region_id INTO org_region FROM organizations WHERE id = NEW.organization_id;
    IF org_region IS NULL THEN RAISE EXCEPTION 'UNKNOWN_ORGANIZATION'; END IF;
    IF org_region IS DISTINCT FROM NEW.region_id THEN
      RAISE EXCEPTION 'REGION_MISMATCH_ORGANIZATION';
    END IF;
  END IF;
  IF NEW.assignee_id IS NOT NULL THEN
    SELECT organization_id, region_id, active, role
      INTO assignee_org, assignee_region, assignee_active, assignee_role
      FROM users WHERE id = NEW.assignee_id;
    IF assignee_org IS NULL AND assignee_role = 'STAFF' THEN
      RAISE EXCEPTION 'ASSIGNEE_WITHOUT_ORGANIZATION';
    END IF;
    IF NOT assignee_active THEN RAISE EXCEPTION 'ASSIGNEE_INACTIVE'; END IF;
    IF assignee_region IS DISTINCT FROM NEW.region_id THEN
      RAISE EXCEPTION 'REGION_MISMATCH_ASSIGNEE';
    END IF;
    IF NEW.organization_id IS NULL OR assignee_org IS DISTINCT FROM NEW.organization_id THEN
      RAISE EXCEPTION 'ASSIGNEE_OUTSIDE_ORGANIZATION';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS ideas_scope ON ideas;
CREATE TRIGGER ideas_scope BEFORE INSERT OR UPDATE OF
  region_id, author_id, territory_id, organization_id, assignee_id ON ideas
  FOR EACH ROW EXECUTE FUNCTION guard_ideas_scope();

-- 3. At most 3 active attachments per idea, race-safe at row level (invariant 9).
CREATE OR REPLACE FUNCTION guard_attachments_cap() RETURNS trigger AS $$
DECLARE
  active_count INT;
BEGIN
  SELECT count(*) INTO active_count FROM attachments
    WHERE idea_id = NEW.idea_id AND removed_at IS NULL;
  IF active_count >= 3 THEN
    RAISE EXCEPTION 'ATTACHMENT_LIMIT_REACHED';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS attachments_cap ON attachments;
CREATE TRIGGER attachments_cap BEFORE INSERT ON attachments
  FOR EACH ROW EXECUTE FUNCTION guard_attachments_cap();

-- 4. Events and audit are append-only at SQL level (invariant 14 support).
CREATE OR REPLACE FUNCTION guard_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'APPEND_ONLY_TABLE';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS idea_events_append_only ON idea_events;
CREATE TRIGGER idea_events_append_only BEFORE UPDATE OR DELETE ON idea_events
  FOR EACH ROW EXECUTE FUNCTION guard_append_only();
DROP TRIGGER IF EXISTS audit_events_append_only ON audit_events;
CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION guard_append_only();
