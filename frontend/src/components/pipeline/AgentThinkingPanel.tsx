/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
/**
 * AgentThinkingPanel
 *
 * Shows the L3 agentic reasoning trace for an agent run:
 *   - Goal the agent set out to achieve
 *   - Initial plan (step list)
 *   - Per-iteration timeline: tool selected → args → result → decision
 *   - Plan revisions with before/after diffs
 *   - Final output acceptance signal
 *
 * Only renders when `run.l3` is populated (L3-mode agents only).
 * L2 agents show a simple "single-shot" notice.
 */
import { useState } from 'react';
import type { AgentRun, L3RuntimeMeta, ToolTraceEntry, PlanRevision, AgentDecision, IterationTokenEntry } from '@/types/agent.types';
import styles from './AgentThinkingPanel.module.css';

interface Props {
  run: AgentRun;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function confidenceBar(c: number): string {
  const filled = Math.round(c * 10);
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
}

function decisionIcon(type: AgentDecision['type']): string {
  switch (type) {
    case 'tool_selected':   return '🔧';
    case 'plan_revised':    return '🔄';
    case 'output_accepted': return '✅';
    case 'retry':           return '↺';
    default:                return '•';
  }
}

// ── Sub-components ────────────────────────────────────────────────────────────

function GoalBlock({ goal }: { goal: string }) {
  return (
    <div className={styles.goalBlock}>
      <div className={styles.sectionLabel}>🎯 Goal</div>
      <p className={styles.goalText}>{goal}</p>
    </div>
  );
}

function PlanBlock({ revision }: { revision: PlanRevision }) {
  return (
    <div className={styles.planBlock}>
      <div className={styles.planHeader}>
        <span className={styles.planBadge}>
          {revision.revision === 0 ? 'Initial Plan' : `Plan Revision ${revision.revision}`}
        </span>
        <span className={styles.planTime}>{formatTime(revision.timestamp)}</span>
      </div>
      {revision.reason && revision.revision > 0 && (
        <div className={styles.planReason}>↳ {revision.reason}</div>
      )}
      <ol className={styles.planSteps}>
        {revision.steps.map((step, i) => (
          <li key={i} className={styles.planStep}>{step}</li>
        ))}
      </ol>
    </div>
  );
}

/** Render any value as readable text — no raw JSON escapes */
function renderValue(val: unknown): string {
  if (val === null || val === undefined) return '—';
  if (typeof val === 'string') {
    // Unescape \n, \t etc so the text reads naturally
    return val.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\r/g, '');
  }
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  if (Array.isArray(val)) {
    if (val.length === 0) return '(empty list)';
    return val.map((item, i) => `${i + 1}. ${renderValue(item)}`).join('\n');
  }
  // Plain object — render as labeled key: value lines
  const entries = Object.entries(val as Record<string, unknown>);
  if (entries.length === 0) return '(empty)';
  return entries.map(([k, v]) => `${k}: ${renderValue(v)}`).join('\n');
}

function ToolCallBlock({ entry }: { entry: ToolTraceEntry }) {
  const [open, setOpen] = useState(false);
  const hasResult = entry.result !== undefined && entry.result !== null;
  const isError = hasResult && typeof entry.result === 'object' && entry.result !== null && 'error' in (entry.result as object);
  const resultText = hasResult ? renderValue(entry.result) : '—';

  return (
    <div className={`${styles.toolBlock} ${isError ? styles.toolBlockError : ''}`}>
      <div className={styles.toolHeader} onClick={() => setOpen(o => !o)} role="button" tabIndex={0}>
        <span className={styles.toolIcon}>🔧</span>
        <span className={styles.toolName}>{entry.tool}</span>
        <span className={styles.toolStep}>Step {entry.step}</span>
        <span className={styles.toolDuration}>{formatDuration(entry.durationMs)}</span>
        <span className={styles.toolTime}>{formatTime(entry.timestamp)}</span>
        <span className={styles.toolToggle}>{open ? '▲' : '▼'}</span>
      </div>
      {/* Args always shown inline */}
      <div className={styles.toolArgs}>
        {Object.entries(entry.args).map(([k, v]) => (
          <span key={k} className={styles.toolArg}>
            <span className={styles.toolArgKey}>{k}:</span>{' '}
            <span className={styles.toolArgVal}>{renderValue(v)}</span>
          </span>
        ))}
      </div>
      {open && (
        <div className={`${styles.toolResult} ${isError ? styles.toolResultError : ''}`}>
          <div className={styles.toolResultLabel}>{isError ? '⚠ Error result' : 'Tool result'}</div>
          <pre className={styles.toolResultPre}>{resultText}</pre>
        </div>
      )}
    </div>
  );
}

