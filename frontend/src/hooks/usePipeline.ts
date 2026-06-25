/**
 * © 2025 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
import { useRef, useState, useCallback } from 'react';
import { PipelineEngine } from '@/services/pipelineEngine';
import { updateProject } from '@/db/projectRepository';
import type { PhaseId } from '@/types/agent.types';
import type { ReviewGateId } from '@/types/project.types';

export interface PipelineState {
  running: boolean;
  pendingGate: ReviewGateId | null;
}

export function usePipeline(projectId: string, mode: 'simple' | 'expert') {
  const engineRef = useRef<PipelineEngine | null>(null);
  const [running, setRunning] = useState(false);
  const [pendingGate, setPendingGate] = useState<ReviewGateId | null>(null);

  const start = useCallback(async (fromPhase?: PhaseId) => {
    setRunning(true);
    setPendingGate(null);

    const engine = new PipelineEngine(projectId, {
      onAgentStart: () => {},
      onAgentComplete: () => {},
      onAgentError: () => {},
      onPhaseComplete: () => {},
      onGateReached: (_gateId) => {
        // Always pause for human review — mode does not affect gate behaviour
        setPendingGate(_gateId);
        setRunning(false);
      },
      onPipelineComplete: () => setRunning(false),
      onPipelineError: () => setRunning(false),
    });

    engineRef.current = engine;
    await engine.run(fromPhase);
  }, [projectId, mode]);

  const stop = useCallback(() => {
    engineRef.current?.abort();
    setRunning(false);
    updateProject(projectId, (p) => { p.status = 'paused'; });
  }, [projectId]);

  const approveGate = useCallback(async (gateId: ReviewGateId, notes: string, approvedBy?: string, fromPhase?: PhaseId) => {
    await updateProject(projectId, (p) => {
      p.reviewGates[gateId] = {
        id: gateId,
        afterPhases: [],
        approved: true,
        approvedAt: Date.now(),
        approvedBy,
        notes,
      };
    });
    setPendingGate(null);
    setRunning(true);
    start(fromPhase);
  }, [projectId, start]);

  const rejectGate = useCallback(() => {
    setPendingGate(null);
    setRunning(false);
    updateProject(projectId, (p) => { p.status = 'paused'; });
  }, [projectId]);

  return { running, pendingGate, start, stop, approveGate, rejectGate };
}
