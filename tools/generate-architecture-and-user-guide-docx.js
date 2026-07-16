const fs = require('fs');
const path = require('path');
const {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  PageBreak,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableOfContents,
  TableRow,
  TextRun,
  WidthType,
} = require('C:/Projects/SLDC - AI/.codex-docx/node_modules/docx');

let sharp;
try {
  sharp = require('sharp');
} catch {
  sharp = require('C:/Projects/SLDC - AI/.codex-docx/node_modules/sharp');
}

const repoRoot = path.resolve(__dirname, '..');
const docsRoot = path.join(repoRoot, 'docs');
const architectureDir = path.join(docsRoot, 'architecture');
const architectureAssets = path.join(architectureDir, 'assets');
const userGuideAssets = path.join(docsRoot, 'assets', 'user-guide');

const architectureDocx = path.join(architectureDir, 'Agentic-SDLC-Professional-Architecture-Document.docx');
const quickGuideDocx = path.join(docsRoot, 'Agentic-SDLC-Quick-Start-Guide.docx');

const PAGE = {
  width: 12240,
  height: 15840,
  margin: { top: 900, right: 900, bottom: 900, left: 900 },
  contentWidthPx: 680,
};

const colors = {
  navy: '172033',
  blue: '2F5597',
  lightBlue: 'D9EAF7',
  purple: '5B5FEF',
  gray: 'F2F5F9',
  border: 'B7C4D6',
  green: 'DFF3E6',
  orange: 'FFF2CC',
  red: 'FCE4E4',
};

function text(value, opts = {}) {
  return new TextRun({
    text: String(value),
    font: 'Arial',
    size: opts.size ?? 22,
    bold: opts.bold,
    italics: opts.italics,
    color: opts.color,
  });
}

function paragraph(value, opts = {}) {
  return new Paragraph({
    alignment: opts.alignment,
    spacing: { before: opts.before ?? 0, after: opts.after ?? 120, line: 276 },
    heading: opts.heading,
    children: Array.isArray(value) ? value : [text(value, opts)],
  });
}

function h1(value) {
  return paragraph(value, { heading: HeadingLevel.HEADING_1 });
}

function h2(value) {
  return paragraph(value, { heading: HeadingLevel.HEADING_2 });
}

function h3(value) {
  return paragraph(value, { heading: HeadingLevel.HEADING_3 });
}

function bullet(value) {
  return new Paragraph({
    numbering: { reference: 'bullet-list', level: 0 },
    spacing: { after: 80 },
    children: [text(value)],
  });
}

function number(value) {
  return new Paragraph({
    numbering: { reference: 'number-list', level: 0 },
    spacing: { after: 80 },
    children: [text(value)],
  });
}

function pageBreak() {
  return new Paragraph({ children: [new PageBreak()] });
}

function table(rows, widths) {
  const border = { style: BorderStyle.SINGLE, size: 1, color: colors.border };
  const borders = { top: border, bottom: border, left: border, right: border };
  const total = widths.reduce((sum, width) => sum + width, 0);
  return new Table({
    width: { size: total, type: WidthType.DXA },
    columnWidths: widths,
    rows: rows.map((row, rowIndex) => new TableRow({
      children: row.map((cell, cellIndex) => new TableCell({
        width: { size: widths[cellIndex], type: WidthType.DXA },
        borders,
        shading: { fill: rowIndex === 0 ? colors.lightBlue : 'FFFFFF', type: ShadingType.CLEAR },
        margins: { top: 100, bottom: 100, left: 120, right: 120 },
        children: [paragraph(cell, { bold: rowIndex === 0, after: 0 })],
      })),
    })),
  });
}

