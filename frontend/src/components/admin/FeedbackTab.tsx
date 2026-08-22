/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 *
 * FeedbackTab — item #18 (Step 6 prioritization matrix). Admin-only view
 * over agent_feedback (backend/migrations/024_agent_feedback.sql): a
 * per-agent up/down summary plus the most recent raw feedback events.
 * Capture-only for now (Step 4 spec's second open question, resolved
 * explicitly with the user) — nothing here feeds an automated action yet.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  getAgentFeedbackSummary,
  listAgentFeedback,
  type AgentFeedbackEntry,
  type AgentFeedbackSummaryEntry,
} from '@/services/agentFeedbackApi';

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

export default function FeedbackTab() {
  const [summary, setSummary] = useState<AgentFeedbackSummaryEntry[]>([]);
  const [recent, setRecent] = useState<AgentFeedbackEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [summaryItems, recentItems] = await Promise.all([
        getAgentFeedbackSummary(),
        listAgentFeedback({ limit: 100 }),
      ]);
      setSummary(summaryItems);
      setRecent(recentItems);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const totalUp = summary.reduce((n, s) => n + s.upCount, 0);
  const totalDown = summary.reduce((n, s) => n + s.downCount, 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Agent Output Feedback</h3>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
            {totalUp} 👍 · {totalDown} 👎 · {summary.length} agent(s) rated · capture-only, not yet wired to anything automated
          </p>
        </div>
        <button className="btn-secondary" style={{ fontSize: 13 }} onClick={load} disabled={loading}>
          {loading ? 'Loading…' : '↻ Reload'}
        </button>
      </div>

      {error && (
        <div style={{ color: 'var(--error, #ef4444)', fontSize: 12 }}>
          Failed to load feedback: {error}
        </div>
      )}

      {/* Per-agent summary */}
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>By Agent</div>
        {summary.length === 0 && !loading && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No feedback recorded yet.</div>
        )}
        {summary.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: 'var(--surface-alt, #f1f5f9)', textAlign: 'left' }}>
                  <th style={{ padding: '6px 10px', borderBottom: '2px solid var(--border)' }}>Agent</th>
                  <th style={{ padding: '6px 10px', borderBottom: '2px solid var(--border)', width: 80 }}>👍</th>
                  <th style={{ padding: '6px 10px', borderBottom: '2px solid var(--border)', width: 80 }}>👎</th>
                  <th style={{ padding: '6px 10px', borderBottom: '2px solid var(--border)', width: 160 }}>Last feedback</th>
                </tr>
              </thead>
              <tbody>
                {summary.map((s) => (
                  <tr key={s.agentId} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '6px 10px', fontWeight: 600 }}>{s.agentId}</td>
                    <td style={{ padding: '6px 10px' }}>{s.upCount}</td>
                    <td style={{ padding: '6px 10px' }}>{s.downCount}</td>
                    <td style={{ padding: '6px 10px', color: 'var(--text-muted)' }}>{formatTime(s.lastFeedbackAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Recent raw events */}
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Recent Feedback (last {recent.length})</div>
        {recent.length === 0 && !loading && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No feedback recorded yet.</div>
        )}
        {recent.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 360, overflowY: 'auto' }}>
            {recent.map((entry) => (
              <div key={entry.id} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 8, fontSize: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span>
                    <strong>{entry.agentId}</strong> {entry.rating === 'up' ? '👍' : '👎'}
                  </span>
                  <span style={{ color: 'var(--text-muted)' }}>{formatTime(entry.createdAt)}</span>
                </div>
                {entry.comment && <div style={{ marginTop: 4 }}>{entry.comment}</div>}
                <div style={{ marginTop: 4, color: 'var(--text-muted)', fontSize: 11 }}>
                  {entry.createdBy ?? 'unknown user'} · project <code>{entry.projectId}</code>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
