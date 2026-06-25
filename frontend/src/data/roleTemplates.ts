/**
 * © 2025 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
/**
 * Suggested project roles with recommended agent assignments.
 * These are starting suggestions — admins can override any mapping.
 */
import type { AgentId, TeamRosterEntry } from '@/types/agent.types';
import type { TeamMember, AgentAssignment } from '@/types/project.types';

export interface RoleTemplate {
  id: string;
  title: string;
  description: string;
  color: string;
  /** Agents this role typically owns or reviews */
  suggestedAgents: AgentId[];
}

export const ROLE_TEMPLATES: RoleTemplate[] = [
  {
    id: 'product-manager',
    title: 'Product Manager',
    description: 'Owns product vision, requirements, and stakeholder communication.',
    color: '#4f46e5',
    suggestedAgents: ['manager', 'projectCharter', 'brd', 'stakeholder', 'userStory', 'businessRules', 'feasibility'],
  },
  {
    id: 'tech-lead',
    title: 'Tech Lead',
    description: 'Drives architecture, API design, and technical decisions.',
    color: '#0891b2',
    suggestedAgents: ['architecture', 'apiDesign', 'dataModel', 'techDebt'],
  },
  {
    id: 'ux-designer',
    title: 'UX Designer',
    description: 'Responsible for user research, interaction design, and usability.',
    color: '#db2777',
    suggestedAgents: ['uxResearch', 'interaction'],
  },
  {
    id: 'project-manager',
    title: 'Project Manager',
    description: 'Coordinates sprint planning, task breakdown, and delivery timelines.',
    color: '#d97706',
    suggestedAgents: ['sprintPlanner', 'taskBreakdown'],
  },
  {
    id: 'scrum-master',
    title: 'Scrum Master',
    description: 'Facilitates agile ceremonies, sprint planning, and backlog grooming; removes team blockers.',
    color: '#65a30d',
    suggestedAgents: ['sprintPlanner', 'taskBreakdown'],
  },
  {
    id: 'qa-engineer',
    title: 'QA Engineer',
    description: 'Owns test strategy, test cases, and quality gates.',
    color: '#059669',
    suggestedAgents: ['testPlan', 'testCases'],
  },
  {
    id: 'security-engineer',
    title: 'Security Engineer',
    description: 'Reviews security posture, compliance, and threat modelling.',
    color: '#dc2626',
    suggestedAgents: ['securityCompliance'],
  },
  {
    id: 'devops-engineer',
    title: 'DevOps Engineer',
    description: 'Owns CI/CD pipelines, deployment infrastructure, and IaC.',
    color: '#7c3aed',
    suggestedAgents: ['devopsEngineer', 'infraEngineer'],
  },
  {
    id: 'sre',
    title: 'SRE / Platform Engineer',
    description: 'Owns observability, on-call runbooks, and reliability engineering.',
    color: '#0d9488',
    suggestedAgents: ['observabilityEngineer', 'onCallEngineer'],
  },
  {
    id: 'engineering-manager',
    title: 'Engineering Manager',
    description: 'Drives delivery, coordinates sprint planning, task breakdown, tech debt, and team health.',
    color: '#b45309',
    suggestedAgents: ['sprintPlanner', 'taskBreakdown', 'techDebt', 'manager'],
  },
  {
    id: 'architect',
    title: 'Architect',
    description: 'Owns system architecture, API contracts, data modelling, feasibility, and infrastructure design.',
    color: '#6d28d9',
    suggestedAgents: ['architecture', 'apiDesign', 'dataModel', 'feasibility', 'infraEngineer'],
  },
];

/** All agents covered by at least one role template */
export const COVERED_AGENTS = new Set(ROLE_TEMPLATES.flatMap((r) => r.suggestedAgents));

/**
 * Build the team roster for an agent prompt context.
 *
 * Starts from the project's actual team members + agent assignments. For any
 * agent that has no assigned team member, falls back to the role template
 * that suggests that agent — so prompts always have a role to attribute
 * ownership/approval/assignment to, even when team setup is incomplete.
 *
 * Fallback entries are named "<Role Title> (role)" so it's clear in generated
 * documents that this is a placeholder role rather than a real person.
 */
export function buildTeamRoster(project: {
  teamMembers?: TeamMember[];
  agentAssignments?: AgentAssignment[];
}): TeamRosterEntry[] {
  const members = project.teamMembers ?? [];
  const assignments = project.agentAssignments ?? [];

  const roster: TeamRosterEntry[] = members.map((m) => ({
    name: m.name,
    role: m.role,
    agents: assignments
      .filter((a) => a.memberIds.includes(m.id))
      .map((a) => a.agentId),
  }));

  // Determine which agents already have at least one real assignee
  const assignedAgents = new Set<AgentId>();
  for (const a of assignments) {
    if (a.memberIds.length > 0) {
      assignedAgents.add(a.agentId);
    }
  }

  // Group unassigned agents by the role template that suggests them
  const fallbackByRole = new Map<string, { title: string; agents: AgentId[] }>();
  for (const role of ROLE_TEMPLATES) {
    for (const agentId of role.suggestedAgents) {
      if (assignedAgents.has(agentId)) continue;
      const entry = fallbackByRole.get(role.id) ?? { title: role.title, agents: [] };
      if (!entry.agents.includes(agentId)) {
        entry.agents.push(agentId);
      }
      fallbackByRole.set(role.id, entry);
    }
  }

  for (const { title, agents } of fallbackByRole.values()) {
    if (agents.length === 0) continue;
    roster.push({
      name: `${title} (role)`,
      role: title,
      agents,
    });
  }

  return roster;
}
