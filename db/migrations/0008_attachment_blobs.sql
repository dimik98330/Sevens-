-- Opt-in durable attachment bytes for hosts with ephemeral local disks.
-- Existing metadata remains filesystem-backed until an explicit migration.
ALTER TABLE attachments ADD COLUMN storage_backend TEXT NOT NULL DEFAULT 'filesystem'
  CHECK (storage_backend IN ('filesystem', 'database'));

CREATE TABLE attachment_blobs (
  attachment_id UUID PRIMARY KEY REFERENCES attachments(id) ON DELETE CASCADE,
  content BYTEA NOT NULL CHECK (octet_length(content) BETWEEN 1 AND 5242880)
);
