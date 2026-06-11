// tests/unit/GithubPushModal.test.tsx
// Component tests for components/documents/GithubPushModal.tsx — credential
// loading, parsed-issue preview, selection, and push flows.
// Covers TS-156 through TS-165 from
// docs/test-plans/document-export-github-test-plan.md.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Project } from '../../frontend/src/types/project.types';
import type { GithubCredentials } from '../../frontend/src/types/integration.types';
import type { GithubPushResult } from '../../frontend/src/services/api';
import type { ParsedIssue } from '../../frontend/src/services/githubIssueParser';

// ── Mock @/services/api ──
const pushIssuesToGithubMock = vi.fn();
vi.mock('@/services/api', () => ({
  api: {
    pushIssuesToGithub: (...args: unknown[]) => pushIssuesToGithubMock(...args),
  },
}));

// ── Mock @/hooks/useIntegrations ──
const loadCredentialMock = vi.fn();
vi.mock('@/hooks/useIntegrations', () => ({
  useIntegrations: () => ({
    loadCredential: (...args: unknown[]) => loadCredentialMock(...args),
    saveCredential: vi.fn(),
    removeCredential: vi.fn(),
  }),
}));

// ── Mock @/services/githubIssueParser ──
const parseDocumentToIssuesMock = vi.fn();
vi.mock('@/services/githubIssueParser', () => ({
  parseDocumentToIssues: (...args: unknown[]) => parseDocumentToIssuesMock(...args),
}));

// Import after mocks are registered.
import GithubPushModal from '../../frontend/src/components/documents/GithubPushModal';

function baseProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj-1',
    name: 'Acme Retail',
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
    teamMembers: [],
    agentAssignments: [],
    ...overrides,
  } as Project;
}

const CREDS: GithubCredentials = { token: 'gh-token', owner: 'acme', repo: 'retail-app' };

function makeIssue(overrides: Partial<ParsedIssue> = {}): ParsedIssue {
  return {
    title: 'Implement feature',
    body: 'Some body text',
    labels: ['backend'],
    ...overrides,
  } as ParsedIssue;
}

const MARKDOWN = '## Backend Tasks\n1. Title: Implement feature\n   Some body text.\n';

