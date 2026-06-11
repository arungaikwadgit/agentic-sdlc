import { useState } from 'react';
import { exportMarkdown, exportDocx } from '@/services/exporters/documentExporter';
import type { Project } from '@/types/project.types';
import type { AgentId } from '@/types/agent.types';
import { AGENT_DEFINITIONS } from '@/agents/definitions';
import { PHASE_ORDER } from '@/agents/constants';

interface Props {
  agentId: AgentId;
  project: Project;
}

export default function ExportMenu({ agentId, project }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const def = AGENT_DEFINITIONS[agentId];
  const output = project.agentRuns[agentId]?.output ?? '';

  async function doExport(format: 'md' | 'docx') {
    setOpen(false);
    setLoading(true);
    try {
      if (format === 'md') {
        exportMarkdown(output, `${def?.outputLabel ?? agentId}.md`);
      } else {
        const phaseNumber = def ? PHASE_ORDER.indexOf(def.phase) + 1 : undefined;
        await exportDocx(output, def?.outputLabel ?? agentId, project.name, phaseNumber, def?.outputLabel ?? agentId);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ position: 'relative' }}>
      <button
        className="btn-secondary"
        onClick={() => setOpen((v) => !v)}
        disabled={loading || !output}
        style={{ fontSize: 12 }}
      >
        {loading ? 'Exporting...' : 'Export ▾'}
      </button>
      {open && (
        <div style={{
          position: 'absolute', right: 0, top: '110%',
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius)', minWidth: 130, zIndex: 50,
          overflow: 'hidden',
          boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
        }}>
          <button onClick={() => doExport('md')} style={{
            display: 'block', width: '100%', padding: '9px 14px',
            background: 'none', border: 'none', color: 'var(--text)',
            textAlign: 'left', fontSize: 13,
          }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface2)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
          >
            📄 Markdown (.md)
          </button>
          <button onClick={() => doExport('docx')} style={{
            display: 'block', width: '100%', padding: '9px 14px',
            background: 'none', border: 'none', color: 'var(--text)',
            textAlign: 'left', fontSize: 13,
          }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface2)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
          >
            📝 Word (.docx)
          </button>
        </div>
      )}
    </div>
  );
}
