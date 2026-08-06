import { AGENT_DEFINITIONS } from '@/agents/definitions';
import { getAuthHeader } from './api';
import type { AgentId, AgentPromptContext } from '@/types/agent.types';

const API_URL = import.meta.env.VITE_API_URL ?? '/api';

export type LifecycleEventType =
  | 'agent_rerun' | 'agent_completed' | 'token_threshold_exceeded'
  | 'prompt_changed' | 'model_changed' | 'tool_changed' | 'data_changed'
  | 'permission_changed' | 'uat_requested' | 'deployment_requested'
  | 'incident_reported' | 'scheduled_review';

export async function emitLifecycleEvent(params: {
  projectId: string;
  eventType: LifecycleEventType;
  idempotencyKey: string;
  agentKey?: AgentId;
  tokensUsed?: number;
  contextChars?: number;
  context: AgentPromptContext;
}): Promise<void> {
  const contexts = Object.fromEntries(
    (['tokenOptimizer', 'aiGovernance'] as AgentId[]).map((id) => {
      const def = AGENT_DEFINITIONS[id];
      return [id, { systemPrompt: def.systemPrompt, userPrompt: def.buildUserPrompt(params.context) }];
    }),
  );
  const auth = await getAuthHeader();
  const response = await fetch(API_URL + '/lifecycle-events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify({
      project_id: params.projectId,
      event_type: params.eventType,
      idempotency_key: params.idempotencyKey,
      agent_key: params.agentKey,
      tokens_used: params.tokensUsed,
      context_chars: params.contextChars,
      contexts,
    }),
  });
  if (!response.ok) throw new Error('Lifecycle event enqueue failed: ' + response.status);
}
