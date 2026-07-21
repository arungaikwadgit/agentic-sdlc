// Unit tests for backend/src/routes/chatRespond.js's own wiring logic
// (createChatRespondRouter). The deeper chat subsystem modules
// (chatEvidence, chatOrchestrator, chatExternalResearch, chatHistoryStore)
// already have their own test suites, so they are mocked here -- this file
// verifies only what chatRespond.js itself is responsible for: building
// callModel from resolveDispatchTarget/dispatchAgentCall, the team-history
// substitution branch, and the fire-and-forget save-both-turns behavior.
//
// Follows the express-app-per-test-file + real-server + fetch() convention
// established by proxy.appStateFallback.test.ts (no supertest in this repo).

export {};

jest.mock('../chat/chatEvidence', () => ({ createChatEvidenceTools: jest.fn() }));
jest.mock('../chat/chatOrchestrator', () => ({ runChatOrchestrator: jest.fn() }));
jest.mock('../chat/chatExternalResearch', () => ({ createExternalResearch: jest.fn() }));
jest.mock('../chat/chatHistoryStore', () => ({
  getTeamRecentMessages: jest.fn(),
  saveChatMessage: jest.fn(),
}));

const express = require('express');
const { createChatRespondRouter } = require('./chatRespond');
const { createChatEvidenceTools } = require('../chat/chatEvidence');
const { runChatOrchestrator } = require('../chat/chatOrchestrator');
const { createExternalResearch } = require('../chat/chatExternalResearch');
const { getTeamRecentMessages, saveChatMessage } = require('../chat/chatHistoryStore');

function buildApp(overrides: any = {}) {
  const app = express();
  app.use(express.json());

  const checkToken =
    overrides.checkToken ||
    ((req: any, _res: any, next: any) => {
      req.authUser = { email: 'test@example.com', user: { id: 'u1' } };
      next();
    });
  const getDb = overrides.getDb || (() => null);
  const isAppAdmin = overrides.isAppAdmin || (() => false);
  const resolveDispatchTarget =
    overrides.resolveDispatchTarget ||
    jest.fn(() => ({ kind: 'catalog', entry: { id: 'model-x', providerType: 'openai' } }));
  const dispatchAgentCall =
    overrides.dispatchAgentCall ||
    jest.fn(async () => ({ choices: [{ message: { content: 'default reply' } }] }));

  const router = createChatRespondRouter({
    checkToken,
    getDb,
    isAppAdmin,
    resolveDispatchTarget,
    dispatchAgentCall,
  });
  app.use('/api/chat', router);
  return app;
}

