import { getAuthHeader } from '@/services/api';
import { PHASE_ORDER, PARALLEL_PHASES, PHASE_AGENTS, REVIEW_GATES, PHASE_LABELS, PHASE_SDLC_STAGE } from '@/agents/constants';
import { AGENT_DEFINITIONS } from '@/agents/definitions';
import { DOMAINS } from '@/agents/domains';
import { DOMAIN_KNOWLEDGE_TEMPLATES } from '@/agents/domainKnowledgeTemplates';
import { ROLE_TEMPLATES, type RoleTemplate } from '@/data/roleTemplates';
import type { AgentId, PhaseId } from '@/types/agent.types';
import type { DomainDefinition, DomainId } from '@/types/domain.types';

function getApiBase(raw: string | undefined): string {
  const base = (raw ?? '/api').replace(/\/$/, '');
  if (!base || base === '/') return '/api';
  if (base === '/api' || base.endsWith('/api')) return base;
  return `${base}/api`;
}

const API_URL = getApiBase(import.meta.env.VITE_API_URL);
const PROXY_TOKEN = (import.meta.env.VITE_PROXY_TOKEN ?? '').trim();

interface PhaseRow {
  id: PhaseId;
  order_index: number;
  label: string;
  sdlc_stage: string;
  is_parallel: boolean;
}

interface ReviewGateRow {
  gate_id: string;
  phase_id: PhaseId;
  phase_order: number;
}

interface AgentRow {
  id: AgentId;
  name: string;
  phase_id: PhaseId;
  description: string;
  output_label: string;
  depends_on: AgentId[] | null;
  max_iterations: number | null;
}

interface PhaseAgentRow {
  phase_id: PhaseId;
  agent_id: AgentId;
  agent_order: number;
}

interface DomainRow {
  id: DomainId;
  label: string;
  color: string;
  bg_color: string;
  context: string;
  template: string;
}

interface RoleTemplateRow {
  id: string;
  title: string;
  description: string;
  color: string;
  sort_order: number;
}

interface RoleTemplateAgentRow {
  role_template_id: string;
  agent_id: AgentId;
  sort_order: number;
}

interface MasterCatalogResponse {
  phases: PhaseRow[];
  reviewGates: ReviewGateRow[];
  agents: AgentRow[];
  phaseAgents: PhaseAgentRow[];
  domains: DomainRow[];
  roleTemplates: RoleTemplateRow[];
  roleTemplateAgents: RoleTemplateAgentRow[];
}

const MASTER_CATALOG_TIMEOUT_MS = 15_000;

async function fetchMasterCatalog(): Promise<MasterCatalogResponse | null> {
  const authHeaders = await getAuthHeader();
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), MASTER_CATALOG_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${API_URL}/master-data/catalog`, {
      headers: {
        ...authHeaders,
        ...(!authHeaders.Authorization && PROXY_TOKEN ? { 'X-API-Token': PROXY_TOKEN } : {}),
      },
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Master catalog request timed out after ${MASTER_CATALOG_TIMEOUT_MS}ms`);
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(`Master catalog request failed: ${response.status}`);
  }
  return await response.json() as MasterCatalogResponse;
}

function replaceRecordArrays<T extends string, V>(target: Record<T, V[]>, next: Record<T, V[]>) {
  for (const key of Object.keys(target) as T[]) {
    delete (target as Record<string, V[]>)[key];
  }
  for (const [key, value] of Object.entries(next) as [T, V[]][]) {
    target[key] = value;
  }
}

