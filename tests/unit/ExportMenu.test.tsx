// tests/unit/ExportMenu.test.tsx
// Component tests for components/documents/ExportMenu.tsx — export menu
// state and wiring to documentExporter.
// Covers TS-151 through TS-155 from
// docs/test-plans/document-export-github-test-plan.md.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Project } from '../../frontend/src/types/project.types';
import { PHASE_ORDER } from '../../frontend/src/agents/constants';
import { AGENT_DEFINITIONS } from '../../frontend/src/agents/definitions';

// ── Mock documentExporter ──
const exportMarkdownMock = vi.fn();
const exportDocxMock = vi.fn(async () => undefined);
vi.mock('@/services/exporters/documentExporter', () => ({
  exportMarkdown: (...args: unknown[]) => exportMarkdownMock(...args),
  exportDocx: (...args: unknown[]) => exportDocxMock(...args),
  exportPdf: vi.fn(),
  exportAllArtifactsZip: vi.fn(),
  buildArtifactFilename: () => 'artifact.docx',
}));

// Import after mocks are registered.
import ExportMenu from '../../frontend/src/components/documents/ExportMenu';

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

// Use sprintPlanner (phase4) as the agent under test, matching the agent
// definitions confirmed earlier for Module 5.
const AGENT_ID = 'sprintPlanner' as const;
const DEF = AGENT_DEFINITIONS[AGENT_ID];

function withOutput(output: string): Project['agentRuns'] {
  return {
    [AGENT_ID]: {
      agentId: AGENT_ID,
      status: 'complete',
      output,
    },
  };
}

describe('ExportMenu', () => {
  beforeEach(() => {
    exportMarkdownMock.mockClear();
    exportDocxMock.mockClear();
    exportDocxMock.mockImplementation(async () => undefined);
  });

  it('disables the Export button when there is no agent output (TS-151)', () => {
    const project = baseProject({ agentRuns: {} });
    render(<ExportMenu agentId={AGENT_ID} project={project} />);

    const button = screen.getByRole('button', { name: /export/i });
    expect(button).toBeDisabled();
  });

  it('clicking Export then Markdown calls exportMarkdown with the output and "<outputLabel>.md" (TS-152)', async () => {
    const project = baseProject({
      agentRuns: withOutput('# Sprint Plan\n\nDo the work.'),
    });
    render(<ExportMenu agentId={AGENT_ID} project={project} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /export/i }));

    const mdButton = screen.getByRole('button', { name: /markdown \(\.md\)/i });
    await user.click(mdButton);

    expect(exportMarkdownMock).toHaveBeenCalledTimes(1);
    expect(exportMarkdownMock).toHaveBeenCalledWith(
      '# Sprint Plan\n\nDo the work.',
      'artifact.md',
    );

    // Dropdown should close after export.
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /markdown \(\.md\)/i })).not.toBeInTheDocument();
    });
  });

  it('clicking Export then Word calls exportDocx with output, label, project name, and computed phase number (TS-153)', async () => {
    const project = baseProject({
      agentRuns: withOutput('# Sprint Plan\n\nDo the work.'),
    });
    render(<ExportMenu agentId={AGENT_ID} project={project} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /export/i }));
    await user.click(screen.getByRole('button', { name: /word \(\.docx\)/i }));

    const expectedPhaseNumber = DEF ? PHASE_ORDER.indexOf(DEF.phase) + 1 : undefined;

    expect(exportDocxMock).toHaveBeenCalledTimes(1);
    expect(exportDocxMock).toHaveBeenCalledWith(
      '# Sprint Plan\n\nDo the work.',
      DEF?.outputLabel,
      project.name,
      expectedPhaseNumber,
      DEF?.outputLabel,
    );
  });

  it('shows a loading state and disables the button while exportDocx is pending (TS-154)', async () => {
    let resolveExport: () => void = () => {};
    exportDocxMock.mockImplementation(
      () => new Promise<void>((resolve) => { resolveExport = resolve; }),
    );

    const project = baseProject({
      agentRuns: withOutput('# Sprint Plan\n\nDo the work.'),
    });
    render(<ExportMenu agentId={AGENT_ID} project={project} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /export/i }));
    await user.click(screen.getByRole('button', { name: /word \(\.docx\)/i }));

    // Loading state visible immediately.
    const loadingButton = await screen.findByRole('button', { name: /exporting/i });
    expect(loadingButton).toBeDisabled();

    // Resolve the pending export.
    resolveExport();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /export/i })).not.toBeDisabled();
    });
  });

  it('clears the loading state via finally even if exportDocx rejects (TS-155)', async () => {
    exportDocxMock.mockImplementation(async () => {
      throw new Error('export failed');
    });

    // doExport's onClick handler is fire-and-forget (`onClick={() =>
    // doExport('docx')}`), so its rejection becomes an unhandled promise
    // rejection once `finally` clears the loading state. Swallow it here so
    // the test doesn't fail/crash the worker on the unhandled rejection
    // itself, while still asserting the `finally` block ran.
    const onUnhandledRejection = (reason: unknown) => {
      // Expected: the "export failed" error from exportDocxMock.
      void reason;
    };
    process.on('unhandledRejection', onUnhandledRejection);

    try {
      const project = baseProject({
        agentRuns: withOutput('# Sprint Plan\n\nDo the work.'),
      });
      render(<ExportMenu agentId={AGENT_ID} project={project} />);

      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: /export/i }));
      await user.click(screen.getByRole('button', { name: /word \(\.docx\)/i }));

      // The `finally` block still clears the loading state even though
      // exportDocx rejected.
      await waitFor(() => {
        const button = screen.getByRole('button', { name: /export/i });
        expect(button).not.toBeDisabled();
        expect(button.textContent).toBe('Export ▾');
      });
    } finally {
      process.off('unhandledRejection', onUnhandledRejection);
    }
  });
});
