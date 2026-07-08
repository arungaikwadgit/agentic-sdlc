/**
 * © 2025 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
/**
 * Document Agent — Phase 1 service.
 *
 * See docs/Document-Agent-Feature-Plan.md Section 4.4 for the full design.
 * This module is called from two fire-and-forget hooks (never awaited by the
 * caller, never allowed to throw into the caller):
 *   - pipelineEngine.ts, right after an agent completes (onAgentComplete)
 *   - ProjectWorkspace.tsx, right after a review gate is approved (onGateApproved)
 *
 * Both hooks generate real, project-specific documents (per DOCUMENT_PACK in
 * documentSpecs.ts), persist them server-side via POST /api/project-documents,
 * and skip regeneration when nothing the document depends on has changed
 * (source_output_hash comparison) — no separate "Documentation" pipeline phase,
 * runs alongside the existing pipeline per your explicit decision.
 *
 * Generation happens client-side (reusing the existing L3 runtime and the
 * existing buildDocxBlob docx builder) and only the resulting bytes are sent
 * to the backend — the same "client computes, backend persists" shape already
 * used for agent_runs via updateAgentRun/updateProject.
 */

import type { Project } from '@/types/project.types';
import type { AgentId, AgentPromptContext, AgentDefinition } from '@/types/agent.types';
import { DOCUMENT_PACK, specsDependingOn, type DocumentSpec } from '@/agents/documentSpecs';
import { CONTEXT_TOOLS } from '@/agents/tools';
import { getDomain } from '@/agents/domains';
import { buildTeamRoster } from '@/data/roleTemplates';
import { runL3Agent } from './l3Runtime';
import { buildDocxBlob } from './exporters/documentExporter';
import { generateTraceabilityMatrix } from './traceability';
import { buildApiUrl } from '@/db/projectRepository';
import { getAuthHeader } from './api';

// ─── Backend fetch helper — mirrors db/projectRepository.ts's apiFetch ──────
// (module-private there; duplicated in miniature rather than exported+shared,
// to avoid widening that module's public surface for one caller).

