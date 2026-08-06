/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getProject,
  updateProject,
  deleteProject,
  subscribeProjectRepositoryChange,
} from '@/db/projectRepository';
import type { Project } from '@/types/project.types';

export function useProject(projectId: string) {
  const [project, setProject] = useState<Project | undefined>();
  const [loading, setLoading] = useState(true);
  // True only for brief, in-place background refetches of already-loaded
  // data (e.g. every agent-run status update firing
  // subscribeProjectRepositoryChange during a pipeline run) -- as opposed
  // to `loading`, which is only for the genuine first load. Consumers
  // should keep rendering existing content through a `refreshing` state
  // (at most showing a small non-blocking indicator) rather than swapping
  // to a full loading screen -- doing the latter on every single
  // background refresh was the actual cause of ProjectWorkspace visibly
  // flickering throughout agent execution.
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasLoadedOnce = useRef(false);

  const refresh = useCallback(async () => {
    if (hasLoadedOnce.current) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const next = await getProject(projectId);
      setProject(next);
      hasLoadedOnce.current = true;
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [projectId]);

  useEffect(() => {
    // Switching to a different project is a genuine fresh load, not a
    // background refresh of the one already on screen.
    hasLoadedOnce.current = false;
    setProject(undefined);
    refresh();
    return subscribeProjectRepositoryChange((changedProjectId) => {
      if (!changedProjectId || changedProjectId === projectId) {
        refresh();
      }
    });
  }, [projectId, refresh]);

  async function save(updater: (p: Project) => void) {
    await updateProject(projectId, updater);
  }

  /** Soft-deletes the project. Requires remarks and app-admin access
   * (enforced server-side) — see db/projectRepository.ts deleteProject(). */
  async function remove(remarks: string) {
    await deleteProject(projectId, remarks);
  }

  return { project, loading, refreshing, error, refresh, save, remove };
}
