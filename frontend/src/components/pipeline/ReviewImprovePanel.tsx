/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
import { useState } from 'react';
import { api } from '@/services/api';
import { AGENT_DEFINITIONS } from '@/agents/definitions';
import { PHASE_ORDER } from '@/agents/constants';
import type { Project } from '@/types/project.types';
import type { AgentId } from '@/types/agent.types';
import styles from './ReviewImprovePanel.module.css';

interface GapQuestion {
  id: string;
  question: string;
  answer: string;
}

interface Props {
  agentId: AgentId;
  project: Project;
  onRegenerate: (enrichedPrompt: string, userExtra: string) => void;
  onClose: () => void;
}

function buildPriorContext(agentId: AgentId, project: Project): string {
  const def = AGENT_DEFINITIONS[agentId];
  if (!def) return '';

  const currentPhaseIdx = PHASE_ORDER.indexOf(def.phase);
  const priorOutputs: string[] = [];

  for (const [aid, run] of Object.entries(project.agentRuns)) {
    if (!run?.output || run.status !== 'complete') continue;
    const priorDef = AGENT_DEFINITIONS[aid as AgentId];
    if (!priorDef) continue;
    const priorPhaseIdx = PHASE_ORDER.indexOf(priorDef.phase);
    if (priorPhaseIdx >= currentPhaseIdx && aid !== agentId) continue;
    if (aid === agentId) continue;
    priorOutputs.push(`### ${priorDef.name}\n${run.output.slice(0, 800)}${run.output.length > 800 ? '\n[...truncated]' : ''}`);
  }

  return priorOutputs.join('\n\n---\n\n');
}

