/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
/**
 * Pipeline dependency graph utilities.
 *
 * Builds a reverse adjacency map from each agent's `dependsOn` declaration
 * and exposes BFS traversal for computing transitive downstream dependents.
 *
 * Used by the cascade-reset feature: when an agent is re-run, every agent
 * that (directly or transitively) depends on it is reset to idle so the
 * pipeline can re-run them from scratch.
 */

import { AGENT_DEFINITIONS } from './definitions';
import { PHASE_ORDER, PHASE_AGENTS } from './constants';
import type { AgentId } from '@/types/agent.types';

// ─── Pipeline order ───────────────────────────────────────────────────────────

/**
 * Flat list of every agent ID in execution order (phase0 → phase8).
 * Used to sort downstream dependents so they appear in the order they'll run.
 */
export const PIPELINE_ORDER: AgentId[] = PHASE_ORDER.flatMap(
  (phase) => PHASE_AGENTS[phase] ?? []
);

// ─── Reverse adjacency ────────────────────────────────────────────────────────

/**
 * Build a reverse dependency map.
 *   key   = an agent
 *   value = the set of agents whose `dependsOn` lists include that key
 *
 * Example: architecture is listed in dependsOn by many phase4 agents,
 * so reverseMap.get('architecture') returns a Set containing all of them.
 */
function buildReverseAdjacency(): Map<AgentId, Set<AgentId>> {
  const map = new Map<AgentId, Set<AgentId>>();

  for (const [id, def] of Object.entries(AGENT_DEFINITIONS)) {
    const agentId = id as AgentId;
    for (const dep of def.dependsOn ?? []) {
      if (!map.has(dep)) map.set(dep, new Set());
      map.get(dep)!.add(agentId);
    }
  }

  return map;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Return every agent that transitively depends on `agentId`, in pipeline
 * execution order. Does NOT include `agentId` itself.
 *
 * Uses BFS starting from `agentId` in the reverse dependency graph.
 *
 * @example
 * getDownstreamDependents('manager')
 * // → ['projectCharter', 'brd', 'stakeholder', 'userStory', ... all 28 downstream agents]
 *
 * getDownstreamDependents('uxMockups')
 * // → ['workingPrototype']
 */
export function getDownstreamDependents(agentId: AgentId): AgentId[] {
  const reverseMap = buildReverseAdjacency();
  const visited = new Set<AgentId>();
  const queue: AgentId[] = [agentId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const directDependents = reverseMap.get(current) ?? new Set<AgentId>();

    for (const dep of directDependents) {
      if (!visited.has(dep)) {
        visited.add(dep);
        queue.push(dep);
      }
    }
  }

  // Sort by pipeline execution order so the list reads top-to-bottom
  return [...visited].sort(
    (a, b) => PIPELINE_ORDER.indexOf(a) - PIPELINE_ORDER.indexOf(b)
  );
}