async function imageParagraph(filePath, caption, maxWidth = PAGE.contentWidthPx) {
  const metadata = await sharp(filePath).metadata();
  const ratio = metadata.height / metadata.width;
  const width = Math.min(maxWidth, metadata.width);
  const height = Math.round(width * ratio);
  const ext = path.extname(filePath).slice(1).toLowerCase();
  const type = ext === 'jpg' ? 'jpeg' : ext;
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 120, after: 80 },
      children: [
        new ImageRun({
          type,
          data: fs.readFileSync(filePath),
          transformation: { width, height },
          altText: { title: caption, description: caption, name: path.basename(filePath) },
        }),
      ],
    }),
    paragraph(caption, { italics: true, size: 18, color: '5B677A', alignment: AlignmentType.CENTER }),
  ];
}

function header(title) {
  return new Header({
    children: [
      new Paragraph({
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: colors.blue, space: 1 } },
        children: [text(title, { bold: true, color: colors.blue })],
      }),
    ],
  });
}

function footer() {
  return new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [text('Page ', { size: 18 }), new TextRun({ children: [PageNumber.CURRENT], font: 'Arial', size: 18 })],
      }),
    ],
  });
}

function createDoc(children, title) {
  return new Document({
    creator: 'Agentic SDLC',
    title,
    description: title,
    styles: {
      default: { document: { run: { font: 'Arial', size: 22 } } },
      paragraphStyles: [
        {
          id: 'Heading1',
          name: 'Heading 1',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { size: 32, bold: true, font: 'Arial', color: colors.navy },
          paragraph: { spacing: { before: 300, after: 180 }, outlineLevel: 0 },
        },
        {
          id: 'Heading2',
          name: 'Heading 2',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { size: 27, bold: true, font: 'Arial', color: colors.blue },
          paragraph: { spacing: { before: 240, after: 140 }, outlineLevel: 1 },
        },
        {
          id: 'Heading3',
          name: 'Heading 3',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { size: 24, bold: true, font: 'Arial', color: colors.navy },
          paragraph: { spacing: { before: 200, after: 100 }, outlineLevel: 2 },
        },
      ],
    },
    numbering: {
      config: [
        {
          reference: 'bullet-list',
          levels: [{
            level: 0,
            format: LevelFormat.BULLET,
            text: '•',
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 520, hanging: 240 } } },
          }],
        },
        {
          reference: 'number-list',
          levels: [{
            level: 0,
            format: LevelFormat.DECIMAL,
            text: '%1.',
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 520, hanging: 240 } } },
          }],
        },
      ],
    },
    sections: [{
      properties: { page: { size: { width: PAGE.width, height: PAGE.height }, margin: PAGE.margin } },
      headers: { default: header(title) },
      footers: { default: footer() },
      children,
    }],
  });
}

