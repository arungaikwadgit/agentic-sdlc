/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
/**
 * L3 Agent Tool Registry
 *
 * Each tool here can be assigned to any AgentDefinition.tools[].
 * Tools are called by the L3 runtime when the LLM emits a tool_call block.
 *
 * Tool contract:
 *   - name      : snake_case, matches the LLM tool_call.name exactly
 *   - description: what the tool does, shown to the LLM
 *   - inputSchema: JSON Schema describing input params (used in system prompt)
 *   - execute   : async function — receives validated args + AgentPromptContext,
 *                 returns a JSON-serialisable value written back to the LLM as
 *                 the tool result.
 *
 * Design rule: tools must be pure from the agent's perspective — they read
 * context or call external read-only APIs. Write side-effects (DB, file)
 * belong in the pipeline engine, not here.
 */

import type { AgentTool, AgentPromptContext } from '@/types/agent.types';

// ─── Tool: search_prior_outputs ──────────────────────────────────────────────
/**
 * Allows an agent to search the text of completed prior agent outputs by keyword.
 * This is the primary "memory read" tool — agents use it to pull relevant
 * sections from earlier phases before writing their own document.
 */
export const searchPriorOutputsTool: AgentTool = {
  name: 'search_prior_outputs',
  description:
    'Search the text output of previously completed agents in this pipeline for a keyword or phrase. ' +
    'Returns matching excerpts (up to 800 characters each) so you can ground your output in prior decisions. ' +
    'Use this before writing sections that reference earlier agents\'s outputs.',
  inputSchema: {
    type: 'object',
    required: ['keyword', 'agent_ids'],
    properties: {
      keyword: {
        type: 'string',
        description: 'Keyword or phrase to search for (case-insensitive).',
      },
      agent_ids: {
        type: 'array',
        items: { type: 'string' },
        description:
          'List of agent IDs to search within (e.g. ["manager", "brd", "architecture"]). ' +
          'Pass ["*"] to search all available prior outputs.',
      },
    },
  },
  execute: async (args, ctx) => {
    const keyword = String(args.keyword ?? '').toLowerCase();
    const ids = Array.isArray(args.agent_ids) ? (args.agent_ids as string[]) : ['*'];
    const searchAll = ids.includes('*');

    const results: Array<{ agent: string; excerpt: string }> = [];

    for (const [agentId, text] of Object.entries(ctx.priorOutputs)) {
      if (!text) continue;
      if (!searchAll && !ids.includes(agentId)) continue;

      const lower = text.toLowerCase();
      let pos = lower.indexOf(keyword);
      let count = 0;
      while (pos !== -1 && count < 3) {
        const start = Math.max(0, pos - 150);
        const end = Math.min(text.length, pos + 650);
        results.push({ agent: agentId, excerpt: text.slice(start, end).trim() });
        pos = lower.indexOf(keyword, pos + 1);
        count++;
      }
    }

    if (results.length === 0) {
      return { found: false, message: `No matches for "${args.keyword}" in the searched outputs.` };
    }

    return { found: true, matches: results };
  },
};

// ─── Tool: get_requirement_ids ────────────────────────────────────────────────
/**
 * Extracts all numbered requirement IDs (FR-xxx, BR-xxx, US-xxx, BRU-xxx)
 * from prior outputs. Useful for agents that need to cross-reference or
 * build traceability matrices.
 */
export const getRequirementIdsTool: AgentTool = {
  name: 'get_requirement_ids',
  description:
    'Extract all numbered requirement IDs (FR-xxx, BR-xxx, US-xxx, BRU-xxx) from prior agent outputs. ' +
    'Use this when you need to reference specific requirements for traceability or cross-referencing.',
  inputSchema: {
    type: 'object',
    properties: {
      prefix: {
        type: 'string',
        description:
          'Filter by prefix (e.g. "FR" returns only FR-xxx). Omit to return all types.',
      },
    },
  },
  execute: async (args, ctx) => {
    const prefix = args.prefix ? String(args.prefix).toUpperCase() : null;
    const pattern = /\b([A-Z]{2,4}-\d{3,})\b/g;
    const found = new Map<string, string[]>();

    for (const [agentId, text] of Object.entries(ctx.priorOutputs)) {
      if (!text) continue;
      const matches = [...text.matchAll(pattern)].map((m) => m[1]);
      const filtered = prefix ? matches.filter((id) => id.startsWith(prefix + '-')) : matches;
      const unique = [...new Set(filtered)];
      if (unique.length > 0) found.set(agentId, unique);
    }

    if (found.size === 0) {
      return { found: false, message: 'No requirement IDs found in prior outputs.' };
    }

    return {
      found: true,
      ids: Object.fromEntries(found),
      total: [...found.values()].flat().length,
    };
  },
};

