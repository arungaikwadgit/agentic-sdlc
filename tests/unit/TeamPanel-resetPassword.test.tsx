// tests/unit/TeamPanel-resetPassword.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TeamPanel from '../../frontend/src/components/team/TeamPanel';
import type { Project, TeamMember } from '../../frontend/src/types/project.types';

vi.mock('../../frontend/src/db/projectRepository', () => ({
  updateProject: vi.fn(async () => undefined),
}));

vi.mock('../../frontend/src/services/api', () => ({
  getAuthHeader: vi.fn(async () => ({ Authorization: 'Bearer test-token' })),
}));

function makeMember(overrides: Partial<TeamMember> = {}): TeamMember {
  return {
    id: 'm1',
    name: 'Jane Doe',
    email: 'jane@example.com',
    role: 'Engineer',
    appRole: 'editor',
    avatarColor: '#4f46e5',
    isAdmin: false,
    inviteStatus: 'accepted',
    invitedAt: Date.now(),
    ...overrides,
  } as TeamMember;
}

function makeProject(members: TeamMember[]): Project {
  return {
    id: 'proj-1',
    name: 'Test Project',
    teamMembers: members,
    agentAssignments: [],
  } as unknown as Project;
}

describe('TeamPanel — admin-triggered password reset', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    Object.assign(navigator, { clipboard: { writeText: vi.fn() } });
  });

  it('shows a "Reset password" button for a non-revoked member', () => {
    render(<TeamPanel project={makeProject([makeMember()])} onClose={vi.fn()} />);
    expect(screen.getByTitle("Reset this member's password")).toBeInTheDocument();
  });

  it('does not show "Reset password" for a revoked member', () => {
    render(<TeamPanel project={makeProject([makeMember({ inviteStatus: 'revoked' })])} onClose={vi.fn()} />);
    expect(screen.queryByTitle("Reset this member's password")).not.toBeInTheDocument();
  });

  it('asks for confirmation before resetting, and does nothing if declined', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    global.fetch = vi.fn() as unknown as typeof fetch;
    render(<TeamPanel project={makeProject([makeMember()])} onClose={vi.fn()} />);

    await userEvent.click(screen.getByTitle("Reset this member's password"));

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('calls POST /invite/reset-password and shows the returned password in a banner', async () => {
    global.fetch = vi.fn(async () => ({
      json: async () => ({ ok: true, password: 'jane_090726x7z', emailSent: true }),
    })) as unknown as typeof fetch;

    render(<TeamPanel project={makeProject([makeMember()])} onClose={vi.fn()} />);

    await userEvent.click(screen.getByTitle("Reset this member's password"));

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/invite/reset-password'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          projectId: 'proj-1',
          projectName: 'Test Project',
          email: 'jane@example.com',
        }),
      })
    );

    expect(await screen.findByDisplayValue('jane_090726x7z')).toBeInTheDocument();
  });

  it('shows an alert when the reset request fails', async () => {
    global.fetch = vi.fn(async () => ({
      json: async () => ({ ok: false, error: 'No team member found with that email on this project.' }),
    })) as unknown as typeof fetch;

    render(<TeamPanel project={makeProject([makeMember()])} onClose={vi.fn()} />);

    await userEvent.click(screen.getByTitle("Reset this member's password"));

    expect(await vi.waitFor(() => window.alert)).toHaveBeenCalledWith(
      expect.stringContaining('No team member found')
    );
  });
});