async function withServer(app: any, fn: (baseUrl: string) => Promise<void>) {
  const server = app.listen(0);
  try {
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Failed to allocate test server port');
    }
    const baseUrl = `http://127.0.0.1:${address.port}`;
    await fn(baseUrl);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

describe('createChatRespondRouter (POST /respond)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (createChatEvidenceTools as jest.Mock).mockReturnValue({ execute: jest.fn() });
    (createExternalResearch as jest.Mock).mockReturnValue({ research: jest.fn() });
    (getTeamRecentMessages as jest.Mock).mockResolvedValue([]);
    (saveChatMessage as jest.Mock).mockResolvedValue(undefined);
    (runChatOrchestrator as jest.Mock).mockResolvedValue({ answer: 'ok', responseMode: 'grounded' });
  });

  it('returns 401 when checkToken does not populate req.authUser', async () => {
    const app = buildApp({
      checkToken: (_req: any, _res: any, next: any) => next(),
    });
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/chat/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: 'hi' }),
      });
      const body: any = await response.json();
      expect(response.status).toBe(401);
      expect(body.error).toMatch(/Authentication is required/i);
      expect(runChatOrchestrator).not.toHaveBeenCalled();
    });
  });

  it('builds callModel from resolveDispatchTarget/dispatchAgentCall and passes plan/synthesize callbacks that call it with the right system prompts and maxTokens', async () => {
    const resolveDispatchTarget = jest.fn(() => ({ kind: 'catalog', entry: { id: 'gpt-x', providerType: 'openai' } }));
    const dispatchAgentCall = jest
      .fn()
      .mockResolvedValueOnce({ choices: [{ message: { content: 'PLAN_TEXT' } }], usage: { total_tokens: 5 }, provider: 'openai', model: 'gpt-x' })
      .mockResolvedValueOnce({ choices: [{ message: { content: 'SYNTH_TEXT' } }], usage: { total_tokens: 9 }, provider: 'openai', model: 'gpt-x' });

    (runChatOrchestrator as jest.Mock).mockImplementation(async ({ planWithModel, synthesizeWithModel }: any) => {
      const plan = await planWithModel('plan this');
      const synth = await synthesizeWithModel('synthesize this');
      return { answer: synth.text, plan: plan.text, responseMode: 'grounded' };
    });

    const app = buildApp({ resolveDispatchTarget, dispatchAgentCall });
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/chat/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: 'What is X?' }),
      });
      const body: any = await response.json();

      expect(response.status).toBe(200);
      expect(body.answer).toBe('SYNTH_TEXT');
      expect(body.plan).toBe('PLAN_TEXT');

      expect(resolveDispatchTarget).toHaveBeenCalledWith(undefined, 'helpAssistant');

      expect(dispatchAgentCall).toHaveBeenCalledTimes(2);
      const [firstCallArgs, secondCallArgs] = dispatchAgentCall.mock.calls;
      expect(firstCallArgs[1]).toEqual(expect.stringContaining('planner'));
      expect(firstCallArgs[2]).toBe('plan this');
      expect(firstCallArgs[3]).toBe(1024);
      expect(secondCallArgs[1]).toEqual(expect.stringContaining('Synthesis'));
      expect(secondCallArgs[2]).toBe('synthesize this');
      expect(secondCallArgs[3]).toBe(2048);
    });
  });

  it('extractChatModelText falls back to the Anthropic-style content array when choices[0].message.content is absent', async () => {
    const dispatchAgentCall = jest.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'ANTHROPIC_STYLE_TEXT' }],
      usage: { total_tokens: 3 },
      provider: 'claude',
      model: 'claude-x',
    });
    (runChatOrchestrator as jest.Mock).mockImplementation(async ({ planWithModel }: any) => {
      const plan = await planWithModel('plan this');
      return { answer: plan.text, responseMode: 'grounded' };
    });

    const app = buildApp({ dispatchAgentCall });
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/chat/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: 'hi' }),
      });
      const body: any = await response.json();
      expect(response.status).toBe(200);
      expect(body.answer).toBe('ANTHROPIC_STYLE_TEXT');
    });
  });

  it('propagates a 502 when the configured model has neither choices[0].message.content nor a content array (fully empty)', async () => {
    const dispatchAgentCall = jest.fn().mockResolvedValue({});
    (runChatOrchestrator as jest.Mock).mockImplementation(async ({ planWithModel }: any) => {
      await planWithModel('plan this');
      return { answer: 'unreachable' };
    });

    const app = buildApp({ dispatchAgentCall });
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/chat/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: 'hi' }),
      });
      const body: any = await response.json();
      expect(response.status).toBe(502);
      expect(body.error).toMatch(/could not complete this request/i);
    });
  });

  it('propagates a 502 when the configured model returns an empty response (callModel throws)', async () => {
    const dispatchAgentCall = jest.fn().mockResolvedValue({ choices: [{ message: { content: '   ' } }] });
    (runChatOrchestrator as jest.Mock).mockImplementation(async ({ planWithModel }: any) => {
      await planWithModel('plan this');
      return { answer: 'unreachable' };
    });

    const app = buildApp({ dispatchAgentCall });
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/chat/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: 'hi' }),
      });
      const body: any = await response.json();
      expect(response.status).toBe(502);
      expect(body.error).toMatch(/could not complete this request/i);
    });
  });

  it('replaces effectiveRequest.history with the team\'s bounded recent history (mapped to role/text) when team history exists', async () => {
    (getTeamRecentMessages as jest.Mock).mockResolvedValue([
      { role: 'user', text: 'old msg', extraField: 'should be dropped' },
      { role: 'assistant', text: 'old reply' },
    ]);
    let capturedRequest: any = null;
    (runChatOrchestrator as jest.Mock).mockImplementation(async ({ request }: any) => {
      capturedRequest = request;
      return { answer: 'ok' };
    });
    const fakeDb = { marker: 'THE_DB' };
    const getDb = jest.fn(() => fakeDb);

    const app = buildApp({ getDb });
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/chat/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: 'proj-1',
          question: 'q',
          history: [{ role: 'user', text: 'client-supplied history — should be ignored' }],
        }),
      });
      expect(response.status).toBe(200);
    });

    expect(getTeamRecentMessages).toHaveBeenCalledWith(fakeDb, { projectId: 'proj-1' });
    expect(capturedRequest.projectId).toBe('proj-1');
    expect(capturedRequest.question).toBe('q');
    expect(capturedRequest.history).toEqual([
      { role: 'user', text: 'old msg' },
      { role: 'assistant', text: 'old reply' },
    ]);
  });

  it('passes the original request through unchanged when there is no persisted team history', async () => {
    (getTeamRecentMessages as jest.Mock).mockResolvedValue([]);
    let capturedRequest: any = null;
    (runChatOrchestrator as jest.Mock).mockImplementation(async ({ request }: any) => {
      capturedRequest = request;
      return { answer: 'ok' };
    });

    const originalHistory = [{ role: 'user', text: 'client history', extraField: 'kept-because-passthrough' }];
    const app = buildApp();
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/chat/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: 'proj-2', question: 'q2', history: originalHistory }),
      });
      expect(response.status).toBe(200);
    });

    expect(capturedRequest.history).toEqual(originalHistory);
  });

  it('does not call getTeamRecentMessages at all when the request has no projectId', async () => {
    (runChatOrchestrator as jest.Mock).mockResolvedValue({ answer: 'ok' });
    const app = buildApp();
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/chat/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: 'no project here' }),
      });
      expect(response.status).toBe(200);
    });
    expect(getTeamRecentMessages).not.toHaveBeenCalled();
  });

  it('saves both the user turn and the assistant turn (fire-and-forget) when getDb() returns a truthy pool', async () => {
    const fakePool = { query: jest.fn() };
    const getDb = jest.fn(() => fakePool);
    const checkToken = (req: any, _res: any, next: any) => {
      req.authUser = { email: 'user@example.com', user: { id: 'user-123' } };
      next();
    };
    (runChatOrchestrator as jest.Mock).mockResolvedValue({ answer: 'X is Y', responseMode: 'grounded' });

    const app = buildApp({ getDb, checkToken });
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/chat/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: 'p1', question: 'What is X?' }),
      });
      expect(response.status).toBe(200);
    });

    expect(saveChatMessage).toHaveBeenCalledTimes(2);
    expect(saveChatMessage).toHaveBeenNthCalledWith(1, fakePool, {
      projectId: 'p1',
      userId: 'user-123',
      userEmail: 'user@example.com',
      role: 'user',
      text: 'What is X?',
    });
    expect(saveChatMessage).toHaveBeenNthCalledWith(2, fakePool, {
      projectId: 'p1',
      userId: 'user-123',
      userEmail: 'user@example.com',
      role: 'assistant',
      text: 'X is Y',
      responseMode: 'grounded',
    });
  });

  it('does not call saveChatMessage at all when getDb() returns null/undefined', async () => {
    const getDb = jest.fn(() => null);
    (runChatOrchestrator as jest.Mock).mockResolvedValue({ answer: 'ok' });

    const app = buildApp({ getDb });
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/chat/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: 'p1', question: 'q' }),
      });
      expect(response.status).toBe(200);
    });

    expect(saveChatMessage).not.toHaveBeenCalled();
  });

  it('calls getDb() fresh at each use site rather than snapshotting a single value', async () => {
    const dbForEvidence = { tag: 'evidence' };
    const dbForHistory = { tag: 'history' };
    const dbForSave = { tag: 'save' };
    const getDb = jest.fn().mockReturnValueOnce(dbForEvidence).mockReturnValueOnce(dbForHistory).mockReturnValueOnce(dbForSave);
    (runChatOrchestrator as jest.Mock).mockResolvedValue({ answer: 'ok' });

    const app = buildApp({ getDb });
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/chat/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: 'p1', question: 'q' }),
      });
      expect(response.status).toBe(200);
    });

    expect(getDb).toHaveBeenCalledTimes(3);
    expect((createChatEvidenceTools as jest.Mock).mock.calls[0][0].db).toBe(dbForEvidence);
    expect(getTeamRecentMessages).toHaveBeenCalledWith(dbForHistory, { projectId: 'p1' });
    expect((saveChatMessage as jest.Mock).mock.calls[0][0]).toBe(dbForSave);
  });

  it('callModel defaults usage/provider/model to null when dispatchAgentCall omits them', async () => {
    const dispatchAgentCall = jest.fn().mockResolvedValue({ choices: [{ message: { content: 'valid text, no usage/provider/model' } }] });
    let captured: any = null;
    (runChatOrchestrator as jest.Mock).mockImplementation(async ({ planWithModel }: any) => {
      captured = await planWithModel('plan this');
      return { answer: 'ok' };
    });

    const app = buildApp({ dispatchAgentCall });
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/chat/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: 'hi' }),
      });
      expect(response.status).toBe(200);
    });

    expect(captured).toEqual({ text: 'valid text, no usage/provider/model', usage: null, provider: null, model: null });
  });

  it('saves userId/userEmail as null when the authenticated caller lacks them', async () => {
    const fakePool = { query: jest.fn() };
    const getDb = jest.fn(() => fakePool);
    const checkToken = (req: any, _res: any, next: any) => {
      req.authUser = {}; // no email, no user.id
      next();
    };
    (runChatOrchestrator as jest.Mock).mockResolvedValue({ answer: 'ok', responseMode: 'grounded' });

    const app = buildApp({ getDb, checkToken });
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/chat/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: 'p1', question: 'hi' }),
      });
      expect(response.status).toBe(200);
    });

    expect(saveChatMessage).toHaveBeenNthCalledWith(1, fakePool, {
      projectId: 'p1',
      userId: null,
      userEmail: null,
      role: 'user',
      text: 'hi',
    });
  });
});