// ─── Tool: get_team_roster ────────────────────────────────────────────────────
/**
 * Returns the project's team roster so agents can assign owners,
 * approvers, and RACI roles using real names.
 */
export const getTeamRosterTool: AgentTool = {
  name: 'get_team_roster',
  description:
    'Return the full project team roster (names, roles, agent assignments). ' +
    'Use this before assigning owners, approvers, or RACI roles in your output.',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  execute: async (_args, ctx) => {
    if (!ctx.teamRoster || ctx.teamRoster.length === 0) {
      return { found: false, message: 'No team roster defined for this project.' };
    }
    return {
      found: true,
      roster: ctx.teamRoster.map((m) => ({ name: m.name, role: m.role, assignedAgents: m.agents })),
    };
  },
};

// ─── Tool: get_domain_context ─────────────────────────────────────────────────
/**
 * Returns the project's domain knowledge block so agents can ground
 * domain-specific decisions in the owner-supplied or AI-generated context.
 */
export const getDomainContextTool: AgentTool = {
  name: 'get_domain_context',
  description:
    'Return the domain knowledge context for this project (industry, regulations, conventions, key terminology). ' +
    'Use this to ensure domain-specific accuracy in your output.',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  execute: async (_args, ctx) => {
    return {
      domain: ctx.domain,
      domainContext: ctx.domainContext || 'No domain-specific context was provided.',
    };
  },
};

// ─── Tool: get_agent_output ───────────────────────────────────────────────────
/**
 * Fetch the complete output of a single prior agent by ID.
 * Agents use this when they need the full text of one specific document
 * rather than keyword search results.
 */
export const getAgentOutputTool: AgentTool = {
  name: 'get_agent_output',
  description:
    'Retrieve the complete output document from a previously completed agent. ' +
    'Use when you need the full content of one specific prior document ' +
    '(e.g. the full architecture document before writing the API spec).',
  inputSchema: {
    type: 'object',
    required: ['agent_id'],
    properties: {
      agent_id: {
        type: 'string',
        description:
          'The agent ID to fetch (e.g. "manager", "brd", "architecture", "dataModel").',
      },
    },
  },
  execute: async (args, ctx) => {
    const id = String(args.agent_id ?? '');
    const text = ctx.priorOutputs[id as keyof typeof ctx.priorOutputs];
    if (!text) {
      return { found: false, message: `Agent "${id}" has not completed or produced no output.` };
    }
    return { found: true, agent_id: id, output: text };
  },
};

// ─── Tool: validate_output_completeness ──────────────────────────────────────
/**
 * An agent can call this tool on its own draft output to check whether
 * required sections are present before finalising. The tool returns a list
 * of any missing sections so the agent can revise its plan.
 */
export const validateOutputCompletenessTool: AgentTool = {
  name: 'validate_output_completeness',
  description:
    'Check whether a draft output contains all required section headings. ' +
    'Returns a list of missing sections so you can revise your plan before finalising. ' +
    'Call this after generating a draft and before declaring the output complete.',
  inputSchema: {
    type: 'object',
    required: ['draft', 'required_sections'],
    properties: {
      draft: {
        type: 'string',
        description: 'The draft output text to validate.',
      },
      required_sections: {
        type: 'array',
        items: { type: 'string' },
        description:
          'List of section heading keywords that must appear in the output ' +
          '(case-insensitive, e.g. ["Executive Summary", "Scope", "Risks"]).',
      },
    },
  },
  execute: async (args, _ctx) => {
    const draft = String(args.draft ?? '').toLowerCase();
    const required = Array.isArray(args.required_sections)
      ? (args.required_sections as string[])
      : [];

    const missing = required.filter((s) => !draft.includes(s.toLowerCase()));
    const present = required.filter((s) => draft.includes(s.toLowerCase()));

    return {
      valid: missing.length === 0,
      present,
      missing,
      coveragePercent: Math.round((present.length / Math.max(required.length, 1)) * 100),
    };
  },
};

// ─── Tool: count_requirement_coverage ────────────────────────────────────────
/**
 * Given a draft and a list of requirement IDs, checks how many are
 * explicitly referenced. Helps agents ensure traceability coverage.
 */
