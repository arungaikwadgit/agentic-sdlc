import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AGENT_DEFINITIONS } from '../../frontend/src/agents/definitions';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const reportPath = path.join(
  repoRoot,
  'AgenticAnalysis',
  'agentic_ai_common_audit_execution_report_2026-07-08.md',
);

function readRepoFile(...segments: string[]): string {
  return fs.readFileSync(path.join(repoRoot, ...segments), 'utf8');
}

function walkTextFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkTextFiles(full));
      continue;
    }
    if (/\.(ts|tsx|js|mjs|css|json|sql|md)$/.test(entry.name) || entry.name === 'LICENSE' || entry.name === 'Dockerfile') {
      out.push(full);
    }
  }
  return out;
}

describe('recent governance and audit artifacts', () => {
  it('keeps Arun signature headers on the 2026 year across source and metadata files', () => {
    const scanRoots = [
      path.join(repoRoot, 'backend', 'src'),
      path.join(repoRoot, 'frontend', 'src'),
      path.join(repoRoot, 'frontend', 'scripts'),
      path.join(repoRoot, 'server', 'src'),
      path.join(repoRoot, 'supabase', 'migrations'),
      path.join(repoRoot, 'docker'),
    ];

    const files = [
      path.join(repoRoot, 'LICENSE'),
      path.join(repoRoot, 'server', 'package.json'),
      ...scanRoots.flatMap(walkTextFiles),
    ];

    const combined = files.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
    expect(combined).not.toMatch(/2025 Arun Gaikwad/);
    expect((combined.match(/2026 Arun Gaikwad/g) ?? []).length).toBeGreaterThan(50);
  });

  it('documents the requested 5/5 action areas in the audit report', () => {
    const report = fs.readFileSync(reportPath, 'utf8');

    expect(report).toContain('Support Projects Already In Flight');
    expect(report).toContain('Support Project Change Requests Against Existing Systems');
    expect(report).toContain('Minimize Token Usage And Optimize Cost On Reruns');
    expect(report).toContain('Expand The Testing Phase Into A True Quality Engineering System');
    expect(report).toContain('Make The Chatbot Truly Agentic');
    expect(report).toContain('5/5 Success Criteria');
  });

  it('keeps the Postgres-first gap report aligned with the current file-backed master catalog implementation', () => {
    const report = fs.readFileSync(reportPath, 'utf8');
    const catalog = readRepoFile('frontend', 'src', 'services', 'masterDataCatalog.ts');

    expect(catalog).toContain("import { PHASE_ORDER");
    expect(catalog).toContain("import { AGENT_DEFINITIONS");
    expect(catalog).toContain("import { DOMAINS");
    expect(catalog).toContain("import { ROLE_TEMPLATES");
    expect(catalog).toContain('applyCatalog(catalog)');
    expect(catalog).toContain('import.meta.env.DEV');

    expect(report).toContain('GAP-001');
    expect(report).toContain('Master agent catalog is still file-bootstrapped');
    expect(report).toContain('master data still boots from frontend file registries');
  });

  it('tracks the chatbot as a candidate for a governed agentic runtime, not only FAQ matching', () => {
    const report = fs.readFileSync(reportPath, 'utf8');
    const chatWidget = readRepoFile('frontend', 'src', 'chatbot', 'ChatWidget.tsx');

    expect(chatWidget).toContain('matchFaq');
    expect(chatWidget).toContain('api.callAgent');

    expect(report).toContain('FAQ-first architecture');
    expect(report).toContain('chat_sessions');
    expect(report).toContain('chat_action_proposals');
    expect(report).toContain('role-aware');
  });

  it('guards the expanded testing-phase expectations on the Phase 5 agents', () => {
    const testPlanPrompt = AGENT_DEFINITIONS.testPlan.buildUserPrompt({
      projectName: 'Governance Test',
      projectDescription: 'A project with APIs, data, and release risk.',
      domain: 'saas',
      domainContext: 'SaaS context',
      priorOutputs: {},
      teamRoster: [{ name: 'Quinn QA', role: 'QA Engineer', agents: ['testPlan', 'testCases'] }],
    });
    const testCasesPrompt = AGENT_DEFINITIONS.testCases.buildUserPrompt({
      projectName: 'Governance Test',
      projectDescription: 'A project with APIs, data, and release risk.',
      domain: 'saas',
      domainContext: 'SaaS context',
      priorOutputs: {},
      teamRoster: [{ name: 'Quinn QA', role: 'QA Engineer', agents: ['testPlan', 'testCases'] }],
    });

    expect(testPlanPrompt).toContain('Unit, Integration, System, UAT, Performance, Security, Accessibility');
    expect(testPlanPrompt).toContain('Automation Strategy');
    expect(testCasesPrompt).toContain('API contracts');
    expect(testCasesPrompt).toContain('Performance test scenarios');
    expect(testCasesPrompt).toContain('Regression test suite outline');

    expect(AGENT_DEFINITIONS.testPlan.goal?.({
      projectName: 'Governance Test',
      projectDescription: 'A project with APIs, data, and release risk.',
      domain: 'saas',
      domainContext: 'SaaS context',
      priorOutputs: {},
      teamRoster: [],
    })).toContain('MANDATORY STEP SEQUENCE');
    expect(AGENT_DEFINITIONS.testCases.dependsOn).toEqual(['testPlan', 'userStory', 'apiDesign', 'dataModel']);
    expect(AGENT_DEFINITIONS.testCases.maxIterations).toBeGreaterThanOrEqual(6);
  });
});
