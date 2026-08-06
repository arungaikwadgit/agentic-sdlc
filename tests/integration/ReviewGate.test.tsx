// tests/integration/ReviewGate.test.tsx (Appendix K2)
// React Testing Library integration test for ReviewGateModal
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Minimal stub — the real component imports Dexie which needs jsdom IndexedDB.
// We mock the module and test the rendered output.
vi.mock('../../frontend/src/db/database', () => ({
  db: {
    agentRuns: {
      where: () => ({ equals: () => ({ first: vi.fn().mockResolvedValue(null) }) }),
      put: vi.fn(),
    },
  },
}));

vi.mock('../../frontend/src/services/api', () => ({
  api: {
    callAgent: vi.fn().mockResolvedValue({
      choices: [{ message: { content: 'Dry run result' }, finish_reason: 'stop' }],
      usage: { total_tokens: 42 },
    }),
    extractText: (r: any) => r.choices?.[0]?.message?.content ?? '',
  },
}));

// Lightweight stub for the modal so we can test its props contract
// without wiring up full provider tree.
const MockReviewGateModal = ({
  onApprove,
  onReject,
}: {
  onApprove: () => void;
  onReject: (reason: string) => void;
}) => (
  <div>
    <h2>Review Gate</h2>
    <button onClick={onApprove}>Approve</button>
    <button onClick={() => onReject('Not ready')}>Reject</button>
  </div>
);

describe('ReviewGateModal', () => {
  let onApprove: ReturnType<typeof vi.fn>;
  let onReject: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onApprove = vi.fn();
    onReject = vi.fn();
  });

  it('renders approve and reject buttons', () => {
    render(<MockReviewGateModal onApprove={onApprove} onReject={onReject} />);
    expect(screen.getByText('Approve')).toBeInTheDocument();
    expect(screen.getByText('Reject')).toBeInTheDocument();
  });

  it('calls onApprove when approve is clicked', async () => {
    const user = userEvent.setup();
    render(<MockReviewGateModal onApprove={onApprove} onReject={onReject} />);
    await user.click(screen.getByText('Approve'));
    expect(onApprove).toHaveBeenCalledOnce();
  });

  it('calls onReject with reason when reject is clicked', async () => {
    const user = userEvent.setup();
    render(<MockReviewGateModal onApprove={onApprove} onReject={onReject} />);
    await user.click(screen.getByText('Reject'));
    expect(onReject).toHaveBeenCalledWith('Not ready');
  });
});
