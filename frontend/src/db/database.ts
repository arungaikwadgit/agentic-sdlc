import Dexie, { type Table } from 'dexie';
import type { Project } from '@/types/project.types';
import type { IntegrationCredential } from '@/types/integration.types';

export interface AppSettings {
  key: string;
  value: unknown;
}

export class AppDatabase extends Dexie {
  projects!: Table<Project, string>;
  integrations!: Table<IntegrationCredential, string>;
  settings!: Table<AppSettings, string>;

  constructor() {
    super('AgenticSDLC');

    this.version(1).stores({
      projects: 'id, domain, status, createdAt, updatedAt',
      integrations: 'id, provider',
      settings: 'key',
    });

    // v2: add teamMembers and agentAssignments arrays
    this.version(2).stores({
      projects: 'id, domain, status, createdAt, updatedAt',
      integrations: 'id, provider',
      settings: 'key',
    }).upgrade((tx) => {
      return tx.table('projects').toCollection().modify((p) => {
        if (!p.teamMembers) p.teamMembers = [];
        if (!p.agentAssignments) p.agentAssignments = [];
      });
    });

    // v3: isAdmin on members, memberIds[] on assignments (many-to-many)
    this.version(3).stores({
      projects: 'id, domain, status, createdAt, updatedAt',
      integrations: 'id, provider',
      settings: 'key',
    }).upgrade((tx) => {
      return tx.table('projects').toCollection().modify((p) => {
        // Add isAdmin to existing members (first member becomes admin)
        if (Array.isArray(p.teamMembers)) {
          p.teamMembers = p.teamMembers.map((m: any, i: number) => ({
            ...m,
            isAdmin: m.isAdmin ?? (i === 0),
          }));
        }
        // Migrate single memberId → memberIds array
        if (Array.isArray(p.agentAssignments)) {
          p.agentAssignments = p.agentAssignments.map((a: any) => ({
            agentId: a.agentId,
            memberIds: a.memberIds ?? (a.memberId ? [a.memberId] : []),
          }));
        }
      });
    });

    // v4: add domainKnowledge string field to projects
    this.version(4).stores({
      projects: 'id, domain, status, createdAt, updatedAt',
      integrations: 'id, provider',
      settings: 'key',
    }).upgrade((tx) => {
      return tx.table('projects').toCollection().modify((p) => {
        if (p.domainKnowledge === undefined) p.domainKnowledge = null;
      });
    });
  }
}

export const db = new AppDatabase();