async function buildArchitectureDoc() {
  const children = [
    paragraph('Agentic SDLC', { size: 44, bold: true, color: colors.navy, alignment: AlignmentType.CENTER, before: 400 }),
    paragraph('Professional Architecture Document', { size: 30, bold: true, color: colors.blue, alignment: AlignmentType.CENTER }),
    paragraph('Current implementation, data ownership, deployment topology, and agentic AI orchestration model.', { alignment: AlignmentType.CENTER, color: '5B677A' }),
    paragraph('Updated: 2026-07-15', { alignment: AlignmentType.CENTER, color: '5B677A' }),
    pageBreak(),
    new TableOfContents('Table of Contents', { hyperlink: true, headingStyleRange: '1-3' }),
    pageBreak(),
    h1('1. Executive Summary'),
    paragraph('Agentic SDLC is a Postgres-backed, API-mediated, multi-service agentic delivery platform. It uses a React/Vite frontend, Railway-hosted backend services, Supabase Auth/Postgres, and backend-only LLM provider routing to generate and govern SDLC artifacts across requirements, architecture, UX, development planning, testing, prototype, DevOps, and operations.'),
    h2('Current Implementation Snapshot'),
    table([
      ['Area', 'Current implementation'],
      ['Frontend', 'React + Vite SPA deployed on Vercel. Browser is a thin client for project, app, catalog, and runtime data.'],
      ['API gateway / LLM proxy', 'Railway proxy API owns LLM calls, app-state APIs, master catalog API, invite/session APIs, CORS, rate limiting, and selected forwarding.'],
      ['Project/admin API', 'Railway service owns authenticated project CRUD, permissions, app-admin checks, and canonical team member access.'],
      ['Runtime API', 'Railway service owns agent runs, jobs, memory records, action proposals, rollback logs, /health, and /ready.'],
      ['Identity', 'Supabase Auth JWT is production identity. Invite sessions are project-scoped. Local admin bypass is local/dev only.'],
      ['Data plane', 'Supabase Postgres is authoritative for projects, memberships, runtime records, app-state, integrations, backlog, master catalogs, and invite data.'],
      ['Agent orchestration', 'PipelineEngine initiates phase execution and reruns; runtime services persist run/job/memory telemetry.'],
    ], [2300, 7060]),
    h1('2. Architecture Diagrams'),
    h2('2.1 Current Implementation Architecture'),
    ...(await imageParagraph(path.join(architectureAssets, 'current-implementation-architecture.png'), 'Current implementation architecture: frontend, backend services, Supabase, runtime, and LLM providers.')),
    h2('2.2 Combined Architecture and Agentic Flow'),
    paragraph('This combined view is the primary architecture diagram for executive and technical walkthroughs. It shows platform services, data ownership, SDLC Orchestrator planning, Gate 0 negative workflow, downstream phase execution, and the L3 thinking loop inside each agent.'),
    ...(await imageParagraph(path.join(architectureAssets, 'agentic-sdlc-architecture-with-agent-flow.png'), 'Combined architecture and agentic flow: platform topology plus SDLC Orchestrator and L3 agent thinking loop.', 700)),
    h2('2.3 Agentic Agent Flow'),
    ...(await imageParagraph(path.join(architectureAssets, 'professional-10-agentic-agent-flow.png'), 'Agentic agent flow with Gate 0 approval/rejection and L3 planning process.')),
    h1('3. Architecture Decision Records'),
    h2('ADR-001: Postgres is the single source of truth'),
    paragraph('Project CRUD, app configuration, integrations, backlog, invite membership, runtime state, and master catalogs are routed through backend APIs backed by PostgreSQL/Supabase. Browser-local storage is not authoritative for production project state.'),
    h2('ADR-002: Staggered parallel agents with dependency tiers'),
    paragraph('Pipeline phases are split into dependency tiers so same-domain dependencies complete before downstream agents start. This preserves safe parallelism while preventing missing prior-output reads.'),
    h2('ADR-003: Multi-service backend behind a stable frontend API surface'),
    paragraph('The proxy API centralizes browser-facing app-state, master catalog, invite/session, and LLM operations. Project/admin and runtime APIs own specialized responsibilities behind the proxy/runtime URLs.'),
    h2('ADR-004: Backend-only provider routing'),
    paragraph('OpenAI is the default provider and Claude is optional. Provider routing is configured server-side so browser code never stores provider secrets.'),
    h1('4. Data and Master Catalog Model'),
    ...(await imageParagraph(path.join(architectureAssets, 'professional-08-logical-data-model.png'), 'Logical data model for project, membership, runtime, invite, and app-state data.')),
    ...(await imageParagraph(path.join(architectureAssets, 'professional-09-master-data-model.png'), 'Master data model for phases, gates, agents, domains, and role templates.')),
    paragraph('Master catalogs are stored in Postgres and hydrated through backend APIs. The frontend keeps in-memory registries for rendering and runtime behavior, but Postgres remains the authoritative source for master catalog definitions.'),
    h1('5. Agentic Behavior Model'),
    paragraph('Every L3-enabled agent follows the same evidence loop: read upstream real-agent outputs, call context/tool agents, observe gaps, revise the plan if necessary, self-check, and persist the final artifact for downstream agents.'),
    bullet('Input: project context, domain knowledge, uploaded documents, team roster, style guide, and prior agent outputs.'),
    bullet('Planning: mandatory step sequence defines what evidence and tool calls are required before artifact generation.'),
    bullet('Thinking loop: plan, act, observe, revise, and validate until enough evidence exists or the loop limit is reached.'),
    bullet('Output: a durable artifact persisted in Postgres-backed agent run records and reused by downstream agents.'),
    h1('6. Appendix: Per-Agent Flow Diagrams'),
    paragraph('The appendix diagrams show each real SDLC agent with its upstream dependencies, L3 thinking loop, output, and downstream consumers. These are generated companion diagrams to AGENT_FLOW_CATALOG.md.'),
  ];

  const agentImages = fs.readdirSync(architectureAssets)
    .filter((name) => /^agent-flow-.*\.png$/.test(name))
    .sort();

  for (const name of agentImages) {
    const label = name.replace(/^agent-flow-/, '').replace(/\.png$/, '');
    children.push(h2(`Agent Flow: ${label}`));
    children.push(...(await imageParagraph(path.join(architectureAssets, name), `Agent input, planning, thinking loop, output, and downstream dependencies for ${label}.`, 650)));
  }

  const doc = createDoc(children, 'Agentic SDLC Architecture');
  fs.writeFileSync(architectureDocx, await Packer.toBuffer(doc));
}

