/**
 * 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential - Unauthorized use prohibited.
 */

const { runChatOrchestrator } = require('./chatOrchestrator');

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';

describe('bounded agentic chat orchestration', () => {
  it('plans, executes independent tools in parallel, and synthesizes supported evidence', async () => {
    const planWithModel = jest.fn().mockResolvedValue(JSON.stringify({
      intent: 'status',
      requiredEvidence: ['project', 'runtime'],
      toolCalls: [
        { name: 'get_project_context', args: {} },
        { name: 'get_agent_run_statuses', args: {} },
      ],
    }));
    const executeTool = jest.fn(async (name: string) => {
      if (name === 'get_project_memory') return [];
      return name === 'get_project_context'
        ? [{ sourceType: 'project', sourceId: PROJECT_ID, title: 'Project', excerpt: 'Running', authority: 100, authorized: true }]
        : [{ sourceType: 'runtime', sourceId: 'architecture', title: 'Architecture', excerpt: 'Complete', authority: 100, authorized: true }];
    });
    const synthesizeWithModel = jest.fn().mockResolvedValue('Architecture is complete.');

    const result = await runChatOrchestrator({
      request: { question: 'What is the status?', projectId: PROJECT_ID, currentView: 'project', history: [] },
      caller: { email: 'owner@example.com', userId: 'owner-id' },
      planWithModel,
      synthesizeWithModel,
      executeTool,
    });

    expect(result).toMatchObject({ answer: 'Architecture is complete.', confidence: 100, supported: true });
    expect(planWithModel).toHaveBeenCalledTimes(1);
    expect(executeTool).toHaveBeenCalledTimes(3);
    expect(result.evidence[0]).not.toHaveProperty('excerpt');
  });

  it('answers from approved project memory without calling either model', async () => {
    const planWithModel = jest.fn();
    const synthesizeWithModel = jest.fn();
    const memory = {
      sourceType: 'memory',
      sourceId: 'memory-1',
      title: 'Payment settlement architecture decision',
      excerpt: 'The project uses asynchronous payment settlement with an outbox and idempotency keys.',
      authority: 98,
      authorized: true,
    };

    const result = await runChatOrchestrator({
      request: { question: 'How does payment settlement use idempotency keys?', projectId: PROJECT_ID, currentView: 'project' },
      caller: { email: 'owner@example.com', userId: 'owner-id' },
      planWithModel,
      synthesizeWithModel,
      executeTool: jest.fn().mockResolvedValue([memory]),
    });

    expect(result).toMatchObject({
      answer: memory.excerpt,
      responseMode: 'memory',
      tokenUsage: { totalTokens: 0, modelCalls: 0, avoidedModelCalls: 2 },
    });
    expect(planWithModel).not.toHaveBeenCalled();
    expect(synthesizeWithModel).not.toHaveBeenCalled();
  });

  it('aggregates real planner and synthesis token usage on a memory miss', async () => {
    const result = await runChatOrchestrator({
      request: { question: 'Which agents exist?', currentView: 'dashboard' },
      caller: { email: 'user@example.com', userId: 'user-id' },
      planWithModel: jest.fn().mockResolvedValue({
        text: JSON.stringify({ intent: 'catalog', requiredEvidence: ['catalog'], toolCalls: [{ name: 'get_agent_catalog', args: {} }] }),
        usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 },
        provider: 'openai',
        model: 'gpt-4o',
      }),
      synthesizeWithModel: jest.fn().mockResolvedValue({
        text: 'The Architecture Agent is available.',
        usage: { prompt_tokens: 90, completion_tokens: 20, total_tokens: 110 },
        provider: 'openai',
        model: 'gpt-4o',
      }),
      executeTool: jest.fn().mockResolvedValue([
        { sourceType: 'catalog', sourceId: 'architecture', title: 'Architecture Agent', excerpt: 'phase3', authority: 100, authorized: true },
      ]),
    });

    expect(result).toMatchObject({
      responseMode: 'model',
      tokenUsage: {
        promptTokens: 210,
        completionTokens: 50,
        totalTokens: 260,
        modelCalls: 2,
        avoidedModelCalls: 0,
        providers: ['openai'],
        models: ['gpt-4o'],
      },
    });
  });
  it('replans once when required evidence is missing and never starts a third round', async () => {
    const planWithModel = jest.fn()
      .mockResolvedValueOnce(JSON.stringify({
        intent: 'blocked',
        requiredEvidence: ['project', 'gates'],
        toolCalls: [{ name: 'get_project_context', args: {} }],
      }))
      .mockResolvedValueOnce(JSON.stringify({
        intent: 'blocked',
        requiredEvidence: ['project', 'gates'],
        toolCalls: [{ name: 'get_review_gate_state', args: {} }],
      }))
      .mockResolvedValueOnce('{}');
    const executeTool = jest.fn(async (name: string) => {
      if (name === 'get_project_memory') return [];
      return name === 'get_project_context'
        ? [{ sourceType: 'project', sourceId: PROJECT_ID, title: 'Project', excerpt: 'Running', authority: 100, authorized: true }]
        : [{ sourceType: 'review_gate', sourceId: 'gate3', title: 'Gate 3', excerpt: 'Pending', authority: 100, authorized: true }];
    });

    const result = await runChatOrchestrator({
      request: { question: 'Why blocked?', projectId: PROJECT_ID, currentView: 'project', history: [] },
      caller: { email: 'owner@example.com', userId: 'owner-id' },
      planWithModel,
      synthesizeWithModel: jest.fn().mockResolvedValue('Gate 3 is pending.'),
      executeTool,
    });

    expect(planWithModel).toHaveBeenCalledTimes(2);
    expect(result.supported).toBe(true);
    expect(result.trace.filter((entry: { stage: string }) => entry.stage === 'plan')).toHaveLength(2);
  });

  it('propagates project authorization failures instead of disguising them as missing evidence', async () => {
    const denied = Object.assign(new Error('You do not have access to this project.'), { status: 403 });
    await expect(runChatOrchestrator({
      request: { question: 'What is the status?', projectId: PROJECT_ID, currentView: 'project', history: [] },
      caller: { email: 'outsider@example.com', userId: 'outsider-id' },
      planWithModel: jest.fn().mockResolvedValue(JSON.stringify({
        intent: 'status', requiredEvidence: ['project'], toolCalls: [{ name: 'get_project_context', args: {} }],
      })),
      synthesizeWithModel: jest.fn(),
      executeTool: jest.fn().mockRejectedValue(denied),
    })).rejects.toMatchObject({ status: 403 });
  });

  it('returns an unsupported response when evidence remains insufficient', async () => {
    const result = await runChatOrchestrator({
      request: { question: 'What failed?', projectId: PROJECT_ID, currentView: 'project', history: [] },
      caller: { email: 'owner@example.com', userId: 'owner-id' },
      planWithModel: jest.fn().mockResolvedValue(JSON.stringify({
        intent: 'failure',
        requiredEvidence: ['runtime'],
        toolCalls: [{ name: 'get_agent_run_statuses', args: {} }],
      })),
      synthesizeWithModel: jest.fn().mockResolvedValue('Runtime evidence is unavailable.'),
      executeTool: jest.fn(async (name: string) => name === 'get_project_memory' ? [] : Promise.reject(new Error('runtime unavailable'))),
    });

    expect(result.supported).toBe(false);
    expect(result.confidence).toBe(0);
    expect(result.trace.some((entry: { status: string }) => entry.status === 'error')).toBe(true);
  });

  it('can combine catalog and current external research without an open project', async () => {
    const executeTool = jest.fn(async (name: string) => name === 'get_agent_catalog'
      ? [{ sourceType: 'catalog', sourceId: 'architecture', title: 'Architecture Agent', excerpt: 'phase3', authority: 100, authorized: true }]
      : [{ sourceType: 'external', sourceId: 'https://example.com/current', title: 'Current source', excerpt: 'Current evidence', authority: 95, authorized: true }]);
    const result = await runChatOrchestrator({
      request: { question: 'What current standards affect architecture?', currentView: 'dashboard', history: [] },
      caller: { email: 'user@example.com', userId: 'user-id' },
      planWithModel: jest.fn().mockResolvedValue(JSON.stringify({
        intent: 'current_research', requiredEvidence: ['catalog', 'external'],
        toolCalls: [
          { name: 'get_agent_catalog', args: {} },
          { name: 'research_external_sources', args: { query: 'current architecture standards' } },
        ],
      })),
      synthesizeWithModel: jest.fn().mockResolvedValue('Current architecture guidance is available.'),
      executeTool,
    });
    expect(executeTool).toHaveBeenCalledTimes(2);
    expect(result.evidence.map((item: { sourceType: string }) => item.sourceType)).toEqual(expect.arrayContaining(['catalog', 'external']));
  });

  it('uses catalog-only retrieval when no project is open', async () => {
    const executeTool = jest.fn().mockResolvedValue([
      { sourceType: 'catalog', sourceId: 'architecture', title: 'Architecture Agent', excerpt: 'phase3', authority: 100, authorized: true },
    ]);
    const result = await runChatOrchestrator({
      request: { question: 'Which agents exist?', projectId: null, currentView: 'dashboard', history: [] },
      caller: { email: 'user@example.com', userId: 'user-id' },
      planWithModel: jest.fn().mockResolvedValue('not-json'),
      synthesizeWithModel: jest.fn().mockResolvedValue('The Architecture Agent is available.'),
      executeTool,
    });

    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(executeTool).toHaveBeenCalledWith('get_agent_catalog', {}, expect.any(Object));
    expect(result.supported).toBe(true);
  });
});

export {};
