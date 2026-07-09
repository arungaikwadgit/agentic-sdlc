// tests/unit/TeamPanel-resetPassword.test.tsx
// Covers the new admin-triggered "Reset password" action in TeamPanel.tsx,
// which calls POST /api/invite/reset-password and displays the returned
// password to the admin (mirrors the existing invite-send password banner).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Project } from '../../frontend/src/types/project.types';

const updateProjectMock = vi.fn(async () => undefined);
vi.mock('../../frontend/src/db/projectRepository', () => ({
  updateProject: (...args: unknown[]) => updateProjectMock(...args),
}));

vi.mock('../../frontend/src/services/api', () => ({
  getAuthHeader: vi.fn(async () => ({ Authorization: 'Bearer test-token' })),
}));

import TeamPanel from '../../frontend/src/components/team/TeamPanel';

function baseProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj-1',
    name: 'Demo Project',
    description: 'A project for testing',
    domain: 'fintech',
    status: 'draft',
    version: 1,
    createdAt: 1000,
    updatedAt: 1000,
    agentRuns: {},
    reviewGates: {},
    promptOverrides: [],
    mode: 'simple',
    teamMembers: [
      {
        id: 'member-1',
        name: 'Dev Dave',
        email: 'dave@example.com',
        role: 'Engineer',
        appRole: 'editor',
        avatarColor: '#0891b2',
        isAdmin: false,
        inviteStatus: 'accepted',
      },
    ],
    agentAssignments: [],
    ...overrides,
  } as Project;
}

describe('TeamPanel — admin-triggered password reset', () => {
  beforeEach(() => {
    updateProjectMock.mockClear();
    window.confirm = vi.fn(() => true);
    window.alert = vi.fn();
    Object.assign(navigator, { clipboard: { writeText: vi.fn() } });
  });

  it('shows a "Reset password" button for an accepted member', () => {
    render(<TeamPanel project={baseProject()} onClose={vi.fn()} />);
    expect(screen.getByTitle('Generate a new sign-in password for this member')).toBeInTheDocument();
  });

  it('confirms, calls the reset endpoint, and displays the returned password', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      json: async () => ({ ok: true, password: 'dave_080726x9z', emailSent: true }),
    } as Response)));

    const user = userEvent.setup();
    render(<TeamPanel project={baseProject()} onClose={vi.fn()} />);

    await user.click(screen.getByTitle('Generate a new sign-in password for this member'));

    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/invite/reset-password'),
      expect.objectContaining({ method: 'POST' })
    ));

    expect(await screen.findByDisplayValue('dave_080726x9z')).toBeInTheDocument();
  });

  it('does not call the reset endpoint when the admin cancels the confirm dialog', async () => {
    window.confirm = vi.fn(() => false);
    vi.stubGlobal('fetch', vi.fn());

    const user = userEvent.setup();
    render(<TeamPanel project={baseProject()} onClose={vi.fn()} />);

    await user.click(screen.getByTitle('Generate a new sign-in password for this member'));

    expect(fetch).not.toHaveBeenCalled();
  });

  it('alerts on a failed reset instead of showing a password', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      json: async () => ({ error: 'This person is not a team member on this project.' }),
    } as Response)));

    const user = userEvent.setup();
    render(<TeamPanel project={baseProject()} onClose={vi.fn()} />);

    await user.click(screen.getByTitle('Generate a new sign-in password for this member'));

    await waitFor(() => expect(window.alert).toHaveBeenCalledWith(
      expect.stringContaining('This person is not a team member on this project.')
    ));
  });

  it('does not show "Reset password" for a revoked member', () => {
    render(<TeamPanel project={baseProject({
      teamMembers: [{
        id: 'member-2', name: 'Ex Employee', email: 'ex@example.com', role: 'Engineer',
        appRole: 'viewer', avatarColor: '#000', isAdmin: false, inviteStatus: 'revoked',
      }],
    })} onClose={vi.fn()} />);

    expect(screen.queryByTitle('Generate a new sign-in password for this member')).not.toBeInTheDocument();
  });
});