async function buildQuickGuideDoc() {
  const children = [
    paragraph('Agentic SDLC', { size: 44, bold: true, color: colors.navy, alignment: AlignmentType.CENTER, before: 400 }),
    paragraph('Quick Start User Guide', { size: 30, bold: true, color: colors.blue, alignment: AlignmentType.CENTER }),
    paragraph('A simple product-style guide for creating new projects, opening assigned projects, adding team members, running the pipeline, reviewing outputs, and handling common issues.', { alignment: AlignmentType.CENTER, color: '5B677A' }),
    paragraph('Updated: 2026-07-15', { alignment: AlignmentType.CENTER, color: '5B677A' }),
    pageBreak(),
    new TableOfContents('Table of Contents', { hyperlink: true, headingStyleRange: '1-3' }),
    pageBreak(),
    h1('1. What Agentic SDLC Helps You Do'),
    paragraph('Agentic SDLC helps project teams create software-delivery artifacts with specialized AI agents. It guides a project from idea to requirements, architecture, UX mockups, development planning, testing, prototype, DevOps, and operations.'),
    bullet('Create a new software project from a short problem statement.'),
    bullet('Upload project documents such as SOW, RFP, BRD, discovery notes, or style guides.'),
    bullet('Generate SDLC documents using specialized AI agents.'),
    bullet('Review and approve outputs at phase gates.'),
    bullet('Collaborate with team members based on assigned project roles.'),
    h1('2. Sign In'),
    number('Open the Agentic SDLC application URL.'),
    number('Enter your email and password.'),
    number('Select Sign In.'),
    number('After signing in, you land on the dashboard.'),
    paragraph('If you were invited to a project, open the invite link first. The invite should take you into that specific project after the account is verified.'),
    h1('3. Understand Your Dashboard'),
    ...(await imageParagraph(path.join(userGuideAssets, 'dashboard.png'), 'Dashboard showing assigned projects and the Create New Project action.')),
    bullet('Project cards show project name, domain, status, agent progress, and recent activity.'),
    bullet('Select a project card to open the project workspace.'),
    bullet('Use Create New Project when starting a new project.'),
    h1('4. Create a New Project'),
    ...(await imageParagraph(path.join(userGuideAssets, 'new-project-simple.png'), 'Simple new project form with required fields and problem statement.')),
    number('From the dashboard, select Create New Project.'),
    number('Choose the simple project creation flow for the fastest start.'),
    number('Fill in all required project details, including project name, domain, project type, priority, and problem statement.'),
    number('Select Next.'),
    number('Review or edit the generated domain knowledge brief.'),
    number('Select Save for the project.'),
    h1('5. Upload Project Documents'),
    ...(await imageParagraph(path.join(userGuideAssets, 'upload-documents.png'), 'Upload documents screen for source project files.')),
    paragraph('Upload supporting material such as SOW, RFP, BRD, product brief, discovery notes, style guide, or UX reference documents. Better inputs usually produce better agent outputs.'),
    h1('6. Review Domain Knowledge'),
    ...(await imageParagraph(path.join(userGuideAssets, 'domain-knowledge.png'), 'Domain knowledge review screen before saving project context.')),
    bullet('Review the template generated for the selected domain.'),
    bullet('Add project-specific context, regulations, integrations, and constraints.'),
    bullet('Save it so agents can use it as common project context.'),
    h1('7. Set Up the Team'),
    ...(await imageParagraph(path.join(userGuideAssets, 'team-settings.png'), 'Project settings team member setup and invite controls.')),
    bullet('Add at least one team member before running the full pipeline.'),
    bullet('Assign Project Owner, Editor, Reviewer, or Viewer based on responsibility.'),
    bullet('If email is not configured, generate and share a unique project-scoped invite link manually.'),
    h1('8. Run the Pipeline'),
    ...(await imageParagraph(path.join(userGuideAssets, 'project-workspace.png'), 'Project workspace showing agent list, output panel, and pipeline controls.')),
    number('Open a project.'),
    number('Confirm the team is set up.'),
    number('Confirm API/model settings are configured.'),
    number('Select Run Pipeline.'),
    number('Review the SDLC Orchestrator plan at Gate 0.'),
    number('Approve Gate 0 only when the plan is good enough for downstream agents.'),
    h1('9. Review Outputs and Gates'),
    paragraph('Each agent creates a specific artifact. Select an agent in the workspace, read the generated output, and use available tabs such as details, diagrams, mockups, or trace views. Review gates should be approved only when the completed phase output is usable for downstream work.'),
    h1('10. Rerun an Agent'),
    number('Select the agent output you want to improve.'),
    number('Select Rerun or the available rerun action.'),
    number('Add clear instructions such as “Add PCI-DSS considerations” or “Use the uploaded style guide.”'),
    number('Confirm the rerun.'),
    h1('11. Work on an Assigned Project'),
    paragraph('If someone invited you to a project, sign in with the invited email, open the dashboard, select the assigned project, and work only in the areas allowed by your role.'),
    h1('12. Common Problems'),
    table([
      ['Problem', 'Meaning', 'What to do'],
      ['No API key configured', 'The AI model connection is not ready.', 'Ask an admin to configure OpenAI or Claude settings.'],
      ['Team setup required', 'No team member is assigned yet.', 'Add at least one team member before running the pipeline.'],
      ['Cannot approve a gate', 'Your role may not allow approval.', 'Ask the project owner to approve or update your role.'],
      ['Invite link does not work', 'Invite may be expired, already used, or not project-scoped.', 'Ask the sender to generate a new invite.'],
      ['Project does not appear', 'You may not be assigned to the project.', 'Ask the owner/admin to confirm team membership.'],
      ['Output is too generic', 'Project context may be incomplete.', 'Add better details, documents, or domain knowledge and rerun.'],
    ], [2500, 3300, 3560]),
    h1('13. Simple First-Day Workflow'),
    number('Sign in.'),
    number('Open the dashboard.'),
    number('Create a new project or open an assigned project.'),
    number('Add project details and domain knowledge.'),
    number('Add team members.'),
    number('Run the SDLC Orchestrator and review Gate 0.'),
    number('Approve, rerun, or add feedback as needed.'),
  ];

  const doc = createDoc(children, 'Agentic SDLC Quick Start Guide');
  fs.writeFileSync(quickGuideDocx, await Packer.toBuffer(doc));
}

async function main() {
  await buildArchitectureDoc();
  await buildQuickGuideDoc();
  console.log(JSON.stringify({ architectureDocx, quickGuideDocx }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
