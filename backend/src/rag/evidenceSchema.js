/**
 * 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential - Unauthorized use prohibited.
 *
 * Item #5 (Step 6 prioritization matrix) Phase 1 -- shared Agentic RAG
 * evidence vocabulary, extracted from backend/src/chat/ (chatEvidence.js,
 * chatPlanner.js, chatOrchestrator.js) with NO behavior change. The
 * chatbot is the only caller today; backend/src/chat/* now import these
 * functions from here instead of defining them locally.
 *
 * See docs/architecture/agentic-rag-gap-analysis-and-plan.md Section 6-7
 * (Phase 1) and docs/architecture/step4-specs-wave3-draft.md Item 2 for
 * the design rationale. This module intentionally holds only the generic,
 * caller-agnostic pieces (evidence item shape, dedup, char-budget capping)
 * -- NOT the planner/synthesis prompt templates or the two-round
 * orchestration loop, which remain chat-specific pending Phase 3 design
 * work on how pipeline agents (a very different execution model from the
 * chatbot's request/response loop) should actually retrieve evidence.
 */

const MAX_EXCERPT_CHARS = 3_000;
const MAX_EVIDENCE_CHARS = 24_000;

function toExcerpt(value, max = MAX_EXCERPT_CHARS) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return String(text ?? '').slice(0, max);
}

/**
 * Canonical evidence-item shape shared by every retrieval source (project,
 * catalog, runtime, agent output, review gate, memory, external search).
 * Mirrors the doc's Section 7 Evidence Workspace schema.
 */
function evidenceItem({ sourceType, sourceId, title, excerpt, version = null, updatedAt = null, authority = 100, claimKey, claimValue }) {
  return {
    sourceType,
    sourceId,
    title,
    version,
    updatedAt,
    excerpt: toExcerpt(excerpt),
    authority,
    authorized: true,
    ...(claimKey ? { claimKey, claimValue } : {}),
  };
}

/** Removes duplicate evidence items (same source, version, and freshness). */
function dedupeEvidence(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.sourceType}:${item.sourceId}:${item.version ?? ''}:${item.updatedAt ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Caps total evidence excerpt length to a synthesis-prompt-safe budget. */
function capEvidence(items, maxChars = MAX_EVIDENCE_CHARS) {
  let remaining = maxChars;
  const capped = [];
  for (const item of items) {
    if (remaining <= 0) break;
    const excerpt = String(item.excerpt ?? '').slice(0, Math.min(3_000, remaining));
    if (!excerpt) continue;
    remaining -= excerpt.length;
    capped.push({ ...item, excerpt });
  }
  return capped;
}

module.exports = {
  MAX_EXCERPT_CHARS,
  MAX_EVIDENCE_CHARS,
  toExcerpt,
  evidenceItem,
  dedupeEvidence,
  capEvidence,
};
