// tests/unit/ProjectCard.test.tsx
// Component tests for components/dashboard/ProjectCard.tsx — active
// (non-archived) rendering: domain badge, status, progress, open/delete.
// Covers TS-183 through TS-191 from
// docs/test-plans/dashboard-and-project-creation-test-plan.md.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ProjectCard from '../../frontend/src/components/dashboard/ProjectCard';
import { DOMAINS } from '../../frontend/src/agents/domains';
import type { ProjectSummary } from '../../frontend/src/types/project.types';

function baseSummary(overrides: Partial<ProjectSummary> = {}): ProjectSummary {
  return {
    id: 'proj-1',
    name: 'Acme Retail',
    domain: 'fintech',
    status: 'draft',
    completedAgents: 0,
    totalAgents: 0,
    updatedAt: new Date('2026-01-15T00:00:00Z').getTime(),
    ...overrides,
  } as unknown as ProjectSummary;
}

describe('ProjectCard (active view)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the domain badge using DOMAINS[project.domain] (TS-183)', () => {
    const project = baseSummary({ domain: 'fintech' });
    render(<ProjectCard project={project} onOpen={vi.fn()} onDelete={vi.fn()} />);

    const badge = screen.getByText(DOMAINS.fintech.label);
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveStyle({ background: DOMAINS.fintech.bgColor, color: DOMAINS.fintech.color });
  });

  it.each([
    ['draft', 'Draft', '#64748b'],
    ['running', 'Running', '#6366f1'],
    ['paused', 'Paused', '#f59e0b'],
    ['complete', 'Complete', '#22c55e'],
    ['error', 'Error', '#ef4444'],
  ])('renders status "%s" with label "%s" and color %s (TS-184)', (status, label, color) => {
    const project = baseSummary({ status: status as ProjectSummary['status'] });
    render(<ProjectCard project={project} onOpen={vi.fn()} onDelete={vi.fn()} />);

    const labelEl = screen.getByText(label);
    expect(labelEl).toBeInTheDocument();
    expect(labelEl).toHaveStyle({ color });
  });

  it('falls back to the raw status string and default color for an unrecognized status (TS-185)', () => {
    const project = baseSummary({ status: 'unknown' as unknown as ProjectSummary['status'] });
    expect(() =>
      render(<ProjectCard project={project} onOpen={vi.fn()} onDelete={vi.fn()} />),
    ).not.toThrow();

    const labelEl = screen.getByText('unknown');
    expect(labelEl).toBeInTheDocument();
    expect(labelEl).toHaveStyle({ color: '#64748b' });
  });

  it('renders progress as Math.round(completed/total * 100)% for non-zero totalAgents (TS-186)', () => {
    const project = baseSummary({ completedAgents: 3, totalAgents: 8 });
    render(<ProjectCard project={project} onOpen={vi.fn()} onDelete={vi.fn()} />);

    // 3/8 = 37.5 -> rounds to 38
    expect(screen.getByText('3/8 agents')).toBeInTheDocument();
    const fill = document.querySelector('[style*="width"]') as HTMLElement | null;
    expect(fill).not.toBeNull();
    expect(fill?.style.width).toBe('38%');
  });

  it('renders 0% and "0/0 agents" without dividing by zero when totalAgents is 0 (TS-187)', () => {
    const project = baseSummary({ completedAgents: 0, totalAgents: 0 });
    expect(() =>
      render(<ProjectCard project={project} onOpen={vi.fn()} onDelete={vi.fn()} />),
    ).not.toThrow();

    expect(screen.getByText('0/0 agents')).toBeInTheDocument();
    const fill = document.querySelector('[style*="width"]') as HTMLElement | null;
    expect(fill?.style.width).toBe('0%');
    expect(fill?.style.width).not.toContain('NaN');
    expect(fill?.style.width).not.toContain('Infinity');
  });

  it('clicking the card body calls onOpen (TS-188)', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const project = baseSummary();
    render(<ProjectCard project={project} onOpen={onOpen} onDelete={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: new RegExp(project.name) }));

    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('clicking delete confirms via window.confirm and calls onDelete without onOpen (TS-189)', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const onDelete = vi.fn();
    const project = baseSummary();
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<ProjectCard project={project} onOpen={onOpen} onDelete={onDelete} />);

    await user.click(screen.getByRole('button', { name: 'Delete project' }));

    expect(window.confirm).toHaveBeenCalledWith(`Delete "${project.name}"? This cannot be undone.`);
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('clicking delete and cancelling the confirm dialog does not call onDelete (TS-190)', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    const project = baseSummary();
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    render(<ProjectCard project={project} onOpen={vi.fn()} onDelete={onDelete} />);

    await user.click(screen.getByRole('button', { name: 'Delete project' }));

    expect(onDelete).not.toHaveBeenCalled();
  });

  it('renders no Restore button or archived metadata when onRestore is not provided (TS-191)', () => {
    const project = baseSummary({
      archivedReason: 'No longer needed',
      archivedBy: 'Alice',
      archivedAt: Date.now(),
    });
    render(<ProjectCard project={project} onOpen={vi.fn()} onDelete={vi.fn()} />);

    expect(screen.queryByRole('button', { name: 'Restore project' })).not.toBeInTheDocument();
    expect(screen.queryByText(/no longer needed/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^archived /i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete project' })).toBeInTheDocument();
  });
});
