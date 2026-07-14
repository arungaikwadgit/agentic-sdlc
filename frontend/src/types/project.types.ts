/**
 * © 2025 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
import type { AgentId, AgentRun, PhaseId, ClarifyingAnswer } from './agent.types';
import type { DomainId } from './domain.types';
import type { ExtractionPackage, ApprovalRecord } from './extraction.types';

/** Role within the app for access control purposes */
export type AppRole = 'project_owner' | 'editor' | 'reviewer' | 'viewer';

/** Status of a team member's invite */
export type InviteStatus = 'pending' | 'accepted' | 'revoked';

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: string;           // job title / functional role (e.g. "Product Manager")
  appRole: AppRole;       // access control role within the app
  avatarColor: string;
  /**
   * @deprecated No longer authoritative. Settings/edit access is derived
   * solely from `appRole === 'project_owner'` (see
   * frontend/src/lib/projectAccess.ts's `isProjectAdminUser`) —
   * historically this was a second, independently-toggleable flag that
   * could drift from `appRole` (e.g. a 'viewer' with isAdmin:true), which
   * is exactly the duplicated-authorization bug this deprecation closes.
   * May still be present on persisted project JSON from before this
   * change; do not read or write it in new code.
   */
  isAdmin?: boolean;
  inviteStatus: InviteStatus;
  inviteToken?: string;   // generated at invite time, cleared after acceptance
  invitedAt?: number;     // ms timestamp
  acceptedAt?: number;    // ms timestamp, set when invite is accepted
  /**
   * When true, this member's ability to run/edit agents is restricted to
   * whatever's in project.agentAssignments for their id (see
   * ProjectWorkspace.tsx's per-agent gating and backend/src/proxy.js's
   * authorizeAgentRun()) -- every other agent is read-only for them
   * (status/output viewable, no run, no prompt edit). Project Owners are
   * exempt regardless of this flag (always full access).
   *
   * Set to true only by the mandatory-agent-assignment invite flow
   * (InviteModal, appRole === 'editor') introduced 2026-07-11. Left
   * undefined/false for every member created before that change so existing
   * Editors keep today's full-project-access behavior until an admin
   * explicitly opts them in by re-inviting or narrowing their assignments --
   * this is the grandfathering rule; do not default this to true elsewhere.
   */
  agentAccessScoped?: boolean;
}

/** Permissions matrix per role */
export const ROLE_PERMISSIONS: Record<AppRole, {
  label: string;
  description: string;
  canRunAgents: boolean;
  canEditSettings: boolean;
  canInvite: boolean;
  canRemoveMembers: boolean;
  canViewOutputs: boolean;
  canCommentApprove: boolean;
}> = {
  project_owner: {
    label: 'Project Owner',
    description: 'Full control of this project — can invite/remove members (including other Project Owners), change roles, run agents, and edit settings. Deleting a project is reserved for app administrators.',
    canRunAgents: true,
    canEditSettings: true,
    canInvite: true,
    canRemoveMembers: true,
    canViewOutputs: true,
    canCommentApprove: true,
  },
  editor: {
    label: 'Editor',
    description: 'Can run agents and upload documents, but cannot change project settings — only the Project Owner (or an app administrator) can.',
    canRunAgents: true,
    canEditSettings: false,
    canInvite: false,
    canRemoveMembers: false,
    canViewOutputs: true,
    canCommentApprove: true,
  },
  reviewer: {
    label: 'Reviewer',
    description: 'Can view outputs, comment, and approve review gates — but cannot run agents or change settings.',
    canRunAgents: false,
    canEditSettings: false,
    canInvite: false,
    canRemoveMembers: false,
    canViewOutputs: true,
    canCommentApprove: true,
  },
  viewer: {
    label: 'Viewer',
    description: 'Read-only — can view all agent outputs but cannot make any changes.',
    canRunAgents: false,
    canEditSettings: false,
    canInvite: false,
    canRemoveMembers: false,
    canViewOutputs: true,
    canCommentApprove: false,
  },
};

/**
 * Roles that can be granted through invite links.
 * Elevated project ownership/admin authority must be assigned explicitly
 * inside the project after membership exists, never via email link.
 */
export const INVITABLE_APP_ROLES: AppRole[] = ['project_owner', 'editor', 'reviewer', 'viewer'];

/** Many-to-many: one agent can have multiple assigned members */
export interface AgentAssignment {
  agentId: AgentId;
  memberIds: string[];
}

export interface ProjectExportAccess {
  enabledRoleIds?: AppRole[];
  enabledMemberIds?: string[];
}

export type ProjectStatus = 'draft' | 'running' | 'paused' | 'complete' | 'error';

export type ProjectPriority = 'low' | 'medium' | 'high' | 'critical';

export type ProjectType = 'web-app' | 'mobile-app' | 'api-backend' | 'internal-tool' | 'data-ml' | 'other';

/**
 * How the engagement/contract for this project is structured. Distinct from
 * ProjectType (what's being built) — this describes the commercial delivery
 * model, which affects how the SDLC Orchestrator should frame scope risk,
 * change-request rigor, and critical path (e.g. a fixed-bid engagement needs
 * tighter scope-lock and estimation discipline than time-and-materials).
 */
export type ProjectExecutionStyle =
  | 'fixed-bid'
  | 'time-and-materials'
  | 'dedicated-team'
  | 'staff-augmentation'
  | 'fixed-capacity'
  | 'milestone-based'
  | 'retainer'
  | 'outcome-based'
  | 'other';

