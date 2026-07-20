/**
 * 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential - Unauthorized use prohibited.
 */

const { saveChatMessage, getTeamRecentMessages, getUserRecentMessages } = require('./chatHistoryStore');

describe('chatHistoryStore', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  describe('saveChatMessage', () => {
    it('inserts a trimmed message and returns the new row', async () => {
      const query = jest.fn().mockResolvedValue({ rows: [{ id: 'msg-1', created_at: '2026-07-20T00:00:00Z' }] });
      const db = { query };

      const result = await saveChatMessage(db, {
        projectId: 'project-1',
        userId: 'user-1',
        userEmail: 'arun@example.com',
        role: 'user',
        text: '  How does gate0 work?  ',
      });

      expect(result).toEqual({ id: 'msg-1', created_at: '2026-07-20T00:00:00Z' });
      expect(query).toHaveBeenCalledWith(
        expect.stringMatching(/INSERT INTO chat_messages/),
        ['project-1', 'user-1', 'arun@example.com', 'user', 'How does gate0 work?', null],
      );
    });

    it('returns null and does not throw when the role is invalid', async () => {
      const query = jest.fn();
      const result = await saveChatMessage({ query }, { role: 'system', text: 'hi' });
      expect(result).toBeNull();
      expect(query).not.toHaveBeenCalled();
    });

    it('returns null and does not throw for empty/whitespace-only text', async () => {
      const query = jest.fn();
      const result = await saveChatMessage({ query }, { role: 'user', text: '   ' });
      expect(result).toBeNull();
      expect(query).not.toHaveBeenCalled();
    });

    it('returns null when no db is provided', async () => {
      const result = await saveChatMessage(null, { role: 'user', text: 'hi' });
      expect(result).toBeNull();
    });

    it('swallows a query error and returns null instead of throwing', async () => {
      const query = jest.fn().mockRejectedValue(new Error('connection reset'));
      const result = await saveChatMessage({ query }, { projectId: 'p1', role: 'assistant', text: 'answer' });
      expect(result).toBeNull();
      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });

  describe('getTeamRecentMessages', () => {
    it('returns rows oldest-first (reversed from the DESC query order)', async () => {
      const query = jest.fn().mockResolvedValue({
        rows: [
          { role: 'assistant', text: 'third', user_email: 'b@example.com', created_at: 3 },
          { role: 'user', text: 'second', user_email: 'a@example.com', created_at: 2 },
          { role: 'user', text: 'first', user_email: 'a@example.com', created_at: 1 },
        ],
      });
      const result = await getTeamRecentMessages({ query }, { projectId: 'project-1' });
      expect(result.map((m: { text: string }) => m.text)).toEqual(['first', 'second', 'third']);
      expect(query).toHaveBeenCalledWith(expect.stringMatching(/WHERE project_id = \$1/), ['project-1', 24]);
    });

    it('returns [] when no projectId is given (no unscoped team-wide read)', async () => {
      const query = jest.fn();
      const result = await getTeamRecentMessages({ query }, {});
      expect(result).toEqual([]);
      expect(query).not.toHaveBeenCalled();
    });

    it('returns [] when no db is given', async () => {
      const result = await getTeamRecentMessages(null, { projectId: 'project-1' });
      expect(result).toEqual([]);
    });

    it('returns [] instead of throwing when the query fails', async () => {
      const query = jest.fn().mockRejectedValue(new Error('timeout'));
      const result = await getTeamRecentMessages({ query }, { projectId: 'project-1' });
      expect(result).toEqual([]);
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('respects a custom limit', async () => {
      const query = jest.fn().mockResolvedValue({ rows: [] });
      await getTeamRecentMessages({ query }, { projectId: 'project-1', limit: 5 });
      expect(query).toHaveBeenCalledWith(expect.any(String), ['project-1', 5]);
    });
  });

  describe('getUserRecentMessages', () => {
    it('returns rows oldest-first, scoped to the caller', async () => {
      const query = jest.fn().mockResolvedValue({
        rows: [
          { id: 'm2', role: 'assistant', text: 'second', created_at: 2 },
          { id: 'm1', role: 'user', text: 'first', created_at: 1 },
        ],
      });
      const result = await getUserRecentMessages({ query }, { projectId: 'project-1', userId: 'user-1', userEmail: 'a@example.com' });
      expect(result.map((m: { text: string }) => m.text)).toEqual(['first', 'second']);
      expect(query).toHaveBeenCalledWith(expect.any(String), ['project-1', 'user-1', 'a@example.com', 50]);
    });

    it('returns [] when neither userId nor userEmail is given', async () => {
      const query = jest.fn();
      const result = await getUserRecentMessages({ query }, { projectId: 'project-1' });
      expect(result).toEqual([]);
      expect(query).not.toHaveBeenCalled();
    });

    it('returns [] when no projectId is given', async () => {
      const query = jest.fn();
      const result = await getUserRecentMessages({ query }, { userId: 'user-1' });
      expect(result).toEqual([]);
      expect(query).not.toHaveBeenCalled();
    });

    it('returns [] instead of throwing when the query fails', async () => {
      const query = jest.fn().mockRejectedValue(new Error('timeout'));
      const result = await getUserRecentMessages({ query }, { projectId: 'project-1', userId: 'user-1' });
      expect(result).toEqual([]);
      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });
});
