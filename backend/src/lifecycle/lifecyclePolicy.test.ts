import { selectBackgroundAgents } from './lifecyclePolicy';

describe('selectBackgroundAgents', () => {
  it('runs token optimization for reruns and expensive workloads', () => {
    expect(selectBackgroundAgents({ type: 'agent_rerun', agentKey: 'architecture' }))
      .toContain('tokenOptimizer');
    expect(selectBackgroundAgents({ type: 'token_threshold_exceeded', tokensUsed: 20_000 }))
      .toContain('tokenOptimizer');
    expect(selectBackgroundAgents({ type: 'agent_completed', contextChars: 40_000 }))
      .toContain('tokenOptimizer');
  });

  it('runs governance for material lifecycle and high-risk agent events', () => {
    expect(selectBackgroundAgents({ type: 'agent_completed', agentKey: 'architecture' }))
      .toContain('aiGovernance');
    expect(selectBackgroundAgents({ type: 'deployment_requested' }))
      .toContain('aiGovernance');
  });

  it('runs governance when a high-risk agent is manually rerun', () => {
    expect(selectBackgroundAgents({ type: 'agent_rerun', agentKey: 'architecture' }))
      .toEqual(['tokenOptimizer', 'aiGovernance']);
  });

  it('never recursively schedules background agents', () => {
    expect(selectBackgroundAgents({ type: 'agent_completed', agentKey: 'tokenOptimizer' })).toEqual([]);
    expect(selectBackgroundAgents({ type: 'agent_completed', agentKey: 'aiGovernance' })).toEqual([]);
  });
});
