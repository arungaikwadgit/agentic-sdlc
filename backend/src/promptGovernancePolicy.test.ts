/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential - Unauthorized use prohibited.
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  assertPromptTransition,
  canActivatePrompt,
  canRollbackPrompt,
} = require('./promptGovernancePolicy');

describe('prompt governance lifecycle policy', () => {
  test.each([
    ['draft', 'submitted'],
    ['submitted', 'approved'],
    ['submitted', 'rejected'],
    ['submitted', 'changes_requested'],
    ['approved', 'activated'],
    ['activated', 'superseded'],
    ['activated', 'rolled_back'],
  ])('allows %s -> %s', (from: string, to: string) => {
    expect(() => assertPromptTransition(from, to)).not.toThrow();
  });

  test.each([
    ['draft', 'activated'],
    ['draft', 'approved'],
    ['submitted', 'activated'],
    ['rejected', 'submitted'],
    ['changes_requested', 'submitted'],
    ['superseded', 'activated'],
  ])('rejects %s -> %s', (from: string, to: string) => {
    expect(() => assertPromptTransition(from, to)).toThrow(/Invalid prompt status transition/);
  });

  it('only permits activation of an approved version', () => {
    expect(canActivatePrompt('approved')).toBe(true);
    expect(canActivatePrompt('activated')).toBe(false);
    expect(canActivatePrompt('submitted')).toBe(false);
  });

  it('permits rollback only from an immutable previously activated version', () => {
    expect(canRollbackPrompt({ status: 'superseded', active: false, activated_at: '2026-07-15T12:00:00Z' })).toBe(true);
    expect(canRollbackPrompt({ status: 'rolled_back', active: false, activated_at: '2026-07-15T12:00:00Z' })).toBe(true);
    expect(canRollbackPrompt({ status: 'draft', active: false, activated_at: null })).toBe(false);
    expect(canRollbackPrompt({ status: 'activated', active: true, activated_at: '2026-07-15T12:00:00Z' })).toBe(false);
  });
});
