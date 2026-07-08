-- Migration: 006_project_documents
-- Document Agent feature — see docs/Document-Agent-Feature-Plan.md Section 4.2.
--
-- Persists per-project, per-document generated artifacts (the AppDocs 72-document
-- pack, filled in with real project context) server-side, durably, as real Word
-- (.docx) / Markdown (.md) file bytes — NOT as a literal OS filesystem folder.
--
-- Rationale (see plan Section 4.2 for the full writeup): this app has no existing
-- filesystem/object-storage precedent anywhere in the backend. Every other piece
-- of durable per-project state already lives in Postgres (agent_runs, projects.data
-- JSONB). This table follows that same established pattern rather than introducing
-- new infrastructure (Railway volume / S3) with an unverified durability story.
--
-- "Folder" semantics are realised in the application layer, not on disk:
--   - category + doc_id give each row the same grouping as the AppDocs/ folder
--     taxonomy (e.g. category = 'Discovery_Initiation', doc_id = '01_project_charter').
--   - Per-agent download (ExportMenu.tsx) filters rows by source_agent_ids.
--   - Per-project "folder" download (exportAllArtifactsZip) pulls every row for a
--     project and rebuilds real subfolders in a ZIP using category as the path.
--
-- source_output_hash lets the Document Agent skip regeneration when nothing the
-- document depends on has actually changed (see plan Section 4.3/4.4).

CREATE TABLE IF NOT EXISTS project_documents (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id          UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    doc_id              TEXT NOT NULL,        -- e.g. '01_project_charter' — matches DocumentSpec.id
    category            TEXT NOT NULL,        -- e.g. 'Discovery_Initiation' — matches AppDocs/ folder name
    title               TEXT NOT NULL,        -- e.g. 'Project Charter'
    format              TEXT NOT NULL,        -- 'docx' | 'md'
    content             BYTEA NOT NULL,       -- generated file bytes (docx binary or md utf-8 text)
    source_agent_ids    TEXT[] NOT NULL DEFAULT '{}',   -- agent IDs this generation was grounded in
    source_output_hash  TEXT NOT NULL,        -- SHA-256 of concatenated source outputs; staleness check
    generated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    generation_trigger  TEXT NOT NULL DEFAULT 'agent_complete',  -- 'agent_complete' | 'gate_sync' | 'manual'
    version             INTEGER NOT NULL DEFAULT 1,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_project_documents_format CHECK (format IN ('docx', 'md')),
    CONSTRAINT chk_project_documents_trigger CHECK (generation_trigger IN ('agent_complete', 'gate_sync', 'manual')),
    UNIQUE (project_id, doc_id)
);

CREATE INDEX IF NOT EXISTS idx_project_documents_project_id ON project_documents(project_id);
CREATE INDEX IF NOT EXISTS idx_project_documents_category   ON project_documents(project_id, category);

-- Reuse the shared set_updated_at() trigger function already defined in
-- 000_full_schema.sql (guarded the same way every other trigger in this repo is).
DO $$ BEGIN
  CREATE TRIGGER trg_project_documents_updated_at
    BEFORE UPDATE ON project_documents
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Per-project feature toggle (Section 3.2 of the plan — Admin Panel control).
-- Defaults to TRUE so existing projects opt in automatically; admins can disable
-- per project via the new Admin Panel "Documentation" block.
ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS document_agent_enabled BOOLEAN NOT NULL DEFAULT TRUE;
