/**
 * 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential - Unauthorized use prohibited.
 */

const { createChatRouteHandler } = require('./chatRoute');

function responseRecorder() {
  return {
    statusCode: 200,
    body: null as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; return this; },
  };
}

describe('agentic chat route', () => {
  it('rejects a request with no authenticated caller', async () => {
    const handler = createChatRouteHandler({ orchestrate: jest.fn() });
    const res = responseRecorder();
    await handler({ body: { question: 'hello' } }, res);
    expect(res.statusCode).toBe(401);
  });

  it('passes the authenticated caller and request to the orchestrator', async () => {
    const orchestrate = jest.fn().mockResolvedValue({
      answer: 'Supported answer', confidence: 100, supported: true, evidence: [], trace: [], followUp: null,
    });
    const handler = createChatRouteHandler({ orchestrate });
    const res = responseRecorder();
    await handler({
      authUser: { email: 'owner@example.com', user: { id: 'owner-id' } },
      body: { question: 'What is blocked?' },
    }, res);
    expect(res.statusCode).toBe(200);
    expect(orchestrate).toHaveBeenCalledWith(expect.objectContaining({
      request: { question: 'What is blocked?' },
      caller: { email: 'owner@example.com', userId: 'owner-id', adminBypass: false },
    }));
  });

  it('maps access errors without leaking internal details', async () => {
    const error = Object.assign(new Error('You do not have access to this project.'), { status: 403 });
    const handler = createChatRouteHandler({ orchestrate: jest.fn().mockRejectedValue(error) });
    const res = responseRecorder();
    await handler({ authUser: { email: 'user@example.com', user: { id: 'u1' } }, body: { question: 'status' } }, res);
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: 'You do not have access to this project.' });
  });

  it('returns a safe provider error for unexpected failures', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const handler = createChatRouteHandler({
      orchestrate: jest.fn().mockRejectedValue(new Error('sk-secret database-password')),
    });
    const res = responseRecorder();
    await handler({ authUser: { email: 'user@example.com', user: { id: 'u1' } }, body: { question: 'status' } }, res);
    expect(res.statusCode).toBe(502);
    expect(JSON.stringify(res.body)).not.toContain('sk-secret');
    expect(JSON.stringify(consoleSpy.mock.calls)).not.toContain('sk-secret');
    consoleSpy.mockRestore();
  });
});

export {};