function applyCatalog(catalog: MasterCatalogResponse) {
  const orderedPhases = [...catalog.phases].sort((a, b) => a.order_index - b.order_index);
  PHASE_ORDER.splice(0, PHASE_ORDER.length, ...orderedPhases.map((phase) => phase.id));

  PARALLEL_PHASES.clear();
  for (const phase of orderedPhases) {
    if (phase.is_parallel) PARALLEL_PHASES.add(phase.id);
    PHASE_LABELS[phase.id] = phase.label;
    PHASE_SDLC_STAGE[phase.id] = phase.sdlc_stage;
  }

  const phaseAgentsNext = {} as Record<PhaseId, AgentId[]>;
  for (const phase of orderedPhases) phaseAgentsNext[phase.id] = [];
  for (const row of [...catalog.phaseAgents].sort((a, b) => a.agent_order - b.agent_order)) {
    if (!phaseAgentsNext[row.phase_id]) phaseAgentsNext[row.phase_id] = [];
    phaseAgentsNext[row.phase_id].push(row.agent_id);
  }
  replaceRecordArrays(PHASE_AGENTS, phaseAgentsNext);

  const reviewGatesNext = {} as Record<string, PhaseId[]>;
  for (const row of [...catalog.reviewGates].sort((a, b) => a.phase_order - b.phase_order)) {
    if (!reviewGatesNext[row.gate_id]) reviewGatesNext[row.gate_id] = [];
    reviewGatesNext[row.gate_id].push(row.phase_id);
  }
  for (const key of Object.keys(REVIEW_GATES)) {
    delete (REVIEW_GATES as Record<string, PhaseId[]>)[key];
  }
  for (const [key, phases] of Object.entries(reviewGatesNext)) {
    (REVIEW_GATES as Record<string, PhaseId[]>)[key] = phases;
  }

  for (const row of catalog.agents) {
    const agent = AGENT_DEFINITIONS[row.id];
    if (!agent) continue;
    agent.name = row.name;
    agent.phase = row.phase_id;
    agent.description = row.description;
    agent.outputLabel = row.output_label;
    agent.dependsOn = Array.isArray(row.depends_on) ? row.depends_on : [];
    agent.maxIterations = row.max_iterations ?? undefined;
  }

  for (const key of Object.keys(DOMAINS) as DomainId[]) {
    delete (DOMAINS as Record<string, DomainDefinition>)[key];
  }
  for (const row of catalog.domains) {
    DOMAINS[row.id] = {
      id: row.id,
      label: row.label,
      color: row.color,
      bgColor: row.bg_color,
      context: row.context,
    };
    DOMAIN_KNOWLEDGE_TEMPLATES[row.id] = row.template;
  }

  const agentsByRole = new Map<string, AgentId[]>();
  for (const row of [...catalog.roleTemplateAgents].sort((a, b) => a.sort_order - b.sort_order)) {
    const list = agentsByRole.get(row.role_template_id) ?? [];
    list.push(row.agent_id);
    agentsByRole.set(row.role_template_id, list);
  }

  const nextRoles: RoleTemplate[] = [...catalog.roleTemplates]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description,
      color: row.color,
      suggestedAgents: agentsByRole.get(row.id) ?? [],
    }));
  ROLE_TEMPLATES.splice(0, ROLE_TEMPLATES.length, ...nextRoles);
}

let initPromise: Promise<void> | null = null;

export function initializeMasterDataCatalog(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    try {
      const catalog = await fetchMasterCatalog();
      if (!catalog) {
        throw new Error('Master catalog API returned no data.');
      }
      applyCatalog(catalog);
    } catch (error) {
      // Local-dev-only fallback: when the backend can't serve the DB-backed catalog
      // (e.g. no local Postgres/Supabase configured -- see docs/DEVELOPMENT.md), don't
      // hard-block the whole app. Log a warning and continue with the built-in
      // defaults already present in agents/definitions.ts, agents/domains.ts, and
      // data/roleTemplates.ts (these modules are only ever *overwritten* by
      // applyCatalog(), never cleared beforehand, so skipping it here just means
      // "keep what's already loaded").
      //
      // Production keeps the original hard-fail behavior -- import.meta.env.DEV is
      // false in the built app, so this branch is a no-op there and App.tsx's
      // existing catalogError handling is unchanged.
      if (import.meta.env.DEV) {
        console.warn(
          '[masterDataCatalog] Falling back to built-in agent/domain/role defaults ' +
          '(catalog fetch failed -- this is expected in local dev without POSTGRES_URL/SUPABASE_* set):',
          error,
        );
        return;
      }
      throw error;
    }
  })().finally(() => {
    initPromise = null;
  });

  return initPromise;
}
