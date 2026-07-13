// tests/unit/InviteModal-agentPicker.test.tsx
// Unit tests for InviteModal's mandatory-agent-assignment picker (added
// 2026-07-11) — components/settings/ProjectSettings.tsx's InviteModal is a
// pure props-in/callback-out component (no context hooks), so it's tested
// directly here without mounting the rest of ProjectSettings.
//
// Covers:
//  - the agent picker only appears (and is only mandatory) for Editor invites
//  - a Job title matching a ROLE_TEMPLATES entry pre-checks its suggested agents
//  - a custom (non-template) Job title leaves the picker empty
//  - Send/Add & Send Invite stays disabled until >=1 agent is checked for Editor
//  - onSubmit receives the checked agentIds
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InviteModal } from '../../frontend/src/components/settings/ProjectSettings';
import type { AgentAssignment } from '../../frontend/src/types/project.types';

function setup(props: Partial<Parameters<typeof InviteModal>[0]> = {}) {
  const onSubmit = vi.fn();
  const onClose = vi.fn();
  const assignments: AgentAssignment[] = props.assignments ?? [];
  render(
    <InviteModal
      assignments={assignments}
      onSubmit={onSubmit}
      onClose={onClose}
      sending={false}
      {...props}
    />
  );
  return { onSubmit, onClose };
}

async function fillNameAndEmail(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByPlaceholderText('e.g. Jane Doe'), 'Nura Gaikwad');
  await user.type(screen.getByPlaceholderText('jane@company.com'), 'nura@example.com');
}

async function selectAppRole(user: ReturnType<typeof userEvent.setup>, role: string) {
  await user.selectOptions(screen.getByRole('combobox'), role);
}

describe('InviteModal — mandatory agent picker', () => {
  it('does not show the agent picker for the default (Viewer) role, and Send is enabled with no agents', async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup();
    await fillNameAndEmail(user);

    expect(screen.queryByText(/Agents this Editor can run/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Send Invite' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ agentIds: [] }));
  });

  it('shows the agent picker and disables Send with 0 agents once Access role is Editor', async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup();
    await fillNameAndEmail(user);
    await selectAppRole(user, 'editor');

    expect(await screen.findByText(/Agents this Editor can run/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send Invite' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Send Invite' }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('pre-checks a role template\'s suggested agents when Job title matches it (e.g. "Tech Lead")', async () => {
    const user = userEvent.setup();
    setup();
    await fillNameAndEmail(user);
    await selectAppRole(user, 'editor');
    await user.type(screen.getByPlaceholderText('e.g. Product Manager'), 'Tech Lead');

    // Tech Lead's suggestedAgents in roleTemplates.ts: architecture, apiDesign, dataModel, techDebt.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Send Invite' })).not.toBeDisabled();
    });
    const archCheckbox = screen.getByRole('checkbox', { name: /architecture/i });
    expect(archCheckbox).toBeChecked();
  });

  it('leaves the picker empty for a custom (non-template) Job title, keeping Send disabled', async () => {
    const user = userEvent.setup();
    setup();
    await fillNameAndEmail(user);
    await selectAppRole(user, 'editor');
    await user.type(screen.getByPlaceholderText('e.g. Product Manager'), 'Dev Lead');

    // "Dev Lead" matches no ROLE_TEMPLATES entry -- nothing should be pre-checked.
    expect(screen.getByRole('button', { name: 'Send Invite' })).toBeDisabled();
    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(checkboxes.every((cb) => !cb.checked)).toBe(true);
  });

  it('manually checking one agent for a custom role enables Send and is included in onSubmit', async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup();
    await fillNameAndEmail(user);
    await selectAppRole(user, 'editor');
    await user.type(screen.getByPlaceholderText('e.g. Product Manager'), 'Dev Lead');

    await user.click(screen.getByRole('checkbox', { name: /architecture/i }));
    expect(screen.getByRole('button', { name: 'Send Invite' })).not.toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Send Invite' }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ appRole: 'editor', jobRole: 'Dev Lead', agentIds: ['architecture'] })
    );
  });

  it('unchecking a pre-checked template suggestion sticks (does not reappear on further typing)', async () => {
    const user = userEvent.setup();
    setup();
    await fillNameAndEmail(user);
    await selectAppRole(user, 'editor');
    await user.type(screen.getByPlaceholderText('e.g. Product Manager'), 'Tech Lead');

    const archCheckbox = await screen.findByRole('checkbox', { name: /architecture/i });
    await waitFor(() => expect(archCheckbox).toBeChecked());
    await user.click(archCheckbox); // uncheck it
    expect(archCheckbox).not.toBeChecked();

    // Further edits to the (still-matching) Job title text must not re-check it.
    await user.type(screen.getByPlaceholderText('e.g. Product Manager'), ' ');
    expect(archCheckbox).not.toBeChecked();
  });

  it('seeds the picker from the existing assignment when resending an invite to an already-invited member', async () => {
    setup({
      existingMember: {
        id: 'editor-1',
        name: 'Nura Gaikwad',
        email: 'nura@example.com',
        role: 'Tech Lead',
        appRole: 'editor',
        avatarColor: '#fff',
        inviteStatus: 'pending',
      },
      assignments: [{ agentId: 'architecture' as never, memberIds: ['editor-1'] }],
    });

    const archCheckbox = await screen.findByRole('checkbox', { name: /architecture/i });
    expect(archCheckbox).toBeChecked();
    expect(screen.getByRole('button', { name: 'Resend Invite' })).not.toBeDisabled();
  });
});
