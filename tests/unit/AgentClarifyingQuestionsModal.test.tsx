// Copyright 2026 Arun Gaikwad. All rights reserved.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import AgentClarifyingQuestionsModal from '../../frontend/src/components/pipeline/AgentClarifyingQuestionsModal';

describe('AgentClarifyingQuestionsModal', () => {
  it('requires an answer for every generated question before continuing', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <AgentClarifyingQuestionsModal
        agentName="Business Requirements"
        questions={['Who approves refunds?', 'What is the refund SLA?']}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );

    const continueButton = screen.getByRole('button', { name: /Continue to Business Requirements/i });
    expect(continueButton).toBeDisabled();

    const answers = screen.getAllByPlaceholderText(/Your answer/i);
    await user.type(answers[0], 'Finance lead');
    expect(continueButton).toBeDisabled();

    await user.type(answers[1], 'Two business days');
    expect(continueButton).toBeEnabled();
    await user.click(continueButton);

    expect(onSubmit).toHaveBeenCalledWith([
      { question: 'Who approves refunds?', answer: 'Finance lead' },
      { question: 'What is the refund SLA?', answer: 'Two business days' },
    ]);
  });
});
