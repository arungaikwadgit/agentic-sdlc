const fs = require('fs');
const path = require('path');
let sharp;
try {
  sharp = require('sharp');
} catch {
  sharp = require('C:/Projects/SLDC - AI/.codex-docx/node_modules/sharp');
}

const repoRoot = path.resolve(__dirname, '..');
const docsDir = path.join(repoRoot, 'docs');
const architecturePath = path.join(docsDir, 'ARCHITECTURE.md');
const agentFlowPath = path.join(docsDir, 'architecture', 'AGENTIC_AGENT_FLOW.md');
const assetDir = path.join(docsDir, 'architecture', 'assets');
const svgPath = path.join(assetDir, 'agentic-sdlc-architecture-with-agent-flow.svg');
const pngPath = path.join(assetDir, 'agentic-sdlc-architecture-with-agent-flow.png');

fs.mkdirSync(assetDir, { recursive: true });

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function wrap(text, maxChars) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function box({ x, y, w, h, title, lines = [], fill = '#101a2d', stroke = '#355079', titleColor = '#f8fafc', lineColor = '#b8c7dd' }) {
  const safeTitle = escapeXml(title);
  const bodyLines = lines.flatMap((line) => wrap(line, Math.max(28, Math.floor(w / 10))));
  const titleY = y + 29;
  const lineStart = y + 56;
  const renderedLines = bodyLines.slice(0, Math.floor((h - 58) / 17)).map((line, i) => {
    return `<text x="${x + 18}" y="${lineStart + i * 17}" class="body" fill="${lineColor}">${escapeXml(line)}</text>`;
  }).join('\n');
  return `
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="18" fill="${fill}" stroke="${stroke}" stroke-width="2"/>
    <text x="${x + 18}" y="${titleY}" class="title" fill="${titleColor}">${safeTitle}</text>
    ${renderedLines}
  `;
}

function pill(x, y, text, fill = '#1d2d4a', stroke = '#426390') {
  const width = Math.max(112, text.length * 8 + 28);
  return `
    <rect x="${x}" y="${y}" width="${width}" height="34" rx="17" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>
    <text x="${x + width / 2}" y="${y + 22}" text-anchor="middle" class="pill">${escapeXml(text)}</text>
  `;
}

function arrow({ x1, y1, x2, y2, label = '', color = '#7dd3fc', dash = false }) {
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;
  const labelSvg = label
    ? `<text x="${midX}" y="${midY - 8}" text-anchor="middle" class="edge-label" fill="${color}">${escapeXml(label)}</text>`
    : '';
  return `
    <path d="M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}" fill="none" stroke="${color}" stroke-width="2.5" ${dash ? 'stroke-dasharray="7 7"' : ''} marker-end="url(#arrow)"/>
    ${labelSvg}
  `;
}

