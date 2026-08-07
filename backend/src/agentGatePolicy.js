// © 2026 Arun Gaikwad. All rights reserved.
// Proprietary and Confidential - Unauthorized use prohibited.

/**
 * Resolve whether a project-scoped agent may execute under the persisted
 * review-gate state. The database catalog is authoritative for agent phase
 * and gate boundaries; projects.data.reviewGates is authoritative for human
 * approvals.
 */
async function resolveAgentGateAuthorization({ db, projectId, agentId }) {
  const contextResult = await db.query(
    `SELECT p.data, ma.phase_id, mp.order_index AS agent_phase_order
     FROM projects p
     LEFT JOIN master_agents ma ON ma.id = $2
     LEFT JOIN master_phases mp ON mp.id = ma.phase_id
     WHERE p.id = $1
     LIMIT 1`,
    [projectId, agentId],
  );

  const context = contextResult.rows[0];
  if (!context) {
    return { allowed: false, status: 404, error: 'Project not found.' };
  }
  if (!context.phase_id || context.agent_phase_order == null) {
    return {
      allowed: false,
      status: 400,
      error: 'The requested agent is not registered in the governed agent catalog.',
    };
  }

  const agentPhaseOrder = Number(context.agent_phase_order);
  if (!Number.isFinite(agentPhaseOrder)) {
    throw new Error(`Invalid phase order for agent "${agentId}".`);
  }
  if (agentPhaseOrder === 0) {
    return { allowed: true, phaseId: context.phase_id, requiredGates: [] };
  }

  const gatesResult = await db.query(
    `SELECT mrg.gate_id, MAX(mp.order_index) AS gate_after_order
     FROM master_review_gates mrg
     JOIN master_phases mp ON mp.id = mrg.phase_id
     GROUP BY mrg.gate_id
     HAVING MAX(mp.order_index) < $1
     ORDER BY MAX(mp.order_index) ASC, mrg.gate_id ASC`,
    [agentPhaseOrder],
  );

  if (gatesResult.rows.length === 0) {
    throw new Error(`No review-gate boundary is configured before agent "${agentId}".`);
  }

  const rawData = context.data;
  const projectData = typeof rawData === 'string' ? JSON.parse(rawData) : (rawData ?? {});
  const reviewGates = projectData.reviewGates && typeof projectData.reviewGates === 'object'
    ? projectData.reviewGates
    : {};

  const requiredGates = gatesResult.rows.map((row) => String(row.gate_id));
  const blockingGate = requiredGates.find((gateId) => reviewGates[gateId]?.approved !== true);
  if (blockingGate) {
    return {
      allowed: false,
      status: 403,
      error: `${blockingGate} must be approved before this agent can run.`,
      phaseId: context.phase_id,
      blockingGate,
      requiredGates,
    };
  }

  return { allowed: true, phaseId: context.phase_id, requiredGates };
}

module.exports = { resolveAgentGateAuthorization };
