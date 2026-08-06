export {};

jest.mock('../chat/chatEvidence', () => ({
  authorizeChatProjectAccess: jest.fn(),
}));
jest.mock('../chat/chatHistoryStore', () => ({
  getUserRecentMessages: jest.fn(),
}));

const express = require('express');
const { authorizeChatProjectAccess } = require('../chat/chatEvidence');
const { getUserRecentMessages } = require('../chat/chatHistoryStore');
const { createChatHistoryRouter } = require('./chatHistory');

function authOk(req: any, _res: any, next: any) {
  req.authUser = { email: 'user@example.com', user: { id: 'u1' }, adminBypass: false };
  next();
}

function buildApp(overrides: any = {}) {
  const app = express();
  app.use(express.json());
  const checkToken = overrides.checkToken ?? authOk;
  const getDb = overrides.getDb ?? (() => (overrides.db !== undefined ? overrides.db : { query: jest.fn() }));
  const isAppAdmin = overrides.isAppAdmin ?? (() => false);
  const router = createChatHistoryRouter({ getDb, checkToken, isAppAdmin });
  app.use('/api/projects', router);
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

describe('createChatHistoryRouter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns messages for an authorized caller', async () => {
    authorizeChatProjectAccess.mockResolvedValue(undefined);
    getUserRecentMessages.mockResolvedValue([{ id: 1, role: 'user', text: 'hi' }]);
    const db = { query: jest.fn() };
    const app = buildApp({ db });

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/projects/proj-1/chat/messages`);
      const body: any = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ messages: [{ id: 1, role: 'user', text: 'hi' }] });
      expect(authorizeChatProjectAccess).toHaveBeenCalledWith({
        db,
        caller: { email: 'user@example.com', userId: 'u1', adminBypass: false },
        projectId: 'proj-1',
        isAppAdmin: expect.any(Function),
      });
      expect(getUserRecentMessages).toHaveBeenCalledWith(db, {
        projectId: 'proj-1',
        userId: 'u1',
        userEmail: 'user@example.com',
      });
    });
  });

  it('returns the mapped status (403) when authorization is denied', async () => {
    const err: any = new Error('You do not have access to this project.');
    err.status = 403;
    authorizeChatProjectAccess.mockRejectedValue(err);
    const app = buildApp();

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/projects/proj-1/chat/messages`);
      const body: any = await response.json();
      expect(response.status).toBe(403);
      expect(body.error).toMatch(/do not have access/i);
      expect(getUserRecentMessages).not.toHaveBeenCalled();
    });
  });

  it('falls back to 500 when the access error carries an unlisted status code', async () => {
    const err: any = new Error('boom');
    err.status = 418;
    authorizeChatProjectAccess.mockRejectedValue(err);
    const app = buildApp();

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/projects/proj-1/chat/messages`);
      expect(response.status).toBe(500);
    });
  });

  it('returns 401 when there is no authenticated user (real route branch, not the auth middleware)', async () => {
    const app = buildApp({ checkToken: (_req: any, _res: any, next: any) => next() });

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/projects/proj-1/chat/messages`);
      const body: any = await response.json();
      expect(response.status).toBe(401);
      expect(body.error).toMatch(/authentication is required/i);
      expect(authorizeChatProjectAccess).not.toHaveBeenCalled();
    });
  });

  it('returns 503 when the database is unavailable', async () => {
    const app = buildApp({ getDb: () => null });

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/projects/proj-1/chat/messages`);
      const body: any = await response.json();
      expect(response.status).toBe(503);
      expect(body.error).toMatch(/database is unavailable/i);
      expect(authorizeChatProjectAccess).not.toHaveBeenCalled();
    });
  });

  it('invokes the default isAppAdmin function when the caller does not supply one', async () => {
    // authorizeChatProjectAccess is mocked, so we simulate a real implementation
    // that actually calls the isAppAdmin it was given, to exercise the default
    // `isAppAdmin = () => false` arrow function defined in chatHistory.js itself.
    authorizeChatProjectAccess.mockImplementation(async ({ isAppAdmin: isAdminFn, caller }: any) => {
      expect(isAdminFn(caller.email)).toBe(false);
      return undefined;
    });
    getUserRecentMessages.mockResolvedValue([]);

    const app = express();
    app.use(express.json());
    app.use('/api/projects', createChatHistoryRouter({ getDb: () => ({}), checkToken: authOk }));
    const server = app.listen(0);
    try {
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Failed to allocate test server port');
      }
      const response = await fetch(`http://127.0.0.1:${address.port}/api/projects/proj-1/chat/messages`);
      const body: any = await response.json();
      expect(response.status).toBe(200);
      expect(body).toEqual({ messages: [] });
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('falls back to null email/userId when authUser has neither (nullish-coalescing fallbacks)', async () => {
    authorizeChatProjectAccess.mockResolvedValue(undefined);
    getUserRecentMessages.mockResolvedValue([]);
    const db = { query: jest.fn() };
    const app = buildApp({
      db,
      checkToken: (req: any, _res: any, next: any) => {
        req.authUser = {}; // no email, no user -- forces both ?? null fallbacks
        next();
      },
    });

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/projects/proj-1/chat/messages`);
      const body: any = await response.json();
      expect(response.status).toBe(200);
      expect(body).toEqual({ messages: [] });
      expect(authorizeChatProjectAccess).toHaveBeenCalledWith({
        db,
        caller: { email: null, userId: null, adminBypass: false },
        projectId: 'proj-1',
        isAppAdmin: expect.any(Function),
      });
      expect(getUserRecentMessages).toHaveBeenCalledWith(db, {
        projectId: 'proj-1',
        userId: null,
        userEmail: null,
      });
    });
  });

  it('defaults to "Access denied." when the access error carries no message', async () => {
    const err: any = { status: 404 };
    authorizeChatProjectAccess.mockRejectedValue(err);
    const app = buildApp();

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/projects/proj-1/chat/messages`);
      const body: any = await response.json();
      expect(response.status).toBe(404);
      expect(body).toEqual({ error: 'Access denied.' });
    });
  });
});
