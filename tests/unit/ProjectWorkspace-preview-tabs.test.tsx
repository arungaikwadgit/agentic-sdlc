// tests/unit/ProjectWorkspace-preview-tabs.test.tsx
//
// Integration tests for the Spec / Preview (Diagrams) tab switching logic
// added in Task #89 and the Architecture ADD preview feature.
//
// Scope:
//   - "Preview" tab appears only for uxMockups agent with ```html output
//   - "Diagrams" tab appears only for architecture agent with ```mermaid output
//   - No preview tab for agents that are neither uxMockups nor architecture
//   - No preview tab for uxMockups output that lacks ```html
//   - No preview tab for architecture output that lacks ```mermaid
//   - Clicking the tab switches from DocumentViewer → MockupPreview / DiagramPreview
//   - Clicking "Spec" switches back to DocumentViewer
//   - Correct component renders in each tab for each agent
//
// Mock strategy: exactly mirrors ProjectWorkspace-controls.test.tsx.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Project } from '../../frontend/src/types/project.types';
import type { AgentId } from '../../frontend/src/types/agent.types';

// ── useLiveQuery ──
let currentProject: Project | undefined;
vi.mock('dexie-react-hooks', () => ({
  useLiveQuery: () => currentProject,
}));

// ── database ──
vi.mock('@/db/database', () => ({
  db: { projects: { get: vi.fn() } },
}));

// ── projectRepository ──
const updateProjectMock = vi.fn();
const updateAgentRunMock = vi.fn();
vi.mock('@/db/projectRepository', () => ({
  updateProject: (...args: unknown[]) => updateProjectMock(...args),
  updateAgentRun: (...args: unknown[]) => updateAgentRunMock(...args),
}));

// ── pipelineEngine ──
vi.mock('@/services/pipelineEngine', () => ({
  PipelineEngine: vi.fn().mockImplementation(() => ({
    run: vi.fn().mockResolvedValue(undefined),
    abort: vi.fn(),
  })),
}));

// ── api ──
// callAgent must resolve (not return undefined) — ProjectWorkspace pings it
// on mount via `testMode: true` to check API key availability, and chains
// .then()/.catch() directly off the call.
vi.mock('@/services/api', () => ({
  api: {
    callAgent: vi.fn().mockResolvedValue({
      choices: [{ message: { role: 'assistant', content: '' }, finish_reason: 'stop' }],
    }),
    extractText: vi.fn(),
    enhancePrompt: vi.fn(),
  },
}));

// ── exporters / traceability ──
vi.mock('@/services/traceability', () => ({ exportTraceabilityCSV: vi.fn() }));
vi.mock('@/services/exporters/documentExporter', () => ({ exportAllArtifactsZip: vi.fn() }));
vi.mock('@/services/exporters/excelExporter', () => ({ exportPipelineMetricsXlsx: vi.fn() }));

// ── Child components: lightweight stubs so we can assert which one renders ──
vi.mock('../../frontend/src/components/documents/DocumentViewer', () => ({
  default: ({ markdown }: { markdown: string }) => (
    <div data-testid="document-viewer" data-markdown={markdown.slice(0, 20)} />
  ),
}));
vi.mock('../../frontend/src/components/documents/MockupPreview', () => ({
  default: ({ markdown }: { markdown: string }) => (
    <div data-testid="mockup-preview" data-markdown={markdown.slice(0, 20)} />
  ),
}));
vi.mock('../../frontend/src/components/documents/DiagramPreview', () => ({
  default: ({ markdown }: { markdown: string }) => (
    <div data-testid="diagram-preview" data-markdown={markdown.slice(0, 20)} />
  ),
}));
vi.mock('../../frontend/src/components/reviewGate/ReviewGateModal', () => ({
  default: () => <div data-testid="review-gate-modal" />,
}));
vi.mock('../../frontend/src/components/settings/ProjectSettings', () => ({
  default: () => <div data-testid="project-settings" />,
  initials: (name: string) =>
    name
      .split(' ')
      .map((p) => p[0])
      .join('')
      .toUpperCase()
      .slice(0, 2),
}));
vi.mock('../../frontend/src/components/documents/ExportMenu', () => ({
  default: () => <div data-testid="export-menu" />,
}));
vi.mock('../../frontend/src/components/documents/GithubPushModal', () => ({
  default: () => <div data-testid="github-push-modal" />,
}));

import ProjectWorkspace from '../../frontend/src/components/pipeline/ProjectWorkspace';

// ─────────────────────────────────────────────────────────────────
// Fixture factories
// ─────────────────────────────────────────────────────────────────

