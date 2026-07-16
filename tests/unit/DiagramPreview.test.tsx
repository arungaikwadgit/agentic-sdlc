// tests/unit/DiagramPreview.test.tsx
//
// Unit + integration tests for src/components/documents/DiagramPreview.tsx
//
// Implementation note (2025):
//   DiagramPreview was migrated from a sandboxed-iframe / CDN approach to the
//   mermaid npm package rendered directly into a React div via mermaid.render().
//   There are NO iframes, srcDoc attributes, postMessage events, or CDN URLs
//   in the current implementation.
//
// Mock fix: vi.hoisted() is used so mockRender/mockInitialize are available
// inside the vi.mock() factory, which is hoisted above imports by Vitest.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ── Mock mermaid ───────────────────────────────────────────────────────────────
const { mockRender, mockInitialize } = vi.hoisted(() => ({
  mockRender: vi.fn<[string, string], Promise<{ svg: string }>>(),
  mockInitialize: vi.fn(),
}));

vi.mock('../../frontend/src/services/mermaidRenderer', () => ({
  initializeMermaid: mockInitialize,
  renderMermaid: mockRender,
}));

const { default: DiagramPreview } = await import('../../frontend/src/components/documents/DiagramPreview');

// jsdom stubs
if (typeof URL.createObjectURL !== 'function') {
  (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = () => 'blob:mock';
}
if (typeof URL.revokeObjectURL !== 'function') {
  (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = () => {};
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function mermaidMd(blocks: Array<{ heading?: string; code: string }>): string {
  return blocks
    .map(({ heading, code }) =>
      [heading ? `## ${heading}` : '', '```mermaid', code, '```'].filter(Boolean).join('\n'),
    )
    .join('\n\n');
}

const SAMPLE_SVG = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="5"/></svg>';

beforeEach(() => {
  vi.clearAllMocks();
  mockRender.mockResolvedValue({ svg: SAMPLE_SVG });
});

afterEach(() => {
  // Keep the module-level Mermaid mock installed across tests.
  vi.clearAllMocks();
});

// ── 1. Empty state ─────────────────────────────────────────────────────────────
describe('DiagramPreview — empty state', () => {
  it('shows empty-state message when markdown has no mermaid blocks', () => {
    render(<DiagramPreview markdown="# Title\n\nProse only." />);
    expect(screen.getByText(/No Mermaid diagrams found/i)).toBeInTheDocument();
  });

  it('empty-state message mentions the Spec tab', () => {
    render(<DiagramPreview markdown="" />);
    expect(screen.getByText(/Spec tab/i)).toBeInTheDocument();
  });

  it('renders no .diagramContainer divs when there are no mermaid blocks', () => {
    const { container } = render(<DiagramPreview markdown="```html\n<div/>\n```" />);
    expect(container.querySelectorAll('[class*="diagramContainer"]')).toHaveLength(0);
  });

  it('renders no iframes — implementation uses divs, not iframes', () => {
    const { container } = render(<DiagramPreview markdown={mermaidMd([{ code: 'graph TD; A-->B' }])} />);
    expect(container.querySelectorAll('iframe')).toHaveLength(0);
  });
});

// ── 2. Block label derivation ──────────────────────────────────────────────────
describe('DiagramPreview — block label derivation', () => {
  it('uses the preceding heading as the label', () => {
    const md = mermaidMd([{ heading: 'System Context', code: 'graph TD; A-->B' }]);
    render(<DiagramPreview markdown={md} />);
    expect(screen.getByText('System Context')).toBeInTheDocument();
  });

  it('falls back to "Diagram N" when there is no preceding heading', () => {
    const md = ['```mermaid', 'graph TD; X-->Y', '```'].join('\n');
    render(<DiagramPreview markdown={md} />);
    expect(screen.getByText('Diagram 1')).toBeInTheDocument();
  });

  it('uses the most recent heading for each block independently', () => {
    const md = [
      '## First Section',
      '```mermaid', 'graph TD; A-->B', '```',
      '',
      '## Second Section',
      '```mermaid', 'graph TD; C-->D', '```',
    ].join('\n');
    render(<DiagramPreview markdown={md} />);
    expect(screen.getByText('First Section')).toBeInTheDocument();
    expect(screen.getByText('Second Section')).toBeInTheDocument();
  });

  it('carries the last heading forward when two blocks follow the same heading', () => {
    const md = [
      '## Shared Heading',
      '```mermaid', 'graph TD; A-->B', '```',
      '',
      '```mermaid', 'graph TD; C-->D', '```',
    ].join('\n');
    render(<DiagramPreview markdown={md} />);
    expect(screen.getAllByText('Shared Heading')).toHaveLength(2);
  });

  it('handles h1/h3/h6 headings equally', () => {
    const md = [
      '# H1 Level', '```mermaid', 'graph TD; A-->B', '```',
      '',
      '### H3 Level', '```mermaid', 'graph TD; C-->D', '```',
      '',
      '###### H6 Level', '```mermaid', 'graph TD; E-->F', '```',
    ].join('\n');
    render(<DiagramPreview markdown={md} />);
    expect(screen.getByText('H1 Level')).toBeInTheDocument();
    expect(screen.getByText('H3 Level')).toBeInTheDocument();
    expect(screen.getByText('H6 Level')).toBeInTheDocument();
  });
});

// ── 3. Div-based rendering ─────────────────────────────────────────────────────
describe('DiagramPreview — div rendering', () => {
  it('renders one diagram card per mermaid block', () => {
    const md = mermaidMd([
      { heading: 'Diagram A', code: 'graph TD; A-->B' },
      { heading: 'Diagram B', code: 'graph TD; C-->D' },
    ]);
    render(<DiagramPreview markdown={md} />);
    expect(screen.getByText('Diagram A')).toBeInTheDocument();
    expect(screen.getByText('Diagram B')).toBeInTheDocument();
  });

  it('shows "rendering…" status pill initially', () => {
    mockRender.mockReturnValue(new Promise(() => {}));
    render(<DiagramPreview markdown={mermaidMd([{ code: 'graph TD; A-->B' }])} />);
    expect(screen.getByText(/rendering/i)).toBeInTheDocument();
  });

  it('shows "rendered" status pill after successful render', async () => {
    render(<DiagramPreview markdown={mermaidMd([{ code: 'graph TD; A-->B' }])} />);
    await waitFor(() => expect(screen.getByText(/rendered/i)).toBeInTheDocument());
  });

  it('calls mermaid.render() with the diagram code', async () => {
    const code = 'graph TD; A-->B';
    render(<DiagramPreview markdown={mermaidMd([{ code }])} />);
    await waitFor(() => expect(mockRender).toHaveBeenCalled());
    const [, passedCode] = mockRender.mock.calls[0];
    expect(passedCode).toContain('graph TD');
  });

  it('calls mermaid.render() once per diagram block', async () => {
    const md = mermaidMd([{ code: 'graph TD; A-->B' }, { code: 'graph LR; C-->D' }]);
    render(<DiagramPreview markdown={md} />);
    await waitFor(() => expect(mockRender).toHaveBeenCalledTimes(2));
  });

  it('diagramContainer has data-status="loading" before render resolves', () => {
    mockRender.mockReturnValue(new Promise(() => {}));
    const { container } = render(<DiagramPreview markdown={mermaidMd([{ code: 'graph TD; A-->B' }])} />);
    expect(container.querySelector('[data-status="loading"]')).toBeInTheDocument();
  });

  it('diagramContainer has data-status="ready" after successful render', async () => {
    const { container } = render(<DiagramPreview markdown={mermaidMd([{ code: 'graph TD; A-->B' }])} />);
    await waitFor(() => expect(container.querySelector('[data-status="ready"]')).toBeInTheDocument());
  });

  it('SVG is injected into the diagramContainer after render', async () => {
    const { container } = render(<DiagramPreview markdown={mermaidMd([{ code: 'graph TD; A-->B' }])} />);
    await waitFor(() => expect(container.querySelector('svg')).toBeInTheDocument());
  });

  it('does not render iframes — ever', async () => {
    const { container } = render(<DiagramPreview markdown={mermaidMd([{ code: 'graph TD; A-->B' }])} />);
    await waitFor(() => expect(mockRender).toHaveBeenCalled());
    expect(container.querySelectorAll('iframe')).toHaveLength(0);
  });
});

// ── 4. Error state ─────────────────────────────────────────────────────────────
describe('DiagramPreview — error state', () => {
  it('shows "⚠ error" status pill when mermaid.render rejects', async () => {
    mockRender.mockRejectedValue(new Error('Parse error on line 2'));
    render(<DiagramPreview markdown={mermaidMd([{ code: 'invalid!!' }])} />);
    await waitFor(() => expect(screen.getByText('⚠ error')).toBeInTheDocument());
  });

  it('shows the error message in the error box', async () => {
    mockRender.mockRejectedValue(new Error('Syntax error: unexpected token'));
    render(<DiagramPreview markdown={mermaidMd([{ code: 'bad diagram' }])} />);
    await waitFor(() => expect(screen.getByText(/Syntax error: unexpected token/i)).toBeInTheDocument());
  });

  it('shows the "Render error" heading in the error box', async () => {
    mockRender.mockRejectedValue(new Error('oops'));
    render(<DiagramPreview markdown={mermaidMd([{ code: 'bad' }])} />);
    await waitFor(() => expect(screen.getByText(/Render error/i)).toBeInTheDocument());
  });

  it('shows a details/summary with raw mermaid source on error', async () => {
    mockRender.mockRejectedValue(new Error('fail'));
    const code = 'graph TD; X-->Y';
    const { container } = render(<DiagramPreview markdown={mermaidMd([{ code }])} />);
    await waitFor(() => {
      const details = container.querySelector('details');
      expect(details).toBeInTheDocument();
      expect(details?.textContent).toContain(code);
    });
  });

  it('handles non-Error rejection (string)', async () => {
    mockRender.mockRejectedValue('string error');
    render(<DiagramPreview markdown={mermaidMd([{ code: 'bad' }])} />);
    await waitFor(() => {
      expect(screen.getByText('⚠ error')).toBeInTheDocument();
      expect(screen.getByText('string error')).toBeInTheDocument();
    });
  });

  it('shows one error box per failing diagram', async () => {
    mockRender.mockRejectedValue(new Error('fail'));
    const md = mermaidMd([{ code: 'bad1' }, { code: 'bad2' }]);
    const { container } = render(<DiagramPreview markdown={md} />);
    await waitFor(() => {
      expect(container.querySelectorAll('[class*="errorBox"]')).toHaveLength(2);
    });
  });
});

// ── 5. Download SVG button ─────────────────────────────────────────────────────
describe('DiagramPreview — Download SVG button', () => {
  it('download button is disabled before render resolves', () => {
    mockRender.mockReturnValue(new Promise(() => {}));
    render(<DiagramPreview markdown={mermaidMd([{ code: 'graph TD; A-->B' }])} />);
    expect(screen.getByRole('button', { name: /SVG/i })).toBeDisabled();
  });

  it('download button is enabled after successful render', async () => {
    render(<DiagramPreview markdown={mermaidMd([{ code: 'graph TD; A-->B' }])} />);
    const btn = screen.getByRole('button', { name: /SVG/i });
    await waitFor(() => expect(btn).not.toBeDisabled());
  });

  it('download button remains disabled after a render error', async () => {
    mockRender.mockRejectedValue(new Error('fail'));
    render(<DiagramPreview markdown={mermaidMd([{ code: 'bad' }])} />);
    const btn = screen.getByRole('button', { name: /SVG/i });
    await waitFor(() => expect(screen.getByText('⚠ error')).toBeInTheDocument());
    expect(btn).toBeDisabled();
  });

  it('clicking download creates a temporary <a> element and triggers click', async () => {
    render(<DiagramPreview markdown={mermaidMd([{ heading: 'Flow', code: 'graph TD; A-->B' }])} />);
    const btn = screen.getByRole('button', { name: /SVG/i });
    await waitFor(() => expect(btn).not.toBeDisabled());

    const clickSpy = vi.fn();
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = realCreate(tag);
      if (tag === 'a') el.click = clickSpy;
      return el;
    });

    await act(async () => { await userEvent.click(btn); });
    expect(clickSpy).toHaveBeenCalled();
  });
});

// ── 6. Non-mermaid fences ──────────────────────────────────────────────────────
describe('DiagramPreview — non-mermaid fence handling', () => {
  it('ignores ```html blocks', () => {
    render(<DiagramPreview markdown="```html\n<div>hello</div>\n```" />);
    expect(screen.getByText(/No Mermaid diagrams found/i)).toBeInTheDocument();
  });

  it('ignores ```js blocks', () => {
    render(<DiagramPreview markdown="```js\nconsole.log('hi')\n```" />);
    expect(screen.getByText(/No Mermaid diagrams found/i)).toBeInTheDocument();
  });

  it('matches ```mermaid with trailing whitespace on the fence line', async () => {
    render(<DiagramPreview markdown={'```mermaid   \ngraph TD; A-->B\n```'} />);
    await waitFor(() => expect(mockRender).toHaveBeenCalled());
    expect(screen.queryByText(/No Mermaid diagrams found/i)).not.toBeInTheDocument();
  });

  it('ignores ```mermaidExtra blocks (not an exact match)', () => {
    render(<DiagramPreview markdown="```mermaidExtra\ngraph TD; A-->B\n```" />);
    expect(screen.getByText(/No Mermaid diagrams found/i)).toBeInTheDocument();
  });

  it('correctly extracts mermaid blocks mixed with other fences', async () => {
    const md = [
      '```js', 'const x = 1', '```', '',
      '## My Diagram', '```mermaid', 'graph TD; A-->B', '```', '',
      '```python', 'print("hello")', '```',
    ].join('\n');
    render(<DiagramPreview markdown={md} />);
    expect(screen.getByText('My Diagram')).toBeInTheDocument();
    await waitFor(() => expect(mockRender).toHaveBeenCalledTimes(1));
  });
});

// ── 7. Cancellation on unmount ─────────────────────────────────────────────────
describe('DiagramPreview — cancellation on unmount', () => {
  it('does not call setState after unmount', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    let resolve!: (v: { svg: string }) => void;
    mockRender.mockReturnValue(new Promise((r) => { resolve = r; }));

    const { unmount } = render(<DiagramPreview markdown={mermaidMd([{ code: 'graph TD; A-->B' }])} />);
    unmount();
    await act(async () => { resolve({ svg: SAMPLE_SVG }); });

    expect(consoleSpy).not.toHaveBeenCalledWith(expect.stringContaining('unmounted'));
    consoleSpy.mockRestore();
  });
});

