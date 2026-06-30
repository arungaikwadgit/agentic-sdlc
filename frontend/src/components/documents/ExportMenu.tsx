/**
 * © 2025 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
import { useState } from 'react';
import { exportMarkdown, exportDocx, exportPdf, exportAllArtifactsZip, buildArtifactFilename } from '@/services/exporters/documentExporter';
import type { Project } from '@/types/project.types';
import type { AgentId } from '@/types/agent.types';
import { AGENT_DEFINITIONS } from '@/agents/definitions';
import { PHASE_ORDER } from '@/agents/constants';

// ── SQL DDL generator ─────────────────────────────────────────────────────────
// Parses a data-model markdown doc and emits PostgreSQL CREATE TABLE statements.
// Recognises heading patterns:  ## EntityName  or  ## Entity: EntityName
// Columns come from the first markdown table under each heading.

const SQL_TYPE_MAP: Record<string, string> = {
  int: 'INTEGER', integer: 'INTEGER', bigint: 'BIGINT', smallint: 'SMALLINT',
  serial: 'SERIAL', bigserial: 'BIGSERIAL',
  uuid: 'UUID', guid: 'UUID',
  varchar: 'VARCHAR(255)', 'character varying': 'VARCHAR(255)', string: 'VARCHAR(255)',
  text: 'TEXT', char: 'CHAR(1)', character: 'CHAR(1)',
  boolean: 'BOOLEAN', bool: 'BOOLEAN',
  float: 'FLOAT', double: 'DOUBLE PRECISION', 'double precision': 'DOUBLE PRECISION',
  decimal: 'DECIMAL(18,2)', numeric: 'NUMERIC(18,2)',
  date: 'DATE', time: 'TIME',
  timestamp: 'TIMESTAMP', 'timestamp with time zone': 'TIMESTAMPTZ', timestamptz: 'TIMESTAMPTZ',
  json: 'JSON', jsonb: 'JSONB', array: 'TEXT[]',
  blob: 'BYTEA', bytes: 'BYTEA',
  enum: 'TEXT',
};

function toSqlType(raw: string): string {
  const key = raw.toLowerCase().replace(/\([^)]*\)/g, '').trim();
  return SQL_TYPE_MAP[key] ?? raw.toUpperCase();
}

function toSnakeCase(name: string): string {
  return name
    .replace(/([A-Z])/g, '_$1')
    .replace(/[\s\-]+/g, '_')
    .replace(/^_/, '')
    .toLowerCase();
}

interface Column { name: string; type: string; constraints: string; }

function parseColumns(tableLines: string[]): Column[] {
  if (tableLines.length < 2) return [];
  const parseCells = (line: string) =>
    line.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

  const headers = parseCells(tableLines[0]).map((h) => h.toLowerCase());
  const nameIdx = headers.findIndex((h) => h.includes('field') || h.includes('column') || h.includes('name') || h.includes('attribute'));
  const typeIdx = headers.findIndex((h) => h.includes('type') || h.includes('data type'));
  const conIdx  = headers.findIndex((h) => h.includes('constraint') || h.includes('key') || h.includes('note') || h.includes('nullable') || h.includes('required'));

  if (nameIdx === -1 || typeIdx === -1) return [];

  return tableLines.slice(2).map((line) => {
    const cells = parseCells(line);
    return {
      name: cells[nameIdx] ?? '',
      type: cells[typeIdx] ?? 'TEXT',
      constraints: conIdx !== -1 ? (cells[conIdx] ?? '') : '',
    };
  }).filter((c) => c.name && !/^[-: ]+$/.test(c.name));
}

function generateSqlFromMarkdown(markdown: string): string {
  const lines = markdown.split('\n');
  const tables: Array<{ entity: string; columns: Column[] }> = [];
  let currentEntity = '';
  let tableBuffer: string[] = [];
  let inTable = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headingMatch = line.match(/^#{1,4}\s+(?:Entity[:\s]+)?([A-Z][^\n#]+)$/i);

    if (headingMatch) {
      if (currentEntity && tableBuffer.length >= 2) {
        tables.push({ entity: currentEntity, columns: parseColumns(tableBuffer) });
      }
      currentEntity = headingMatch[1].replace(/\*+/g, '').trim();
      tableBuffer = [];
      inTable = false;
      continue;
    }

    const isTableRow = /^\|.+\|$/.test(line.trim());
    if (isTableRow) {
      inTable = true;
      tableBuffer.push(line);
    } else if (inTable && line.trim() === '') {
      inTable = false;
    }
  }

  if (currentEntity && tableBuffer.length >= 2) {
    tables.push({ entity: currentEntity, columns: parseColumns(tableBuffer) });
  }

  if (tables.length === 0) {
    return '-- No structured entity tables found in this document.\n-- Paste your data model markdown and re-export.\n';
  }

  const header = [
    '-- ============================================================',
    '-- Auto-generated SQL DDL from Agentic SDLC Data Model',
    `-- Generated: ${new Date().toISOString()}`,
    '-- ============================================================',
    '',
  ].join('\n');

  const body = tables.map(({ entity, columns }) => {
    const tableName = toSnakeCase(entity);
    if (columns.length === 0) return `-- Skipped "${entity}": no parseable columns\n`;

    const pkCols = columns.filter((c) => /\bPK\b|\bprimary\s*key\b/i.test(c.constraints));

    const colDefs = columns.map((col) => {
      const colName = toSnakeCase(col.name);
      const sqlType = toSqlType(col.type);
      const isPk = /\bPK\b|\bprimary\s*key\b/i.test(col.constraints);
      const isNotNull = isPk || /NOT\s*NULL|required/i.test(col.constraints);
      const isUnique = /\bUNIQUE\b|\bUK\b/i.test(col.constraints);

      const parts = [colName, sqlType];
      if (isPk && pkCols.length === 1) parts.push('PRIMARY KEY');
      if (!isPk && isNotNull) parts.push('NOT NULL');
      if (isUnique) parts.push('UNIQUE');

      return `  ${parts.join(' ')}`;
    });

    if (pkCols.length > 1) {
      colDefs.push(`  PRIMARY KEY (${pkCols.map((c) => toSnakeCase(c.name)).join(', ')})`);
    }

    return [`CREATE TABLE ${tableName} (`, colDefs.join(',\n'), ');', ''].join('\n');
  }).join('\n');

  return header + body;
}

function downloadSqlScript(markdown: string, label: string, projectName: string, phaseNumber: number) {
  const sql = generateSqlFromMarkdown(markdown);
  // Use same naming convention: ProjectName_Phase_AgentLabel.sql
  const filename = buildArtifactFilename(projectName, phaseNumber, label).replace(/\.docx$/, '.sql');
  const blob = new Blob([sql], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  agentId: AgentId;
  project: Project;
  canExport?: boolean;
  disabledReason?: string | null;
}

const menuBtnStyle: React.CSSProperties = {
  display: 'block', width: '100%', padding: '9px 14px',
  background: 'none', border: 'none', color: 'var(--text)',
  textAlign: 'left', fontSize: 13, cursor: 'pointer',
};

export default function ExportMenu({ agentId, project, canExport = true, disabledReason }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const def = AGENT_DEFINITIONS[agentId];
  const output = project.agentRuns[agentId]?.output ?? '';
  const isDataModel = agentId === 'dataModel';

  async function doExport(format: 'md' | 'docx' | 'pdf') {
    setOpen(false);
    setLoading(true);
    try {
      const phaseNumber = def ? PHASE_ORDER.indexOf(def.phase) + 1 : 1;
      const label = def?.outputLabel ?? agentId;
      if (format === 'md') {
        // Use the same naming convention as docx: ProjectName_Phase_AgentLabel.md
        const mdFilename = buildArtifactFilename(project.name, phaseNumber, label).replace(/\.docx$/, '.md');
        exportMarkdown(output, mdFilename);
      } else if (format === 'docx') {
        await exportDocx(output, label, project.name, phaseNumber, label);
      } else {
        exportPdf(output, label, project.name);
      }
    } finally {
      setLoading(false);
    }
  }

  async function doExportAll() {
    setOpen(false);
    setLoading(true);
    try {
      const artifacts = Object.entries(project.agentRuns ?? {})
        .filter(([, run]) => run?.status === 'complete' && run?.output)
        .map(([aid, run]) => {
          const d = AGENT_DEFINITIONS[aid as AgentId];
          const phaseNumber = d ? PHASE_ORDER.indexOf(d.phase) + 1 : 1;
          return {
            title: d?.outputLabel ?? aid,
            markdown: run!.output!,
            phaseNumber,
            agentLabel: d?.outputLabel ?? aid,
          };
        });
      await exportAllArtifactsZip(artifacts, project.name);
    } finally {
      setLoading(false);
    }
  }

  const completedCount = Object.values(project.agentRuns ?? {}).filter(
    (r) => r?.status === 'complete' && r?.output
  ).length;

  return (
    <div style={{ position: 'relative' }}>
      <button
        className="btn-secondary"
        onClick={() => canExport && setOpen((v) => !v)}
        disabled={loading || !output || !canExport}
        style={{ fontSize: 12 }}
        title={!canExport ? (disabledReason ?? 'Export is disabled for your current access level.') : undefined}
      >
        {loading ? 'Exporting…' : 'Export ▾'}
      </button>
      {open && (
        <div style={{
          position: 'absolute', right: 0, top: '110%',
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius)', minWidth: 160, zIndex: 50,
          overflow: 'hidden',
          boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
        }}>
          <button
            onClick={() => doExport('md')}
            style={menuBtnStyle}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface2)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
          >
            📄 Markdown (.md)
          </button>
          <button
            onClick={() => doExport('docx')}
            style={menuBtnStyle}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface2)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
          >
            📝 Word (.docx)
          </button>
          <button
            onClick={() => doExport('pdf')}
            style={menuBtnStyle}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface2)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
          >
            📑 PDF
          </button>
          {isDataModel && (
            <>
              <div style={{ borderTop: '1px solid var(--border)', margin: '4px 0' }} />
              <button
                onClick={() => {
                  setOpen(false);
                  const label = def?.outputLabel ?? agentId;
                  const phaseNumber = def ? PHASE_ORDER.indexOf(def.phase) + 1 : 1;
                  downloadSqlScript(output, label, project.name, phaseNumber);
                }}
                style={menuBtnStyle}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface2)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
              >
                🗄️ SQL Script (.sql)
              </button>
            </>
          )}
          {completedCount > 1 && (
            <>
              <div style={{ borderTop: '1px solid var(--border)', margin: '4px 0' }} />
              <button
                onClick={doExportAll}
                style={menuBtnStyle}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface2)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
              >
                📦 Export All (.zip)
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
