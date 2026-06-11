import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/database';
import { updateProject, deleteProject } from '@/db/projectRepository';
import type { Project } from '@/types/project.types';

export function useProject(projectId: string) {
  const project = useLiveQuery<Project | undefined>(
    () => db.projects.get(projectId),
    [projectId]
  );

  async function save(updater: (p: Project) => void) {
    await updateProject(projectId, updater);
  }

  async function remove() {
    await deleteProject(projectId);
  }

  return { project, save, remove };
}