describe('GithubPushModal', () => {
  beforeEach(() => {
    pushIssuesToGithubMock.mockReset();
    loadCredentialMock.mockReset();
    parseDocumentToIssuesMock.mockReset();
  });

  it('shows a configuration error and disables Push when githubIntegrationId is missing (TS-156)', async () => {
    const project = baseProject({ githubIntegrationId: undefined });
    render(
      <GithubPushModal project={project} markdown={MARKDOWN} sourceLabel="Sprint Plan" onClose={vi.fn()} />,
    );

    await waitFor(() => {
      expect(screen.getByText('⚠ No GitHub integration configured for this project.')).toBeInTheDocument();
    });

    expect(loadCredentialMock).not.toHaveBeenCalled();
    expect(parseDocumentToIssuesMock).not.toHaveBeenCalled();

    const pushButton = screen.getByRole('button', { name: /push/i });
    expect(pushButton).toBeDisabled();
  });

  it('shows a reconnect error and disables Push when loadCredential resolves null (TS-157)', async () => {
    loadCredentialMock.mockResolvedValue(null);
    const project = baseProject({ githubIntegrationId: 'gh-int-1' });
    render(
      <GithubPushModal project={project} markdown={MARKDOWN} sourceLabel="Sprint Plan" onClose={vi.fn()} />,
    );

    await waitFor(() => {
      expect(
        screen.getByText('⚠ Saved GitHub connection could not be loaded. Reconnect it in Settings.'),
      ).toBeInTheDocument();
    });

    expect(parseDocumentToIssuesMock).not.toHaveBeenCalled();
    const pushButton = screen.getByRole('button', { name: /push/i });
    expect(pushButton).toBeDisabled();
  });

  it('renders all parsed issues pre-checked and shows the source -> owner/repo header (TS-158)', async () => {
    loadCredentialMock.mockResolvedValue(CREDS);
    const issues = [
      makeIssue({ title: 'Issue One' }),
      makeIssue({ title: 'Issue Two' }),
      makeIssue({ title: 'Issue Three' }),
    ];
    parseDocumentToIssuesMock.mockReturnValue(issues);

    const project = baseProject({ githubIntegrationId: 'gh-int-1' });
    render(
      <GithubPushModal project={project} markdown={MARKDOWN} sourceLabel="Sprint Plan" onClose={vi.fn()} />,
    );

    await waitFor(() => {
      expect(screen.getByText('Issue One')).toBeInTheDocument();
    });
    expect(screen.getByText('Issue Two')).toBeInTheDocument();
    expect(screen.getByText('Issue Three')).toBeInTheDocument();

    // All checkboxes pre-checked: 1 "select all" + 3 issue checkboxes = 4.
    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(checkboxes).toHaveLength(4);
    checkboxes.forEach((cb) => expect(cb.checked).toBe(true));

    expect(screen.getByText('Sprint Plan → acme/retail-app')).toBeInTheDocument();
    expect(screen.getByText(/3 of 3 selected/)).toBeInTheDocument();
  });

  it('unchecking one issue updates the count, and "select all" toggle re-selects everything (TS-159)', async () => {
    loadCredentialMock.mockResolvedValue(CREDS);
    const issues = [
      makeIssue({ title: 'Issue One' }),
      makeIssue({ title: 'Issue Two' }),
      makeIssue({ title: 'Issue Three' }),
    ];
    parseDocumentToIssuesMock.mockReturnValue(issues);

    const project = baseProject({ githubIntegrationId: 'gh-int-1' });
    render(
      <GithubPushModal project={project} markdown={MARKDOWN} sourceLabel="Sprint Plan" onClose={vi.fn()} />,
    );

    await waitFor(() => {
      expect(screen.getByText('Issue One')).toBeInTheDocument();
    });

    const user = userEvent.setup();
    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    const [selectAllCheckbox, firstIssueCheckbox] = checkboxes;

    await user.click(firstIssueCheckbox);
    expect(screen.getByText(/2 of 3 selected/)).toBeInTheDocument();
    expect(selectAllCheckbox.checked).toBe(false);

    await user.click(selectAllCheckbox);
    await waitFor(() => {
      expect(screen.getByText(/3 of 3 selected/)).toBeInTheDocument();
    });
    const refreshedCheckboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    refreshedCheckboxes.forEach((cb) => expect(cb.checked).toBe(true));
  });

  it('pushes only the selected issues and renders a success result list with links (TS-160)', async () => {
    loadCredentialMock.mockResolvedValue(CREDS);
    const issues = [
      makeIssue({ title: 'Issue One', body: 'Body one', labels: ['backend'] }),
      makeIssue({ title: 'Issue Two', body: 'Body two', labels: ['frontend'] }),
      makeIssue({ title: 'Issue Three', body: 'Body three', labels: ['sprint'] }),
    ];
    parseDocumentToIssuesMock.mockReturnValue(issues);

    const result: GithubPushResult = {
      created: 2,
      total: 2,
      results: [
        { title: 'Issue One', ok: true, number: 101, url: 'https://github.com/acme/retail-app/issues/101' },
        { title: 'Issue Three', ok: true, number: 103, url: 'https://github.com/acme/retail-app/issues/103' },
      ],
    };
    pushIssuesToGithubMock.mockResolvedValue(result);

    const project = baseProject({ githubIntegrationId: 'gh-int-1' });
    render(
      <GithubPushModal project={project} markdown={MARKDOWN} sourceLabel="Sprint Plan" onClose={vi.fn()} />,
    );

    await waitFor(() => {
      expect(screen.getByText('Issue One')).toBeInTheDocument();
    });

    const user = userEvent.setup();
    // Uncheck "Issue Two" (the second issue checkbox, after the select-all checkbox).
    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    await user.click(checkboxes[2]); // index 0 = select-all, 1 = Issue One, 2 = Issue Two

    expect(screen.getByText(/2 of 3 selected/)).toBeInTheDocument();

    const pushButton = screen.getByRole('button', { name: /push 2 issues/i });
    await user.click(pushButton);

    await waitFor(() => {
      expect(pushIssuesToGithubMock).toHaveBeenCalledTimes(1);
    });
    expect(pushIssuesToGithubMock).toHaveBeenCalledWith({
      ...CREDS,
      issues: [
        { title: 'Issue One', body: 'Body one', labels: ['backend'] },
        { title: 'Issue Three', body: 'Body three', labels: ['sprint'] },
      ],
    });

    await waitFor(() => {
      expect(screen.getByText('Created 2 of 2 issues.')).toBeInTheDocument();
    });

    const link101 = screen.getByRole('link', { name: '#101 Issue One' });
    expect(link101).toHaveAttribute('href', 'https://github.com/acme/retail-app/issues/101');
    const link103 = screen.getByRole('link', { name: '#103 Issue Three' });
    expect(link103).toHaveAttribute('href', 'https://github.com/acme/retail-app/issues/103');
  });

  it('renders a failed push result with the error message (TS-161)', async () => {
    loadCredentialMock.mockResolvedValue(CREDS);
    const issues = [makeIssue({ title: 'Issue One', body: 'Body one', labels: ['backend'] })];
    parseDocumentToIssuesMock.mockReturnValue(issues);

    const result: GithubPushResult = {
      created: 0,
      total: 1,
      results: [
        { title: 'Issue One', ok: false, error: 'Validation failed' },
      ],
    };
    pushIssuesToGithubMock.mockResolvedValue(result);

    const project = baseProject({ githubIntegrationId: 'gh-int-1' });
    render(
      <GithubPushModal project={project} markdown={MARKDOWN} sourceLabel="Sprint Plan" onClose={vi.fn()} />,
    );

    await waitFor(() => {
      expect(screen.getByText('Issue One')).toBeInTheDocument();
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /push 1 issue/i }));

    await waitFor(() => {
      expect(screen.getByText('Issue One — Validation failed')).toBeInTheDocument();
    });
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('shows pushError and no result list when pushIssuesToGithub rejects (TS-162)', async () => {
    loadCredentialMock.mockResolvedValue(CREDS);
    const issues = [makeIssue({ title: 'Issue One' })];
    parseDocumentToIssuesMock.mockReturnValue(issues);

    pushIssuesToGithubMock.mockRejectedValue(new Error('Network error'));

    const project = baseProject({ githubIntegrationId: 'gh-int-1' });
    render(
      <GithubPushModal project={project} markdown={MARKDOWN} sourceLabel="Sprint Plan" onClose={vi.fn()} />,
    );

    await waitFor(() => {
      expect(screen.getByText('Issue One')).toBeInTheDocument();
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /push 1 issue/i }));

    await waitFor(() => {
      expect(screen.getByText('⚠ Network error')).toBeInTheDocument();
    });
    expect(screen.queryByText(/^Created/)).not.toBeInTheDocument();
  });

  it('blocks the push and sets a cap-exceeded error when more than 50 issues are selected (TS-163)', async () => {
    loadCredentialMock.mockResolvedValue(CREDS);
    const issues = Array.from({ length: 51 }, (_, i) => makeIssue({ title: `Issue ${i + 1}` }));
    parseDocumentToIssuesMock.mockReturnValue(issues);

    const project = baseProject({ githubIntegrationId: 'gh-int-1' });
    render(
      <GithubPushModal project={project} markdown={MARKDOWN} sourceLabel="Sprint Plan" onClose={vi.fn()} />,
    );

    await waitFor(() => {
      expect(screen.getByText(/51 of 51 selected/)).toBeInTheDocument();
    });
    expect(screen.getByText(/\(max 50 per push\)/)).toBeInTheDocument();

    const user = userEvent.setup();
    const pushButton = screen.getByRole('button', { name: /push 51 issues/i });
    await user.click(pushButton);

    await waitFor(() => {
      expect(screen.getByText('⚠ Select 50 or fewer issues per push (51 selected).')).toBeInTheDocument();
    });
    expect(pushIssuesToGithubMock).not.toHaveBeenCalled();
  });

  it('shows the empty-state message and disables Push when no issues are parsed (TS-164)', async () => {
    loadCredentialMock.mockResolvedValue(CREDS);
    parseDocumentToIssuesMock.mockReturnValue([]);

    const project = baseProject({ githubIntegrationId: 'gh-int-1' });
    render(
      <GithubPushModal project={project} markdown={MARKDOWN} sourceLabel="Sprint Plan" onClose={vi.fn()} />,
    );

    await waitFor(() => {
      expect(
        screen.getByText(/No tasks could be parsed from this document/),
      ).toBeInTheDocument();
    });

    const pushButton = screen.getByRole('button', { name: /push 0 issues/i });
    expect(pushButton).toBeDisabled();
  });

  it('invokes onClose when Cancel/Close is clicked (TS-165)', async () => {
    loadCredentialMock.mockResolvedValue(CREDS);
    parseDocumentToIssuesMock.mockReturnValue([makeIssue({ title: 'Issue One' })]);

    const onClose = vi.fn();
    const project = baseProject({ githubIntegrationId: 'gh-int-1' });
    render(
      <GithubPushModal project={project} markdown={MARKDOWN} sourceLabel="Sprint Plan" onClose={onClose} />,
    );

    await waitFor(() => {
      expect(screen.getByText('Issue One')).toBeInTheDocument();
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalledTimes(1);

    // Also verify the header close (✕) button invokes onClose.
    onClose.mockClear();
    await user.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