function DecisionBlock({ decision }: { decision: AgentDecision }) {
  return (
    <div className={styles.decisionBlock}>
      <span className={styles.decisionIcon}>{decisionIcon(decision.type)}</span>
      <div className={styles.decisionBody}>
        <span className={styles.decisionType}>{decision.type.replace(/_/g, ' ')}</span>
        <span className={styles.decisionRationale}>{decision.rationale}</span>
        <span className={styles.decisionConf} title={`Confidence: ${Math.round(decision.confidence * 100)}%`}>
          <span className={styles.confBar}>{confidenceBar(decision.confidence)}</span>
          {Math.round(decision.confidence * 100)}%
        </span>
      </div>
      <span className={styles.decisionTime}>{formatTime(decision.timestamp)}</span>
    </div>
  );
}

function variantLabel(variant: IterationTokenEntry['promptVariant']): string {
  switch (variant) {
    case 'intermediate': return 'condensed';
    case 'forced-final':  return 'forced final';
    default:              return 'full';
  }
}

function TokenBreakdown({ entries }: { entries: IterationTokenEntry[] }) {
  const [open, setOpen] = useState(false);
  const total = entries.reduce((sum, e) => sum + e.tokens, 0);
  const condensedCount = entries.filter((e) => e.promptVariant === 'intermediate').length;

  return (
    <div className={styles.planBlock}>
      <div
        className={styles.planHeader}
        onClick={() => setOpen((o) => !o)}
        role="button"
        tabIndex={0}
        style={{ cursor: 'pointer' }}
      >
        <span className={styles.planBadge}>
          🪙 Token Usage — {total.toLocaleString()} total across {entries.length} call{entries.length === 1 ? '' : 's'}
          {condensedCount > 0 ? ` (${condensedCount} condensed)` : ''}
        </span>
        <span className={styles.planTime}>{open ? '▲' : '▼'}</span>
      </div>
      {open && (
        <ol className={styles.planSteps}>
          {entries.map((e, i) => (
            <li key={i} className={styles.planStep}>
              {e.iteration === -1 ? 'Forced finalization' : `Iteration ${e.iteration}`}
              {' — '}{e.tokens.toLocaleString()} tokens ({variantLabel(e.promptVariant)} prompt)
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// ── L3 full trace ─────────────────────────────────────────────────────────────

function L3Trace({ l3 }: { l3: L3RuntimeMeta }) {
  // Build a chronological timeline by merging tool calls, plan revisions, decisions
  // Decisions drive the narrative; tool calls and plan revisions provide detail.

  const initialPlan = l3.planRevisions[0];
  const laterRevisions = l3.planRevisions.slice(1);

  return (
    <div className={styles.trace}>
      {/* Goal */}
      <GoalBlock goal={l3.goal} />

      {/* Incomplete required-tools warning — set when the agent finished
          without calling one or more of its mandatory tools (see
          AgentDefinition.requiredTools / l3Runtime.ts). Means the output
          may be based on incomplete grounding, not just a fast run. */}
      {l3.incompleteRequiredTools && l3.incompleteRequiredTools.length > 0 && (
        <div className={styles.gapWarning}>
          <span className={styles.gapWarningIcon}>⚠</span>
          <div>
            <strong>This run finished without calling every required tool</strong>
            It never called: {l3.incompleteRequiredTools.join(', ')}. The output below may be based on
            incomplete grounding — consider re-running this agent.
          </div>
        </div>
      )}

      {/* Governance confidence-gate warning — set when this agent's output
          didn't include a parseable "Validation & Confidence" footer with a
          score at or above 98% (see assessGovernedOutput() /
          outputGovernance.ts). This used to replace the artifact outright;
          now the real output is always kept, flagged here instead — the
          check is a brittle regex against free-text LLM output, so a
          near-miss (e.g. "Confidence: High" instead of "98%") shouldn't
          throw away otherwise-usable work. */}
      {l3.outputGovernance && !l3.outputGovernance.passed && (
        <div className={styles.gapWarning}>
          <span className={styles.gapWarningIcon}>⚠</span>
          <div>
            <strong>This run didn't pass the governance confidence check</strong>
            {' '}{l3.outputGovernance.issues.join(' ')} The output below is the agent's real work — review it
            before relying on it, or re-run the agent for a corrected version.
          </div>
        </div>
      )}

      {/* Diagram requirement warning — set when AgentDefinition.requiresDiagram
          is true and the final output still has no detectable ```mermaid
          block after the runtime's bounded correction attempt (see
          MAX_DIAGRAM_CORRECTIONS in l3Runtime.ts). The "Show Diagram" view
          will be empty/unavailable for this run until it's re-run. */}
      {l3.missingDiagram && (
        <div className={styles.gapWarning}>
          <span className={styles.gapWarningIcon}>⚠</span>
          <div>
            <strong>This run is missing its required diagram</strong>
            {' '}No fenced ```mermaid block was found in the output, so "Show Diagram" will have nothing to render.
            Re-run this agent to generate the diagram, or add one manually via Edit Output.
          </div>
        </div>
      )}

      {/* Stats bar */}
      <div className={styles.statsBar}>
        <div className={styles.stat}>
          <span className={styles.statNum}>{l3.iterationCount}</span>
          <span className={styles.statLabel}>iterations</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statNum}>{l3.toolTrace.length}</span>
          <span className={styles.statLabel}>tool calls</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statNum}>{laterRevisions.length}</span>
          <span className={styles.statLabel}>plan revisions</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statNum}>{l3.decisions.length}</span>
          <span className={styles.statLabel}>decisions</span>
        </div>
      </div>

      {/* Per-call token breakdown (2026-07-17) — added so "why did this run
          use N tokens" can be answered by looking at real per-call data
          instead of estimating from the aggregate total. Shows which
          system-prompt variant each call used (see
          AgentDefinition.intermediateSystemPrompt) alongside its measured
          token cost. */}
      {l3.iterationTokens && l3.iterationTokens.length > 0 && (
        <TokenBreakdown entries={l3.iterationTokens} />
      )}

      {/* Initial plan */}
      {initialPlan && <PlanBlock revision={initialPlan} />}

      {/* Chronological execution trace */}
      <div className={styles.sectionLabel}>⚙ Execution Trace</div>
      <div className={styles.timeline}>
        {l3.toolTrace.map((entry) => {
          // Find any plan revision that happened around the same time (within 1 iteration)
          const revisionAtStep = laterRevisions.find(
            r => Math.abs(r.timestamp - entry.timestamp) < 5000
          );
          // Find the decision that matches this tool call
          const decision = l3.decisions.find(
            d => d.type === 'tool_selected' &&
                 Math.abs(d.timestamp - entry.timestamp) < 2000
          );
          return (
            <div key={entry.step} className={styles.timelineItem}>
              {decision && <DecisionBlock decision={decision} />}
              <ToolCallBlock entry={entry} />
              {revisionAtStep && <PlanBlock revision={revisionAtStep} />}
            </div>
          );
        })}

        {/* Final decision */}
        {l3.decisions
          .filter(d => d.type === 'output_accepted')
          .map((d, i) => (
            <div key={`final-${i}`} className={styles.timelineItem}>
              <DecisionBlock decision={d} />
              <div className={styles.finalOutput}>
                ✅ Final output produced after {l3.iterationCount} iteration{l3.iterationCount !== 1 ? 's' : ''}
              </div>
            </div>
          ))
        }
      </div>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export default function AgentThinkingPanel({ run }: Props) {
  if (!run.l3) {
    return (
      <div className={styles.l2Notice}>
        <span className={styles.l2Icon}>🧠</span>
        <div>
          <strong>This run was generated before L3 was active</strong>
          <p>
            All agents are now upgraded to L3 autonomous mode — they plan, call tools,
            observe results, and revise before writing the final output.
          </p>
          <p style={{ marginTop: 6 }}>
            <strong>Hit Re-run</strong> on this agent to see the full thinking trace.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <L3Trace l3={run.l3} />
    </div>
  );
}
