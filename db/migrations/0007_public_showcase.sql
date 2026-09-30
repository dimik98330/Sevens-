-- Opt-in publication is independent of private submissions and their comments.
-- No existing idea becomes public when this migration is applied.
CREATE TABLE idea_publications (
  idea_id UUID PRIMARY KEY REFERENCES ideas(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'PRIVATE' CHECK (state IN ('PRIVATE','PENDING','PUBLISHED','REJECTED')),
  title TEXT NOT NULL DEFAULT '',
  problem TEXT NOT NULL DEFAULT '',
  solution TEXT NOT NULL DEFAULT '',
  expected_benefit TEXT,
  author_consent BOOLEAN NOT NULL DEFAULT FALSE,
  moderation_note TEXT,
  moderated_by UUID REFERENCES users(id),
  published_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version INT NOT NULL DEFAULT 1 CHECK (version >= 1),
  CHECK (state <> 'PUBLISHED' OR (author_consent AND published_at IS NOT NULL))
);
CREATE INDEX idea_publications_visible ON idea_publications(state, published_at DESC, idea_id);

CREATE TABLE showcase_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idea_id UUID NOT NULL REFERENCES idea_publications(idea_id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('PUBLISHED','STATUS_CHANGED','REPLY')),
  body TEXT,
  status TEXT CHECK (status IN ('RECEIVED','UNDER_REVIEW','NEEDS_INFO','IN_PROGRESS','COMPLETED','REJECTED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((type = 'REPLY' AND body IS NOT NULL) OR (type <> 'REPLY' AND body IS NULL))
);
CREATE INDEX showcase_events_timeline ON showcase_events(idea_id, created_at, id);

CREATE TABLE idea_supports (
  idea_id UUID NOT NULL REFERENCES idea_publications(idea_id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (idea_id, user_id)
);
CREATE TABLE idea_follows (
  idea_id UUID NOT NULL REFERENCES idea_publications(idea_id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (idea_id, user_id)
);
CREATE INDEX idea_follows_user ON idea_follows(user_id, idea_id);
