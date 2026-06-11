import type { AgentId, AgentRun, PhaseId } from './agent.types';
import type { DomainId } from './domain.types';

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: string;
  avatarColor: string;
  isAdmin: boolean;
}

/** Many-to-many: one agent can have multiple assigned members */
export interface AgentAssignment {
  agentId: AgentId;
  memberIds: string[];  // TeamMember.id[]
}

export type ProjectStatus = 'draft' | 'running' | 'paused' | 'complete' | 'error';

export type ReviewGateId = 'gate1' | 'gate2_3' | 'gate5' | 'gate6';

export interface ReviewGate {
  id: ReviewGateId;
  /** Phase(s) that precede this gate */
  afterPhases: PhaseId[];
  approved: boolean;
  approvedAt?: number;
  approvedBy?: string;  // TeamMember.id
  notes?: string;
}

export interface PromptOverride {
  agentId: AgentId;
  /** JSON Patch operations (RFC 6902) against the default prompt */
  patch: object[];
  /** Full replacement prompt string (takes precedence over patch when set) */
  fullPrompt?: string;
  updatedAt: number;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  domain: DomainId;
  status: ProjectStatus;
  /** Optimistic concurrency version stamp */
  version: number;
  createdAt: number;
  updatedAt: number;
  /** Which phase is currently active */
  currentPhase?: PhaseId;
  /** All agent run states, keyed by agentId */
  agentRuns: Partial<Record<AgentId, AgentRun>>;
  /** Review gate states */
  reviewGates: Partial<Record<ReviewGateId, ReviewGate>>;
  /** Per-agent prompt overrides (Expert mode) */
  promptOverrides: PromptOverride[];
  /** Simple or Expert UI mode */
  mode: 'simple' | 'expert';
  /** Team members on this project */
  teamMembers: TeamMember[];
  /** Agent → team member assignments (many-to-many) */
  agentAssignments: AgentAssignment[];
  /** ID of the active admin session (TeamMember.id) — no password, just selection */
  activeAdminId?: string;
  /** User-edited domain knowledge brief (prepended to all agent prompts) */
  domainKnowledge?: string;
  /** Branding guidelines (colors, typography, tone, brand references) supplied by the project owner — used by the UX Mockups agent */
  brandingGuidelines?: string;
  /** Role template IDs (RoleTemplate.id) hidden from pickers for this project, e.g. roles not applicable to this team */
  disabledRoleIds?: string[];
  /** Soft-delete: true if the project is archived. Hidden from the dashboard by default, but can be reopened by an admin. */
  archived?: boolean;
  /** Reason given by the admin who archived this project */
  archivedReason?: string;
  /** Timestamp when the project was archived */
  archivedAt?: number;
  /** TeamMember.id (or name, if no team set up) of the admin who archived this project */
  archivedBy?: string;
  /** id of this project's GitHub credential record in db.integrations (if connected) */
  githubIntegrationId?: string;
}

export interface ProjectSummary {
  id: string;
  name: string;
  domain: DomainId;
  status: ProjectStatus;
  createdAt: number;
  updatedAt: number;
  completedAgents: number;
  totalAgents: number;
  archived?: boolean;
  archivedReason?: string;
  archivedAt?: number;
  archivedBy?: string;
}