export default function ReviewImprovePanel({ agentId, project, onRegenerate, onClose }: Props) {
  const [questions, setQuestions] = useState<GapQuestion[]>([]);
  // Track all questions ever shown in this session so Refresh never repeats them
  const [allShownQuestions, setAllShownQuestions] = useState<GapQuestion[]>([]);
  const [generating, setGenerating] = useState(false);
  const [generatingMore, setGeneratingMore] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const def = AGENT_DEFINITIONS[agentId];
  const currentOutput = project.agentRuns[agentId]?.output ?? '';

  async function callLLMForQuestions(existingQuestions: GapQuestion[] = []): Promise<GapQuestion[]> {
    // M-10 fix: cap prior context to avoid exceeding ~50K token proxy limit
    const MAX_PRIOR_CHARS = 6_000;
    const rawPriorContext = buildPriorContext(agentId, project);
    const priorContext = rawPriorContext.length > MAX_PRIOR_CHARS
      ? rawPriorContext.slice(0, MAX_PRIOR_CHARS) + '\n\n[...prior context truncated to stay within token limit]'
      : rawPriorContext;

    const alreadyAsked = existingQuestions.length > 0
      ? `\n\n## Already asked questions (do NOT repeat these):\n${existingQuestions.map((q, i) => `${i + 1}. ${q.question}`).join('\n')}`
      : '';

    const systemPrompt = `You are a senior document quality reviewer specialising in software development artifacts.
Your job is to read an agent-generated document and identify the most important gaps, ambiguities, or missing details that would make the document more complete and accurate.
Generate exactly 4 concise, specific questions that the project owner can answer to fill those gaps.
Each question must be directly tied to a concrete weakness you found in the document.
Format your response as a numbered list — one question per line, nothing else. No preamble, no explanations.`;

    const userPrompt = [
      `## Agent: ${def?.name ?? agentId}`,
      `## Project: ${project.name}`,
      '',
      '## Document to review:',
      currentOutput.slice(0, 3000),
      currentOutput.length > 3000 ? '[...document truncated for brevity]' : '',
      '',
      priorContext ? `## Context from earlier agents:\n${priorContext}` : '',
      alreadyAsked,
    ].filter(Boolean).join('\n');

    // H-07 fix: 120s timeout to prevent hung LLM calls
    const resp = await api.callAgent({ systemPrompt, userPrompt, signal: AbortSignal.timeout(120_000) });
    const text = api.extractText(resp).trim();
    const offset = existingQuestions.length;

    return text
      .split('\n')
      .map((l) => l.replace(/^\d+[\.\)]\s*/, '').trim())
      .filter((l) => l.length > 10)
      .slice(0, 5)
      .map((q, i) => ({ id: `q${offset + i}`, question: q, answer: '' }));
  }

  async function suggestQuestions() {
    setGenerating(true);
    setError(null);
    setQuestions([]);

    try {
      // Pass ALL previously shown questions so the LLM generates a fresh set
      const parsed = await callLLMForQuestions(allShownQuestions);
      setQuestions(parsed);
      setAllShownQuestions((prev) => [...prev, ...parsed]);
    } catch (e) {
      setError(String(e));
    } finally {
      setGenerating(false);
    }
  }

  async function generateMoreQuestions() {
    setGeneratingMore(true);
    setError(null);
    try {
      // Pass currently visible + all previously shown to avoid any repeats
      const seen = [...allShownQuestions, ...questions].filter(
        (q, idx, arr) => arr.findIndex((x) => x.id === q.id) === idx,
      );
      const more = await callLLMForQuestions(seen);
      setQuestions((prev) => [...prev, ...more]);
      setAllShownQuestions((prev) => [...prev, ...more]);
    } catch (e) {
      setError(String(e));
    } finally {
      setGeneratingMore(false);
    }
  }

  function setAnswer(id: string, answer: string) {
    setQuestions((prev) => prev.map((q) => (q.id === id ? { ...q, answer } : q)));
  }

  async function handleRegenerate() {
    const answered = questions.filter((q) => q.answer.trim());
    if (answered.length === 0) return;

    setRegenerating(true);
    setError(null);
    try {
      const qaContext = answered
        .map((q, i) => `Q${i + 1}: ${q.question}\nAnswer: ${q.answer.trim()}`)
        .join('\n\n');

      const basePrompt = project.promptOverrides?.find((o) => o.agentId === agentId)?.fullPrompt
        ?? AGENT_DEFINITIONS[agentId]?.systemPrompt
        ?? '';

      const enrichedPrompt = `${basePrompt}

## Additional context provided by the project owner (via Review & Improve):
${qaContext}

Use the above answers to fill the specific gaps identified in the previous draft. Ensure the regenerated document fully incorporates this new information while maintaining consistency with all prior agent outputs.`;

      onRegenerate(enrichedPrompt, qaContext);
    } finally {
      setRegenerating(false);
    }
  }

  const hasAnswers = questions.some((q) => q.answer.trim());

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.sparkle}>✦</span>
          <span className={styles.title}>Review & Improve</span>
          <span className={styles.agentLabel}>{def?.name ?? agentId}</span>
        </div>
        <button className={styles.closeBtn} onClick={onClose} aria-label="Close review panel">✕</button>
      </div>

      <div className={styles.body}>
        {questions.length === 0 && !generating && (
          <div className={styles.emptyState}>
            <p className={styles.emptyDesc}>
              AI will analyse <strong>{def?.name ?? agentId}</strong> and all prior agent outputs, then generate targeted questions to fill gaps in the document.
            </p>
            <button
              className={styles.suggestBtn}
              onClick={suggestQuestions}
              disabled={!currentOutput}
            >
              <span className={styles.sparkle}>✦</span>
              {currentOutput ? 'AI Suggest Questions' : 'No output yet — run the agent first'}
            </button>
          </div>
        )}

        {generating && (
          <div className={styles.loadingState}>
            <div className={styles.spinner} />
            <p>Analysing document and prior context…</p>
          </div>
        )}

        {questions.length > 0 && (
          <>
            <div className={styles.qList}>
              {questions.map((q, i) => (
                <div key={q.id} className={styles.qItem}>
                  <label className={styles.qLabel}>
                    <span className={styles.qNum}>Q{i + 1}</span>
                    {q.question}
                  </label>
                  <textarea
                    className={styles.qAnswer}
                    placeholder="Type your answer here…"
                    value={q.answer}
                    onChange={(e) => setAnswer(q.id, e.target.value)}
                    rows={3}
                  />
                </div>
              ))}
            </div>

            <div className={styles.actions}>
              <button
                className={styles.suggestBtn}
                onClick={suggestQuestions}
                disabled={generating || generatingMore}
                style={{ flex: '0 0 auto' }}
              >
                <span className={styles.sparkle}>✶</span> Refresh Questions
              </button>
              <button
                className={styles.moreBtn}
                onClick={generateMoreQuestions}
                disabled={generating || generatingMore}
                title="Generate additional questions and append them to the list"
              >
                {generatingMore ? (
                  <><span className={styles.spinner} /> Generating…</>
                ) : (
                  <><span className={styles.sparkle}>✶</span> Generate More Questions</>
                )}
              </button>
              <button
                className={styles.regenBtn}
                onClick={handleRegenerate}
                disabled={!hasAnswers || regenerating}
              >
                {regenerating ? 'Preparing…' : '↻ Regenerate with my answers'}
              </button>
            </div>

            <p className={styles.hint}>
              Your answers will be saved as a project-level prompt override and the agent will re-run with the enriched context.
            </p>
          </>
        )}

        {error && <p className={styles.error}>{error}</p>}
      </div>
    </div>
  );
}
