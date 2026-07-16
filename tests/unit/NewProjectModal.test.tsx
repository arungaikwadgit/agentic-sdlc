// tests/unit/NewProjectModal.test.tsx
// Component tests for components/dashboard/NewProjectModal.tsx - the
// two-step project creation wizard (presets, validation, domain knowledge
// defaults, create flow).
// Covers TS-170 through TS-182 from
// docs/test-plans/dashboard-and-project-creation-test-plan.md.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// The mandatory-field workflow performs many realistic user interactions.
// Allow enough time when the full suite is running under constrained CI workers.
vi.setConfig({ testTimeout: 20_000 });

const createProjectMock = vi.fn();
vi.mock('@/db/projectRepository', () => ({
  createProject: (...args: unknown[]) => createProjectMock(...args),
}));

const getEffectiveDomainKnowledgeDefaultMock = vi.fn();
vi.mock('@/agents/domainKnowledgeDefaults', () => ({
  getEffectiveDomainKnowledgeDefault: (...args: unknown[]) =>
    getEffectiveDomainKnowledgeDefaultMock(...args),
}));

import NewProjectModal from '../../frontend/src/components/dashboard/NewProjectModal';
import { DOMAIN_KNOWLEDGE_TEMPLATES } from '../../frontend/src/agents/domainKnowledgeTemplates';

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
  await user.type(screen.getByPlaceholderText(/e\.g\. Jane Doe/i), 'Test Owner');
  await user.type(screen.getByPlaceholderText(/e\.g\. Platform Squad/i), 'Platform Squad');
  await user.type(screen.getByPlaceholderText(/describe the project goals/i), description);

  const projectTypeSelect = screen.getAllByRole('combobox').find(
    (el) => (el as HTMLSelectElement).querySelector('option[value="web-app"]') !== null,
  ) as HTMLSelectElement;
  await user.selectOptions(projectTypeSelect, 'web-app');

  const dateInputs = Array.from(document.querySelectorAll('input[type="date"]')) as HTMLInputElement[];
  await user.type(dateInputs[0], '2026-07-09');
  await user.type(dateInputs[1], '2026-07-31');

  const techInput = screen.getByPlaceholderText(/Enter to add/i);
  await user.type(techInput, 'React');
  await user.click(screen.getByRole('button', { name: /^add$/i }));

  await user.type(screen.getByPlaceholderText(/Who will use this product day-to-day\?/i), 'Operations teams and merchants');
  await user.type(screen.getByPlaceholderText(/Known risks, dependencies, or open questions/i), 'Payment gateway integration risk');

  const next = screen.getByRole('button', { name: /next: domain knowledge/i });
  await user.click(next);
}

async function findDomainKnowledgeTextarea() {
  return screen.findByPlaceholderText(/describe the domain context/i);
}