// ── 8. mermaid singleton init ──────────────────────────────────────────────────
describe('DiagramPreview — mermaid singleton init', () => {
  it('calls mermaid.initialize with startOnLoad: false', async () => {
    render(<DiagramPreview markdown={mermaidMd([{ code: 'graph TD; A-->B' }])} />);
    await waitFor(() => expect(mockRender).toHaveBeenCalled());
    expect(mockInitialize).toHaveBeenCalledWith(expect.objectContaining({ startOnLoad: false }));
  });

  it('calls mermaid.initialize with securityLevel: "loose"', async () => {
    render(<DiagramPreview markdown={mermaidMd([{ code: 'graph TD; A-->B' }])} />);
    await waitFor(() => expect(mockRender).toHaveBeenCalled());
    expect(mockInitialize).toHaveBeenCalledWith(expect.objectContaining({ securityLevel: 'loose' }));
  });
});

// ── 9. Accessibility ───────────────────────────────────────────────────────────
describe('DiagramPreview — accessibility', () => {
  it('each diagram card has a visible label', () => {
    const md = ['## Context Diagram', '```mermaid', 'graph TD; A-->B', '```'].join('\n');
    render(<DiagramPreview markdown={md} />);
    expect(screen.getByText('Context Diagram')).toBeInTheDocument();
  });

  it('download button is accessible via button role', () => {
    render(<DiagramPreview markdown={mermaidMd([{ code: 'graph TD; A-->B' }])} />);
    expect(screen.getByRole('button', { name: /SVG/i })).toBeInTheDocument();
  });

  it('status pill text is meaningful (not just an icon)', () => {
    render(<DiagramPreview markdown={mermaidMd([{ code: 'graph TD; A-->B' }])} />);
    expect(screen.getByText(/rendering|rendered|error/i)).toBeInTheDocument();
  });
});
