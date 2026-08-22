/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
/**
 * AgentFeedbackWidget — item #18 (Step 6 prioritization matrix).
 *
 * Thumbs up/down on the currently-displayed agent output. Submits
 * immediately on click (no confirm step — this is deliberately low-friction
 * so it actually gets used); a "add details" link then lets the user send
 * a follow-up comment tied to the same rating. Feedback is keyed to
 * (projectId, agentId) — see backend/migrations/024_agent_feedback.sql for
 * why, and note that a rerun of this agent doesn't reset this widget's
 * local state, so re-rating after a rerun is just another normal click.
 */
import { useState } from 'react';
import { submitAgentFeedback, type FeedbackRating } from '@/services/agentFeedbackApi';

interface Props {
  projectId: string;
  agentId: string;
}

export default function AgentFeedbackWidget({ projectId, agentId }: Props) {
  const [lastRating, setLastRating] = useState<FeedbackRating | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [showComment, setShowComment] = useState(false);
  const [comment, setComment] = useState('');
  const [commentSent, setCommentSent] = useState(false);

  async function rate(rating: FeedbackRating) {
    setSubmitting(true);
    setError('');
    try {
      await submitAgentFeedback(projectId, agentId, rating);
      setLastRating(rating);
      setShowComment(false);
      setCommentSent(false);
      setComment('');
    } catch {
      setError('Could not send feedback');
    } finally {
      setSubmitting(false);
    }
  }

  async function sendComment() {
    if (!lastRating || !comment.trim()) return;
    setSubmitting(true);
    setError('');
    try {
      await submitAgentFeedback(projectId, agentId, lastRating, comment.trim());
      setCommentSent(true);
      setShowComment(false);
    } catch {
      setError('Could not send comment');
    } finally {
      setSubmitting(false);
    }
  }

  const btnStyle = (active: boolean): React.CSSProperties => ({
    background: active ? 'var(--surface2)' : 'transparent',
    border: '1px solid var(--border)',
    borderRadius: 6,
    padding: '4px 8px',
    fontSize: 13,
    cursor: submitting ? 'default' : 'pointer',
    opacity: submitting ? 0.6 : 1,
  });

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, position: 'relative' }}>
      <button
        type="button"
        style={btnStyle(lastRating === 'up')}
        disabled={submitting}
        onClick={() => rate('up')}
        title="This output was helpful"
        aria-pressed={lastRating === 'up'}
      >
        👍
      </button>
      <button
        type="button"
        style={btnStyle(lastRating === 'down')}
        disabled={submitting}
        onClick={() => rate('down')}
        title="This output needs work"
        aria-pressed={lastRating === 'down'}
      >
        👎
      </button>

      {lastRating && !showComment && !commentSent && (
        <button
          type="button"
          onClick={() => setShowComment(true)}
          style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 11, cursor: 'pointer', textDecoration: 'underline', padding: 0 }}
        >
          Add details
        </button>
      )}
      {commentSent && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Thanks — sent</span>}
      {error && <span style={{ fontSize: 11, color: 'var(--error, #ef4444)' }}>{error}</span>}

      {showComment && (
        <div style={{
          position: 'absolute', top: '100%', right: 0, marginTop: 4, zIndex: 5,
          background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8,
          padding: 8, width: 240, display: 'flex', flexDirection: 'column', gap: 6,
          boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
        }}>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="What made this good or bad? (optional)"
            rows={3}
            maxLength={2000}
            style={{ fontSize: 12, padding: 6, border: '1px solid var(--border)', borderRadius: 6, resize: 'vertical' }}
          />
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <button type="button" className="btn-secondary" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => setShowComment(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              style={{ fontSize: 11, padding: '3px 8px' }}
              disabled={submitting || !comment.trim()}
              onClick={sendComment}
            >
              Send
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
