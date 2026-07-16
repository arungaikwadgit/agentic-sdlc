/**
 * 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential - Unauthorized use prohibited.
 */

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ChatWidget from '@/chatbot/ChatWidget';

const chatMocks = vi.hoisted(() => ({ askAgenticChat: vi.fn() }));

vi.mock('@/chatbot/chatApi', () => ({
  askAgenticChat: chatMocks.askAgenticChat,
}));

describe('project-aware agentic ChatWidget', () => {
  afterEach(() => vi.clearAllMocks());

  async function ask(question: string) {
    fireEvent.click(screen.getByRole('button', { name: /open help chat/i }));
    const input = await screen.findByPlaceholderText(/ask about/i);
    await act(async () => {
      fireEvent.change(input, { target: { value: question } });
      fireEvent.click(screen.getByRole('button', { name: /^send$/i }));
      await Promise.resolve();
    });
  }

  it('sends project identity, current view, and recent history to the backend orchestrator', async () => {
    chatMocks.askAgenticChat.mockResolvedValue({
      answer: 'Gate 3 is pending.',
      confidence: 100,
      supported: true,
      evidence: [],
      trace: [],
      followUp: null,
    });
    render(<ChatWidget projectId="11111111-1111-4111-8111-111111111111" currentView="project" isAdmin />);
    await ask('Why is the prototype blocked?');
    await waitFor(() => expect(chatMocks.askAgenticChat).toHaveBeenCalled());
    expect(chatMocks.askAgenticChat.mock.calls[0][0]).toMatchObject({
      question: 'Why is the prototype blocked?',
      projectId: '11111111-1111-4111-8111-111111111111',
      currentView: 'project',
    });
    expect(chatMocks.askAgenticChat.mock.calls[0][0].history).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'user', text: 'Why is the prototype blocked?' }),
    ]));
  });

  it('renders confidence and expandable source evidence without chain-of-thought', async () => {
    chatMocks.askAgenticChat.mockResolvedValue({
      answer: 'Architecture is complete.',
      confidence: 99,
      supported: true,
      evidence: [{
        sourceType: 'agent_output', sourceId: 'architecture', title: 'Architecture Agent', version: 3,
        updatedAt: '2026-07-15T12:00:00.000Z', authority: 99,
      }],
      trace: [{ stage: 'tool', name: 'get_latest_agent_outputs', status: 'complete', sourceCount: 1 }],
      followUp: null,
    });
    render(<ChatWidget projectId="11111111-1111-4111-8111-111111111111" currentView="project" />);
    await ask('Architecture status?');
    expect(await screen.findByText('Architecture is complete.')).toBeInTheDocument();
    expect(screen.getByText(/99% evidence confidence/i)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/view 1 source/i));
    expect(screen.getByText(/Architecture Agent/)).toBeInTheDocument();
    expect(screen.queryByText(/chain-of-thought/i)).not.toBeInTheDocument();
  });

  it('shows an unsupported evidence state and follow-up', async () => {
    chatMocks.askAgenticChat.mockResolvedValue({
      answer: 'I cannot verify the failure yet.',
      confidence: 70,
      supported: false,
      evidence: [],
      trace: [],
      followUp: 'Missing authoritative evidence: runtime.',
    });
    render(<ChatWidget currentView="dashboard" />);
    await ask('What failed?');
    expect(await screen.findByText('I cannot verify the failure yet.')).toBeInTheDocument();
    expect(screen.getByText(/evidence incomplete/i)).toBeInTheDocument();
    expect(screen.getByText(/missing authoritative evidence: runtime/i)).toBeInTheDocument();
  });

  it('uses the local FAQ only when the backend chat request fails', async () => {
    chatMocks.askAgenticChat.mockRejectedValue(new Error('offline'));
    render(<ChatWidget currentView="dashboard" />);
    await ask('How do review gates work?');
    expect(await screen.findByText(/local help fallback/i)).toBeInTheDocument();
  });
});
