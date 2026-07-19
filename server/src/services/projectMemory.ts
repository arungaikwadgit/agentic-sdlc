/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential - Unauthorized use prohibited.
 */

export interface ProjectMemoryRecord {
  id: string;
  project_id: string;
  scope: 'project' | 'domain_shared';
  domain_id?: string | null;
  approved: boolean;
  title: string;
  content: string;
  tags: string[];
  updated_at: string;
}

export interface ProjectMemoryContext {
  summary: string;
  recordIds: string[];
  coveredAgentKeys: string[];
  estimatedTokens: number;
  sourceCharacters: number;
  selectedCharacters: number;
}

const SIGNAL_LINE = /(^#{1,4}\s)|(^[-*+]\s)|(^\d+[.)]\s)|\b(decision|requirement|constraint|risk|assumption|dependency|interface|endpoint|entity|acceptance|test|security|performance|architecture)\b/i;

function sourceAgentKey(record: ProjectMemoryRecord): string | undefined {
  return record.tags.find((tag) => tag.startsWith('source-agent:'))?.slice('source-agent:'.length);
}

export function buildArtifactMemoryDigest(output: string, maxChars = 3_500): string {
  const normalized = output.replace(/\r\n/g, '\n').trim();
  if (normalized.length <= maxChars) return normalized;

  const selected: string[] = [];
  const seen = new Set<string>();
  for (const rawLine of normalized.split('\n')) {
    const line = rawLine.trim();
    if (!line || !SIGNAL_LINE.test(line)) continue;
    const key = line.toLowerCase().replace(/\s+/g, ' ');
    if (seen.has(key)) continue;
    seen.add(key);
    selected.push(line);
    if (selected.join('\n').length >= maxChars) break;
  }

  const suffix = '\n\n[Artifact memory digest; consult the current agent output for full detail.]';
  const contentBudget = Math.max(0, maxChars - suffix.length);
  const fallback = normalized.slice(0, contentBudget);
  const digest = selected.length >= 3 ? selected.join('\n') : fallback;
  return digest.slice(0, contentBudget).trim() + suffix;
}

function scoreRecord(
  record: ProjectMemoryRecord,
  projectId: string,
  agentKey: string,
  dependencyKeys: Set<string>,
): number {
  const source = sourceAgentKey(record);
  let score = record.project_id === projectId ? 200 : 40;
  if (record.tags.includes(`target-agent:${agentKey}`)) score += 120;
  if (source && dependencyKeys.has(source)) score += 100;
  if (record.tags.includes('kind:agent-output-summary')) score += 30;
  if (record.scope === 'domain_shared' && record.approved) score += 20;
  const ageDays = Math.max(0, (Date.now() - Date.parse(record.updated_at)) / 86_400_000);
  score += Math.max(0, 20 - Math.min(20, ageDays));
  return score;
}

export function selectProjectMemoryContext(options: {
  records: ProjectMemoryRecord[];
  projectId: string;
  agentKey: string;
  dependencyKeys?: string[];
  maxChars?: number;
  limit?: number;
}): ProjectMemoryContext {
  const maxChars = Math.min(12_000, Math.max(1_000, options.maxChars ?? 6_000));
  const limit = Math.min(12, Math.max(1, options.limit ?? 6));
  const dependencyKeys = new Set(options.dependencyKeys ?? []);
  const unique = new Map(options.records.map((record) => [record.id, record]));
  const ranked = [...unique.values()].sort((a, b) =>
    scoreRecord(b, options.projectId, options.agentKey, dependencyKeys) -
    scoreRecord(a, options.projectId, options.agentKey, dependencyKeys)
  );

  const sections: string[] = [];
  const selected: ProjectMemoryRecord[] = [];
  let selectedCharacters = 0;
  for (const record of ranked) {
    if (selected.length >= limit) break;
    const source = sourceAgentKey(record);
    const header = `### ${record.title}${source ? ` [source: ${source}]` : ''}`;
    const remaining = maxChars - selectedCharacters - header.length - 2;
    if (remaining < 160) break;
    const content = record.content.slice(0, Math.min(2_000, remaining)).trim();
    if (!content) continue;
    sections.push(`${header}\n${content}`);
    selected.push(record);
    selectedCharacters += header.length + content.length + 2;
  }

  const summary = sections.join('\n\n');
  return {
    summary,
    recordIds: selected.map((record) => record.id),
    coveredAgentKeys: [...new Set(selected.map(sourceAgentKey).filter((key): key is string => !!key))],
    estimatedTokens: Math.ceil(summary.length / 4),
    sourceCharacters: selected.reduce((sum, record) => sum + record.content.length, 0),
    selectedCharacters: summary.length,
  };
}
