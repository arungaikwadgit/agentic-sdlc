import { importProjects } from '@/db/projectRepository';
import type { Project } from '@/types/project.types';

const LEGACY_DB_NAME = 'AgenticSDLC';
const LEGACY_STORE_NAME = 'projects';
const IMPORT_MARKER_KEY = 'sdlc:legacy-project-import:v1';

function canUseIndexedDb(): boolean {
  return typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined';
}

async function legacyDatabaseExists(): Promise<boolean> {
  if (!canUseIndexedDb()) return false;
  const dbs = (window.indexedDB as IDBFactory & {
    databases?: () => Promise<Array<{ name?: string }>>;
  }).databases;
  if (typeof dbs !== 'function') return false;
  const list = await dbs.call(window.indexedDB);
  return list.some((db) => db.name === LEGACY_DB_NAME);
}

async function readLegacyProjects(): Promise<Project[]> {
  if (!(await legacyDatabaseExists())) return [];

  return new Promise<Project[]>((resolve, reject) => {
    const request = window.indexedDB.open(LEGACY_DB_NAME);

    request.onerror = () => reject(request.error ?? new Error('Failed to open legacy project database'));
    request.onupgradeneeded = () => {
      request.transaction?.abort();
      resolve([]);
    };
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(LEGACY_STORE_NAME)) {
        db.close();
        resolve([]);
        return;
      }

      const tx = db.transaction(LEGACY_STORE_NAME, 'readonly');
      const store = tx.objectStore(LEGACY_STORE_NAME);
      const getAll = store.getAll();

      getAll.onerror = () => {
        db.close();
        reject(getAll.error ?? new Error('Failed to read legacy projects'));
      };

      getAll.onsuccess = () => {
        const rows = Array.isArray(getAll.result) ? getAll.result : [];
        db.close();
        resolve(rows as Project[]);
      };
    };
  });
}

function isProjectLike(value: unknown): value is Project {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.id === 'string' &&
    typeof obj.name === 'string' &&
    typeof obj.description === 'string' &&
    typeof obj.domain === 'string'
  );
}

function normalizeLegacyProject(project: Project): Project {
  return {
    ...project,
    teamMembers: Array.isArray(project.teamMembers) ? project.teamMembers : [],
    agentAssignments: Array.isArray(project.agentAssignments) ? project.agentAssignments : [],
    promptOverrides: Array.isArray(project.promptOverrides) ? project.promptOverrides : [],
    agentRuns: project.agentRuns ?? {},
    reviewGates: project.reviewGates ?? {},
    mode: project.mode ?? 'simple',
    version: typeof project.version === 'number' ? project.version : 1,
    createdAt: typeof project.createdAt === 'number' ? project.createdAt : Date.now(),
    updatedAt: typeof project.updatedAt === 'number' ? project.updatedAt : Date.now(),
  };
}

export async function importLegacyProjectsIfNeeded(existingProjectCount: number): Promise<number> {
  if (existingProjectCount > 0) return 0;
  if (typeof window === 'undefined') return 0;
  if (window.localStorage.getItem(IMPORT_MARKER_KEY) === 'done') return 0;

  const legacyProjects = (await readLegacyProjects())
    .filter(isProjectLike)
    .map(normalizeLegacyProject);

  if (legacyProjects.length === 0) {
    window.localStorage.setItem(IMPORT_MARKER_KEY, 'done');
    return 0;
  }

  await importProjects(JSON.stringify({
    version: 1,
    exportedAt: Date.now(),
    projects: legacyProjects,
  }));

  window.localStorage.setItem(IMPORT_MARKER_KEY, 'done');
  return legacyProjects.length;
}
