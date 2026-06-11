// tests/unit/roleTemplates.test.ts
import { describe, it, expect } from 'vitest';
import { ROLE_TEMPLATES, COVERED_AGENTS, buildTeamRoster } from '../../frontend/src/data/roleTemplates';
import type { AgentId } from '../../frontend/src/types/agent.types';
import type { TeamMember, AgentAssignment } from '../../frontend/src/types/project.types';

describe('ROLE_TEMPLATES', () => {
  it('exports exactly 11 templates', () => {
    expect(ROLE_TEMPLATES).toHaveLength(11);
  });

  it('contains all expected role IDs', () => {
    const ids = ROLE_TEMPLATES.map((r) => r.id);
    expect(ids).toContain('product-manager');
    expect(ids).toContain('tech-lead');
    expect(ids).toContain('ux-designer');
    expect(ids).toContain('project-manager');
    expect(ids).toContain('scrum-master');
    expect(ids).toContain('qa-engineer');
    expect(ids).toContain('security-engineer');
    expect(ids).toContain('devops-engineer');
    expect(ids).toContain('sre');
    expect(ids).toContain('engineering-manager');
    expect(ids).toContain('architect');
  });

  it('scrum-master has the expected shape (TS-110)', () => {
    const sm = ROLE_TEMPLATES.find((r) => r.id === 'scrum-master')!;
    expect(sm).toBeDefined();
    expect(sm.title).toBe('Scrum Master');
    expect(sm.color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(sm.description.length).toBeGreaterThan(0);
    expect(sm.suggestedAgents).toContain('sprintPlanner' as AgentId);
    expect(sm.suggestedAgents).toContain('taskBreakdown' as AgentId);
  });

  it('each template has a non-empty title and description', () => {
    for (const t of ROLE_TEMPLATES) {
      expect(t.title.length, `${t.id} title empty`).toBeGreaterThan(0);
      expect(t.description.length, `${t.id} description empty`).toBeGreaterThan(0);
    }
  });

  it('each template has a valid CSS hex color', () => {
    for (const t of ROLE_TEMPLATES) {
      expect(t.color, `${t.id} color invalid`).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('each template has at least one suggestedAgent', () => {
    for (const t of ROLE_TEMPLATES) {
      expect(t.suggestedAgents.length, `${t.id} has no suggested agents`).toBeGreaterThan(0);
    }
  });

  it('has no duplicate role IDs', () => {
    const ids = ROLE_TEMPLATES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('product-manager covers core SDLC agents', () => {
    const pm = ROLE_TEMPLATES.find((r) => r.id === 'product-manager')!;
    expect(pm.suggestedAgents).toContain('brd' as AgentId);
    expect(pm.suggestedAgents).toContain('userStory' as AgentId);
  });

  it('tech-lead covers architecture and API design', () => {
    const tl = ROLE_TEMPLATES.find((r) => r.id === 'tech-lead')!;
    expect(tl.suggestedAgents).toContain('architecture' as AgentId);
    expect(tl.suggestedAgents).toContain('apiDesign' as AgentId);
  });

  it('sre covers observability and on-call', () => {
    const sre = ROLE_TEMPLATES.find((r) => r.id === 'sre')!;
    expect(sre.suggestedAgents).toContain('observabilityEngineer' as AgentId);
    expect(sre.suggestedAgents).toContain('onCallEngineer' as AgentId);
  });

  it('architect covers infra and data model', () => {
    const arch = ROLE_TEMPLATES.find((r) => r.id === 'architect')!;
    expect(arch.suggestedAgents).toContain('infraEngineer' as AgentId);
    expect(arch.suggestedAgents).toContain('dataModel' as AgentId);
  });
});

describe('COVERED_AGENTS', () => {
  it('is a Set', () => {
    expect(COVERED_AGENTS).toBeInstanceOf(Set);
  });

  it('contains at least 15 agents', () => {
    expect(COVERED_AGENTS.size).toBeGreaterThanOrEqual(15);
  });

  it('includes every agent referenced by at least one template', () => {
    for (const t of ROLE_TEMPLATES) {
      for (const a of t.suggestedAgents) {
        expect(COVERED_AGENTS.has(a), `${a} missing from COVERED_AGENTS`).toBe(true);
      }
    }
  });

  it('does not include empty strings', () => {
    expect(COVERED_AGENTS.has('' as AgentId)).toBe(false);
  });
});

describe('buildTeamRoster', () => {
  const ALICE: TeamMember = {
    id: 'alice-id',
    name: 'Alice Admin',
    email: 'alice@example.com',
    role: 'Product Manager',
    avatarColor: '#4f46e5',
    isAdmin: true,
  };

  it('TS-111: real members only — no fallback entries when every COVERED_AGENTS agent is assigned', () => {
    const allCoveredAgents = Array.from(COVERED_AGENTS) as AgentId[];
    const agentAssignments: AgentAssignment[] = allCoveredAgents.map((agentId) => ({
      agentId,
      memberIds: [ALICE.id],
    }));

    const roster = buildTeamRoster({ teamMembers: [ALICE], agentAssignments });

    // One real-member entry for Alice, listing every covered agent.
    const aliceEntry = roster.find((r) => r.name === 'Alice Admin');
    expect(aliceEntry).toBeDefined();
    expect(aliceEntry!.role).toBe('Product Manager');
    for (const agentId of allCoveredAgents) {
      expect(aliceEntry!.agents).toContain(agentId);
    }

    // No "(role)" fallback entries, since assignedAgents covers everything
    // ROLE_TEMPLATES could suggest.
    const fallbackEntries = roster.filter((r) => r.name.endsWith('(role)'));
    expect(fallbackEntries).toHaveLength(0);
  });

  it('TS-112: empty project — one "(role)" fallback entry per role template with suggestedAgents', () => {
    const roster = buildTeamRoster({ teamMembers: [], agentAssignments: [] });

    // No real members.
    expect(roster.every((r) => r.name.endsWith('(role)'))).toBe(true);

    for (const template of ROLE_TEMPLATES) {
      if (template.suggestedAgents.length === 0) continue;
      const entry = roster.find((r) => r.name === `${template.title} (role)`);
      expect(entry, `expected fallback entry for ${template.title}`).toBeDefined();
      for (const agentId of template.suggestedAgents) {
        expect(entry!.agents).toContain(agentId);
      }
      // Deduplicated.
      expect(new Set(entry!.agents).size).toBe(entry!.agents.length);
    }
  });

  it('TS-113: overlapping role templates each produce their own fallback entry (documents current, possibly-redundant behavior)', () => {
    const roster = buildTeamRoster({ teamMembers: [], agentAssignments: [] });

    const pmEntry = roster.find((r) => r.name === 'Project Manager (role)');
    const smEntry = roster.find((r) => r.name === 'Scrum Master (role)');
    const emEntry = roster.find((r) => r.name === 'Engineering Manager (role)');

    expect(pmEntry).toBeDefined();
    expect(smEntry).toBeDefined();
    expect(emEntry).toBeDefined();

    // All three list sprintPlanner and taskBreakdown — same agents,
    // attributed to multiple placeholder roles. Not deduplicated across
    // templates; see team-and-roles.md Dev Note #3.
    for (const entry of [pmEntry!, smEntry!, emEntry!]) {
      expect(entry.agents).toContain('sprintPlanner' as AgentId);
      expect(entry.agents).toContain('taskBreakdown' as AgentId);
    }
  });

  it('mixed: a real assignment for one agent removes it from fallback entries that suggest it', () => {
    const agentAssignments: AgentAssignment[] = [
      { agentId: 'sprintPlanner' as AgentId, memberIds: [ALICE.id] },
    ];
    const roster = buildTeamRoster({ teamMembers: [ALICE], agentAssignments });

    const aliceEntry = roster.find((r) => r.name === 'Alice Admin');
    expect(aliceEntry!.agents).toContain('sprintPlanner' as AgentId);

    // Fallback entries for roles that suggest sprintPlanner should no
    // longer include it (it's now an assignedAgent), but should still
    // include taskBreakdown if that's still unassigned.
    const pmEntry = roster.find((r) => r.name === 'Project Manager (role)');
    if (pmEntry) {
      expect(pmEntry.agents).not.toContain('sprintPlanner' as AgentId);
      expect(pmEntry.agents).toContain('taskBreakdown' as AgentId);
    }
  });
});
