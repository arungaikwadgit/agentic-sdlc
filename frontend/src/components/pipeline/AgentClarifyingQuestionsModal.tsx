/**
 * © 2025 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
/**
 * AgentClarifyingQuestionsModal
 *
 * Shown when PipelineEngine fires onClarifyingQuestionsNeeded — the first
 * time an agent flagged with AgentDefinition.needsClarifyingQuestions (brd,
 * userStory) is about to run and no answers are saved yet for it. Answers
 * are optional per-question: leaving one blank just means the agent falls
 * back to its own judgment for that question, it doesn't block submission.
 * See services/clarifyingQuestions.ts for how the question set was
 * generated, and ProjectWorkspace.tsx for how the answers get persisted to
 * project.clarifyingAnswers[agentId] and the pipeline resumed.
 */
import { useState } from 'react';
import styles from './AgentClarifyingQuestionsModal.module.css';

interface Props {
  agentName: string;
  questions: string[];
  onSubmit: (answers: { question: string; answer: string }[]) => void | Promise<void>;
  onCancel: () => void;
}

export default function AgentClarifyingQuestionsModal({ agentName, questions, onSubmit, onCancel }: Props) {
  const [answers, setAnswers] = useState<string[]>(() => questions.map(() => ''));
  const [submitting, setSubmitting] = useState(false);

  function setAnswer(i: number, value: string) {
    setAnswers((prev) => {
      const next = [...prev];
      next[i] = value;
      return next;
    });
  }

  async function handleSubmit() {
    setSubmitting(true);
    try {
      await onSubmit(questions.map((question, i) => ({ question, answer: answers[i].trim() })));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2>A few questions before {agentName} runs</h2>
          <p className={styles.subtitle}>
            Answers here shape what {agentName} generates — leave any of these blank to let it use its own
            judgment instead.
          </p>
        </div>

        <div className={styles.body}>
          {questions.map((q, i) => (
            <div key={i} className={styles.questionBlock}>
              <label className={styles.questionLabel}>{q}</label>
              <textarea
                className={styles.answerInput}
                value={answers[i]}
                onChange={(e) => setAnswer(i, e.target.value)}
                placeholder="Your answer (optional)"
                rows={2}
                disabled={submitting}
              />
            </div>
          ))}
        </div>

        <div className={styles.footer}>
          <button className="btn-secondary" onClick={onCancel} disabled={submitting}>
            Cancel
          </button>
          <button className="btn-primary" onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Continuing…' : `Continue to ${agentName}`}
          </button>
        </div>
      </div>
    </div>
  );
}
