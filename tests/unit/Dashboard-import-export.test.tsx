// tests/unit/Dashboard-import-export.test.tsx
// Real-component RTL test for Dashboard.tsx — Import/Export handlers.
// Covers TS-192 through TS-196 from
// docs/test-plans/dashboard-and-project-creation-test-plan.md.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, useState } from 'react';
import type { ProjectSummary } from '../../frontend/src/types/project.types';

// ── jsdom's Blob (and therefore File, which extends Blob) does not implement
// .text() the way real browsers / Node do. Dashboard.tsx's handleExport
// (new Blob([json]).text() via the test) and handleImport (file.text())
// both rely on the real Web API, which is correct for production — this is
// purely a test-environment gap. Polyfill it via FileReader, which jsdom
// does implement, rather than changing production code to work around a
// test-runner limitation. ──
if (typeof Blob.prototype.text !== 'function') {
  Blob.prototype.text = function (this: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result as string);
      fr.onerror = () => reject(fr.error);
      fr.readAsText(this);
    });
  };
}

// ── Mock dexie-react-hooks' useLiveQuery (same pattern as Dashboard-archive.test.tsx) ──
vi.mock('dexie-react-hooks', () => ({
  useLiveQuery: (querier: () => Promise<unknown>, deps: unknown[] = []) => {
    const [value, setValue] = useState<unknown>(undefined);
    useEffect(() => {
      let cancelled = false;
      Promise.resolve(querier()).then((result) => {
        if (!cancelled) setValue(result);
      });
      return () => {
        cancelled = true;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, deps);
    return value;
  },
}));

// ── Mock db/projectRepository ───────────────────────────────────────────────
let summariesStore: ProjectSummary[] = [];

const listProjectsMock = vi.fn(async () => summariesStore);
const deleteProjectMock = vi.fn(async () => {});
const restoreProjectMock = vi.fn(async () => {});
const exportAllProjectsMock = vi.fn(async () => '{"version":1,"exportedAt":1000,"projects":[]}');
const importProjectsMock = vi.fn(async () => 0);

vi.mock('../../frontend/src/db/projectRepository', () => ({
  listProjects: (...args: unknown[]) => listProjectsMock(...(args as [])),
  // Dashboard.tsx calls listVisibleProjects (access-control aware), not
  // listProjects directly — route it through the same mock/store.
  listVisibleProjects: (...args: unknown[]) => listProjectsMock(...(args as [])),
  deleteProject: (...args: Parameters<typeof deleteProjectMock>) => deleteProjectMock(...args),
  restoreProject: (...args: Parameters<typeof restoreProjectMock>) => restoreProjectMock(...args),
  exportAllProjects: (...args: unknown[]) => exportAllProjectsMock(...(args as [])),
  importProjects: (...args: Parameters<typeof importProjectsMock>) => importProjectsMock(...args),
}));

// ── Mock NewProjectModal and AppSettingsModal — out of scope here ──
vi.mock('../../frontend/src/components/dashboard/NewProjectModal', () => ({
  default: () => null,
}));
vi.mock('../../frontend/src/components/settings/AppSettingsModal', () => ({
  default: () => null,
}));

// Import after mocks are registered.
import Dashboard from '../../frontend/src/components/dashboard/Dashboard';

function makeSummary(overrides: Partial<ProjectSummary> = {}): ProjectSummary {
  return {
    id: 'proj-1',
    name: 'Demo Project',
    domain: 'fintech',
    status: 'draft',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    completedAgents: 3,
    totalAgents: 10,
    ...overrides,
  };
}

/**
 * Dashboard.handleImport creates an `<input type="file">` element
 * programmatically and calls `.click()` on it (it is never attached to the
 * DOM). To drive the flow in tests we intercept `document.createElement` so
 * the input we hand back is one we can dispatch a real `change` event on.
 */
function interceptFileInput(): { getInput: () => HTMLInputElement } {
  let capturedInput: HTMLInputElement | null = null;
  const realCreateElement = document.createElement.bind(document);

  vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
    const el = realCreateElement(tagName);
    if (tagName === 'input') {
      capturedInput = el as HTMLInputElement;
    }
    return el;
  });

  return {
    getInput: () => {
      if (!capturedInput) throw new Error('No <input> element was created yet');
      return capturedInput;
    },
  };
}

function dispatchFileChange(input: HTMLInputElement, file: File | undefined) {
  Object.defineProperty(input, 'files', {
    value: file ? [file] : [],
    configurable: true,
  });
  input.dispatchEvent(new Event('change'));
}

