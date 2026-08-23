/**
 * 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential - Unauthorized use prohibited.
 */

// Item #5 Phase 1: evidenceItem() now lives in backend/src/rag/evidenceSchema.js
// (shared with any future non-chat caller). Re-exported below unchanged so
// nothing importing evidenceItem from this module needs to change.
const { evidenceItem } = require('../rag/evidenceSchema');

class ChatAccessError extends Error {
  constructor(message, status = 403) {
    super(message);
    this.name = 'ChatAccessError';
    this.status = status;
  }
}

function memberFromProjectData(project, email) {
  const members = Array.isArray(project?.data?.teamMembers) ? project.data.teamMembers : [];
  return members.find((member) => String(member?.email ?? '').toLowerCase() === String(email ?? '').toLowerCase()) ?? null;
}

function assignedAgentIds(project, memberId) {
  const assignments = Array.isArray(project?.data?.agentAssignments) ? project.data.agentAssignments : [];
  return assignments
    .filter((assignment) => Array.isArray(assignment?.memberIds) && assignment.memberIds.includes(memberId))
    .map((assignment) => String(assignment.agentId))
    .filter(Boolean);
}

async function loadProject(db, projectId) {
  const result = await db.query(
    `SELECT id, owner_id, name, description, domain, status, data, created_at, updated_at
       FROM projects
      WHERE id = $1`,
    [projectId],
  );
  return result.rows[0] ?? null;
}

async function authorizeChatProjectAccess({ db, caller, projectId, isAppAdmin = () => false }) {
  if (!db) throw new ChatAccessError('Project database is unavailable.', 503);
  if (!projectId) throw new ChatAccessError('A project must be open for project-specific evidence.', 400);

  const project = await loadProject(db, projectId);
  if (!project) throw new ChatAccessError('Project not found.', 404);

  if (caller?.adminBypass || isAppAdmin(caller?.email)) {
    return { project, role: 'app_admin', allAgents: true, allowedAgentIds: [] };
  }
  if (caller?.userId && project.owner_id === caller.userId) {
    return { project, role: 'project_owner', allAgents: true, allowedAgentIds: [] };
  }

  const memberResult = await db.query(
    `SELECT id, user_id, email, app_role, invite_status
       FROM team_members
      WHERE project_id = $1
        AND invite_status = 'accepted'
        AND (user_id = $2 OR LOWER(email) = LOWER($3))
      LIMIT 1`,
    [projectId, caller?.userId ?? null, caller?.email ?? ''],
  );
  const member = memberResult.rows[0];
  if (!member) throw new ChatAccessError('You do not have access to this project.', 403);
  if (member.app_role === 'project_owner') {
    return { project, role: 'project_owner', allAgents: true, allowedAgentIds: [] };
  }

  const jsonMember = memberFromProjectData(project, caller?.email);
  const scoped = jsonMember?.agentAccessScoped === true;
  return {
    project,
    role: member.app_role,
    allAgents: !scoped,
    allowedAgentIds: scoped ? assignedAgentIds(project, jsonMember?.id) : [],
  };
}