describe('NewProjectModal', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

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

    const domainSelect = screen.getAllByRole('combobox').find(
      (el) => (el as HTMLSelectElement).value === 'saas'
    ) as HTMLSelectElement;
    expect(domainSelect.value).toBe('saas');

    const next = screen.getByRole('button', { name: /next: domain knowledge/i });
    expect(next).toBeDisabled();
  });

  it('clicking the FinPay preset fills name, description, and domain (TS-171)', async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByRole('button', { name: /finpay/i }));

    const nameInput = screen.getByPlaceholderText(/payment processing platform/i) as HTMLInputElement;
    const descInput = screen.getByPlaceholderText(/describe the project goals/i) as HTMLTextAreaElement;
    const domainSelect = screen.getAllByRole('combobox').find(
      (el) => (el as HTMLSelectElement).querySelector('option[value="fintech"]') !== null
    ) as HTMLSelectElement;

    expect(nameInput.value).toContain('FinPay');
    expect(descInput.value.length).toBeGreaterThan(0);
    expect(domainSelect.value).toBe('fintech');
  });

  it('Next is disabled until all mandatory fields are filled (TS-172)', async () => {
    const user = userEvent.setup();
    setup();

    const nameInput = screen.getByPlaceholderText(/payment processing platform/i);
    const descInput = screen.getByPlaceholderText(/describe the project goals/i);
    const next = screen.getByRole('button', { name: /next: domain knowledge/i });

    await user.type(nameInput, 'My Project');
    expect(next).toBeDisabled();

    await user.type(descInput, 'A description');
    expect(next).toBeDisabled();

    await user.type(screen.getByPlaceholderText(/e\.g\. Jane Doe/i), 'Test Owner');
    await user.type(screen.getByPlaceholderText(/e\.g\. Platform Squad/i), 'Platform Squad');
    const projectTypeSelect = screen.getAllByRole('combobox').find(
      (el) => (el as HTMLSelectElement).querySelector('option[value="web-app"]') !== null,
    ) as HTMLSelectElement;
    await user.selectOptions(projectTypeSelect, 'web-app');
    const dateInputs = Array.from(document.querySelectorAll('input[type="date"]')) as HTMLInputElement[];
    await user.type(dateInputs[0], '2026-07-09');
    await user.type(dateInputs[1], '2026-07-31');
    const techInput = screen.getByPlaceholderText(/Enter to add/i);
    await user.type(techInput, 'React');
    await user.click(screen.getByRole('button', { name: /^add$/i }));
    await user.type(screen.getByPlaceholderText(/Who will use this product day-to-day\?/i), 'Operations teams and merchants');
    await user.type(screen.getByPlaceholderText(/Known risks, dependencies, or open questions/i), 'Payment gateway integration risk');

    expect(next).not.toBeDisabled();
  });

  it('changing the domain replaces domainKnowledge even if a custom brief was set (TS-173)', async () => {
    const user = userEvent.setup();
    setup();

    await fillDetailsAndProceed(user, 'My Project', 'A description');

    const textarea = await findDomainKnowledgeTextarea();
    await user.clear(textarea);
    await user.type(textarea, 'My custom brief');
    expect((textarea as HTMLTextAreaElement).value).toBe('My custom brief');

    await user.click(screen.getAllByRole('button', { name: /back/i }).at(-1)!);
    const domainSelect = screen.getAllByRole('combobox').find(
      (el) => (el as HTMLSelectElement).querySelector('option[value="healthcare"]') !== null
    ) as HTMLSelectElement;
    await user.selectOptions(domainSelect, 'healthcare');

    await user.click(screen.getByRole('button', { name: /next: domain knowledge/i }));
    const textarea2 = await findDomainKnowledgeTextarea();
    await waitFor(() => {
      expect((textarea2 as HTMLTextAreaElement).value).toBe(DEFAULT_BY_DOMAIN.healthcare);
    });
  });

  it('proceeding to Domain Knowledge with empty domainKnowledge pre-fills the effective default (TS-174)', async () => {
    const user = userEvent.setup();
    setup();

    await fillDetailsAndProceed(user, 'My Project', 'A description');

    const textarea = await findDomainKnowledgeTextarea();
    await waitFor(() => {
      expect((textarea as HTMLTextAreaElement).value).toBe(DEFAULT_BY_DOMAIN.saas);
    });
    expect(getEffectiveDomainKnowledgeDefaultMock).toHaveBeenCalledWith('saas');
  });

  it('proceeding to Domain Knowledge with non-empty domainKnowledge does not overwrite it (TS-175)', async () => {
    const user = userEvent.setup();
    setup();

    await fillDetailsAndProceed(user, 'My Project', 'A description');
    const textarea = await findDomainKnowledgeTextarea();
    await waitFor(() => {
      expect((textarea as HTMLTextAreaElement).value).toBe(DEFAULT_BY_DOMAIN.saas);
    });

    await user.clear(textarea);
    await user.type(textarea, 'A custom edited brief');

    getEffectiveDomainKnowledgeDefaultMock.mockClear();
    await user.click(screen.getAllByRole('button', { name: /back/i }).at(-1)!);
    await user.click(screen.getByRole('button', { name: /next: domain knowledge/i }));

    const textarea2 = await findDomainKnowledgeTextarea();
    expect((textarea2 as HTMLTextAreaElement).value).toBe('A custom edited brief');
    expect(getEffectiveDomainKnowledgeDefaultMock).not.toHaveBeenCalled();
  });

  it('Reset to template overwrites the textarea with the effective default (TS-176)', async () => {
    const user = userEvent.setup();
    setup();

    await fillDetailsAndProceed(user, 'My Project', 'A description');
    const textarea = await findDomainKnowledgeTextarea();
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

  it('Download as .md downloads the current textarea content as domain-knowledge-{domain}.md (TS-177)', async () => {
    const user = userEvent.setup();
    setup();

    await fillDetailsAndProceed(user, 'My Project', 'A description');
    const textarea = await findDomainKnowledgeTextarea();
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
    const text = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsText(blobArg);
    });
    expect(text).toBe('Edited brief content');
    expect(clickSpy).toHaveBeenCalledTimes(1);
    clickSpy.mockRestore();
  });

  it('Back returns to Details with all values intact (TS-178)', async () => {
    const user = userEvent.setup();
    setup();

    await fillDetailsAndProceed(user, 'My Project', 'A description');
    await findDomainKnowledgeTextarea();
    await user.click(screen.getAllByRole('button', { name: /back/i }).at(-1)!);

    expect(screen.getByText(/step 1 of 2/i)).toBeInTheDocument();
    expect((screen.getByPlaceholderText(/payment processing platform/i) as HTMLInputElement).value).toBe('My Project');
    expect((screen.getByPlaceholderText(/describe the project goals/i) as HTMLTextAreaElement).value).toBe('A description');
    expect((screen.getByPlaceholderText(/e\.g\. Jane Doe/i) as HTMLInputElement).value).toBe('Test Owner');
    expect((screen.getByPlaceholderText(/e\.g\. Platform Squad/i) as HTMLInputElement).value).toBe('Platform Squad');
  });

  it('Create Project calls createProject with the expected shape and onCreated with the new id (TS-179)', async () => {
    const user = userEvent.setup();
    createProjectMock.mockResolvedValue({ id: 'new-proj-1' });
    const { onCreated } = setup();

    await fillDetailsAndProceed(user, 'My Project', 'A description');
    const textarea = await findDomainKnowledgeTextarea();
    await waitFor(() => {
      expect((textarea as HTMLTextAreaElement).value).toBe(DEFAULT_BY_DOMAIN.saas);
    });

    await user.click(screen.getByRole('button', { name: /save for the project/i }));

    await waitFor(() => {
      expect(createProjectMock).toHaveBeenCalledTimes(1);
    });
    expect(createProjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'My Project',
        description: 'A description',
        domain: 'saas',
        status: 'draft',
        mode: 'simple',
        domainKnowledge: DEFAULT_BY_DOMAIN.saas,
        owner: 'Test Owner',
        team: 'Platform Squad',
        projectType: 'web-app',
      }),
    );
    expect(onCreated).toHaveBeenCalledWith('new-proj-1');
  });

  it('Save for the project is disabled while pending and re-enabled after rejection (TS-180)', async () => {
    const user = userEvent.setup();
    let reject: (e: Error) => void = () => {};
    createProjectMock.mockImplementation(() => new Promise((_resolve, rej) => { reject = rej; }));
    setup();

    await fillDetailsAndProceed(user, 'My Project', 'A description');
    await findDomainKnowledgeTextarea();

    await user.click(screen.getByRole('button', { name: /save for the project/i }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /saving/i })).toBeDisabled();
    });

    reject(new Error('create failed'));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save for the project/i })).not.toBeDisabled();
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
    await findDomainKnowledgeTextarea();
    await user.click(screen.getByRole('button', { name: /create project/i }));

    await waitFor(() => {
      expect(createProjectMock).toHaveBeenCalledTimes(1);
    });
    expect(createProjectMock).toHaveBeenCalledWith(expect.objectContaining({ mode: 'expert' }));
  });

  it('falls back to the built-in domain template when the app-level default fetch fails', async () => {
    const user = userEvent.setup();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    getEffectiveDomainKnowledgeDefaultMock.mockRejectedValueOnce(new Error('backend unavailable'));
    setup();

    await fillDetailsAndProceed(user, 'My Project', 'A description');

    const textarea = await findDomainKnowledgeTextarea();
    await waitFor(() => {
      expect((textarea as HTMLTextAreaElement).value).toBe(DOMAIN_KNOWLEDGE_TEMPLATES.saas);
    });
    expect(warnSpy).toHaveBeenCalled();
  });

  it('shows an inline error and re-enables save when project creation fails', async () => {
    const user = userEvent.setup();
    createProjectMock.mockRejectedValueOnce(new Error('API 503: backend unavailable'));
    setup();

    await fillDetailsAndProceed(user, 'My Project', 'A description');
    await findDomainKnowledgeTextarea();
    await user.click(screen.getByRole('button', { name: /save for the project/i }));

    expect(await screen.findByText(/API 503: backend unavailable/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save for the project/i })).not.toBeDisabled();
    });
  });

  it('Cancel calls onClose without calling createProject (TS-182)', async () => {
    const user = userEvent.setup();
    const { onClose } = setup();

    await user.click(screen.getByRole('button', { name: /cancel/i }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(createProjectMock).not.toHaveBeenCalled();
  });
});

