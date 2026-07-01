/**
 * © 2025 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
import { useCallback, useEffect, useState } from 'react';
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
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await getProject(projectId);
      setProject(next);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
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

  async function remove() {
    await deleteProject(projectId);
  }

  return { project, loading, error, refresh, save, remove };
}
