/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
/**
 * Shared diagram-detection logic (2026-07-17).
 *
 * Previously duplicated as a local `DIAGRAM_AGENTS` set + `hasMermaid()`
 * closure inside ProjectWorkspace.tsx only — meaning the "Show Diagram"
 * experience existed in exactly one place. Centralizing it here lets
 * ReviewGateModal.tsx (and l3Runtime.ts, for the requiresDiagram
 * enforcement check) share the exact same definition of "does this output
 * contain a diagram" instead of maintaining parallel copies that could
 * silently drift apart.
 */
import type { AgentId } from '@/types/agent.types';

/** Agents whose output is expected to contain Mermaid diagrams. */
export const DIAGRAM_AGENTS = new Set<AgentId>([
  'dataModel',
  'architecture',
  'apiDesign',
  'interaction',
  'devopsEngineer',
  'infraEngineer',
  'observabilityEngineer',
]);

const MERMAID_START_RE =
  /(?:^|\n)(?:flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|journey|gantt|pie|mindmap|timeline|C4Context|C4Container|C4Component|C4Dynamic)\b/i;

/** True if the given text contains a fenced ```mermaid block or a bare
 *  Mermaid diagram declaration (flowchart/sequenceDiagram/erDiagram/etc). */
export function hasMermaidDiagram(text?: string | null): boolean {
  const s = text ?? '';
  return s.includes('```mermaid') || MERMAID_START_RE.test(s);
}
