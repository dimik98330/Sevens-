-- Shared paid-call admission across serverless instances. No idea text,
-- provider credentials, prompts or model response content is stored here.
CREATE TABLE IF NOT EXISTS classifier_global_budget (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  used_calls INTEGER NOT NULL DEFAULT 0 CHECK (used_calls BETWEEN 0 AND 100),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS classifier_actor_budget (
  actor_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  used_calls INTEGER NOT NULL DEFAULT 0 CHECK (used_calls BETWEEN 0 AND 50),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