function lane(y, title, color) {
  return `
    <rect x="40" y="${y}" width="1720" height="48" rx="24" fill="${color}" opacity="0.2"/>
    <text x="70" y="${y + 31}" class="lane">${escapeXml(title)}</text>
  `;
}

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1800" height="1240" viewBox="0 0 1800 1240" role="img" aria-labelledby="title desc">
  <title id="title">Agentic SDLC combined platform architecture and agentic flow</title>
  <desc id="desc">Combined diagram showing frontend, Railway backend APIs, Supabase Postgres, LLM providers, SDLC orchestrator, gates, phases, and L3 thinking loops.</desc>
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0b1020"/>
      <stop offset="55%" stop-color="#101a2d"/>
      <stop offset="100%" stop-color="#16213a"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#7c3aed"/>
      <stop offset="50%" stop-color="#2563eb"/>
      <stop offset="100%" stop-color="#06b6d4"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#000000" flood-opacity="0.32"/>
    </filter>
    <marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
      <path d="M0,0 L0,6 L9,3 z" fill="#7dd3fc"/>
    </marker>
    <style>
      .heading { font: 700 38px Inter, Segoe UI, Arial, sans-serif; fill: #f8fafc; }
      .subheading { font: 500 18px Inter, Segoe UI, Arial, sans-serif; fill: #b8c7dd; }
      .lane { font: 700 18px Inter, Segoe UI, Arial, sans-serif; fill: #f8fafc; letter-spacing: 0.02em; }
      .title { font: 700 18px Inter, Segoe UI, Arial, sans-serif; }
      .body { font: 500 13px Inter, Segoe UI, Arial, sans-serif; }
      .pill { font: 700 13px Inter, Segoe UI, Arial, sans-serif; fill: #e0f2fe; }
      .edge-label { font: 700 13px Inter, Segoe UI, Arial, sans-serif; }
      .small { font: 500 12px Inter, Segoe UI, Arial, sans-serif; fill: #a9bbd4; }
    </style>
  </defs>

  <rect width="1800" height="1240" fill="url(#bg)"/>
  <rect x="24" y="24" width="1752" height="1192" rx="34" fill="#0d1425" stroke="#263b5f" stroke-width="2" filter="url(#shadow)"/>
  <text x="70" y="82" class="heading">Agentic SDLC: Platform Architecture + L3 Agent Flow</text>
  <text x="70" y="114" class="subheading">How Vercel, Railway, Supabase, backend APIs, review gates, and real SDLC agents work as one agentic delivery system.</text>

  ${lane(145, '1. Cloud Platform and Data Plane', '#2563eb')}
  ${box({ x: 70, y: 220, w: 260, h: 130, title: 'React Frontend', lines: ['Vercel SPA', 'Thin client: no LLM keys', 'Calls backend APIs only'], fill: '#111d34' })}
  ${box({ x: 410, y: 205, w: 285, h: 160, title: 'Railway Proxy API', lines: ['LLM gateway', 'App-state + master catalog APIs', 'Invite/session endpoints', 'Forwards project APIs'], fill: '#10243a', stroke: '#4077a6' })}
  ${box({ x: 780, y: 205, w: 285, h: 160, title: 'Project/Admin API', lines: ['Authenticated project CRUD', 'Permissions and memberships', 'Admin allowlist', 'Postgres-backed project state'], fill: '#10243a', stroke: '#4077a6' })}
  ${box({ x: 1150, y: 205, w: 285, h: 160, title: 'Runtime API', lines: ['Agent runs and jobs', 'Memory records', 'Action proposals', 'Readiness and observability'], fill: '#10243a', stroke: '#4077a6' })}
  ${box({ x: 1510, y: 205, w: 210, h: 160, title: 'Supabase', lines: ['Auth JWT', 'Postgres source of truth', 'Master data', 'Runtime data'], fill: '#0f2a24', stroke: '#31b77b' })}
  ${arrow({ x1: 330, y1: 285, x2: 410, y2: 285, label: 'REST + JWT' })}
  ${arrow({ x1: 695, y1: 285, x2: 780, y2: 285, label: 'forward' })}
  ${arrow({ x1: 1065, y1: 285, x2: 1150, y2: 285, label: 'runtime' })}
  ${arrow({ x1: 1435, y1: 285, x2: 1510, y2: 285, label: 'SQL/API' })}

  ${lane(405, '2. Orchestrator Starts the Agentic Workflow', '#7c3aed')}
  ${box({ x: 70, y: 480, w: 290, h: 145, title: 'Project Context', lines: ['Problem statement', 'Domain knowledge', 'Team roster', 'Uploaded docs', 'Prior outputs'], fill: '#151d35', stroke: '#5b6ea8' })}
  ${box({ x: 430, y: 480, w: 300, h: 145, title: 'PipelineEngine', lines: ['Starts Phase 0', 'Controls phase ordering', 'Respects dependency tiers', 'Pauses at review gates'], fill: '#161d36', stroke: '#6d5bd0' })}
  ${box({ x: 800, y: 455, w: 340, h: 195, title: 'SDLC Orchestrator', lines: ['Plans delivery path before downstream agents run', 'Calls planning/context agents', 'Builds critical path, risks, model guidance, and replan triggers'], fill: '#211747', stroke: '#8b5cf6', titleColor: '#f5f3ff' })}
  ${box({ x: 1210, y: 455, w: 255, h: 195, title: 'Gate 0', lines: ['Approve orchestrator plan?', 'Approved: run Phase 1+', 'Rejected: pause, capture feedback, replan'], fill: '#281b3c', stroke: '#f59e0b', titleColor: '#fff7ed' })}
  ${box({ x: 1525, y: 455, w: 195, h: 195, title: 'LLM Providers', lines: ['OpenAI default', 'Claude optional', 'Provider routing hints', 'Backend-only secrets'], fill: '#12243b', stroke: '#38bdf8' })}
  ${arrow({ x1: 360, y1: 552, x2: 430, y2: 552, label: 'input' })}
  ${arrow({ x1: 730, y1: 552, x2: 800, y2: 552, label: 'Phase 0' })}
  ${arrow({ x1: 1140, y1: 552, x2: 1210, y2: 552, label: 'plan' })}
  ${arrow({ x1: 1140, y1: 505, x2: 1525, y2: 505, label: 'model calls', dash: true })}
  ${arrow({ x1: 1340, y1: 650, x2: 970, y2: 650, label: 'rejected -> feedback -> replan', color: '#f59e0b', dash: true })}

  ${lane(690, '3. Planning Agents / Tools Used by Orchestrator', '#0891b2')}
  ${pill(85, 765, 'Catalog Agent')}
  ${pill(255, 765, 'Phase Rules Agent')}
  ${pill(465, 765, 'Domain Context Agent')}
  ${pill(715, 765, 'Team Roster Agent')}
  ${pill(945, 765, 'Style Guide Agent')}
  ${pill(1170, 765, 'Model Catalog Agent')}
  ${pill(1425, 765, 'Completeness Validator')}
  ${arrow({ x1: 970, y1: 650, x2: 970, y2: 765, label: 'tool calls', color: '#22d3ee' })}

  ${lane(835, '4. Approved Phase Chain with Real Agent Names', '#16a34a')}
  ${box({ x: 70, y: 910, w: 260, h: 105, title: 'Phase 1-2A', lines: ['PRD Agent, Project Charter, Business Requirements, Business Rules, Stakeholder Analysis, User Stories, Feasibility Study, Data Model'], fill: '#10251e', stroke: '#2fbf71' })}
  ${box({ x: 370, y: 910, w: 260, h: 105, title: 'Phase 3-3C', lines: ['Architecture, UX Research, API Design, Interaction Design, UX Mockups, Security & Compliance'], fill: '#10251e', stroke: '#2fbf71' })}
  ${box({ x: 670, y: 910, w: 290, h: 105, title: 'Phase 4-4A', lines: ['Code Structure, Sprint Planner, Task Breakdown, Tech Debt, Code Snippets, Code Review Guide, UI Component Library, Product Roadmap'], fill: '#10251e', stroke: '#2fbf71' })}
  ${box({ x: 1000, y: 910, w: 250, h: 105, title: 'Phase 5-6', lines: ['Test Plan, Test Cases, Working Prototype'], fill: '#10251e', stroke: '#2fbf71' })}
  ${box({ x: 1290, y: 910, w: 260, h: 105, title: 'Phase 7-8', lines: ['DevOps Engineer, Infrastructure Engineer, Observability Engineer, On-Call Engineer'], fill: '#10251e', stroke: '#2fbf71' })}
  ${box({ x: 1585, y: 900, w: 135, h: 125, title: 'Outputs', lines: ['agent_runs', 'jobs', 'memory', 'artifacts'], fill: '#13233a', stroke: '#38bdf8' })}
  ${arrow({ x1: 1465, y1: 552, x2: 152, y2: 910, label: 'approved', color: '#4ade80' })}
  ${arrow({ x1: 330, y1: 962, x2: 370, y2: 962, color: '#4ade80' })}
  ${arrow({ x1: 630, y1: 962, x2: 670, y2: 962, color: '#4ade80' })}
  ${arrow({ x1: 960, y1: 962, x2: 1000, y2: 962, color: '#4ade80' })}
  ${arrow({ x1: 1250, y1: 962, x2: 1290, y2: 962, color: '#4ade80' })}
  ${arrow({ x1: 1550, y1: 962, x2: 1585, y2: 962, color: '#4ade80' })}

  ${lane(1055, '5. L3 Thinking Loop Inside Each Agent', '#f59e0b')}
  ${box({ x: 70, y: 1120, w: 250, h: 76, title: 'Input', lines: ['Upstream real agents + project context'], fill: '#201b13', stroke: '#d97706' })}
  ${box({ x: 390, y: 1120, w: 250, h: 76, title: 'Plan', lines: ['Mandatory step sequence + tool strategy'], fill: '#201b13', stroke: '#d97706' })}
  ${box({ x: 710, y: 1120, w: 250, h: 76, title: 'Think / Act', lines: ['Call prior output, domain, team, style, validator tools'], fill: '#201b13', stroke: '#d97706' })}
  ${box({ x: 1030, y: 1120, w: 250, h: 76, title: 'Observe / Revise', lines: ['If evidence is weak, revise plan and loop'], fill: '#201b13', stroke: '#d97706' })}
  ${box({ x: 1350, y: 1120, w: 250, h: 76, title: 'Output', lines: ['Final artifact persisted for downstream agents'], fill: '#201b13', stroke: '#d97706' })}
  ${arrow({ x1: 320, y1: 1158, x2: 390, y2: 1158, color: '#fbbf24' })}
  ${arrow({ x1: 640, y1: 1158, x2: 710, y2: 1158, color: '#fbbf24' })}
  ${arrow({ x1: 960, y1: 1158, x2: 1030, y2: 1158, color: '#fbbf24' })}
  ${arrow({ x1: 1280, y1: 1158, x2: 1350, y2: 1158, color: '#fbbf24' })}
  ${arrow({ x1: 1155, y1: 1120, x2: 835, y2: 1120, label: 'loop if gap found', color: '#f59e0b', dash: true })}

  <text x="70" y="1210" class="small">Generated from AGENTIC_AGENT_FLOW.md and AGENT_FLOW_CATALOG.md. Use detailed appendix diagrams for per-agent input/planning/output views.</text>
</svg>`;

fs.writeFileSync(svgPath, svg, 'utf8');

function upsertSection(content, heading, sectionText, insertAfterHeading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const sectionPattern = new RegExp(`\\n## ${escaped}\\n[\\s\\S]*?(?=\\n## |\\n---\\n|$)`);
  if (sectionPattern.test(content)) {
    return content.replace(sectionPattern, `\n## ${heading}\n\n${sectionText}\n`);
  }
  const anchor = `## ${insertAfterHeading}`;
  const idx = content.indexOf(anchor);
  if (idx === -1) return `${content.trimEnd()}\n\n## ${heading}\n\n${sectionText}\n`;
  const nextIdx = content.indexOf('\n## ', idx + anchor.length);
  const insertAt = nextIdx === -1 ? content.length : nextIdx;
  return `${content.slice(0, insertAt).trimEnd()}\n\n## ${heading}\n\n${sectionText}\n\n${content.slice(insertAt).trimStart()}`;
}

const combinedSection = [
  'This diagram combines the platform architecture with the generated agentic flow so one view shows the cloud services, Postgres data plane, SDLC Orchestrator, Gate 0 negative workflow, downstream phase chain, and L3 thinking loop.',
  '',
  '![Agentic SDLC combined architecture and agentic flow](architecture/assets/agentic-sdlc-architecture-with-agent-flow.png)',
  '',
  'Use the detailed agent-flow appendix for implementation-level diagrams: [AGENTIC_AGENT_FLOW.md](architecture/AGENTIC_AGENT_FLOW.md) and [AGENT_FLOW_CATALOG.md](architecture/AGENT_FLOW_CATALOG.md).',
].join('\n');

let architecture = fs.readFileSync(architecturePath, 'utf8');
architecture = upsertSection(
  architecture,
  'Combined Architecture and Agentic Flow',
  combinedSection,
  'System Overview',
);
fs.writeFileSync(architecturePath, architecture, 'utf8');

const agentFlowSection = [
  'The architecture document now includes a combined image view that places this orchestration flow beside the platform architecture.',
  '',
  '![Combined architecture and agentic flow](assets/agentic-sdlc-architecture-with-agent-flow.png)',
].join('\n');

let agentFlow = fs.readFileSync(agentFlowPath, 'utf8');
agentFlow = upsertSection(agentFlow, 'Combined Architecture Image', agentFlowSection, 'What This Shows');
fs.writeFileSync(agentFlowPath, agentFlow, 'utf8');

sharp(Buffer.from(svg))
  .png()
  .toFile(pngPath)
  .then(() => {
    console.log(JSON.stringify({ svgPath, pngPath }, null, 2));
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