describe('Dashboard — import/export', () => {
  beforeEach(() => {
    summariesStore = [makeSummary()];
    listProjectsMock.mockClear();
    exportAllProjectsMock.mockClear();
    importProjectsMock.mockClear();
    exportAllProjectsMock.mockResolvedValue('{"version":1,"exportedAt":1000,"projects":[]}');
    importProjectsMock.mockReset();
    importProjectsMock.mockResolvedValue(0);
  });

  it('Export downloads a Blob of exportAllProjects() output as sdlc-backup-<timestamp>.json (TS-192)', async () => {
    const user = userEvent.setup();
    render(<Dashboard onOpenProject={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Demo Project')).toBeInTheDocument());

    const createObjectURLSpy = vi.fn(() => 'blob:mock-url');
    const revokeObjectURLSpy = vi.fn();
    (URL as unknown as { createObjectURL: typeof createObjectURLSpy }).createObjectURL = createObjectURLSpy;
    (URL as unknown as { revokeObjectURL: typeof revokeObjectURLSpy }).revokeObjectURL = revokeObjectURLSpy;
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await user.click(screen.getByRole('button', { name: 'Export' }));

    await waitFor(() => expect(exportAllProjectsMock).toHaveBeenCalledTimes(1));
    expect(createObjectURLSpy).toHaveBeenCalledTimes(1);

    const blobArg = createObjectURLSpy.mock.calls[0][0] as Blob;
    expect(blobArg.type).toBe('application/json');
    const text = await blobArg.text();
    expect(text).toBe('{"version":1,"exportedAt":1000,"projects":[]}');

    expect(clickSpy).toHaveBeenCalledTimes(1);
    clickSpy.mockRestore();
  });

  it('Import reads the selected .json file and calls importProjects with its text (TS-193)', async () => {
    const user = userEvent.setup();
    render(<Dashboard onOpenProject={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Demo Project')).toBeInTheDocument());

    const { getInput } = interceptFileInput();
    importProjectsMock.mockResolvedValue(2);
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});

    await user.click(screen.getByRole('button', { name: 'Import' }));

    const fileContent = '{"version":1,"exportedAt":1000,"projects":[{"id":"a"},{"id":"b"}]}';
    const file = new File([fileContent], 'backup.json', { type: 'application/json' });
    dispatchFileChange(getInput(), file);

    await waitFor(() => expect(importProjectsMock).toHaveBeenCalledTimes(1));
    expect(importProjectsMock).toHaveBeenCalledWith(fileContent);

    alertSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it('shows an alert with the imported count on success (TS-194)', async () => {
    const user = userEvent.setup();
    render(<Dashboard onOpenProject={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Demo Project')).toBeInTheDocument());

    const { getInput } = interceptFileInput();
    importProjectsMock.mockResolvedValue(3);
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});

    await user.click(screen.getByRole('button', { name: 'Import' }));
    const file = new File(['{"projects":[]}'], 'backup.json', { type: 'application/json' });
    dispatchFileChange(getInput(), file);

    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('Imported 3 project(s).'));

    alertSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it('shows an alert with the error via String(e) on failure, without crashing (TS-195)', async () => {
    const user = userEvent.setup();
    render(<Dashboard onOpenProject={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Demo Project')).toBeInTheDocument());

    const { getInput } = interceptFileInput();
    importProjectsMock.mockRejectedValue(new Error('Invalid backup format'));
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});

    await user.click(screen.getByRole('button', { name: 'Import' }));
    const file = new File(['not json'], 'backup.json', { type: 'application/json' });
    dispatchFileChange(getInput(), file);

    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith(`Import failed: ${String(new Error('Invalid backup format'))}`),
    );
    expect(alertSpy.mock.calls[0][0]).toContain('Invalid backup format');

    alertSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it('does not call importProjects when no file is selected (TS-196)', async () => {
    const user = userEvent.setup();
    render(<Dashboard onOpenProject={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Demo Project')).toBeInTheDocument());

    const { getInput } = interceptFileInput();
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});

    await user.click(screen.getByRole('button', { name: 'Import' }));
    dispatchFileChange(getInput(), undefined);

    // Give any pending microtasks a chance to run.
    await waitFor(() => expect(getInput()).toBeDefined());
    expect(importProjectsMock).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();

    alertSpy.mockRestore();
    vi.restoreAllMocks();
  });
});
