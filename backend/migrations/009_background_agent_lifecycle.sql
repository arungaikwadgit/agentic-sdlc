ALTER TABLE agent_jobs ADD COLUMN IF NOT EXISTS trigger_type TEXT;
ALTER TABLE agent_jobs ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_jobs_lifecycle_idempotency
  ON agent_jobs(project_id, agent_key, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS lifecycle_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(project_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_lifecycle_events_project_created
  ON lifecycle_events(project_id, created_at DESC);