export const countRequirementCoverageTool: AgentTool = {
  name: 'count_requirement_coverage',
  description:
    'Check how many requirement IDs from the prior outputs appear in a draft. ' +
    'Use this to verify traceability coverage before finalising.',
  inputSchema: {
    type: 'object',
    required: ['draft', 'requirement_ids'],
    properties: {
      draft: {
        type: 'string',
        description: 'The draft output to check.',
      },
      requirement_ids: {
        type: 'array',
        items: { type: 'string' },
        description: 'List of requirement IDs to check for (e.g. ["FR-001", "FR-002"]).',
      },
    },
  },
  execute: async (args, _ctx) => {
    const draft = String(args.draft ?? '');
    const ids = Array.isArray(args.requirement_ids) ? (args.requirement_ids as string[]) : [];
    const covered = ids.filter((id) => draft.includes(id));
    const uncovered = ids.filter((id) => !draft.includes(id));
    return {
      total: ids.length,
      covered: covered.length,
      uncovered,
      coveragePercent: Math.round((covered.length / Math.max(ids.length, 1)) * 100),
    };
  },
};

// ─── Tool: get_style_guide ────────────────────────────────────────────────────
/**
 * Fetches the combined style guide context for the current project.
 *
 * Returns TWO sources of design truth in one call:
 *   1. The complete UX Mockups output (colors, typography, design tokens, CSS
 *      custom properties, component patterns) — if it has already been generated.
 *   2. Any style guide / brand documents uploaded by the user as context files
 *      (brand books, design specs, color swatches, etc.).
 *
 * Design agents (UX Mockups, Working Prototype) MUST call this as their FIRST
 * step so that uploaded brand guidelines and approved mockup design systems are
 * reflected in every piece of generated UI or code.
 */
export const getStyleGuideTool: AgentTool = {
  name: 'get_style_guide',
  description:
    'Retrieve the complete style guide context for this project. ' +
    'Returns (1) the UX Mockups output — full design system tokens, color palette, typography, ' +
    'component patterns, and HTML mockup source — if it has already been generated, AND ' +
    '(2) any style guide or brand documents uploaded by the user (brand books, design specs, ' +
    'color guides, etc.). ' +
    'ALWAYS call this as your FIRST step before generating any UI, mockup, or prototype output. ' +
    'If either source is found, extract the exact colors, fonts, spacing, and brand identity and ' +
    'apply them verbatim — do not invent a new design system when one has been provided.',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  execute: async (_args, ctx) => {
    const uxMockupsText = ctx.priorOutputs['uxMockups' as keyof typeof ctx.priorOutputs];
    const contextDocs = ctx.contextDocuments;

    let anyFound = false;

    const uxMockups = uxMockupsText
      ? (() => {
          anyFound = true;
          return {
            found: true,
            note:
              'Extract --color-primary, --color-secondary, --color-accent, --color-surface, ' +
              '--color-text, --font-family, --radius, --shadow-sm/md/lg from the CSS :root ' +
              'block and apply them exactly.',
            output: uxMockupsText,
          };
        })()
      : { found: false, message: 'UX Mockups agent has not run yet for this project.' };

    const uploadedDocs =
      contextDocs && contextDocs.length > 0
        ? (() => {
            anyFound = true;
            return {
              found: true,
              count: contextDocs.length,
              note:
                'These documents were uploaded by the project owner and take FULL PRECEDENCE ' +
                'over default design choices. Extract colors, fonts, spacing, and brand identity ' +
                'and apply them exactly.',
              documents: contextDocs.map((doc) => ({
                name: doc.name,
                kind: doc.kind,
                sizeKb: doc.sizeKb,
                content: doc.content,
              })),
            };
          })()
        : { found: false, message: 'No style guide documents were uploaded by the user.' };

    return {
      found: anyFound,
      uxMockups,
      uploadedStyleGuide: uploadedDocs,
      instruction: anyFound
        ? 'Use the design tokens, colors, typography, and brand identity from the sources above. ' +
          'Uploaded documents (uploadedStyleGuide) take precedence over uxMockups when both exist.'
        : 'No style guide context is available. Proceed with professional domain-appropriate design defaults.',
    };
  },
};

// ─── Convenience bundles ──────────────────────────────────────────────────────

/** Full tool set for document-producing agents (all tools) */
export const ALL_TOOLS: AgentTool[] = [
  getStyleGuideTool,
  searchPriorOutputsTool,
  getRequirementIdsTool,
  getTeamRosterTool,
  getDomainContextTool,
  getAgentOutputTool,
  validateOutputCompletenessTool,
  countRequirementCoverageTool,
];

/** Minimal tool set — for agents that only need context lookup */
export const CONTEXT_TOOLS: AgentTool[] = [
  getStyleGuideTool,
  getAgentOutputTool,
  getDomainContextTool,
  getTeamRosterTool,
];

/** Research tool set — for agents that synthesise prior work */
export const RESEARCH_TOOLS: AgentTool[] = [
  getStyleGuideTool,
  searchPriorOutputsTool,
  getRequirementIdsTool,
  getAgentOutputTool,
  getDomainContextTool,
  getTeamRosterTool,
];