function makeProject(
  agentId: AgentId,
  output: string,
  overrides: Partial<Project> = {}
): Project {
  return {
    id: 'proj-tab-test',
    name: 'Tab Test Project',
    description: 'Test project for tab switching',
    domain: 'saas',
    status: 'complete',
    currentPhase: 'phase3',
    version: 1,
    createdAt: 1000,
    updatedAt: 1000,
    reviewGates: {
      gate1: { id: 'gate1', approved: true, afterPhases: [] },
      gate2: { id: 'gate2', approved: true, afterPhases: [] },
      gate3: { id: 'gate3', approved: true, afterPhases: [] },
      gate5: { id: 'gate5', approved: true, afterPhases: [] },
    },
    promptOverrides: [],
    mode: 'simple',
    teamMembers: [
      {
        id: 'm1',
        name: 'Alice',
        email: 'alice@example.com',
        role: 'Admin',
        isAdmin: true,
        avatarColor: '#fff',
      },
    ],
    activeAdminId: 'm1',
    agentAssignments: [],
    agentRuns: {
      [agentId]: {
        agentId,
        status: 'complete',
        output,
        startedAt: 900,
        completedAt: 1100,
        provider: 'claude',
        model: 'claude-opus-4-8',
        tokensUsed: 1000,
      },
    },
    ...overrides,
  } as unknown as Project;
}

// HTML output fixture containing ```html fence
const HTML_OUTPUT = `# UX Mockups\n\n## Login Screen\n\n\`\`\`html\n<html><head></head><body><p>Login</p></body></html>\n\`\`\`\n\n## Dashboard\n\n\`\`\`html\n<html><head></head><body><p>Dashboard</p></body></html>\n\`\`\``;

// Mermaid output fixture containing ```mermaid fence
const MERMAID_OUTPUT = `# Architecture\n\n## System Context\n\n\`\`\`mermaid\ngraph TD; Frontend-->Backend\n\`\`\`\n\n## Data Flow\n\n\`\`\`mermaid\nsequenceDiagram; User->>API: request\n\`\`\``;

// Plain output with no fences
const PLAIN_OUTPUT = '# Sprint Plan\n\nSome content without any code fences.';

const noop = () => {};

// ─────────────────────────────────────────────────────────────────
// Helper: select an agent by clicking its label in the sidebar
// ─────────────────────────────────────────────────────────────────
async function clickAgent(agentLabel: string) {
  const user = userEvent.setup();
  const btn = screen.getByRole('button', { name: new RegExp(agentLabel, 'i') });
  await user.click(btn);
}

