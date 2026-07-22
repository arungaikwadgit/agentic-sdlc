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
        `/aggregate?projectIds=${encodeURIComponent(idsParam)}`
      );
      if (error) throw new Error(error);
      const items = data?.items ?? {};
      setRows(projects.map((project) => ({ project, status: items[project.id] ?? null })));
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

  async function toggleProjectOverride(agentId: string, currentlyDisabled: boolean | undefined) {
    if (!selectedProjectId) return;
    setKillSwitchError(null);
    setPendingAgentId(agentId);
    let result: ApiResult<unknown>;
    if (currentlyDisabled === undefined) {
      // No row yet — create one, disabled.
      result = await apiCall(`/agent-controls/project/${selectedProjectId}/${agentId}`, {
        method: 'POST',
        body: JSON.stringify({ disabled: true }),
      });
    } else if (currentlyDisabled) {
      // Currently an explicit disable — flip to an explicit enable, rather
      // than clearing the row, so it stays enabled even if someone later
      // disables the agent globally (see resolveAgentKillSwitch's
      // precedence in backend/src/routes/agentControls.js).
      result = await apiCall(`/agent-controls/project/${selectedProjectId}/${agentId}`, {
        method: 'POST',
        body: JSON.stringify({ disabled: false }),
      });
    } else {
      // Currently an explicit enable — clear the override entirely, back
      // to "no opinion, defer to global".
      result = await apiCall(`/agent-controls/project/${selectedProjectId}/${agentId}`, { method: 'DELETE' });
    }
    setPendingAgentId(null);
    if (result.error) { setKillSwitchError(`Failed to update "${agentId}" (project override): ${result.error}`); return; }
    await loadProjectOverrides(selectedProjectId);
  }

  const pill: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 600 };
  const sel: React.CSSProperties = { background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 6, padding: '5px 9px', fontSize: 12 };

  const drillIn = rows.find((r) => r.project.id === drillInId) ?? null;
  const globalByAgent = Object.fromEntries(globalSettings.map((s) => [s.agent_id, s.disabled]));
  const overrideByAgent = Object.fromEntries(projectOverrides.map((o) => [o.agent_id, o.disabled]));
  const agentIds = Object.keys(AGENT_DEFINITIONS) as AgentId[];

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
          Global disable applies platform-wide. A per-project override always wins over the global setting.
        </p>

        {killSwitchError && (
          <p style={{ fontSize: 12, color: 'var(--error, #ef4444)', margin: '0 0 10px' }}>
            {killSwitchError}
          </p>
        )}

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
          <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Per-project overrides for:</label>
          <select style={sel} value={selectedProjectId} onChange={(e) => setSelectedProjectId(e.target.value)}>
            <option value="">Select a project…</option>
            {rows.map(({ project }) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--text-muted)' }}>
              <th style={{ padding: '4px 8px' }}>Agent</th>
              <th style={{ padding: '4px 8px' }}>Global</th>
              {selectedProjectId && <th style={{ padding: '4px 8px' }}>This Project</th>}
            </tr>
          </thead>
          <tbody>
            {agentIds.map((agentId) => {
              const globalDisabled = globalByAgent[agentId] ?? false;
              const overrideDisabled = overrideByAgent[agentId];
              return (
                <tr key={agentId} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '6px 8px' }}>{AGENT_DEFINITIONS[agentId]?.name ?? agentId}</td>
                  <td style={{ padding: '6px 8px' }}>
                    <button
                      className={globalDisabled ? 'btn-danger' : 'btn-secondary'}
                      style={{ fontSize: 11, padding: '2px 8px', opacity: pendingAgentId === agentId ? 0.6 : 1 }}
                      disabled={pendingAgentId === agentId}
                      onClick={() => void toggleGlobal(agentId, globalDisabled)}
                    >
                      {pendingAgentId === agentId ? '…' : globalDisabled ? 'Disabled' : 'Enabled'}
                    </button>
                  </td>
                  {selectedProjectId && (
                    <td style={{ padding: '6px 8px' }}>
                      <button
                        className={overrideDisabled ? 'btn-danger' : 'btn-secondary'}
                        style={{ fontSize: 11, padding: '2px 8px', opacity: pendingAgentId === agentId ? 0.6 : 1 }}
                        disabled={pendingAgentId === agentId}
                        onClick={() => void toggleProjectOverride(agentId, overrideDisabled)}
                        title={
                          overrideDisabled === undefined
                            ? 'No project-specific setting — click to disable for this project only'
                            : overrideDisabled
                              ? 'Disabled for this project — click to explicitly enable'
                              : 'Explicitly enabled for this project — click to clear (defer to global)'
                        }
                      >
                        {pendingAgentId === agentId ? '…' : overrideDisabled === undefined ? '(defers to global)' : overrideDisabled ? 'Disabled' : 'Enabled (explicit)'}
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
