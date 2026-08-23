/**
 * 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential - Unauthorized use prohibited.
 *
 * Item #5 (Step 6 prioritization matrix) Phase 1 -- shared evidence
 * sufficiency scoring, extracted from backend/src/chat/chatPlanner.js with
 * NO behavior change. See evidenceSchema.js's header for the extraction
 * rationale and scope.
 *
 * `sourceAliases` lets a caller define its own requirement vocabulary
 * (the chatbot's is 'project' | 'catalog' | 'runtime' | 'outputs' |
 * 'gates' | 'memory' | 'external'); a future pipeline-agent caller can
 * pass a different alias map without needing changes here.
 */

const CHAT_SOURCE_ALIASES = {
  project: new Set(['project']),
  catalog: new Set(['catalog']),
  runtime: new Set(['runtime', 'agent_run']),
  outputs: new Set(['agent_output']),
  gates: new Set(['review_gate']),
  memory: new Set(['memory']),
  external: new Set(['external']),
};

function sourceSatisfies(sourceType, requirement, sourceAliases = CHAT_SOURCE_ALIASES) {
  const accepted = sourceAliases[requirement];
  return accepted ? accepted.has(sourceType) : sourceType === requirement;
}

/**
 * Computes confidence (0-100), sufficiency, missing requirements, and
 * contradicting claims from a set of retrieved evidence items. Mirrors the
 * doc's Section 10 Context Sufficiency / Groundedness Evaluator concept.
 */
function assessEvidence(items = [], requirements = [], sourceAliases = CHAT_SOURCE_ALIASES) {
  const authorized = items.filter((item) => item?.authorized !== false && item?.excerpt);
  const missing = [...new Set(requirements)].filter(
    (requirement) => !authorized.some((item) => sourceSatisfies(item.sourceType, requirement, sourceAliases)),
  );

  const contradictionKeys = new Map();
  for (const item of authorized) {
    if (!item.claimKey || item.claimValue == null) continue;
    const values = contradictionKeys.get(item.claimKey) ?? new Set();
    values.add(String(item.claimValue));
    contradictionKeys.set(item.claimKey, values);
  }
  const contradictions = [...contradictionKeys.entries()]
    .filter(([, values]) => values.size > 1)
    .map(([key]) => key);

  const averageAuthority = authorized.length
    ? Math.round(authorized.reduce((sum, item) => sum + Math.max(0, Math.min(100, Number(item.authority ?? 80))), 0) / authorized.length)
    : 0;
  let confidence = averageAuthority;
  if (missing.length) confidence = Math.min(confidence, 97);
  if (contradictions.length) confidence = Math.min(confidence, 85);
  if (!authorized.length) confidence = 0;

  return {
    confidence,
    sufficient: missing.length === 0 && contradictions.length === 0 && confidence >= 98,
    missing,
    contradictions,
  };
}

module.exports = {
  CHAT_SOURCE_ALIASES,
  sourceSatisfies,
  assessEvidence,
};
