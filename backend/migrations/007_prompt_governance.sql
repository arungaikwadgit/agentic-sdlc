-- Prompt governance and approval workflow, 2026.
-- Stores global default prompts and project-specific overrides as immutable,
-- versioned records instead of mutable browser/project JSON only.

CREATE TABLE IF NOT EXISTS agent_prompt_versions (
  id UUID PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('global', 'project')),
  agent_id TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  parent_global_prompt_id UUID REFERENCES agent_prompt_versions(id),
  version INTEGER NOT NULL CHECK (version > 0),
  content TEXT NOT NULL,
  resolved_effective_prompt TEXT,
  content_checksum TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN (
      'draft',
      'submitted',
      'approved',
      'rejected',
      'changes_requested',
      'activated',
      'superseded',
      'rolled_back'
    )
  ),
  active BOOLEAN NOT NULL DEFAULT FALSE,
  approval_status TEXT NOT NULL DEFAULT 'draft' CHECK (
    approval_status IN (
      'draft',
      'submitted',
      'approved',
      'rejected',
      'changes_requested',
      'activated',
      'superseded',
      'rolled_back'
    )
  ),
  project_owner_email TEXT,
  approval_comments TEXT,
  submitted_by TEXT,
  submitted_at TIMESTAMPTZ,
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  rejected_by TEXT,
  rejected_at TIMESTAMPTZ,
  activated_by TEXT,
  activated_at TIMESTAMPTZ,
  created_by TEXT,
  updated_by TEXT,
  change_summary TEXT,
  change_reason TEXT,
  business_reason TEXT,
  technical_reason TEXT,
  risk_assessment TEXT,
  impact_assessment TEXT,
  previous_version_id UUID REFERENCES agent_prompt_versions(id),
  rollback_reference_id UUID REFERENCES agent_prompt_versions(id),
  immutable_history JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT agent_prompt_project_scope CHECK (
    (scope = 'global' AND project_id IS NULL) OR
    (scope = 'project' AND project_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_agent_prompt_versions_agent
ON agent_prompt_versions(agent_id, scope, project_id, version DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_prompt_global_active
ON agent_prompt_versions(agent_id)
WHERE scope = 'global' AND active = TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_prompt_project_active
ON agent_prompt_versions(project_id, agent_id)
WHERE scope = 'project' AND active = TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_prompt_global_version
ON agent_prompt_versions(agent_id, version)
WHERE scope = 'global';

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_prompt_project_version
ON agent_prompt_versions(project_id, agent_id, version)
WHERE scope = 'project';

CREATE TABLE IF NOT EXISTS agent_prompt_audit_log (
  id UUID PRIMARY KEY,
  prompt_version_id UUID REFERENCES agent_prompt_versions(id) ON DELETE SET NULL,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,
  action TEXT NOT NULL,
  actor_email TEXT,
  actor_user_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_prompt_audit_agent
ON agent_prompt_audit_log(agent_id, project_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_agent_prompt_versions_updated_at ON agent_prompt_versions;
CREATE TRIGGER trg_agent_prompt_versions_updated_at
BEFORE UPDATE ON agent_prompt_versions
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
