// tests/unit/NewProjectModal.test.tsx
// Component tests for components/dashboard/NewProjectModal.tsx — the
// two-step project creation wizard (presets, validation, domain knowledge
// defaults, create flow).
// Covers TS-170 through TS-182 from
// docs/test-plans/dashboard-and-project-creation-test-plan.md.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ── Mock @/db/projectRepository ──
const createProjectMock = vi.fn();
vi.mock('@/db/projectRepository', () => ({
  createProject: (...args: unknown[]) => createProjectMock(...args),
}));

// ── Mock @/agents/domainKnowledgeDefaults ──
const getEffectiveDomainKnowledgeDefaultMock = vi.fn();
vi.mock('@/agents/domainKnowledgeDefaults', () => ({
  getEffectiveDomainKnowledgeDefault: (...args: unknown[]) =>
    getEffectiveDomainKnowledgeDefaultMock(...args),
}));

// Import after mocks are registered.
import NewProjectModal from '../../frontend/src/components/dashboard/NewProjectModal';

const DEFAULT_BY_DOMAIN: Record<string, string> = {
  saas: '# SaaS default brief',
  fintech: '# FinTech default brief',
  healthcare: '# Healthcare default brief',
};

function setup() {
  const onClose = vi.fn();
  const onCreated = vi.fn();
  const utils = render(<NewProjectModal onClose={onClose} onCreated={onCreated} />);
  return { ...utils, onClose, onCreated };
}

async function fillDetailsAndProceed(user: ReturnType<typeof userEvent.setup>, name: string, description: string) {
  await user.type(screen.getByPlaceholderText(/payment processing platform/i), name);
  await user.type(screen.getByPlaceholderText(/describe the project goals/i), description);
  const next = screen.getByRole('button', { name: /next: domain knowledge/i });
  await user.click(next);
}