export type ReviewGateId = 'gate0' | 'gate1' | 'gate2' | 'gate3' | 'gate5' | 'gate6';

export interface ReviewGate {
  id: ReviewGateId;
  afterPhases: PhaseId[];
  approved: boolean;
  approvedAt?: number;
  approvedBy?: string;
  notes?: string;
}

export interface PromptOverride {
  agentId: AgentId;
  patch: object[];
  fullPrompt?: string;
  updatedAt: number;
}

/**
 * A replan trigger condition that an agent flagged as having occurred,
 * detected via an explicit <replan-trigger> tag the agent emitted in its
 * own output (see services/pipelineEngine.ts `extractReplanTrigger`).
 *
 * When present and unacknowledged on a project, the pipeline pauses
 * (status: 'paused') and the admin must acknowledge it before resuming.
 * This is a "pause + flag for review" mechanism, distinct from ReviewGate —
 * it is not an approval step that unlocks the next phase; acknowledging
 * just clears the flag so the admin can resume manually. No auto-replan.
 */
export interface ReplanFlag {
  /** Agent whose output contained the trigger tag */
  agentId: AgentId;
  /** Phase the agent belongs to, for display */
  phase: PhaseId;
  /** Free-text reason/condition, taken from the tag content */
  reason: string;
  flaggedAt: number;
  acknowledged: boolean;
  acknowledgedAt?: number;
  acknowledgedBy?: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  domain: DomainId;
  status: ProjectStatus;
  version: number;
  createdAt: number;
  updatedAt: number;
  currentPhase?: PhaseId;
  agentRuns: Partial<Record<AgentId, AgentRun>>;
  reviewGates: Partial<Record<ReviewGateId, ReviewGate>>;
  promptOverrides: PromptOverride[];
  mode: 'simple' | 'expert';
  teamMembers: TeamMember[];
  agentAssignments: AgentAssignment[];
  activeAdminId?: string;
  domainKnowledge?: string;
  brandingGuidelines?: string;
  disabledRoleIds?: string[];
  archived?: boolean;
  archivedReason?: string;
  archivedAt?: number;
  archivedBy?: string;
  githubIntegrationId?: string;
  sourceDocumentIds?: string[];
  extractionPackage?: ExtractionPackage;
  creationApproval?: ApprovalRecord;
  /**
   * Email of the user who created this project.
   * Used for client-side access control: only the owner and accepted
   * team members can see a project in the dashboard.
   * Legacy projects (created before this field was added) have no ownerId
   * and are always visible (backward-compatible).
   */
  ownerId?: string;
  owner?: string;
  team?: string;
  projectType?: ProjectType;
  projectExecutionStyle?: ProjectExecutionStyle;
  priority?: ProjectPriority;
  startDate?: string;
  targetEndDate?: string;
  techStack?: string;
  targetUsers?: string;
  initialRisks?: string;
  /**
   * Agent IDs marked as skippable by the admin (via the SDLC Orchestrator's
   * Pipeline Plan tab). PipelineEngine.runAgent checks this and marks the
   * agent run 'skipped' instead of executing it. Phase order is unaffected —
   * only individual agents within the existing fixed phase order can be
   * skipped; reordering phases is out of scope (see pipelineEngine.ts).
   */
  skippedAgentIds?: AgentId[];
  /**
   * Set once the project owner/admin has confirmed the pre-flight
   * team-assignment warning (unassigned agents will be skipped) before the
   * first pipeline run. Prevents re-showing that warning on every
   * subsequent "Resume Pipeline" click — see lib/agentEnablement.ts and
   * ProjectWorkspace.tsx's Run Pipeline button.
   */
  teamAssignmentWarningAcknowledged?: boolean;
  /**
   * Answers collected via the pre-generation clarifying-questions flow (see
   * AgentDefinition.needsClarifyingQuestions in agent.types.ts), keyed by
   * agentId. Presence of a non-empty array for an agentId is what tells
   * PipelineEngine.runAgent() the question step is done and it's safe to
   * proceed to that agent's actual generation call — see
   * services/clarifyingQuestions.ts and pipelineEngine.ts.
   */
  clarifyingAnswers?: Partial<Record<AgentId, ClarifyingAnswer[]>>;
  /**
   * Context documents attached by the user for agent re-runs.
   * Persisted so the extracted text survives panel close / page reload.
   * Each entry mirrors ExtractedFile (minus the ephemeral File object).
   */
  contextDocuments?: {
    id: string;
    name: string;
    sizeKb: number;
    kind: 'text' | 'image' | 'spreadsheet' | 'document' | 'pdf' | 'unknown';
    content: string;
  }[];
  /**
   * Active (unacknowledged or recently acknowledged) replan trigger flags
   * raised by agents during pipeline execution. Most recent last. See
   * ReplanFlag for the pause-and-flag-for-review semantics.
   */
  replanFlags?: ReplanFlag[];
  /**
   * Number of distinct mockup versions the UX Mockups agent should generate.
   * Range 1–4. Persisted so the setting survives panel close / page reload.
   * Defaults to 2 in the pipeline engine when absent.
   */
  mockupVersionCount?: number;
  /**
   * Per-project overrides for download/export access.
   * Admins always retain access. Non-admin users can export only if their
   * role or explicit member ID is allow-listed here.
   */
  exportAccess?: ProjectExportAccess;
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
