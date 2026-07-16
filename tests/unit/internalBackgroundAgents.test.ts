import { describe, expect, it } from 'vitest';
import { AGENT_DEFINITIONS } from '../../frontend/src/agents/definitions';
import { getUserVisibleAgentIds, isInternalAgent } from '../../frontend/src/lib/agentEnablement';

describe('internal background agents', () => {
  it('keeps optimization and governance out of the normal workspace catalog', () => {
    expect(AGENT_DEFINITIONS.tokenOptimizer.visibility).toBe('internal');
    expect(AGENT_DEFINITIONS.aiGovernance.visibility).toBe('internal');
    expect(isInternalAgent('tokenOptimizer')).toBe(true);
    expect(isInternalAgent('aiGovernance')).toBe(true);
    expect(getUserVisibleAgentIds()).not.toContain('tokenOptimizer');
    expect(getUserVisibleAgentIds()).not.toContain('aiGovernance');
  });
  it('keeps standard agents visible', () => {
    expect(isInternalAgent('architecture')).toBe(false);
    expect(getUserVisibleAgentIds()).toContain('architecture');
  });
});
