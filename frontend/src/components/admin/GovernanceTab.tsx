/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 *
 * GovernanceTab — AI Governance MVP-0 (2026-07-21). See
 * docs/architecture/govern-ai-gap-assessment-and-implementation-plan.md, §8.
 * Cross-project decision/risk/findings table + drill-in, plus the
 * global/per-project agent kill switch (decision 2), reading/writing
 * backend/src/routes/governance.js and backend/src/routes/agentControls.js.
 *
 * Code-review fix (2026-07-22, Suggestion #7): this used to call GET
 * /:projectId once per project (N+1) via fetchGovernanceStatus. Now calls
 * GET /governance/aggregate?projectIds=... once for every project on the
 * page, via the admin-only aggregate route in governance.js.
 */
import { useEffect, useState } from 'react';
import { getAuthHeader } from '@/services/api';
import { listProjectRecords } from '@/db/projectRepository';
import { AGENT_DEFINITIONS } from '@/agents/definitions';
import {
  governanceApiBase,
  DECISION_LABELS,
  DECISION_COLORS,
  type GovernanceStatus,
} from '@/services/governanceStatus';
import type { Project } from '@/types/project.types';
import type { AgentId } from '@/types/agent.types';

interface ProjectGovernanceRow {
  project: Project;
  status: GovernanceStatus | null;
}

interface AgentGlobalSetting {
  agent_id: string;
  disabled: boolean;
}

interface ProjectAgentOverride {
  project_id: string;
  agent_id: string;
  disabled: boolean;
}

interface ApiResult<T> {
  data: T | null;
  error: string | null;
}

async function apiCall<T>(path: string, options?: RequestInit): Promise<ApiResult<T>> {
  try {
    const resp = await fetch(`${governanceApiBase()}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(await getAuthHeader()), ...(options?.headers ?? {}) },
    });
    if (!resp.ok) {
      let detail = '';
      try {
        const body = await resp.json();
        detail = body?.error ? `: ${body.error}` : '';
      } catch { /* body wasn't JSON — fall back to status only */ }
      return { data: null, error: `HTTP ${resp.status}${detail}` };
    }
    return { data: (await resp.json()) as T, error: null };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : 'Network error — is the backend running?' };
  }
}

export default function GovernanceTab() {
  const [rows, setRows] = useState<ProjectGovernanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [rowsError, setRowsError] = useState<string | null>(null);
  const [drillInId, setDrillInId] = useState<string | null>(null);

  const [globalSettings, setGlobalSettings] = useState<AgentGlobalSetting[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [projectOverrides, setProjectOverrides] = useState<ProjectAgentOverride[]>([]);
  const [killSwitchError, setKillSwitchError] = useState<string | null>(null);
  const [pendingAgentId, setPendingAgentId] = useState<string | null>(null);

  async function loadRows() {
    setLoading(true);
    setRowsError(null);
    try {
      const projects = await listProjectRecords();
      if (projects.length === 0) { setRows([]); return; }
      const idsParam = projects.map((p) => p.id).join(',');
      const { data, error } = await apiCall<{ items: Record<string, GovernanceStatus> }>(
        `/governance/aggregate?projectIds=${encodeURIComponent(idsParam)}`
      );
      if (error) throw new Error(error);
      const items = data?.items ?? {};
      setRows(projects.map((project) => ({ project, status: items[project.id] ?? null })));
      setSelectedProjectId((current) => current || projects[0]?.id || '');
    } catch (err) {
      setRows([]);
      setRowsError(err instanceof Error ? err.message : 'Failed to load projects.');
    } finally {
      setLoading(false);
    }
  }

  async function loadGlobalSettings() {
    const { data, error } = await apiCall<{ items: AgentGlobalSetting[] }>('/agent-controls/global');
    if (error) { setKillSwitchError(`Failed to load global settings: ${error}`); return; }
    setGlobalSettings(data?.items ?? []);
  }

  async function loadProjectOverrides(projectId: string) {
    if (!projectId) { setProjectOverrides([]); return; }
    const { data, error } = await apiCall<{ items: ProjectAgentOverride[] }>(`/agent-controls/project/${projectId}`);
    if (error) { setKillSwitchError(`Failed to load project overrides: ${error}`); return; }
    setProjectOverrides(data?.items ?? []);
  }

  useEffect(() => { void loadRows(); void loadGlobalSettings(); }, []);
  useEffect(() => { void loadProjectOverrides(selectedProjectId); }, [selectedProjectId]);

  async function toggleGlobal(agentId: string, currentlyDisabled: boolean) {
    setKillSwitchError(null);
    setPendingAgentId(agentId);
    const { error } = await apiCall(`/agent-controls/global/${agentId}`, {
      method: 'POST',
      body: JSON.stringify({ disabled: !currentlyDisabled }),
    });
    setPendingAgentId(null);
    if (error) { setKillSwitchError(`Failed to update "${agentId}" (global): ${error}`); return; }
    await loadGlobalSettings();
  }

  async function setProjectOverride(agentId: string, disabled: boolean | null) {
    if (!selectedProjectId) return;
    setKillSwitchError(null);
    setPendingAgentId(agentId);
    const result = disabled === null
      ? await apiCall(`/agent-controls/project/${selectedProjectId}/${agentId}`, { method: 'DELETE' })
      : await apiCall(`/agent-controls/project/${selectedProjectId}/${agentId}`, {
        method: 'POST',
        body: JSON.stringify({ disabled }),
      });
    setPendingAgentId(null);
    if (result.error) { setKillSwitchError(`Failed to update "${agentId}" for this project: ${result.error}`); return; }
    await loadProjectOverrides(selectedProjectId);
  }

  const pill: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 600 };
  const sel: React.CSSProperties = { background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 6, padding: '5px 9px', fontSize: 12 };

  const drillIn = rows.find((r) => r.project.id === drillInId) ?? null;
  const selectedProject = rows.find((r) => r.project.id === selectedProjectId)?.project ?? null;
  const selectedProjectName = selectedProject?.name ?? 'selected project';
  const globalByAgent = Object.fromEntries(globalSettings.map((s) => [s.agent_id, s.disabled]));
  const overrideByAgent = Object.fromEntries(projectOverrides.map((o) => [o.agent_id, o.disabled]));
  const agentIds = Object.keys(AGENT_DEFINITIONS) as AgentId[];
  const statusPill = (disabled: boolean): React.CSSProperties => ({
    ...pill,
    color: disabled ? 'var(--error, #ef4444)' : 'var(--success, #10b981)',
    border: `1px solid ${disabled ? 'var(--error, #ef4444)' : 'var(--success, #10b981)'}`,
    background: disabled ? 'rgba(239, 68, 68, 0.12)' : 'rgba(16, 185, 129, 0.12)',
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>AI Governance</h3>
        <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
          Decisions, risk, and findings across every project, plus the agent kill switch.
        </p>
      </div>

      {/* Cross-project table */}
      {loading ? (
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading…</p>
      ) : rowsError ? (
        <p style={{ fontSize: 13, color: 'var(--error, #ef4444)' }}>
          Failed to load projects: {rowsError}
          {' '}
          <button className="btn-secondary" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => void loadRows()}>Retry</button>
        </p>
      ) : rows.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>No projects found.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--text-muted)' }}>
              <th style={{ padding: '4px 8px' }}>Project</th>
              <th style={{ padding: '4px 8px' }}>Domain</th>
              <th style={{ padding: '4px 8px' }}>Risk Tier</th>
              <th style={{ padding: '4px 8px' }}>Decision</th>
              <th style={{ padding: '4px 8px' }}>Open Findings</th>
              <th style={{ padding: '4px 8px' }}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ project, status }) => (
              <tr key={project.id} style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ padding: '6px 8px' }}>{project.name}</td>
                <td style={{ padding: '6px 8px' }}>
                  {project.domain}
                  {project.secondaryDomains && project.secondaryDomains.length > 0 && (
                    <span style={{ color: 'var(--text-muted)' }}> (+{project.secondaryDomains.length})</span>
                  )}
                </td>
                <td style={{ padding: '6px 8px' }}>{status?.decision?.risk_tier ?? '—'}</td>
                <td style={{ padding: '6px 8px' }}>
                  {status?.decision ? (
                    <span style={{ ...pill, color: DECISION_COLORS[status.decision.decision], border: `1px solid ${DECISION_COLORS[status.decision.decision]}` }}>
                      {DECISION_LABELS[status.decision.decision]}
                    </span>
                  ) : '—'}
                </td>
                <td style={{ padding: '6px 8px' }}>{status?.openFindingsCount ?? 0}</td>
                <td style={{ padding: '6px 8px' }}>
                  {status?.decision && (
                    <button className="btn-secondary" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => setDrillInId(project.id)}>
                      Details
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Drill-in view */}
      {drillIn?.status?.decision && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{drillIn.project.name} — Governance Detail</p>
            <button className="btn-secondary" style={{ fontSize: 11 }} onClick={() => setDrillInId(null)}>Close</button>
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '8px 0' }}>
            {drillIn.status.decision.decision_reason ?? 'No rationale recorded.'}
          </p>
          {drillIn.status.override && (
            <p style={{ fontSize: 12, color: 'var(--accent)', margin: '0 0 8px' }}>
              ✓ Overridden by {drillIn.status.override.actor_email} ({drillIn.status.override.actor_role}): "{drillIn.status.override.reason}"
            </p>
          )}
          {drillIn.status.findings.length === 0 ? (
            <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>No open findings.</p>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
              {drillIn.status.findings.map((f) => (
                <li key={f.id} style={{ marginBottom: 4 }}>
                  <strong>{f.severity}</strong> [{f.control_id}] — {f.gap ?? 'No gap description'}
                  {f.recommendation ? <> → {f.recommendation}</> : null}
                  {f.owner_role ? <span style={{ color: 'var(--text-muted)' }}> (owner: {f.owner_role})</span> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Agent kill switch */}
      <div>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Agent Kill Switch</h3>
        <p style={{ margin: '2px 0 10px', fontSize: 12, color: 'var(--text-muted)' }}>
          Select a project to manage agent availability for that project only. Global status is shown for context; project overrides always win.
        </p>

        {killSwitchError && (
          <p style={{ fontSize: 12, color: 'var(--error, #ef4444)', margin: '0 0 10px' }}>
            {killSwitchError}
          </p>
        )}

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
          <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Project-specific controls for:</label>
          <select style={{ ...sel, minWidth: 280 }} value={selectedProjectId} onChange={(e) => setSelectedProjectId(e.target.value)}>
            <option value="">Select a project...</option>
            {rows.map(({ project }) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
          {selectedProject && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              Changes here apply only to {selectedProjectName}.
            </span>
          )}
        </div>

        {!selectedProjectId ? (
          <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Select a project to view and edit project-specific agent overrides.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--text-muted)' }}>
                <th style={{ padding: '4px 8px' }}>Agent</th>
                <th style={{ padding: '4px 8px' }}>Global Default</th>
                <th style={{ padding: '4px 8px' }}>Project Override</th>
                <th style={{ padding: '4px 8px' }}>Effective In This Project</th>
                <th style={{ padding: '4px 8px' }}>Project Actions</th>
              </tr>
            </thead>
            <tbody>
              {agentIds.map((agentId) => {
                const globalDisabled = globalByAgent[agentId] ?? false;
                const hasOverride = Object.prototype.hasOwnProperty.call(overrideByAgent, agentId);
                const overrideDisabled = overrideByAgent[agentId];
                const effectiveDisabled = hasOverride ? !!overrideDisabled : globalDisabled;
                const sourceLabel = hasOverride
                  ? (overrideDisabled ? 'Project-specific disable' : 'Project-specific enable')
                  : (globalDisabled ? 'Inherited global disable' : 'Inherited global enable');
                const pending = pendingAgentId === agentId;
                return (
                  <tr key={agentId} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '6px 8px' }}>{AGENT_DEFINITIONS[agentId]?.name ?? agentId}</td>
                    <td style={{ padding: '6px 8px' }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <span style={statusPill(globalDisabled)}>{globalDisabled ? 'Disabled' : 'Enabled'}</span>
                        <button
                          className="btn-secondary"
                          style={{ fontSize: 11, padding: '2px 8px', opacity: pending ? 0.6 : 1 }}
                          disabled={pending}
                          onClick={() => void toggleGlobal(agentId, globalDisabled)}
                          title="Platform-wide setting. Use carefully; it affects every project without an explicit override."
                        >
                          {globalDisabled ? 'Enable globally' : 'Disable globally'}
                        </button>
                      </div>
                    </td>
                    <td style={{ padding: '6px 8px' }}>
                      {hasOverride ? (
                        <span style={statusPill(!!overrideDisabled)}>{overrideDisabled ? 'Disabled for this project' : 'Enabled for this project'}</span>
                      ) : (
                        <span style={{ ...pill, color: 'var(--text-muted)', border: '1px solid var(--border)', background: 'var(--surface2)' }}>Defers to global</span>
                      )}
                    </td>
                    <td style={{ padding: '6px 8px' }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <span style={statusPill(effectiveDisabled)}>{effectiveDisabled ? 'Disabled' : 'Enabled'}</span>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{sourceLabel}</span>
                      </div>
                    </td>
                    <td style={{ padding: '6px 8px' }}>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button
                          className="btn-secondary"
                          style={{ fontSize: 11, padding: '2px 8px' }}
                          disabled={pending || (hasOverride && overrideDisabled === false)}
                          onClick={() => void setProjectOverride(agentId, false)}
                          title={`Enable ${AGENT_DEFINITIONS[agentId]?.name ?? agentId} only for ${selectedProjectName}`}
                        >
                          Enable here
                        </button>
                        <button
                          className="btn-secondary"
                          style={{ fontSize: 11, padding: '2px 8px' }}
                          disabled={pending || (hasOverride && overrideDisabled === true)}
                          onClick={() => void setProjectOverride(agentId, true)}
                          title={`Disable ${AGENT_DEFINITIONS[agentId]?.name ?? agentId} only for ${selectedProjectName}`}
                        >
                          Disable here
                        </button>
                        <button
                          className="btn-secondary"
                          style={{ fontSize: 11, padding: '2px 8px' }}
                          disabled={pending || !hasOverride}
                          onClick={() => void setProjectOverride(agentId, null)}
                          title="Remove the project-specific setting and use the global default"
                        >
                          Clear override
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
