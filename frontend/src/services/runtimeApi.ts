/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
/**
 * runtimeApi.ts
 *
 * Typed client for the Agent Runtime backend (Express on port 4000).
 * All requests are routed through the Vite `/runtime` proxy so the
 * RUNTIME_API_TOKEN is injected server-side and never exposed in the browser.
 *
 * All functions are fire-and-forget friendly: callers should `void` them or
 * catch individually — a down runtime must not block agent execution.
 */

const RUNTIME_BASE = '/runtime/api/v1';

/**
 * The Agent Runtime is optional observability infrastructure.
 * If VITE_RUNTIME_URL is not configured, all runtime calls are silently
 * skipped so the pipeline never throws or logs noisy 503s.
 */
const RUNTIME_ENABLED = !!import.meta.env.VITE_RUNTIME_URL;

// ── Shared fetch helper ──────────────────────────────────────────────────────

async function runtimeFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${RUNTIME_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`[runtimeApi] ${init.method ?? 'GET'} ${path} → ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

// ── Types mirrored from shared-types / backend ──────────────────────────────

export interface RuntimeAgentRun {
  id: string;
  project_id: string;
  agent_key: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed';
  goal?: string | null;
  plan_steps?: string[] | null;
  input_payload?: unknown;
  result?: string | null;
  error?: string | null;
  provider?: string | null;
  model?: string | null;
  tool_trace?: unknown[];
  decisions?: unknown[];
  memory_read_ids?: string[];
  started_at?: string | null;
  completed_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface RuntimeAgentJob {
  id: string;
  project_id: string;
  agent_key: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  input_payload?: unknown;
  created_at: string;
  updated_at: string;
}

export interface CreateRunParams {
  project_id: string;
  agent_key: string;
  goal?: string;
  plan_steps?: string[];
  input_payload?: unknown;
  provider?: string;
  model?: string;
}

export interface CreateJobParams {
  project_id: string;
  agent_key: string;
  input_payload?: unknown;
}

// ── Agent Runs API ───────────────────────────────────────────────────────────

export const agentRunsApi = {
  /** Create a run record at the start of agent execution. Returns the new run's id. */
  async create(params: CreateRunParams): Promise<RuntimeAgentRun> {
    return runtimeFetch<RuntimeAgentRun>('/agent-runs', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  /** Mark a run succeeded with the final output. */
  async succeed(id: string, result: string): Promise<void> {
    await runtimeFetch<{ ok: boolean }>(`/agent-runs/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ action: 'succeed', result }),
    });
  },

  /** Mark a run failed with an error message. */
  async fail(id: string, error: string): Promise<void> {
    await runtimeFetch<{ ok: boolean }>(`/agent-runs/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ action: 'fail', error }),
    });
  },

  /** Append a tool trace entry (L3 agents). */
  async appendToolTrace(id: string, entry: unknown): Promise<void> {
    await runtimeFetch<{ ok: boolean }>(`/agent-runs/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ action: 'append_tool_trace', entry }),
    });
  },

  /** Append a decision record (L3 agents). */
  async appendDecision(id: string, decision: unknown): Promise<void> {
    await runtimeFetch<{ ok: boolean }>(`/agent-runs/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ action: 'append_decision', decision }),
    });
  },

  /** Record which memory records were read during this run. */
  async setMemoryReads(id: string, memoryIds: string[]): Promise<void> {
    await runtimeFetch<{ ok: boolean }>(`/agent-runs/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ action: 'set_memory_reads', memory_ids: memoryIds }),
    });
  },

  /** Fetch a single run by id. */
  async getById(id: string): Promise<RuntimeAgentRun> {
    return runtimeFetch<RuntimeAgentRun>(`/agent-runs/${id}`);
  },

  /** List all runs for a project (most recent first). */
  async listByProject(projectId: string): Promise<RuntimeAgentRun[]> {
    return runtimeFetch<RuntimeAgentRun[]>(`/agent-runs?project_id=${encodeURIComponent(projectId)}`);
  },
};

// ── Agent Jobs API ───────────────────────────────────────────────────────────

export const agentJobsApi = {
  /** Enqueue a durable agent job. Worker picks it up asynchronously. */
  async create(params: CreateJobParams): Promise<RuntimeAgentJob> {
    return runtimeFetch<RuntimeAgentJob>('/agent-jobs', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  /** Poll a job's current status. */
  async getById(id: string): Promise<RuntimeAgentJob> {
    return runtimeFetch<RuntimeAgentJob>(`/agent-jobs/${id}`);
  },

  /** List jobs for a project, optionally filtered by status. */
  async listByProject(
    projectId: string,
    status?: RuntimeAgentJob['status'],
  ): Promise<RuntimeAgentJob[]> {
    const qs = new URLSearchParams({ project_id: projectId });
    if (status) qs.set('status', status);
    return runtimeFetch<RuntimeAgentJob[]>(`/agent-jobs?${qs.toString()}`);
  },
};

// ── Convenience: fire-and-forget wrappers ───────────────────────────────────
// Use these in pipelineEngine.ts so a down runtime never throws on the
// critical execution path.

export function syncRunStart(params: CreateRunParams): Promise<string | null> {
  if (!RUNTIME_ENABLED) return Promise.resolve(null);
  return agentRunsApi.create(params)
    .then((r) => r.id)
    .catch((err) => {
      console.warn('[runtimeApi] syncRunStart failed (runtime down?):', err);
      return null;
    });
}

export function syncRunSucceed(id: string | null, result: string): void {
  if (!id || !RUNTIME_ENABLED) return;
  agentRunsApi.succeed(id, result).catch((err) => {
    console.warn('[runtimeApi] syncRunSucceed failed:', err);
  });
}

export function syncRunFail(id: string | null, error: string): void {
  if (!id || !RUNTIME_ENABLED) return;
  agentRunsApi.fail(id, error).catch((err) => {
    console.warn('[runtimeApi] syncRunFail failed:', err);
  });
}
