-- AI Governance MVP-0 code-review follow-up (Suggestion #6), 2026-07-22.
-- See docs/architecture/govern-ai-code-review-findings.md.
--
-- governance_finding.backlog_item_id was originally documented as
-- "FK by convention, not a real FK" (013_ai_governance_mvp.sql's own
-- comment), since admin_backlog_items.id is a client-generated TEXT
-- primary key rather than a UUID this table could formally reference at
-- the time. It IS a real primary key though, so a genuine FK is possible
-- and worth adding now that it's been running long enough to trust.
--
-- Defensive cleanup first: rows written by the PRE-transaction-fix code
-- path (before 2026-07-22's code-review fix wrapped POST /decision in a
-- BEGIN/COMMIT/ROLLBACK) could theoretically have a backlog_item_id that
-- was set but whose corresponding admin_backlog_items row never actually
-- committed, or was independently deleted later by an admin. Adding a FK
-- constraint directly against unverified historical data would fail this
-- entire migration if even one row is inconsistent. Nulling out orphaned
-- references first makes this safe to apply without a manual pre-check --
-- any such reference was already useless for its intended purpose (it
-- pointed at a backlog item that doesn't exist).
UPDATE governance_finding gf
SET backlog_item_id = NULL
WHERE backlog_item_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM admin_backlog_items abi WHERE abi.id = gf.backlog_item_id
  );

-- ON DELETE SET NULL, not CASCADE: deleting a backlog item (e.g. an admin
-- clearing it manually from BacklogTab.tsx) should not delete the
-- governance_finding row that spawned it -- the finding itself is still a
-- real, independently-meaningful governance record even if its backlog
-- item goes away.
DO $$ BEGIN
  ALTER TABLE governance_finding
    ADD CONSTRAINT governance_finding_backlog_item_id_fkey
    FOREIGN KEY (backlog_item_id) REFERENCES admin_backlog_items(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
