-- ============================================================================
-- 004_master_data_catalog.sql
-- Master data catalog tables for the Agentic SDLC application.
--
-- These tables store the non-project, app-wide catalogs that were previously
-- hardcoded in frontend source files: phases, review gates, agents, domains,
-- role templates, and their relationships.
-- ============================================================================

CREATE TABLE IF NOT EXISTS master_phases (
    id           TEXT PRIMARY KEY,
    order_index  INTEGER NOT NULL UNIQUE,
    label        TEXT NOT NULL,
    sdlc_stage   TEXT NOT NULL,
    is_parallel  BOOLEAN NOT NULL DEFAULT FALSE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS master_review_gates (
    gate_id      TEXT NOT NULL,
    phase_id     TEXT NOT NULL REFERENCES master_phases(id) ON DELETE CASCADE,
    phase_order  INTEGER NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (gate_id, phase_id)
);

CREATE TABLE IF NOT EXISTS master_agents (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    phase_id        TEXT NOT NULL REFERENCES master_phases(id) ON DELETE RESTRICT,
    description     TEXT NOT NULL DEFAULT '',
    output_label    TEXT NOT NULL DEFAULT '',
    depends_on      JSONB NOT NULL DEFAULT '[]'::jsonb,
    max_iterations  INTEGER,
    system_prompt   TEXT,
    is_enabled      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS master_phase_agents (
    phase_id      TEXT NOT NULL REFERENCES master_phases(id) ON DELETE CASCADE,
    agent_id      TEXT NOT NULL REFERENCES master_agents(id) ON DELETE CASCADE,
    agent_order   INTEGER NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (phase_id, agent_id)
);

CREATE TABLE IF NOT EXISTS master_domains (
    id           TEXT PRIMARY KEY,
    label        TEXT NOT NULL,
    color        TEXT NOT NULL,
    bg_color     TEXT NOT NULL,
    context      TEXT NOT NULL,
    template     TEXT NOT NULL DEFAULT '',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS master_role_templates (
    id           TEXT PRIMARY KEY,
    title        TEXT NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    color        TEXT NOT NULL,
    sort_order   INTEGER NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS master_role_template_agents (
    role_template_id  TEXT NOT NULL REFERENCES master_role_templates(id) ON DELETE CASCADE,
    agent_id          TEXT NOT NULL REFERENCES master_agents(id) ON DELETE CASCADE,
    sort_order        INTEGER NOT NULL DEFAULT 0,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (role_template_id, agent_id)
);

CREATE INDEX IF NOT EXISTS idx_master_agents_phase_id
    ON master_agents(phase_id);

CREATE INDEX IF NOT EXISTS idx_master_phase_agents_phase_order
    ON master_phase_agents(phase_id, agent_order);

CREATE INDEX IF NOT EXISTS idx_master_review_gates_gate_order
    ON master_review_gates(gate_id, phase_order);

CREATE INDEX IF NOT EXISTS idx_master_role_template_agents_role_order
    ON master_role_template_agents(role_template_id, sort_order);

DO $$ BEGIN
  CREATE TRIGGER trg_master_phases_updated_at
    BEFORE UPDATE ON master_phases
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_master_agents_updated_at
    BEFORE UPDATE ON master_agents
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_master_domains_updated_at
    BEFORE UPDATE ON master_domains
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_master_role_templates_updated_at
    BEFORE UPDATE ON master_role_templates
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
