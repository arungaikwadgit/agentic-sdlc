// tests/unit/buildContext.test.ts
import { describe, it, expect } from 'vitest';
import { DOMAINS } from '../../frontend/src/agents/domains';
import type { Project, TeamMember, AgentAssignment } from '../../frontend/src/types/project.types';
import type { AgentId } from '../../frontend/src/types/agent.types';

// ── Replicate buildContext logic (mirrors pipelineEngine.ts) ───────────────
function buildContext(project: Project) {
  const domain = DOMAINS[project.domain] ?? DOMAINS['saas'];
  const priorOutputs: Partial<Record<AgentId, string>> = {};
  for (const [agentId, run] of Object.entries(project.agentRuns)) {
    if (run?.status === 'complete' && run.output) {
      priorOutputs[agentId as AgentId] = run.output;
    }
  }
  const members = project.teamMembers ?? [];
  const assignments = project.agentAssignments ?? [];
  const teamRoster = members.map((m) => ({
    name: m.name,
    role: m.role,
    agents: assignments
      .filter((a) => a.memberIds.includes(m.id))
      .map((a) => a.agentId),
  }));
  return {
    projectName: project.name,
    projectDescription: project.description,
    domain: domain.id,
    domainContext: domain.context,
    priorOutputs,
    teamRoster,
  };
}

// ── Fixtures ───────────────────────────────────────────────────────────────
const makeMember = (id: string, name: string, role: string, isAdmin = false): TeamMember => ({
  id, name, email: `${name.toLowerCase()}@test.com`,
  role, isAdmin, avatarColor: '#000',
});

const BASE_PROJECT: Project = {
  id: 'proj1',
  name: 'My App',
  description: 'A cool app',
  domain: 'saas',
  mode: 'expert',
  status: 'draft',
  version: 1,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  currentPhase: 'phase1',
  agentRuns: {},
  reviewGates: {},
  promptOverrides: [],
  teamMembers: [],
  agentAssignments: [],
};

describe('buildContext — teamRoster', () => {
  it('returns empty teamRoster when no members', () => {
    const ctx = buildContext(BASE_PROJECT);
    expect(ctx.teamRoster).toEqual([]);
  });

  it('maps a single member with their assigned agents', () => {
    const members = [makeMember('u1', 'Alice', 'tech-lead', true)];
    const assignments: AgentAssignment[] = [
      { agentId: 'architecture' as AgentId, memberIds: ['u1'] },
      { agentId: 'apiDesign' as AgentId, memberIds: ['u1'] },
    ];
    const ctx = buildContext({ ...BASE_PROJECT, teamMembers: members, agentAssignments: assignments });
    expect(ctx.teamRoster).toHaveLength(1);
    expect(ctx.teamRoster[0].name).toBe('Alice');
    expect(ctx.teamRoster[0].role).toBe('tech-lead');
    expect(ctx.teamRoster[0].agents).toContain('architecture');
    expect(ctx.teamRoster[0].agents).toContain('apiDesign');
  });

  it('maps multiple members with no agent overlap', () => {
    const members = [
      makeMember('u1', 'Alice', 'tech-lead', true),
      makeMember('u2', 'Bob', 'qa-engineer'),
    ];
    const assignments: AgentAssignment[] = [
      { agentId: 'architecture' as AgentId, memberIds: ['u1'] },
      { agentId: 'testPlan' as AgentId, memberIds: ['u2'] },
    ];
    const ctx = buildContext({ ...BASE_PROJECT, teamMembers: members, agentAssignments: assignments });
    const alice = ctx.teamRoster.find((r) => r.name === 'Alice')!;
    const bob   = ctx.teamRoster.find((r) => r.name === 'Bob')!;
    expect(alice.agents).toEqual(['architecture']);
    expect(bob.agents).toEqual(['testPlan']);
  });

  it('member with no assignments gets empty agents array', () => {
    const members = [makeMember('u1', 'Alice', 'tech-lead', true)];
    const ctx = buildContext({ ...BASE_PROJECT, teamMembers: members, agentAssignments: [] });
    expect(ctx.teamRoster[0].agents).toEqual([]);
  });

  it('multiple members can share the same agent assignment', () => {
    const members = [
      makeMember('u1', 'Alice', 'tech-lead', true),
      makeMember('u2', 'Bob', 'sre'),
    ];
    const assignments: AgentAssignment[] = [
      { agentId: 'architecture' as AgentId, memberIds: ['u1', 'u2'] },
    ];
    const ctx = buildContext({ ...BASE_PROJECT, teamMembers: members, agentAssignments: assignments });
    const alice = ctx.teamRoster.find((r) => r.name === 'Alice')!;
    const bob   = ctx.teamRoster.find((r) => r.name === 'Bob')!;
    expect(alice.agents).toContain('architecture');
    expect(bob.agents).toContain('architecture');
  });

  it('teamRoster preserves member order', () => {
    const members = [
      makeMember('u1', 'Alice', 'tech-lead', true),
      makeMember('u2', 'Bob', 'qa-engineer'),
      makeMember('u3', 'Carol', 'sre'),
    ];
    const ctx = buildContext({ ...BASE_PROJECT, teamMembers: members, agentAssignments: [] });
    expect(ctx.teamRoster.map((r) => r.name)).toEqual(['Alice', 'Bob', 'Carol']);
  });
});

