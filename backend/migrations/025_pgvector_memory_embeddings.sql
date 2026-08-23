-- Item #4 (Step 6 prioritization matrix), 2026-08-23 -- install pgvector and
-- add a semantic-search embedding column to memory_records. Hard blocker
-- for item #5 (RAG grounding for the 32 pipeline agents), per the Step 4
-- Wave 3 spec (docs/architecture/step4-specs-wave3-draft.md, Item 1).
--
-- Decisions made explicitly before this migration (the spec's own
-- Pre-Implementation Gate required these, not a default guess):
-- - Embedding model: OpenAI text-embedding-3-small (1536 dimensions).
--   OPENAI_API_KEY is already configured on the runtime service
--   (Railway project zucchini-rejoicing, service "agentic-sdlc",
--   id ac1a41fb-8789-40fd-bf56-31a9a4573c20) -- confirmed live via
--   list-variables before writing this migration, so no new secret is
--   needed. See backend/src/embeddings.ts for the generation code and
--   full rationale (cost/quality tradeoff vs. text-embedding-3-large).
-- - Backfill: not needed. memory_records has 28 rows today (confirmed
--   live via execute_sql), trivially small -- the spec flagged backfill
--   volume as an open risk, but at this scale it's a non-issue. New
--   writes get an embedding going forward (backend/src/repositories/
--   MemoryRecordRepository.ts); the 28 existing rows are left with a
--   NULL embedding and simply won't surface in similarity search until
--   re-saved -- no separate backfill job was worth writing for this
--   volume.
-- - Index type: HNSW over ivfflat. ivfflat's `lists` parameter needs to
--   be tuned to the expected row count to perform well and requires
--   re-tuning as the table grows; HNSW has no such upfront-sizing
--   requirement and gives better recall by default, which matters more
--   than ivfflat's faster index *build* time at this table's current
--   (tiny) scale. Revisit if memory_records grows into the
--   hundreds-of-thousands range and HNSW build time becomes a real cost.

CREATE EXTENSION IF NOT EXISTS vector;

-- Nullable: existing rows (and any future row where embedding generation
-- fails -- see embeddings.ts's best-effort/never-throws contract) simply
-- have no embedding and are excluded from similarity search via the
-- `embedding IS NOT NULL` filter in MemoryRecordRepository.retrieveBySimilarity.
ALTER TABLE memory_records ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- vector_cosine_ops to match the `<=>` (cosine distance) operator used in
-- MemoryRecordRepository.retrieveBySimilarity.
CREATE INDEX IF NOT EXISTS idx_memory_records_embedding_hnsw
ON memory_records USING hnsw (embedding vector_cosine_ops);
