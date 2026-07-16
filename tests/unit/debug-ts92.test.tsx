import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Project } from '../../frontend/src/types/project.types';

vi.mock('../../frontend/src/contexts/AuthContext', () => ({
  useAuth: () => ({ user: null, adminMode: true }),
}));
vi.mock('../../frontend/src/contexts/AlertContext', () => ({
  useAlert: () => ({ showAlert: vi.fn() }),
}));

vi.mock('../../frontend/src/db/database', () => ({
  db: {
    projects: { get: vi.fn(), put: vi.fn(), add: vi.fn(), delete: vi.fn(), bulkPut: vi.fn(), toArray: vi.fn(async () => []), orderBy: vi.fn(() => ({ reverse: () => ({ toArray: async () => [] }) })) },
    settings: { get: vi.fn(async () => undefined), put: vi.fn(async () => undefined) },
    integrations: { toArray: vi.fn(async () => []), get: vi.fn(), put: vi.fn(), delete: vi.fn() },
    transaction: vi.fn(async (_mode: string, _table: unknown, fn: () => Promise<unknown>) => fn()),
  },
}));
vi.mock('../../frontend/src/db/projectRepository', () => ({
  updateProject: vi.fn(async () => {}),
  checkIsAppAdmin: vi.fn(async () => true),
}));
vi.mock('../../frontend/src/services/api', () => ({ api: { callAgent: vi.fn(), extractText: vi.fn(), generateDomainKnowledge: vi.fn(), generateBrandingGuidelines: vi.fn(), fetchSiteBranding: vi.fn(), testGithubConnection: vi.fn() } }));
vi.mock('../../frontend/src/hooks/useIntegrations', () => ({ useIntegrations: () => ({ integrations: [], saveCredential: vi.fn(), loadCredential: vi.fn(async () => null), removeCredential: vi.fn() }) }));

import ProjectSettings from '../../frontend/src/components/settings/ProjectSettings';

const ADMIN_MEMBER = { id: 'member-admin', name: 'Alice Admin', email: 'alice@example.com', role: 'Product Manager', avatarColor: '#4f46e5', isAdmin: true, inviteStatus: 'accepted' as const };
const NON_ADMIN_MEMBER = { id: 'member-dev', name: 'Dev Dave', email: 'dave@example.com', role: 'Engineer', avatarColor: '#0891b2', isAdmin: false, inviteStatus: 'accepted' as const };

describe('debug TS-92 selector', () => {
  it('shows class structure', () => {
    const project: Project = {
      id: 'proj-1', name: 'Demo', description: '', domain: 'fintech', status: 'draft',
      version: 1, createdAt: 1000, updatedAt: 1000, agentRuns: {}, reviewGates: {},
      promptOverrides: [], mode: 'simple',
      agentAssignments: [{ agentId: 'brd' as const, memberIds: [ADMIN_MEMBER.id, NON_ADMIN_MEMBER.id] }],
      teamMembers: [ADMIN_MEMBER, NON_ADMIN_MEMBER],
      activeAdminId: ADMIN_MEMBER.id,
    };
    const { container } = render(<ProjectSettings project={project} onClose={vi.fn()} />);
    const daveName = screen.getAllByText('Dev Dave')[0];
    // Log class hierarchy from text to root
    let el: Element | null = daveName;
    const hierarchy: string[] = [];
    while (el && el !== container) {
      hierarchy.push(`${el.tagName}[${el.className}]`);
      el = el.parentElement;
    }
    console.log('CLASS HIERARCHY from "Dev Dave" up:');
    hierarchy.forEach((h, i) => console.log(`  ${i}: ${h}`));

    // Try the selector the test uses
    const bySubstr = daveName.closest('div[class*="memberCard"]');
    console.log('closest("div[class*=memberCard]") class:', bySubstr?.className);

    // Try a better selector
    const byGrid = daveName.closest('[class*="memberGrid"] > div');
    console.log('closest("[class*=memberGrid] > div") class:', byGrid?.className);
    expect(bySubstr ?? byGrid).not.toBeNull();
  });
});
