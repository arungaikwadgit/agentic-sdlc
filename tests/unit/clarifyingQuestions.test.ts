// tests/unit/clarifyingQuestions.test.ts
//
// Unit tests for the pure helper functions in services/clarifyingQuestions.ts
// (extractRequirementIds, parseQuestionList). The LLM-calling functions
// (generateBrdQuestions/generateUserStoryQuestions) are exercised indirectly
// via generateClarifyingQuestions with api.callAgent mocked, covering both
// the happy path and the fallback-on-failure path.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  extractRequirementIds,
  parseQuestionList,
  generateClarifyingQuestions,
} from '../../frontend/src/services/clarifyingQuestions';
import type { AgentPromptContext } from '../../frontend/src/types/agent.types';

const CTX: AgentPromptContext = {
  projectName: 'ShopEase',
  projectDescription: 'An e-commerce platform for small businesses',
  domain: 'ecommerce',
  domainContext: 'E-commerce context',
  priorOutputs: {},
  teamRoster: [],
};

// ─────────────────────────────────────────────────────────────────
// extractRequirementIds
// ─────────────────────────────────────────────────────────────────
describe('extractRequirementIds', () => {
  it('extracts BR-xxx ids in first-appearance order', () => {
    const text = 'See BR-001 and BR-003, also revisit BR-001 again, then BR-002.';
    expect(extractRequirementIds(text, 'BR')).toEqual(['BR-001', 'BR-003', 'BR-002']);
  });

  it('dedupes repeated ids', () => {
    const text = 'BR-001 BR-001 BR-001';
    expect(extractRequirementIds(text, 'BR')).toEqual(['BR-001']);
  });

  it('ignores ids with a different prefix', () => {
    const text = 'FR-001 relates to BR-001, and US-101 implements it.';
    expect(extractRequirementIds(text, 'BR')).toEqual(['BR-001']);
  });

  it('returns an empty array when no matching ids exist', () => {
    expect(extractRequirementIds('No numbered requirements here.', 'BR')).toEqual([]);
  });

  it('requires at least 3 digits (matches get_requirement_ids tool pattern)', () => {
    const text = 'BR-01 is too short, BR-001 is valid.';
    expect(extractRequirementIds(text, 'BR')).toEqual(['BR-001']);
  });
});

// ─────────────────────────────────────────────────────────────────
// parseQuestionList
// ─────────────────────────────────────────────────────────────────
describe('parseQuestionList', () => {
  it('parses a bare JSON array of strings', () => {
    const raw = '["Question one?", "Question two?"]';
    expect(parseQuestionList(raw, 10)).toEqual(['Question one?', 'Question two?']);
  });

  it('parses a JSON array wrapped in a fenced code block', () => {
    const raw = '```json\n["Question one?", "Question two?"]\n```';
    expect(parseQuestionList(raw, 10)).toEqual(['Question one?', 'Question two?']);
  });

  it('parses a JSON array of {question} objects', () => {
    const raw = '[{"question": "Question one?"}, {"question": "Question two?"}]';
    expect(parseQuestionList(raw, 10)).toEqual(['Question one?', 'Question two?']);
  });

  it('caps the result at max', () => {
    const raw = JSON.stringify(['Q1', 'Q2', 'Q3', 'Q4']);
    expect(parseQuestionList(raw, 2)).toEqual(['Q1', 'Q2']);
  });

  it('falls back to line-splitting when JSON parsing fails', () => {
    const raw = '1. First question?\n2. Second question?\n';
    expect(parseQuestionList(raw, 10)).toEqual(['First question?', 'Second question?']);
  });

  it('strips markdown list markers in the line-splitting fallback', () => {
    const raw = '- First question?\n* Second question?\n';
    expect(parseQuestionList(raw, 10)).toEqual(['First question?', 'Second question?']);
  });

  it('returns an empty array for empty input', () => {
    expect(parseQuestionList('', 10)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────
// generateClarifyingQuestions — dispatch + fallback behavior
// ─────────────────────────────────────────────────────────────────
vi.mock('../../frontend/src/services/api', () => ({
  api: {
    callAgent: vi.fn(),
    extractText: (resp: { choices: Array<{ message: { content: string } }> }) =>
      resp.choices?.[0]?.message?.content ?? '',
  },
}));

import { api } from '../../frontend/src/services/api';

describe('generateClarifyingQuestions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns [] for an agent that does not need clarifying questions', async () => {
    const result = await generateClarifyingQuestions('manager', CTX);
    expect(result).toEqual([]);
    expect(api.callAgent).not.toHaveBeenCalled();
  });

  it('brd: returns the LLM-generated questions on success', async () => {
    vi.mocked(api.callAgent).mockResolvedValue({
      choices: [{ message: { role: 'assistant', content: '["Is this replacing a legacy system?"]' }, finish_reason: 'stop' }],
    });
    const result = await generateClarifyingQuestions('brd', CTX, 'proj-1');
    expect(result).toEqual(['Is this replacing a legacy system?']);
    expect(api.callAgent).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'brd', projectId: 'proj-1' })
    );
  });

  it('brd: falls back to the default question set when the LLM call throws', async () => {
    vi.mocked(api.callAgent).mockRejectedValue(new Error('network error'));
    const result = await generateClarifyingQuestions('brd', CTX);
    expect(result.length).toBeGreaterThan(0);
  });

  it('userStory: falls back to generic questions when the BRD has no numbered BR-xxx items', async () => {
    const ctxNoBrIds: AgentPromptContext = { ...CTX, priorOutputs: { brd: 'A BRD with no numbered requirements.' } };
    const result = await generateClarifyingQuestions('userStory', ctxNoBrIds);
    expect(result.length).toBeGreaterThan(0);
    // Falling back means no LLM call was made — nothing to ask questions about yet.
    expect(api.callAgent).not.toHaveBeenCalled();
  });

  it('userStory: calls the LLM with BR excerpts when the BRD has numbered BR-xxx items', async () => {
    vi.mocked(api.callAgent).mockResolvedValue({
      choices: [{ message: { role: 'assistant', content: '["[BR-001] Which persona initiates this?"]' }, finish_reason: 'stop' }],
    });
    const ctxWithBrIds: AgentPromptContext = {
      ...CTX,
      priorOutputs: { brd: 'BR-001: The system shall allow customer returns within 30 days.' },
    };
    const result = await generateClarifyingQuestions('userStory', ctxWithBrIds, 'proj-1');
    expect(result).toEqual(['[BR-001] Which persona initiates this?']);
    const callArgs = vi.mocked(api.callAgent).mock.calls[0][0];
    expect(callArgs.userPrompt).toContain('BR-001');
  });
});