function createChatEvidenceTools({ db, isAppAdmin = () => false, externalResearch = null }) {
  async function accessFor(context) {
    return authorizeChatProjectAccess({ db, caller: context.caller, projectId: context.projectId, isAppAdmin });
  }

  async function execute(name, args = {}, context = {}) {
    if (!db) throw new ChatAccessError('Project database is unavailable.', 503);

    if (name === 'research_external_sources') {
      if (!externalResearch?.search) throw new ChatAccessError('External research is not configured.', 503);
      return externalResearch.search(String(args.query ?? ''), context.signal);
    }

    if (name === 'get_agent_catalog') {
      const result = await db.query(
        `SELECT ma.id, ma.name, ma.phase_id, ma.depends_on, ma.output_label,
                mp.order_index AS phase_order, mpa.agent_order
           FROM master_agents ma
           JOIN master_phases mp ON mp.id = ma.phase_id
           LEFT JOIN master_phase_agents mpa
             ON mpa.phase_id = ma.phase_id AND mpa.agent_id = ma.id
          WHERE ma.is_enabled = TRUE
          ORDER BY mp.order_index, mpa.agent_order NULLS LAST, ma.id
          LIMIT 100`,
      );
      return result.rows.map((row) => evidenceItem({
        sourceType: 'catalog',
        sourceId: row.id,
        title: row.name,
        excerpt: {
          phase: row.phase_id,
          dependencies: row.depends_on ?? [],
          outputLabel: row.output_label,
        },
        authority: 100,
      }));
    }

    const access = await accessFor(context);
    const project = access.project;
    const canReadAgent = (agentId) => access.allAgents || access.allowedAgentIds.includes(agentId);

    if (name === 'get_project_context') {
      return [evidenceItem({
        sourceType: 'project',
        sourceId: project.id,
        title: project.name,
        updatedAt: project.updated_at,
        excerpt: {
          name: project.name,
          description: project.description,
          domain: project.domain,
          status: project.status,
          currentPhase: project.data?.currentPhase ?? null,
          techStack: project.data?.techStack ?? null,
          targetUsers: project.data?.targetUsers ?? null,
          initialRisks: project.data?.initialRisks ?? null,
        },
        authority: 100,
        claimKey: 'project.status',
        claimValue: project.status,
      })];
    }

    if (name === 'get_agent_run_statuses') {
      const runtimeResult = await db.query(
        `SELECT ar.id, ar.agent_key, ar.status, ar.tool_trace,
                ar.started_at, ar.completed_at, ar.created_at
           FROM agent_runs ar
          WHERE ar.project_id = $1
          ORDER BY COALESCE(ar.completed_at, ar.started_at, ar.created_at) DESC
          LIMIT 100`,
        [project.id],
      );
      const latestRuntime = new Map();
      for (const row of runtimeResult.rows) {
        if (canReadAgent(row.agent_key) && !latestRuntime.has(row.agent_key)) latestRuntime.set(row.agent_key, row);
      }
      const blobRuns = project.data?.agentRuns && typeof project.data.agentRuns === 'object' ? project.data.agentRuns : {};
      const agentIds = new Set([...Object.keys(blobRuns), ...latestRuntime.keys()]);
      return [...agentIds]
        .filter(canReadAgent)
        .map((agentId) => {
          const runtime = latestRuntime.get(agentId);
          const blob = blobRuns[agentId] ?? {};
          const status = runtime?.status ?? blob.status ?? 'idle';
          return evidenceItem({
            sourceType: 'runtime',
            sourceId: agentId,
            title: `${agentId} runtime status`,
            updatedAt: runtime?.completed_at ?? runtime?.started_at ?? runtime?.created_at ?? blob.completedAt ?? blob.startedAt ?? project.updated_at,
            excerpt: {
              status,
              iterationCount: Array.isArray(runtime?.tool_trace) ? runtime.tool_trace.filter((entry) => entry?.type === 'iteration').length : (blob.l3?.iterationCount ?? null),
              error: blob.error ? String(blob.error).slice(0, 500) : null,
              validation: blob.l3?.validation ?? null,
            },
            authority: runtime ? 100 : 98,
            claimKey: `agent.${agentId}.status`,
            claimValue: status,
          });
        });
    }

    if (name === 'get_latest_agent_outputs') {
      const requested = Array.isArray(args.agentIds) ? args.agentIds.map(String) : null;
      const blobRuns = project.data?.agentRuns && typeof project.data.agentRuns === 'object' ? project.data.agentRuns : {};
      return Object.entries(blobRuns)
        .filter(([agentId, run]) => canReadAgent(agentId) && (!requested || requested.includes(agentId)) && run?.output)
        .slice(0, 12)
        .map(([agentId, run]) => evidenceItem({
          sourceType: 'agent_output',
          sourceId: agentId,
          title: `${agentId} latest output`,
          version: project.data?.version ?? null,
          updatedAt: run.completedAt ?? run.startedAt ?? project.updated_at,
          excerpt: run.output,
          authority: run.status === 'complete' ? 98 : 85,
        }));
    }

    if (name === 'get_review_gate_state') {
      const gates = project.data?.reviewGates && typeof project.data.reviewGates === 'object' ? project.data.reviewGates : {};
      return Object.entries(gates).map(([gateId, gate]) => evidenceItem({
        sourceType: 'review_gate',
        sourceId: gateId,
        title: `${gateId} review gate`,
        updatedAt: gate?.approvedAt ?? gate?.rejectedAt ?? project.updated_at,
        excerpt: {
          status: gate?.status ?? (gate?.approved ? 'approved' : 'pending'),
          approved: gate?.approved ?? false,
          feedback: gate?.feedback ?? gate?.comments ?? null,
        },
        authority: 100,
        claimKey: `gate.${gateId}.status`,
        claimValue: gate?.status ?? (gate?.approved ? 'approved' : 'pending'),
      }));
    }

    if (name === 'get_project_memory') {
      const result = await db.query(
        `SELECT id, title, content, tags, updated_at
           FROM memory_records
          WHERE project_id = $1
            AND (scope = 'project' OR (scope = 'domain_shared' AND approved = TRUE))
          ORDER BY updated_at DESC
          LIMIT 12`,
        [project.id],
      );
      return result.rows
        .filter((row) => {
          const tags = Array.isArray(row.tags) ? row.tags.map(String) : [];
          const sourceAgent = tags.find((tag) => tag.startsWith('source-agent:'))?.slice('source-agent:'.length);
          return !sourceAgent || canReadAgent(sourceAgent);
        })
        .map((row) => evidenceItem({
          sourceType: 'memory',
          sourceId: row.id,
          title: row.title,
          updatedAt: row.updated_at,
          excerpt: row.content,
          authority: 98,
        }));
    }

    throw new Error(`Unknown chat evidence tool: ${name}`);
  }

  return { execute };
}

module.exports = {
  ChatAccessError,
  authorizeChatProjectAccess,
  createChatEvidenceTools,
};