async function documentApiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = await getAuthHeader();
  const res = await fetch(buildApiUrl(path), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...headers, ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Document Agent API ${res.status}: ${body}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

interface ProjectDocumentRow {
  id: string;
  doc_id: string;
  category: string;
  title: string;
  format: 'docx' | 'md';
  source_agent_ids: string[];
  source_output_hash: string;
  generated_at: string;
  generation_trigger: 'agent_complete' | 'gate_sync' | 'manual';
  version: number;
  size_bytes: number;
}

async function listProjectDocuments(projectId: string): Promise<ProjectDocumentRow[]> {
  return documentApiFetch<ProjectDocumentRow[]>(`/project-documents/${projectId}`);
}

/**
 * Generated documents grounded in a specific agent's output — used by
 * ExportMenu.tsx's per-agent "Download Documentation" button (Section 4.2).
 */
export async function listDocumentsForAgent(projectId: string, agentId: AgentId): Promise<ProjectDocumentRow[]> {
  const rows = await listProjectDocuments(projectId);
  return rows.filter((row) => row.source_agent_ids.includes(agentId));
}

/**
 * Downloads one generated document's real bytes via the authenticated
 * download route and triggers a browser save — mirrors exportDocx's
 * save-via-file-saver pattern used elsewhere in this app.
 */
export async function downloadGeneratedDocument(projectId: string, row: ProjectDocumentRow): Promise<void> {
  const headers = await getAuthHeader();
  const res = await fetch(buildApiUrl(`/project-documents/${projectId}/${row.doc_id}/download`), { headers });
  if (!res.ok) {
    throw new Error(`Failed to download "${row.title}": HTTP ${res.status}`);
  }
  const blob = await res.blob();
  const { saveAs } = await import('file-saver');
  const ext = row.format === 'docx' ? 'docx' : 'md';
  saveAs(blob, `${row.title.replace(/[^a-z0-9]/gi, '_')}.${ext}`);
}

async function persistDocument(
  projectId: string,
  spec: DocumentSpec,
  contentBase64: string,
  sourceAgentIds: string[],
  sourceOutputHash: string,
  trigger: 'agent_complete' | 'gate_sync' | 'manual'
): Promise<void> {
  await documentApiFetch(`/project-documents/${projectId}`, {
    method: 'POST',
    body: JSON.stringify({
      docId: spec.id,
      category: spec.category,
      title: spec.title,
      format: spec.outputFormat,
      contentBase64,
      sourceAgentIds,
      sourceOutputHash,
      trigger,
    }),
  });
}

// ─── Hashing (staleness check) ───────────────────────────────────────────────

/** SHA-256 of the concatenated source-agent outputs, as a hex string. */
export async function computeSourceOutputHash(spec: DocumentSpec, project: Project): Promise<string> {
  const parts = spec.sourceAgents.map((agentId) => project.agentRuns[agentId]?.output ?? '');
  // Include the doc id and project-level context fields that also feed generation
  // (domain, techStack, contextDocuments count) so a context-only change (e.g. a
  // newly uploaded style guide) is also detected as "stale" even when no agent
  // output text itself changed.
  const contextFingerprint = [
    project.domainKnowledge ?? '',
    project.techStack ?? '',
    project.brandingGuidelines ?? '',
    String(project.contextDocuments?.length ?? 0),
  ].join('|');
  const input = spec.id + '::' + parts.join(' ') + '::' + contextFingerprint;

  const encoder = new TextEncoder();
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** True once every agent this document depends on has completed (empty deps = always eligible). */
export function isEligible(spec: DocumentSpec, project: Project): boolean {
  return spec.sourceAgents.every((agentId) => project.agentRuns[agentId]?.status === 'complete');
}

// ─── Context Absorption (Section 2.1 of the plan) ────────────────────────────
// Built fresh on every generation rather than cached once — project fields
// (uploads, domain, tech stack) can change between pipeline runs, and rebuilding
// from the live Project record costs nothing (no LLM call), so a stale cache
// isn't a risk worth taking on. This mirrors pipelineEngine.ts's buildContext.

function buildDocumentContext(project: Project): AgentPromptContext {
  const domain = getDomain(project.domain);
  const priorOutputs: Partial<Record<AgentId, string>> = {};
  for (const [agentId, run] of Object.entries(project.agentRuns)) {
    if (run?.status === 'complete' && run.output) {
      priorOutputs[agentId as AgentId] = run.output;
    }
  }
  const domainContext = project.domainKnowledge
    ? `${project.domainKnowledge}\n\n---\n\n${domain.context}`
    : domain.context;

  return {
    projectName: project.name,
    projectDescription: project.description,
    domain: domain.id,
    domainContext,
    priorOutputs,
    teamRoster: buildTeamRoster(project),
    brandingGuidelines: project.brandingGuidelines,
    techStack: project.techStack,
    contextDocuments: project.contextDocuments,
    mockupVersionCount: project.mockupVersionCount,
  };
}

// ─── Prompt file fetch ────────────────────────────────────────────────────────
// AppDocs/ is copied to frontend/public/AppDocs/ at build time (see
// scripts/sync-appdocs.mjs) so Vite serves it as a static asset, fetchable at
// runtime — a repo-root sibling folder is otherwise invisible to a deployed build.

const promptFileCache = new Map<string, string>();

async function fetchPromptFile(spec: DocumentSpec): Promise<string> {
  const cached = promptFileCache.get(spec.promptFile);
  if (cached) return cached;

  // spec.promptFile is "AppDocs/<Category>/<file>.md" (repo-root relative);
  // the served static path is "/AppDocs/<Category>/<file>.md".
  const url = '/' + spec.promptFile.replace(/^\.?\/?/, '');
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch prompt file ${url}: HTTP ${res.status}`);
  }
  const text = await res.text();
  promptFileCache.set(spec.promptFile, text);
  return text;
}

// ─── Generation ───────────────────────────────────────────────────────────────

const BASE_DOCUMENT_AGENT_SYSTEM = `You are a senior SDLC documentation expert generating one document from the AppDocs
professional prompt library, filled in with THIS project's real, current context.
Ground every claim in the project's actual agent outputs and context — do not invent
capabilities, metrics, or completed work that isn't evidenced by the context provided.
Output only the document itself in the format the prompt below specifies (Word-ready
Markdown, or plain Markdown if the prompt explicitly says so) — no preamble, no
meta-commentary about these instructions.`;

async function generateViaLlm(spec: DocumentSpec, project: Project): Promise<string> {
  const promptFileContent = await fetchPromptFile(spec);
  const ctx = buildDocumentContext(project);

  const syntheticDef: AgentDefinition = {
    id: spec.id as AgentId, // not a real pipeline AgentId — only used as an L3 trace label here
    name: spec.title,
    phase: 'phase0',
    description: `Document Agent generation for AppDocs document ${spec.id}`,
    outputLabel: spec.title,
    systemPrompt: BASE_DOCUMENT_AGENT_SYSTEM,
    buildUserPrompt: () => '',
    tools: CONTEXT_TOOLS,
    maxIterations: 4,
    goal: () =>
      `Generate the "${spec.title}" document for project "${project.name}" (${project.domain} domain), ` +
      `following the AppDocs prompt instructions in the system prompt exactly (sections, diagrams, ` +
      `current/target-state labeling, Output Required list, Quality Bar). ` +
      `Ground the document in this project's real context: call get_domain_context and get_team_roster ` +
      (spec.sourceAgents.length > 0
        ? `first, then call get_agent_output for each of: ${spec.sourceAgents.join(', ')}.`
        : `first. This document is not tied to a specific prior agent — ground it in domain/team/style context only.`) +
      ` Call get_style_guide as well if the document involves any UI/UX/branding content. ` +
      `Do not skip required sections. Mark anything not evidenced by the fetched context as an assumption ` +
      `or open question per the prompt's own labeling rules — never invent completed work.`,
  };

  const systemPrompt = BASE_DOCUMENT_AGENT_SYSTEM + '\n\n## AppDocs Prompt Instructions\n\n' + promptFileContent;
  const userPrompt =
    `Project: ${project.name}\nDomain: ${project.domain}\nDescription: ${project.description}\n\n` +
    `Produce the "${spec.title}" document now, following the AppDocs Prompt Instructions above exactly.`;

  const result = await runL3Agent(syntheticDef, ctx, {
    systemPrompt,
    userPrompt,
    agentId: spec.id,
  });

  return result.output;
}

async function generateMarkdown(spec: DocumentSpec, project: Project): Promise<string> {
  if (spec.generator === 'traceability') {
    return generateTraceabilityMatrix(project.id);
  }
  return generateViaLlm(spec, project);
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string; // "data:<mime>;base64,<data>"
      const base64 = result.slice(result.indexOf(',') + 1);
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function bytesToBase64(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * Generate one document and persist it. Never throws to the caller — logs and
 * returns false on failure so a single bad document can't break the hook loop.
 */
async function generateAndPersistOne(
  spec: DocumentSpec,
  project: Project,
  trigger: 'agent_complete' | 'gate_sync' | 'manual'
): Promise<boolean> {
  try {
    const markdown = await generateMarkdown(spec, project);
    const hash = await computeSourceOutputHash(spec, project);

    let contentBase64: string;
    if (spec.outputFormat === 'docx') {
      const blob = await buildDocxBlob(markdown, spec.title, project.name);
      contentBase64 = await toBase64(blob);
    } else {
      contentBase64 = await bytesToBase64(markdown);
    }

    await persistDocument(project.id, spec, contentBase64, spec.sourceAgents, hash, trigger);
    return true;
  } catch (err) {
    console.error(`[documentAgentService] Failed to generate "${spec.id}" for project ${project.id}:`, err);
    return false;
  }
}

// ─── Public hooks ─────────────────────────────────────────────────────────────

/**
 * Fire-and-forget. Call right after an agent completes (pipelineEngine.ts).
 * Generates every eligible, stale-or-missing document that depends on this agent.
 */
export async function onAgentComplete(project: Project, agentId: AgentId): Promise<void> {
  if (project.documentAgentEnabled === false) return;

  const candidates = specsDependingOn(agentId).filter((spec) => isEligible(spec, project));
  if (candidates.length === 0) return;

  let existing: ProjectDocumentRow[];
  try {
    existing = await listProjectDocuments(project.id);
  } catch (err) {
    console.error('[documentAgentService] onAgentComplete: failed to list existing documents, skipping this pass:', err);
    return;
  }
  const existingByDocId = new Map(existing.map((row) => [row.doc_id, row]));

  for (const spec of candidates) {
    const currentHash = await computeSourceOutputHash(spec, project);
    const existingRow = existingByDocId.get(spec.id);
    if (existingRow && existingRow.source_output_hash === currentHash) continue; // unchanged — skip LLM call
    await generateAndPersistOne(spec, project, 'agent_complete');
  }
}

/**
 * Fire-and-forget. Call right after a review gate is approved (ProjectWorkspace.tsx).
 * Re-checks every document whose sourceAgents are within completed phases and
 * regenerates anything stale — keeps documents "current and relevant" at each
 * review checkpoint per the explicit sync requirement.
 */
export async function onGateApproved(project: Project): Promise<void> {
  if (project.documentAgentEnabled === false) return;

  const candidates = DOCUMENT_PACK.filter((spec) => isEligible(spec, project));
  if (candidates.length === 0) return;

  let existing: ProjectDocumentRow[];
  try {
    existing = await listProjectDocuments(project.id);
  } catch (err) {
    console.error('[documentAgentService] onGateApproved: failed to list existing documents, skipping this pass:', err);
    return;
  }
  const existingByDocId = new Map(existing.map((row) => [row.doc_id, row]));

  for (const spec of candidates) {
    const currentHash = await computeSourceOutputHash(spec, project);
    const existingRow = existingByDocId.get(spec.id);
    if (existingRow && existingRow.source_output_hash === currentHash) continue;
    await generateAndPersistOne(spec, project, 'gate_sync');
  }
}

/** Manual trigger — used by the Admin Panel "Regenerate All" action (Section 3.2). */
export async function regenerateAll(project: Project): Promise<{ generated: number; skipped: number; failed: number }> {
  const candidates = DOCUMENT_PACK.filter((spec) => isEligible(spec, project));
  let generated = 0;
  let failed = 0;
  for (const spec of candidates) {
    const ok = await generateAndPersistOne(spec, project, 'manual');
    if (ok) generated++;
    else failed++;
  }
  return { generated, skipped: DOCUMENT_PACK.length - candidates.length, failed };
}

/**
 * Fetches every generated document for a project WITH its content, base64-encoded,
 * for merging into the project-level ZIP export (documentExporter.ts,
 * exportAllArtifactsZip's `generatedDocuments` param). Sequential downloads —
 * fine for Phase 1's ≤19-document pack; a bulk-fetch route is a reasonable
 * fast-follow if/when the full 72-document pack makes this noticeably slow.
 */
export async function fetchAllDocumentsWithContent(
  projectId: string
): Promise<Array<{ category: string; title: string; format: 'docx' | 'md'; contentBase64: string }>> {
  const rows = await listProjectDocuments(projectId);
  const headers = await getAuthHeader();
  const results: Array<{ category: string; title: string; format: 'docx' | 'md'; contentBase64: string }> = [];

  for (const row of rows) {
    const res = await fetch(buildApiUrl(`/project-documents/${projectId}/${row.doc_id}/download`), { headers });
    if (!res.ok) continue; // best-effort — one bad row shouldn't fail the whole zip
    const blob = await res.blob();
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        resolve(result.slice(result.indexOf(',') + 1));
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    results.push({ category: row.category, title: row.title, format: row.format, contentBase64: base64 });
  }
  return results;
}

export { listProjectDocuments };
export type { ProjectDocumentRow };
