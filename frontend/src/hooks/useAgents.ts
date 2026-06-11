import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/database';
import { PHASE_ORDER, PHASE_AGENTS, PHASE_LABELS } from '@/agents/constants';
import { AGENT_DEFINITIONS } from '@/agents/definitions';
import type { AgentId, AgentRun, PhaseId } from '@/types/agent.types';

export interface AgentWithStatus {
  id: AgentId;
  name: string;
  phase: PhaseId;
  outputLabel: string;
  run: AgentRun | undefined;
}

export interface PhaseWithAgents {
  id: PhaseId;
  label: string;
  agents: AgentWithStatus[];
  allComplete: boolean;
  anyRunning: boolean;
  anyError: boolean;
}

export function useAgents(projectId: string): PhaseWithAgents[] {
  const project = useLiveQuery(() => db.projects.get(projectId), [projectId]);

  return useMemo(() => {
    if (!project) return [];

    return PHASE_ORDER.map((phase) => {
      const agentIds = PHASE_AGENTS[phase];
      const agents: AgentWithStatus[] = agentIds.map((id) => ({
        id,
        name: AGENT_DEFINITIONS[id]?.name ?? id,
        phase,
        outputLabel: AGENT_DEFINITIONS[id]?.outputLabel ?? id,
        run: project.agentRuns[id],
      }));

      return {
        id: phase,
        label: PHASE_LABELS[phase],
        agents,
        allComplete: agents.every((a) => a.run?.status === 'complete'),
        anyRunning: agents.some((a) => a.run?.status === 'running'),
        anyError: agents.some((a) => a.run?.status === 'error'),
      };
    });
  }, [project]);
}
