/**
 * © 2025 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */

import Dexie, { type Table } from 'dexie';
import type { Project } from '@/types/project.types';
import type { IntegrationCredential } from '@/types/integration.types';
import type { ProjectDocument } from '@/types/extraction.types';

export interface AppSettings {
  key: string;
  value: unknown;
}

export class AppDatabase extends Dexie {
  projects!: Table<Project, string>;
  integrations!: Table<IntegrationCredential, string>;
  settings!: Table<AppSettings, string>;
  projectDocuments!: Table<ProjectDocument, string>;

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
        if (Array.isArray(p.teamMembers)) {
          // Pre-v3 records predate the `isAdmin` field, so these are raw,
          // loosely-shaped legacy rows rather than well-typed TeamMember objects.
          p.teamMembers = p.teamMembers.map((m: any, i: number) => ({
            ...m,
            isAdmin: m.isAdmin ?? (i === 0),
          }));
        }
        if (Array.isArray(p.agentAssignments)) {
          // Pre-v3 records used a single `memberId`; this migrates them to `memberIds[]`.
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

    // v5: split the combined gate2_3 review gate into separate gate2 and gate3
    this.version(5).stores({
      projects: 'id, domain, status, createdAt, updatedAt',
      integrations: 'id, provider',
      settings: 'key',
    }).upgrade((tx) => {
      return tx.table('projects').toCollection().modify((p) => {
        const gates = p.reviewGates;
        const legacy = gates?.gate2_3;
        if (!legacy || !gates) return;
        if (!gates.gate2) {
          gates.gate2 = { ...legacy, id: 'gate2', afterPhases: ['phase2'] };
        }
        if (!gates.gate3) {
          gates.gate3 = { ...legacy, id: 'gate3', afterPhases: ['phase3'] };
        }
        delete gates.gate2_3;
      });
    });

    // v6: add projectDocuments table for document upload + extraction wizard
    this.version(6).stores({
      projects:         'id, domain, status, createdAt, updatedAt',
      integrations:     'id, provider',
      settings:         'key',
      projectDocuments: 'id, projectId, uploadedAt',
    }).upgrade((tx) => {
      return tx.table('projects').toCollection().modify((p) => {
        if (!p.sourceDocumentIds) p.sourceDocumentIds = [];
      });
    });
  }
}

export const db = new AppDatabase();

// M-07 fix: catch IndexedDB quota exceeded and private-browsing errors.
// Without this, Dexie failures surface as silent promise rejections or
// cryptic "UnknownError" messages. We surface a user-visible toast instead.
db.open().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  const isQuota  = /quota/i.test(msg) || (err as { name?: string })?.name === 'QuotaExceededError';
  const isBlock  = /blocked/i.test(msg);
  const isPrivate = /private/i.test(msg) || /access/i.test(msg);

  let userMsg = 'Storage error: could not open the local database.';
  if (isQuota)   userMsg = 'Storage full: please free up browser storage and reload.';
  if (isBlock)   userMsg = 'Database upgrade blocked — please close other tabs of this app and reload.';
  if (isPrivate) userMsg = 'Local storage unavailable — Private Browsing mode may block IndexedDB. Some features will not work.';

  // Show a non-dismissible banner rather than a transient toast so the user
  // actually sees it before attempting to do anything.
  const banner = document.createElement('div');
  banner.setAttribute('role', 'alert');
  banner.style.cssText = [
    'position:fixed;top:0;left:0;right:0;z-index:99999',
    'background:#b91c1c;color:#fff;padding:12px 16px',
    'font:14px/1.5 system-ui,sans-serif;text-align:center',
  ].join(';');
  banner.textContent = `⚠️ ${userMsg}`;
  document.body?.prepend(banner);

  console.error('[AppDatabase] Failed to open:', err);
});