// ─────────────────────────────────────────────────────────────────
// 1. "Preview" tab — uxMockups with HTML output
// ─────────────────────────────────────────────────────────────────
describe('ProjectWorkspace — Preview tab for uxMockups', () => {
  beforeEach(() => {
    updateProjectMock.mockClear();
    updateAgentRunMock.mockClear();
  });

  it('shows "Preview" tab button when uxMockups output contains ```html', async () => {
    currentProject = makeProject('uxMockups', HTML_OUTPUT);
    render(<ProjectWorkspace projectId="proj-tab-test" onBack={noop} />);

    // Click the uxMockups sidebar entry to select it
    await clickAgent('UX Mockups');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Preview' })).toBeInTheDocument();
    });
  });

  it('shows "Spec" tab button alongside the Preview tab', async () => {
    currentProject = makeProject('uxMockups', HTML_OUTPUT);
    render(<ProjectWorkspace projectId="proj-tab-test" onBack={noop} />);
    await clickAgent('UX Mockups');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Spec' })).toBeInTheDocument();
    });
  });

  it('does NOT show "Diagrams" tab for uxMockups', async () => {
    currentProject = makeProject('uxMockups', HTML_OUTPUT);
    render(<ProjectWorkspace projectId="proj-tab-test" onBack={noop} />);
    await clickAgent('UX Mockups');

    await waitFor(() => screen.getByRole('button', { name: 'Preview' }));
    expect(screen.queryByRole('button', { name: 'Diagrams' })).not.toBeInTheDocument();
  });

  it('renders DocumentViewer by default on the Spec tab', async () => {
    currentProject = makeProject('uxMockups', HTML_OUTPUT);
    render(<ProjectWorkspace projectId="proj-tab-test" onBack={noop} />);
    await clickAgent('UX Mockups');

    await waitFor(() => {
      expect(screen.getByTestId('document-viewer')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('mockup-preview')).not.toBeInTheDocument();
  });

  it('clicking "Preview" switches to MockupPreview component', async () => {
    currentProject = makeProject('uxMockups', HTML_OUTPUT);
    render(<ProjectWorkspace projectId="proj-tab-test" onBack={noop} />);
    await clickAgent('UX Mockups');

    const user = userEvent.setup();
    await waitFor(() => screen.getByRole('button', { name: 'Preview' }));
    await user.click(screen.getByRole('button', { name: 'Preview' }));

    await waitFor(() => {
      expect(screen.getByTestId('mockup-preview')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('document-viewer')).not.toBeInTheDocument();
  });

  it('clicking "Spec" after Preview switches back to DocumentViewer', async () => {
    currentProject = makeProject('uxMockups', HTML_OUTPUT);
    render(<ProjectWorkspace projectId="proj-tab-test" onBack={noop} />);
    await clickAgent('UX Mockups');

    const user = userEvent.setup();
    await waitFor(() => screen.getByRole('button', { name: 'Preview' }));
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    await waitFor(() => screen.getByTestId('mockup-preview'));

    await user.click(screen.getByRole('button', { name: 'Spec' }));

    await waitFor(() => {
      expect(screen.getByTestId('document-viewer')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('mockup-preview')).not.toBeInTheDocument();
  });

  it('does NOT show the Preview tab when uxMockups output has no ```html', async () => {
    currentProject = makeProject('uxMockups', PLAIN_OUTPUT);
    render(<ProjectWorkspace projectId="proj-tab-test" onBack={noop} />);
    await clickAgent('UX Mockups');

    await waitFor(() => screen.getByTestId('document-viewer'));
    expect(screen.queryByRole('button', { name: 'Preview' })).not.toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────
// 2. "Diagrams" tab — architecture with mermaid output
// ─────────────────────────────────────────────────────────────────
describe('ProjectWorkspace — Diagrams tab for architecture', () => {
  beforeEach(() => {
    updateProjectMock.mockClear();
  });

  it('shows "Diagrams" tab button when architecture output contains ```mermaid', async () => {
    currentProject = makeProject('architecture', MERMAID_OUTPUT);
    render(<ProjectWorkspace projectId="proj-tab-test" onBack={noop} />);
    await clickAgent('Architecture');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Diagrams' })).toBeInTheDocument();
    });
  });

  it('shows "Spec" tab alongside the Diagrams tab', async () => {
    currentProject = makeProject('architecture', MERMAID_OUTPUT);
    render(<ProjectWorkspace projectId="proj-tab-test" onBack={noop} />);
    await clickAgent('Architecture');

    await waitFor(() => screen.getByRole('button', { name: 'Diagrams' }));
    expect(screen.getByRole('button', { name: 'Spec' })).toBeInTheDocument();
  });

  it('does NOT show "Preview" for architecture (uses "Diagrams" label instead)', async () => {
    currentProject = makeProject('architecture', MERMAID_OUTPUT);
    render(<ProjectWorkspace projectId="proj-tab-test" onBack={noop} />);
    await clickAgent('Architecture');

    await waitFor(() => screen.getByRole('button', { name: 'Diagrams' }));
    expect(screen.queryByRole('button', { name: 'Preview' })).not.toBeInTheDocument();
  });

  it('renders DocumentViewer by default on the Spec tab', async () => {
    currentProject = makeProject('architecture', MERMAID_OUTPUT);
    render(<ProjectWorkspace projectId="proj-tab-test" onBack={noop} />);
    await clickAgent('Architecture');

    await waitFor(() => {
      expect(screen.getByTestId('document-viewer')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('diagram-preview')).not.toBeInTheDocument();
  });

  it('clicking "Diagrams" switches to DiagramPreview component', async () => {
    currentProject = makeProject('architecture', MERMAID_OUTPUT);
    render(<ProjectWorkspace projectId="proj-tab-test" onBack={noop} />);
    await clickAgent('Architecture');

    const user = userEvent.setup();
    await waitFor(() => screen.getByRole('button', { name: 'Diagrams' }));
    await user.click(screen.getByRole('button', { name: 'Diagrams' }));

    await waitFor(() => {
      expect(screen.getByTestId('diagram-preview')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('document-viewer')).not.toBeInTheDocument();
  });

  it('clicking "Spec" after Diagrams switches back to DocumentViewer', async () => {
    currentProject = makeProject('architecture', MERMAID_OUTPUT);
    render(<ProjectWorkspace projectId="proj-tab-test" onBack={noop} />);
    await clickAgent('Architecture');

    const user = userEvent.setup();
    await waitFor(() => screen.getByRole('button', { name: 'Diagrams' }));
    await user.click(screen.getByRole('button', { name: 'Diagrams' }));
    await waitFor(() => screen.getByTestId('diagram-preview'));

    await user.click(screen.getByRole('button', { name: 'Spec' }));

    await waitFor(() => {
      expect(screen.getByTestId('document-viewer')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('diagram-preview')).not.toBeInTheDocument();
  });

  it('does NOT show the Diagrams tab when architecture output has no ```mermaid', async () => {
    currentProject = makeProject('architecture', PLAIN_OUTPUT);
    render(<ProjectWorkspace projectId="proj-tab-test" onBack={noop} />);
    await clickAgent('Architecture');

    await waitFor(() => screen.getByTestId('document-viewer'));
    expect(screen.queryByRole('button', { name: 'Diagrams' })).not.toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────
// 3. Other agents — no preview/diagram tab
// ─────────────────────────────────────────────────────────────────
describe('ProjectWorkspace — no preview tab for non-preview agents', () => {
  const NON_PREVIEW_AGENTS: Array<{ agentId: AgentId; label: string }> = [
    { agentId: 'manager', label: 'PRD Agent' },
    { agentId: 'testPlan', label: 'Test Plan' },
    { agentId: 'apiDesign', label: 'API Design' },
  ];

  for (const { agentId, label } of NON_PREVIEW_AGENTS) {
    it(`"${agentId}" with plain output shows no Preview or Diagrams tab`, async () => {
      currentProject = makeProject(agentId, PLAIN_OUTPUT);
      render(<ProjectWorkspace projectId="proj-tab-test" onBack={noop} />);
      await clickAgent(label);

      await waitFor(() => screen.getByTestId('document-viewer'));
      expect(screen.queryByRole('button', { name: 'Preview' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Diagrams' })).not.toBeInTheDocument();
    });
  }
});

// ─────────────────────────────────────────────────────────────────
// 4. Cross-contamination: mermaid output on uxMockups → no Diagrams tab
// ─────────────────────────────────────────────────────────────────
describe('ProjectWorkspace — agent/output type cross checks', () => {
  it('uxMockups with mermaid-only output does NOT show Preview or Diagrams tab', async () => {
    currentProject = makeProject('uxMockups', MERMAID_OUTPUT);
    render(<ProjectWorkspace projectId="proj-tab-test" onBack={noop} />);
    await clickAgent('UX Mockups');

    await waitFor(() => screen.getByTestId('document-viewer'));
    expect(screen.queryByRole('button', { name: 'Preview' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Diagrams' })).not.toBeInTheDocument();
  });

  it('architecture with html-only output does NOT show Preview or Diagrams tab', async () => {
    currentProject = makeProject('architecture', HTML_OUTPUT);
    render(<ProjectWorkspace projectId="proj-tab-test" onBack={noop} />);
    await clickAgent('Architecture');

    await waitFor(() => screen.getByTestId('document-viewer'));
    expect(screen.queryByRole('button', { name: 'Preview' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Diagrams' })).not.toBeInTheDocument();
  });

  it('DiagramPreview is NOT rendered for uxMockups even when clicking Preview', async () => {
    currentProject = makeProject('uxMockups', HTML_OUTPUT);
    render(<ProjectWorkspace projectId="proj-tab-test" onBack={noop} />);
    await clickAgent('UX Mockups');

    const user = userEvent.setup();
    await waitFor(() => screen.getByRole('button', { name: 'Preview' }));
    await user.click(screen.getByRole('button', { name: 'Preview' }));

    await waitFor(() => screen.getByTestId('mockup-preview'));
    expect(screen.queryByTestId('diagram-preview')).not.toBeInTheDocument();
  });

  it('MockupPreview is NOT rendered for architecture even when clicking Diagrams', async () => {
    currentProject = makeProject('architecture', MERMAID_OUTPUT);
    render(<ProjectWorkspace projectId="proj-tab-test" onBack={noop} />);
    await clickAgent('Architecture');

    const user = userEvent.setup();
    await waitFor(() => screen.getByRole('button', { name: 'Diagrams' }));
    await user.click(screen.getByRole('button', { name: 'Diagrams' }));

    await waitFor(() => screen.getByTestId('diagram-preview'));
    expect(screen.queryByTestId('mockup-preview')).not.toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────
// 5. Tab state resets when switching agents
// ─────────────────────────────────────────────────────────────────
describe('ProjectWorkspace — tab state resets on agent change', () => {
  it('navigating from uxMockups Preview to another agent resets to Spec view', async () => {
    // Create a project with two complete agents
    const proj = makeProject('uxMockups', HTML_OUTPUT);
    proj.agentRuns['manager'] = {
      agentId: 'manager',
      status: 'complete',
      output: PLAIN_OUTPUT,
      startedAt: 900,
      completedAt: 1100,
    } as any;
    currentProject = proj;

    render(<ProjectWorkspace projectId="proj-tab-test" onBack={noop} />);
    const user = userEvent.setup();

    // Select uxMockups and switch to Preview
    await clickAgent('UX Mockups');
    await waitFor(() => screen.getByRole('button', { name: 'Preview' }));
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    await waitFor(() => screen.getByTestId('mockup-preview'));

    // Now switch to manager (which has no html output, so should fall back to Spec)
    await clickAgent('PRD Agent');

    await waitFor(() => screen.getByTestId('document-viewer'));
    expect(screen.queryByRole('button', { name: 'Preview' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('mockup-preview')).not.toBeInTheDocument();
  });
});
