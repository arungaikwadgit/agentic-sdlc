/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential - Unauthorized use prohibited.
 */

const TRANSITIONS = Object.freeze({
  draft: new Set(['submitted']),
  submitted: new Set(['approved', 'rejected', 'changes_requested']),
  approved: new Set(['activated']),
  activated: new Set(['superseded', 'rolled_back']),
  rejected: new Set(),
  changes_requested: new Set(),
  superseded: new Set(['rolled_back']),
  rolled_back: new Set(),
});

function assertPromptTransition(from, to) {
  if (!TRANSITIONS[from]?.has(to)) {
    const error = new Error(`Invalid prompt status transition: ${from} -> ${to}`);
    error.code = 'INVALID_PROMPT_TRANSITION';
    throw error;
  }
}

function canActivatePrompt(status) {
  return status === 'approved';
}

function canRollbackPrompt(record) {
  return Boolean(
    record &&
    !record.active &&
    record.activated_at &&
    ['superseded', 'rolled_back'].includes(record.status),
  );
}

module.exports = { assertPromptTransition, canActivatePrompt, canRollbackPrompt };