describe('NewProjectModal', () => {
  beforeEach(() => {
    createProjectMock.mockReset();
    getEffectiveDomainKnowledgeDefaultMock.mockReset();
    getEffectiveDomainKnowledgeDefaultMock.mockImplementation(
      async (domainId: string) => DEFAULT_BY_DOMAIN[domainId] ?? `# ${domainId} default brief`,
    );
  });

  it('renders the Details step with defaults and a disabled Next button (TS-170)', () => {
    setup();

    expect(screen.getByRole('heading', { name: /new project/i })).toBeInTheDocument();
    expect(screen.getByText(/step 1 of 2/i)).toBeInTheDocument();

    const nameInput = screen.getByPlaceholderText(/payment processing platform/i) as HTMLInputElement;
    const descInput = screen.getByPlaceholderText(/describe the project goals/i) as HTMLTextAreaElement;
    expect(nameInput.value).toBe('');
    expect(descInput.value).toBe('');

    const domainSelect = screen.getByRole('combobox') as HTMLSelectElement;
    expect(domainSelect.value).toBe('saas');

    const next = screen.getByRole('button', { name: /next: domain knowledge/i });
    expect(next).toBeDisabled();
  });

  it('clicking the FinPay preset fills name, description, and domain (TS-171)', async () => {
    const user = userEvent.setup();
    setup();

    const finPayPreset = screen.getByRole('button', { name: /finpay/i });
    await user.click(finPayPreset);

    const nameInput = screen.getByPlaceholderText(/payment processing platform/i) as HTMLInputElement;
    const descInput = screen.getByPlaceholderText(/describe the project goals/i) as HTMLTextAreaElement;
    const domainSelect = screen.getByRole('combobox') as HTMLSelectElement;

    expect(nameInput.value).toContain('FinPay');
    expect(descInput.value.length).toBeGreaterThan(0);
    expect(domainSelect.value).toBe('fintech');
  });

  it('Next is disabled unless both name and description are non-empty (TS-172)', async () => {
    const user = userEvent.setup();
    setup();

    const nameInput = screen.getByPlaceholderText(/payment processing platform/i);
    const descInput = screen.getByPlaceholderText(/describe the project goals/i);
    const next = screen.getByRole('button', { name: /next: domain knowledge/i });

    await user.type(nameInput, 'My Project');
    expect(next).toBeDisabled();

    await user.type(descInput, 'A description');
    expect(next).not.toBeDisabled();
  });

  it('changing the domain replaces domainKnowledge even if a custom brief was set (TS-173)', async () => {
    const user = userEvent.setup();
    setup();

    await fillDetailsAndProceed(user, 'My Project', 'A description');

    // On the Domain Knowledge step, type a custom brief.
    const textarea = await screen.findByPlaceholderText(/describe the domain context/i);
    await user.clear(textarea);
    await user.type(textarea, 'My custom brief');
    expect((textarea as HTMLTextAreaElement).value).toBe('My custom brief');

    // Go back to Details and change the domain.
    await user.click(screen.getByRole('button', { name: /back/i }));
    const domainSelect = screen.getByRole('combobox') as HTMLSelectElement;
    await user.selectOptions(domainSelect, 'healthcare');

    // Proceed to Domain Knowledge again — it should now show the
    // healthcare default, not the custom brief.
    await user.click(screen.getByRole('button', { name: /next: domain knowledge/i }));
    const textarea2 = await screen.findByPlaceholderText(/describe the domain context/i);
    await waitFor(() => {
      expect((textarea2 as HTMLTextAreaElement).value).toBe(DEFAULT_BY_DOMAIN.healthcare);
    });
  });

  it('proceeding to Domain Knowledge with empty domainKnowledge pre-fills the effective default (TS-174)', async () => {
    const user = userEvent.setup();
    setup();

    await fillDetailsAndProceed(user, 'My Project', 'A description');

    const textarea = await screen.findByPlaceholderText(/describe the domain context/i);
    await waitFor(() => {
      expect((textarea as HTMLTextAreaElement).value).toBe(DEFAULT_BY_DOMAIN.saas);
    });
    expect(getEffectiveDomainKnowledgeDefaultMock).toHaveBeenCalledWith('saas');
  });

  it('proceeding to Domain Knowledge with non-empty domainKnowledge does not overwrite it (TS-175)', async () => {
    const user = userEvent.setup();
    setup();

    await fillDetailsAndProceed(user, 'My Project', 'A description');
    const textarea = await screen.findByPlaceholderText(/describe the domain context/i);
    await waitFor(() => {
      expect((textarea as HTMLTextAreaElement).value).toBe(DEFAULT_BY_DOMAIN.saas);
    });

    // Edit the brief, then go back and forward again without changing domain.
    await user.clear(textarea);
    await user.type(textarea, 'A custom edited brief');

    getEffectiveDomainKnowledgeDefaultMock.mockClear();
    await user.click(screen.getByRole('button', { name: /back/i }));
    await user.click(screen.getByRole('button', { name: /next: domain knowledge/i }));

    const textarea2 = await screen.findByPlaceholderText(/describe the domain context/i);
    expect((textarea2 as HTMLTextAreaElement).value).toBe('A custom edited brief');
    expect(getEffectiveDomainKnowledgeDefaultMock).not.toHaveBeenCalled();
  });

  it('"Reset to template" overwrites the textarea with the effective default (TS-176)', async () => {
    const user = userEvent.setup();
    setup();

    await fillDetailsAndProceed(user, 'My Project', 'A description');
    const textarea = await screen.findByPlaceholderText(/describe the domain context/i);
    await waitFor(() => {
      expect((textarea as HTMLTextAreaElement).value).toBe(DEFAULT_BY_DOMAIN.saas);
    });

    await user.clear(textarea);
    await user.type(textarea, 'Something else entirely');

    await user.click(screen.getByRole('button', { name: /reset to template/i }));

    await waitFor(() => {
      expect((textarea as HTMLTextAreaElement).value).toBe(DEFAULT_BY_DOMAIN.saas);
    });
  });

  it('"Download as .md" downloads the current textarea content as domain-knowledge-{domain}.md (TS-177)', async () => {
    const user = userEvent.setup();
    setup();

    await fillDetailsAndProceed(user, 'My Project', 'A description');
    const textarea = await screen.findByPlaceholderText(/describe the domain context/i);
    await waitFor(() => {
      expect((textarea as HTMLTextAreaElement).value).toBe(DEFAULT_BY_DOMAIN.saas);
    });

    await user.clear(textarea);
    await user.type(textarea, 'Edited brief content');

    const createObjectURLSpy = vi.fn(() => 'blob:mock-url');
    const revokeObjectURLSpy = vi.fn();
    (URL as unknown as { createObjectURL: typeof createObjectURLSpy }).createObjectURL = createObjectURLSpy;
    (URL as unknown as { revokeObjectURL: typeof revokeObjectURLSpy }).revokeObjectURL = revokeObjectURLSpy;

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await user.click(screen.getByRole('button', { name: /download as \.md/i }));

    expect(createObjectURLSpy).toHaveBeenCalledTimes(1);
    const blobArg = createObjectURLSpy.mock.calls[0][0] as Blob;
    expect(blobArg.type).toBe('text/markdown');
    const text = await blobArg.text();
    expect(text).toBe('Edited brief content');

    expect(clickSpy).toHaveBeenCalledTimes(1);
    clickSpy.mockRestore();
  });

  it('"Back" returns to Details with all values intact (TS-178)', async () => {
    const user = userEvent.setup();
    setup();

    await fillDetailsAndProceed(user, 'My Project', 'A description');
    await screen.findByPlaceholderText(/describe the domain context/i);

    await user.click(screen.getByRole('button', { name: /back/i }));

    expect(screen.getByText(/step 1 of 2/i)).toBeInTheDocument();
    const nameInput = screen.getByPlaceholderText(/payment processing platform/i) as HTMLInputElement;
    const descInput = screen.getByPlaceholderText(/describe the project goals/i) as HTMLTextAreaElement;
    expect(nameInput.value).toBe('My Project');
    expect(descInput.value).toBe('A description');
  });

  it('"Create Project" calls createProject with the expected shape and onCreated with the new id (TS-179)', async () => {
    const user = userEvent.setup();
    createProjectMock.mockResolvedValue({ id: 'new-proj-1' });
    const { onCreated } = setup();

    await fillDetailsAndProceed(user, 'My Project', 'A description');
    const textarea = await screen.findByPlaceholderText(/describe the domain context/i);
    await waitFor(() => {
      expect((textarea as HTMLTextAreaElement).value).toBe(DEFAULT_BY_DOMAIN.saas);
    });

    await user.click(screen.getByRole('button', { name: /create project/i }));

    await waitFor(() => {
      expect(createProjectMock).toHaveBeenCalledTimes(1);
    });
    expect(createProjectMock).toHaveBeenCalledWith({
      name: 'My Project',
      description: 'A description',
      domain: 'saas',
      status: 'draft',
      mode: 'simple',
      domainKnowledge: DEFAULT_BY_DOMAIN.saas,
      brandingGuidelines: undefined,
    });
    expect(onCreated).toHaveBeenCalledWith('new-proj-1');
  });

  it('"Create Project" is disabled while pending and re-enabled after rejection (TS-180)', async () => {
    const user = userEvent.setup();
    let reject: (e: Error) => void = () => {};
    createProjectMock.mockImplementation(
      () => new Promise((_resolve, rej) => { reject = rej; }),
    );
    setup();

    await fillDetailsAndProceed(user, 'My Project', 'A description');
    await screen.findByPlaceholderText(/describe the domain context/i);

    const createButton = screen.getByRole('button', { name: /create project/i });
    await user.click(createButton);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /creating/i })).toBeDisabled();
    });

    reject(new Error('create failed'));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /create project/i })).not.toBeDisabled();
    });
  });

  it('toggling mode updates the hint text and the value sent to createProject (TS-181)', async () => {
    const user = userEvent.setup();
    createProjectMock.mockResolvedValue({ id: 'new-proj-2' });
    setup();

    expect(screen.getByText(/simple mode runs the full pipeline/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^expert$/i }));
    expect(screen.getByText(/expert mode enables review gates/i)).toBeInTheDocument();

    await fillDetailsAndProceed(user, 'My Project', 'A description');
    await screen.findByPlaceholderText(/describe the domain context/i);
    await user.click(screen.getByRole('button', { name: /create project/i }));

    await waitFor(() => {
      expect(createProjectMock).toHaveBeenCalledTimes(1);
    });
    expect(createProjectMock).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'expert' }),
    );
  });

  it('Cancel calls onClose without calling createProject (TS-182)', async () => {
    const user = userEvent.setup();
    const { onClose } = setup();

    await user.click(screen.getByRole('button', { name: /cancel/i }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(createProjectMock).not.toHaveBeenCalled();
  });
});
