export type LifecycleEventType =
  | 'agent_rerun'
  | 'agent_completed'
  | 'token_threshold_exceeded'
  | 'prompt_changed'
  | 'model_changed'
  | 'tool_changed'
  | 'data_changed'
  | 'permission_changed'
  | 'uat_requested'
  | 'deployment_requested'
  | 'incident_reported'
  | 'scheduled_review';

export interface LifecycleEvent {
  type: LifecycleEventType;
  agentKey?: string;
  tokensUsed?: number;
  contextChars?: number;
}

export type BackgroundAgentKey = 'tokenOptimizer' | 'aiGovernance';

const INTERNAL = new Set<BackgroundAgentKey>(['tokenOptimizer', 'aiGovernance']);
const GOVERNED_AGENTS = new Set([
  'architecture', 'securityCompliance', 'testPlan', 'testCases',
  'devopsEngineer', 'infraEngineer', 'workingPrototype', 'observabilityEngineer', 'onCallEngineer',
]);

export function selectBackgroundAgents(event: LifecycleEvent): BackgroundAgentKey[] {
  if (event.agentKey && INTERNAL.has(event.agentKey as BackgroundAgentKey)) return [];
  const selected = new Set<BackgroundAgentKey>();
  if (event.type === 'agent_rerun' || event.type === 'prompt_changed' ||
      event.type === 'model_changed' || event.type === 'token_threshold_exceeded' ||
      (event.type === 'agent_completed' && ((event.tokensUsed ?? 0) >= 10_000 || (event.contextChars ?? 0) >= 30_000))) {
    selected.add('tokenOptimizer');
  }
  if (['prompt_changed', 'model_changed', 'tool_changed', 'data_changed', 'permission_changed',
       'uat_requested', 'deployment_requested', 'incident_reported', 'scheduled_review'].includes(event.type) ||
      ((event.type === 'agent_completed' || event.type === 'agent_rerun') && !!event.agentKey && GOVERNED_AGENTS.has(event.agentKey))) {
    selected.add('aiGovernance');
  }
  return [...selected];
}
