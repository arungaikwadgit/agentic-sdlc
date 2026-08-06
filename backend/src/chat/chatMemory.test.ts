/**
 * 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential - Unauthorized use prohibited.
 */

const { findMemoryAnswer, isVolatileQuestion, scoreMemory } = require('./chatMemory');

const memory = {
  sourceType: 'memory',
  sourceId: 'memory-1',
  title: 'Payment settlement architecture decision',
  excerpt: 'The project uses asynchronous payment settlement with an outbox and idempotency keys.',
  authority: 98,
  authorized: true,
};

describe('chat memory matching', () => {
  it('returns a strong approved project-memory match without synthesis', () => {
    const result = findMemoryAnswer('How does payment settlement use idempotency keys?', [memory]);
    expect(result).toMatchObject({
      answer: memory.excerpt,
      confidence: expect.any(Number),
      evidence: memory,
    });
    expect(result.confidence).toBeGreaterThanOrEqual(98);
  });

  it('does not use memory for volatile runtime questions', () => {
    expect(isVolatileQuestion('What is the current agent status?')).toBe(true);
    expect(findMemoryAnswer('What is the current agent status?', [memory])).toBeNull();
  });

  it('rejects weak or unauthorized memory matches', () => {
    expect(scoreMemory('Explain the deployment rollback strategy', memory)).toBeLessThan(0.78);
    expect(findMemoryAnswer('Explain the deployment rollback strategy', [memory])).toBeNull();
    expect(findMemoryAnswer('How does payment settlement use idempotency keys?', [
      { ...memory, authorized: false },
    ])).toBeNull();
  });
});

export {};
