/* eslint-disable no-console */
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { Pool } = require('pg');

const repoRoot = path.resolve(__dirname, '..', '..');
const frontendRoot = path.join(repoRoot, 'frontend', 'src');

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function extractLiteral(source, exportName, openChar) {
  const marker = `export const ${exportName}`;
  const start = source.indexOf(marker);
  if (start === -1) throw new Error(`Could not find ${exportName}`);
  const eq = source.indexOf('=', start);
  if (eq === -1) throw new Error(`Could not parse assignment for ${exportName}`);
  const open = source.indexOf(openChar, eq);
  if (open === -1) throw new Error(`Could not find ${openChar} for ${exportName}`);

  const closeChar = openChar === '{' ? '}' : ']';
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let escaped = false;

  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (!inDouble && !inTemplate && ch === '\'') {
      inSingle = !inSingle;
      continue;
    }
    if (!inSingle && !inTemplate && ch === '"') {
      inDouble = !inDouble;
      continue;
    }
    if (!inSingle && !inDouble && ch === '`') {
      inTemplate = !inTemplate;
      continue;
    }
    if (inSingle || inDouble || inTemplate) continue;
    if (ch === openChar) depth += 1;
    if (ch === closeChar) {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  throw new Error(`Unbalanced literal for ${exportName}`);
}

function evalLiteral(literal) {
  const sanitized = literal
    .replace(/\s+as\s+[A-Za-z0-9_<>\[\]\|]+/g, '')
    .replace(/new Set\s*\(/g, '(');
  return vm.runInNewContext(`(${sanitized})`, {});
}

function parseAgentMetadata(source) {
  const lines = source.split(/\r?\n/);
  const items = [];
  let current = null;

  for (const line of lines) {
    if (/^const\s+\w+\s*:\s*AgentDefinition\s*=\s*{/.test(line.trim())) {
      if (current?.id) items.push(current);
      current = { dependsOn: [] };
      continue;
    }
    if (!current) continue;

    let m = line.match(/^\s*id:\s*'([^']+)'/);
    if (m) { current.id = m[1]; continue; }
    m = line.match(/^\s*name:\s*(['"])(.*?)\1,\s*$/);
    if (m) { current.name = m[2]; continue; }
    m = line.match(/^\s*phase:\s*'([^']+)'/);
    if (m) { current.phase = m[1]; continue; }
    m = line.match(/^\s*description:\s*(['"])(.*?)\1,\s*$/);
    if (m) { current.description = m[2]; continue; }
    m = line.match(/^\s*outputLabel:\s*(['"])(.*?)\1,\s*$/);
    if (m) { current.outputLabel = m[2]; continue; }
    m = line.match(/^\s*dependsOn:\s*\[(.*?)\],\s*$/);
    if (m) {
      current.dependsOn = m[1]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => s.replace(/^['"]|['"]$/g, ''));
      continue;
    }
    m = line.match(/^\s*maxIterations:\s*(\d+)/);
    if (m) { current.maxIterations = Number(m[1]); continue; }
  }
  if (current?.id) items.push(current);
  return items;
}

function loadCatalog() {
  const constantsSrc = read(path.join(frontendRoot, 'agents', 'constants.ts'));
  const domainsSrc = read(path.join(frontendRoot, 'agents', 'domains.ts'));
  const domainTemplatesSrc = read(path.join(frontendRoot, 'agents', 'domainKnowledgeTemplates.ts'));
  const roleTemplatesSrc = read(path.join(frontendRoot, 'data', 'roleTemplates.ts'));
  const definitionsSrc = read(path.join(frontendRoot, 'agents', 'definitions.ts'));

  const phaseOrder = evalLiteral(extractLiteral(constantsSrc, 'PHASE_ORDER', '['));
  const phaseAgents = evalLiteral(extractLiteral(constantsSrc, 'PHASE_AGENTS', '{'));
  const reviewGates = evalLiteral(extractLiteral(constantsSrc, 'REVIEW_GATES', '{'));
  const phaseLabels = evalLiteral(extractLiteral(constantsSrc, 'PHASE_LABELS', '{'));
  const phaseStages = evalLiteral(extractLiteral(constantsSrc, 'PHASE_SDLC_STAGE', '{'));
  const parallelPhases = evalLiteral(
    extractLiteral(constantsSrc.slice(constantsSrc.indexOf('export const PARALLEL_PHASES')), 'PARALLEL_PHASES', '['),
  );
  const domains = evalLiteral(extractLiteral(domainsSrc, 'DOMAINS', '{'));
  const domainTemplates = evalLiteral(extractLiteral(domainTemplatesSrc, 'DOMAIN_KNOWLEDGE_TEMPLATES', '{'));
  const roleTemplates = evalLiteral(extractLiteral(roleTemplatesSrc, 'ROLE_TEMPLATES', '['));
  const agents = parseAgentMetadata(definitionsSrc);

  return {
    phaseOrder,
    phaseAgents,
    reviewGates,
    phaseLabels,
    phaseStages,
    parallelPhases,
    domains,
    domainTemplates,
    roleTemplates,
    agents,
  };
}

async function seed() {
  if (
    !process.env.POSTGRES_URL &&
    !(process.env.PGHOST && process.env.PGPORT && process.env.PGDATABASE && process.env.PGUSER)
  ) {
    throw new Error('POSTGRES_URL or PGHOST/PGPORT/PGDATABASE/PGUSER is required');
  }

  const pool = process.env.PGHOST
    ? new Pool({
        host: process.env.PGHOST,
        port: Number(process.env.PGPORT ?? '5432'),
        database: process.env.PGDATABASE ?? 'postgres',
        user: process.env.PGUSER,
        password: process.env.PGPASSWORD,
        ssl: { rejectUnauthorized: false },
      })
    : new Pool({ connectionString: process.env.POSTGRES_URL, ssl: { rejectUnauthorized: false } });
  const client = await pool.connect();

  try {
    const catalog = loadCatalog();
    await client.query('BEGIN');

    for (const [index, phaseId] of catalog.phaseOrder.entries()) {
      await client.query(
        `INSERT INTO master_phases (id, order_index, label, sdlc_stage, is_parallel)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO UPDATE
           SET order_index = EXCLUDED.order_index,
               label = EXCLUDED.label,
               sdlc_stage = EXCLUDED.sdlc_stage,
               is_parallel = EXCLUDED.is_parallel,
               updated_at = NOW()`,
        [
          phaseId,
          index,
          catalog.phaseLabels[phaseId] ?? phaseId,
          catalog.phaseStages[phaseId] ?? '',
          catalog.parallelPhases.includes(phaseId),
        ],
      );
    }

    for (const agent of catalog.agents) {
      await client.query(
        `INSERT INTO master_agents (id, name, phase_id, description, output_label, depends_on, max_iterations)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
         ON CONFLICT (id) DO UPDATE
           SET name = EXCLUDED.name,
               phase_id = EXCLUDED.phase_id,
               description = EXCLUDED.description,
               output_label = EXCLUDED.output_label,
               depends_on = EXCLUDED.depends_on,
               max_iterations = EXCLUDED.max_iterations,
               updated_at = NOW()`,
        [
          agent.id,
          agent.name ?? agent.id,
          agent.phase,
          agent.description ?? '',
          agent.outputLabel ?? '',
          JSON.stringify(agent.dependsOn ?? []),
          agent.maxIterations ?? null,
        ],
      );
    }

    await client.query('DELETE FROM master_phase_agents');
    for (const [phaseId, agentIds] of Object.entries(catalog.phaseAgents)) {
      for (const [order, agentId] of agentIds.entries()) {
        await client.query(
          `INSERT INTO master_phase_agents (phase_id, agent_id, agent_order)
           VALUES ($1, $2, $3)`,
          [phaseId, agentId, order],
        );
      }
    }

    await client.query('DELETE FROM master_review_gates');
    for (const [gateId, phases] of Object.entries(catalog.reviewGates)) {
      for (const [phaseOrder, phaseId] of phases.entries()) {
        await client.query(
          `INSERT INTO master_review_gates (gate_id, phase_id, phase_order)
           VALUES ($1, $2, $3)`,
          [gateId, phaseId, phaseOrder],
        );
      }
    }

    for (const [domainId, domainDef] of Object.entries(catalog.domains)) {
      await client.query(
        `INSERT INTO master_domains (id, label, color, bg_color, context, template)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO UPDATE
           SET label = EXCLUDED.label,
               color = EXCLUDED.color,
               bg_color = EXCLUDED.bg_color,
               context = EXCLUDED.context,
               template = EXCLUDED.template,
               updated_at = NOW()`,
        [
          domainId,
          domainDef.label,
          domainDef.color,
          domainDef.bgColor,
          domainDef.context,
          catalog.domainTemplates[domainId] ?? '',
        ],
      );
    }

    for (const [index, roleTemplate] of catalog.roleTemplates.entries()) {
      await client.query(
        `INSERT INTO master_role_templates (id, title, description, color, sort_order)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO UPDATE
           SET title = EXCLUDED.title,
               description = EXCLUDED.description,
               color = EXCLUDED.color,
               sort_order = EXCLUDED.sort_order,
               updated_at = NOW()`,
        [
          roleTemplate.id,
          roleTemplate.title,
          roleTemplate.description ?? '',
          roleTemplate.color,
          index,
        ],
      );
    }

    await client.query('DELETE FROM master_role_template_agents');
    for (const roleTemplate of catalog.roleTemplates) {
      for (const [index, agentId] of (roleTemplate.suggestedAgents ?? []).entries()) {
        await client.query(
          `INSERT INTO master_role_template_agents (role_template_id, agent_id, sort_order)
           VALUES ($1, $2, $3)`,
          [roleTemplate.id, agentId, index],
        );
      }
    }

    await client.query('COMMIT');
    console.log('Master data seeded successfully.');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch((error) => {
  console.error(error);
  process.exit(1);
});
