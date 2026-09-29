-- B-01: core schema for «Идеи для региона» (contract 03 v1.0).
-- Plain SQL, runnable on PostgreSQL 17 and PGlite. snake_case, timestamptz.
-- gen_random_uuid() is PostgreSQL core since v13; no extension required.

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Sequence for public idea numbers ABAI-YYYY-NNNNNN (invariant 13).
CREATE SEQUENCE IF NOT EXISTS idea_number_seq START 1;

CREATE TABLE IF NOT EXISTS regions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name_ru TEXT NOT NULL,
  name_kk TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS territories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  region_id UUID NOT NULL REFERENCES regions(id),
  parent_id UUID REFERENCES territories(id),
  code TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL DEFAULT 'LOCALITY',
  name_ru TEXT NOT NULL,
  name_kk TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  region_id UUID NOT NULL REFERENCES regions(id),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  is_triage BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Exactly one active triage organization per region (03 section 3.1).
CREATE UNIQUE INDEX IF NOT EXISTS organizations_single_active_triage
  ON organizations(region_id) WHERE is_triage AND active;

CREATE TABLE IF NOT EXISTS categories (
  code TEXT PRIMARY KEY,
  name_ru TEXT NOT NULL,
  name_kk TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS routing_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  region_id UUID NOT NULL REFERENCES regions(id),
  territory_id UUID REFERENCES territories(id),
  category_code TEXT NOT NULL REFERENCES categories(code),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  priority INT NOT NULL DEFAULT 100,
  version TEXT NOT NULL DEFAULT 'rules-v1',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS routing_rules_lookup
  ON routing_rules(region_id, category_code, active);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email_normalized TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('CITIZEN', 'STAFF', 'ADMIN')),
  organization_id UUID REFERENCES organizations(id),
  region_id UUID NOT NULL REFERENCES regions(id),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT staff_requires_organization
    CHECK (role <> 'STAFF' OR organization_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  csrf_token_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS sessions_token ON sessions(token_hash);

CREATE TABLE IF NOT EXISTS user_consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL,
  version TEXT NOT NULL,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, purpose, version)
);

CREATE TABLE IF NOT EXISTS ideas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  region_id UUID NOT NULL REFERENCES regions(id),
  author_id UUID NOT NULL REFERENCES users(id),
  public_number TEXT UNIQUE,
  title TEXT NOT NULL DEFAULT '',
  problem TEXT NOT NULL DEFAULT '',
  solution TEXT NOT NULL DEFAULT '',
  expected_benefit TEXT,
  requested_category_code TEXT REFERENCES categories(code),
  effective_category_code TEXT REFERENCES categories(code),
  territory_id UUID REFERENCES territories(id),
  location_text TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','RECEIVED','UNDER_REVIEW','NEEDS_INFO','IN_PROGRESS','COMPLETED','REJECTED')),
  organization_id UUID REFERENCES organizations(id),
  assignee_id UUID REFERENCES users(id),
  version INT NOT NULL DEFAULT 1,
  content_revision INT NOT NULL DEFAULT 1,
  submitted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolution_type TEXT CHECK (resolution_type IN ('ANSWER_PROVIDED','PILOT_PLANNED','IMPLEMENTED','FORWARDED_EXTERNALLY')),
  consent_version TEXT,
  consent_at TIMESTAMPTZ,
  CONSTRAINT submitted_fields_present CHECK (
    status = 'DRAFT' OR (
      public_number IS NOT NULL AND submitted_at IS NOT NULL
      AND effective_category_code IS NOT NULL AND organization_id IS NOT NULL
    )
  ),
  CONSTRAINT draft_has_no_number CHECK (
    status <> 'DRAFT' OR (public_number IS NULL AND submitted_at IS NULL)
  ),
  CONSTRAINT resolution_only_when_completed CHECK (
    (status = 'COMPLETED') = (resolution_type IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS ideas_author ON ideas(author_id, updated_at DESC, id);
CREATE INDEX IF NOT EXISTS ideas_staff_queue
  ON ideas(region_id, organization_id, status, created_at DESC, id);
CREATE INDEX IF NOT EXISTS ideas_routing_lookup
  ON ideas(region_id, territory_id, effective_category_code);

CREATE TABLE IF NOT EXISTS routing_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idea_id UUID NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('RULES', 'HUMAN')),
  mode TEXT NOT NULL CHECK (mode IN ('ASSIGNED', 'TRIAGE')),
  effective_category_code TEXT NOT NULL REFERENCES categories(code),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  tags_json JSONB NOT NULL DEFAULT '[]',
  confidence_band TEXT NOT NULL CHECK (confidence_band IN ('HIGH', 'MEDIUM', 'LOW')),
  scores_json JSONB NOT NULL DEFAULT '{}',
  reason_codes_json JSONB NOT NULL DEFAULT '[]',
  explanation TEXT NOT NULL DEFAULT '',
  rule_version TEXT NOT NULL DEFAULT 'rules-v1',
  actor_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS routing_decisions_idea ON routing_decisions(idea_id, created_at, id);

CREATE TABLE IF NOT EXISTS comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idea_id UUID NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES users(id),
  visibility TEXT NOT NULL CHECK (visibility IN ('PUBLIC', 'INTERNAL')),
  kind TEXT NOT NULL CHECK (kind IN ('STATUS_COMMENT','CLARIFICATION_QUESTION','CLARIFICATION_ANSWER','NOTE')),
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS comments_idea ON comments(idea_id, created_at, id);

CREATE TABLE IF NOT EXISTS idea_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idea_id UUID NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('CREATED','SUBMITTED','ASSIGNED','UNASSIGNED','STATUS_CHANGED','COMMENT_PUBLIC','COMMENT_INTERNAL','CLARIFICATION_REQUESTED','CLARIFICATION_ANSWERED','REROUTED','ATTACHMENT_ADDED','ATTACHMENT_REMOVED')),
  actor_id UUID REFERENCES users(id),
  visibility TEXT NOT NULL DEFAULT 'PUBLIC' CHECK (visibility IN ('PUBLIC', 'INTERNAL')),
  from_status TEXT,
  to_status TEXT,
  comment_id UUID REFERENCES comments(id),
  payload_json JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idea_events_idea ON idea_events(idea_id, created_at, id);

CREATE TABLE IF NOT EXISTS attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idea_id UUID NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
  uploaded_by UUID NOT NULL REFERENCES users(id),
  storage_key TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  detected_mime TEXT NOT NULL,
  size_bytes INT NOT NULL CHECK (size_bytes > 0),
  sha256 TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS attachments_idea ON attachments(idea_id);

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idea_id UUID NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
  source_event_id UUID NOT NULL REFERENCES idea_events(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_event_id, recipient_id)
);
CREATE INDEX IF NOT EXISTS notifications_recipient
  ON notifications(recipient_id, read_at, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  region_id UUID NOT NULL REFERENCES regions(id),
  actor_id UUID REFERENCES users(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_events_entity ON audit_events(entity_type, entity_id, created_at);

CREATE TABLE IF NOT EXISTS idempotency_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  operation TEXT NOT NULL,
  key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_status INT NOT NULL,
  response_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  UNIQUE (user_id, operation, key)
);
CREATE INDEX IF NOT EXISTS idempotency_expiry ON idempotency_records(expires_at);
