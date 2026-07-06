/**
 * shared-types — TypeScript interfaces shared between backend and frontend.
 * Vendored copy inlined into backend/src for Railway monorepo builds.
 * Source of truth: shared-types/src/index.ts
 * DO NOT import backend-specific packages (pg, express) here.
 */

// ── Enums (mirrors DB enums) ────────────────────────────────────────────────

export type AgentRunStatus = 'running' | 'succeeded' | 'failed' | 'retrying';
export type AgentJobStatus = 'queued' | 'running' | 'succeeded' | 'failed';
export type MemoryRecordScope = 'project' | 'domain_shared';
export type ActionProposalStatus = 'pending' | 'auto_approved' | 'approved' | 'rejected';
export type RiskLevel = 'low' | 'medium' | 'high';
export type UserRole = 'admin' | 'product_owner';

// v1 action type taxonomy (ADR-005)
export type ActionType =
  | 'generate_document'
  | 'tag_memory_record'
  | 'flag_for_review';

// ── Plan / Trace types ───────────────────────────────────────────────────────

export interface ToolTraceEntry {
  type: 'llm_call' | 'tool_call' | 'retrieval';
  name?: string;
  input?: unknown;
  output?: unknown;
  tokens?: { prompt: number; completion: number };
  duration_ms?: number;
  timestamp: string; // ISO
}

export interface DecisionEntry {
  type: string;          // e.g. 'retry' | 'classification' | 'policy_check'
  rationale: string;
  confidence?: number;   // 0.0 - 1.0
  timestamp: string;     // ISO
  // Log Analysis Agent specific
  failure_id?: string;
  classification?: 'known_pattern' | 'novel';
}

// ── Core domain types ────────────────────────────────────────────────────────

export interface AgentRun {
  id: string;
  project_id: string;
  agent_key: string;
  status: AgentRunStatus;
  // Phase 1 runtime fields
  goal?: string;
  plan_steps?: string[];
  tool_trace?: ToolTraceEntry[];
  decisions?: DecisionEntry[];
  memory_reads?: string[];  // array of memory_record IDs
  // Execution metadata
  provider?: string;
  model?: string;
  input_payload?: unknown;
  result?: string;
  error?: string;
  created_at: string;
  started_at?: string;
  completed_at?: string;
}

export interface AgentJob {
  id: string;
  project_id: string;
  agent_key: string;
  status: AgentJobStatus;
  input_payload: unknown;
  result?: string;
  error?: string;
  attempts: number;
  next_attempt_after?: string;
  agent_run_id?: string;
  created_at: string;
  started_at?: string;
  completed_at?: string;
}

export interface MemoryRecord {
  id: string;
  project_id: string;
  scope: MemoryRecordScope;
  domain_id?: string;
  approved: boolean;
  approved_by?: string;
  approved_at?: string;
  title: string;
  content: string;
  tags: string[];
  created_by?: string;
  created_at: string;
  updated_at: string;
}

export interface ActionProposal {
  id: string;
  project_id: string;
  agent_run_id: string;
  action_type: ActionType;
  risk_level: RiskLevel;
  payload: unknown;
  status: ActionProposalStatus;
  decided_by?: string;
  decided_at?: string;
  created_at: string;
}

export interface RollbackLog {
  id: string;
  proposal_id: string;
  snapshot: {
    agent_key: string;
    output_preview: string;  // first 1000 chars
  };
  created_at: string;
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  industry?: string;
  team_size?: string;
  methodology?: string;
  active_admin_id?: string;
  created_at: string;
  updated_at: string;
}

export interface TeamMember {
  id: string;
  project_id: string;
  email: string;
  name: string;
  role: UserRole;
  is_admin: boolean;
  created_at: string;
}

// ── API request/response shapes ──────────────────────────────────────────────

export interface EnqueueJobRequest {
  agent_key: string;
  input_payload?: unknown;
}

export interface EnqueueJobResponse {
  id: string;
  status: AgentJobStatus;
  agent_key: string;
  created_at: string;
}

export interface CreateMemoryRecordRequest {
  scope: MemoryRecordScope;
  domain_id?: string;
  title: string;
  content: string;
  tags?: string[];
}

export interface CreateActionProposalRequest {
  action_type: ActionType;
  risk_level: RiskLevel;
  payload?: unknown;
}

export interface FailureSummary {
  failedRuns: AgentRun[];
  failedJobs: AgentJob[];
}

// ── Policy engine types (Phase 4) ────────────────────────────────────────────

export interface PolicyEvaluationResult {
  status: ActionProposalStatus;
  rule_applied: string;
}