describe('buildContext — priorOutputs', () => {
  it('only includes complete runs with output', () => {
    const project: Project = {
      ...BASE_PROJECT,
      agentRuns: {
        manager:   { agentId: 'manager' as AgentId, status: 'complete', output: 'Done', completedAt: 1 },
        brd:       { agentId: 'brd' as AgentId, status: 'running' },
        userStory: { agentId: 'userStory' as AgentId, status: 'error', error: 'timeout' },
      } as any,
    };
    const ctx = buildContext(project);
    expect(ctx.priorOutputs['manager' as AgentId]).toBe('Done');
    expect(ctx.priorOutputs['brd' as AgentId]).toBeUndefined();
    expect(ctx.priorOutputs['userStory' as AgentId]).toBeUndefined();
  });

  it('returns empty priorOutputs for a fresh project', () => {
    const ctx = buildContext(BASE_PROJECT);
    expect(Object.keys(ctx.priorOutputs)).toHaveLength(0);
  });

  it('excludes complete runs with empty output', () => {
    const project: Project = {
      ...BASE_PROJECT,
      agentRuns: {
        manager: { agentId: 'manager' as AgentId, status: 'complete', output: '' },
      } as any,
    };
    const ctx = buildContext(project);
    expect(ctx.priorOutputs['manager' as AgentId]).toBeUndefined();
  });

  it('includes multiple complete runs', () => {
    const project: Project = {
      ...BASE_PROJECT,
      agentRuns: {
        manager: { agentId: 'manager' as AgentId, status: 'complete', output: 'PRD output' },
        brd:     { agentId: 'brd' as AgentId, status: 'complete', output: 'BRD output' },
      } as any,
    };
    const ctx = buildContext(project);
    expect(ctx.priorOutputs['manager' as AgentId]).toBe('PRD output');
    expect(ctx.priorOutputs['brd' as AgentId]).toBe('BRD output');
  });
});

describe('buildContext — metadata', () => {
  it('maps domain id and context correctly', () => {
    const ctx = buildContext(BASE_PROJECT);
    expect(ctx.domain).toBe('saas');
    expect(typeof ctx.domainContext).toBe('string');
    expect(ctx.domainContext.length).toBeGreaterThan(0);
  });

  it('projectName and projectDescription pass through', () => {
    const ctx = buildContext(BASE_PROJECT);
    expect(ctx.projectName).toBe('My App');
    expect(ctx.projectDescription).toBe('A cool app');
  });
});
