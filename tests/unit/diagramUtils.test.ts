/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential - Unauthorized use prohibited.
 */
import { describe, it, expect } from 'vitest';
import { DIAGRAM_AGENTS, hasMermaidDiagram } from '../../frontend/src/agents/diagramUtils';

describe('DIAGRAM_AGENTS', () => {
  it('includes dataModel, architecture, apiDesign, and interaction', () => {
    expect(DIAGRAM_AGENTS.has('dataModel')).toBe(true);
    expect(DIAGRAM_AGENTS.has('architecture')).toBe(true);
    expect(DIAGRAM_AGENTS.has('apiDesign')).toBe(true);
    expect(DIAGRAM_AGENTS.has('interaction')).toBe(true);
  });

  it('does not include an unrelated document agent', () => {
    expect(DIAGRAM_AGENTS.has('manager')).toBe(false);
  });
});

describe('hasMermaidDiagram', () => {
  it('detects a fenced ```mermaid block', () => {
    const text = 'Some doc text.\n\n```mermaid\nflowchart TD\nA-->B\n```\nMore text.';
    expect(hasMermaidDiagram(text)).toBe(true);
  });

  it('detects a bare mermaid diagram declaration without a fence', () => {
    expect(hasMermaidDiagram('erDiagram\nUSER ||--o{ ORDER : places')).toBe(true);
    expect(hasMermaidDiagram('Some text\nsequenceDiagram\nA->>B: hi')).toBe(true);
  });

  it('returns false for plain text with no diagram', () => {
    expect(hasMermaidDiagram('Just a plain document with no diagrams at all.')).toBe(false);
  });

  it('returns false for undefined/null/empty input', () => {
    expect(hasMermaidDiagram(undefined)).toBe(false);
    expect(hasMermaidDiagram(null)).toBe(false);
    expect(hasMermaidDiagram('')).toBe(false);
  });
});
