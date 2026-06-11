// tests/unit/DocumentViewer.test.tsx
// Component tests for components/documents/DocumentViewer.tsx — markdown
// rendering and Mermaid live-render / error-fallback handling.
// Covers TS-142 through TS-150 from
// docs/test-plans/document-export-github-test-plan.md.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import DocumentViewer from '../../frontend/src/components/documents/DocumentViewer';

// DocumentViewer lazy-loads mermaid via a <script> tag appended to
// document.head, gated by a module-level `mermaidLoaded` flag. To make the
// effect resolve quickly and deterministically in tests, we stub
// document.createElement so that any 'script' element with the mermaid CDN
// src fires its onload handler immediately (synchronously after being
// assigned), after pre-populating window.mermaid with our mock.

function installMermaidStub(renderImpl: (id: string, code: string) => Promise<{ svg: string }>) {
  (window as any).mermaid = {
    initialize: vi.fn(),
    render: vi.fn(renderImpl),
  };

  const originalCreateElement = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
    const el = originalCreateElement(tagName);
    if (tagName === 'script') {
      // Defer setting src trigger: jsdom doesn't actually load remote scripts,
      // so we manually invoke onload once src is assigned.
      let onloadHandler: (() => void) | null = null;
      Object.defineProperty(el, 'onload', {
        set(fn: () => void) {
          onloadHandler = fn;
        },
        get() {
          return onloadHandler;
        },
      });
      Object.defineProperty(el, 'src', {
        set(_value: string) {
          // Simulate async script load.
          queueMicrotask(() => onloadHandler?.());
        },
        get() {
          return 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js';
        },
      });
    }
    return el;
  });

  return originalCreateElement;
}

describe('DocumentViewer', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as any).mermaid;
    // Clean up any stray mermaid error SVGs the component may have appended to body.
    document.querySelectorAll('svg[aria-roledescription="error"], svg[id^="mermaid-svg-"]')
      .forEach((el) => el.remove());
  });

  it('renders headings, bold text, bullet lists, and tables (TS-142)', () => {
    const md = [
      '# Title',
      '',
      'This is **bold** text.',
      '',
      '- Item one',
      '- Item two',
      '',
      '| A | B |',
      '|---|---|',
      '| 1 | 2 |',
    ].join('\n');

    const { container } = render(<DocumentViewer markdown={md} />);

    expect(container.querySelector('h1')?.textContent).toBe('Title');
    expect(container.querySelector('strong')?.textContent).toBe('bold');
    const items = container.querySelectorAll('ul li');
    expect(items.length).toBe(2);
    expect(items[0].textContent).toBe('Item one');
    expect(container.querySelector('table')).not.toBeNull();
  });

  it('replaces a mermaid placeholder with the rendered SVG on success (TS-143)', async () => {
    installMermaidStub(async () => ({ svg: '<svg data-testid="rendered-mermaid"></svg>' }));

    const md = ['```mermaid', 'graph TD; A-->B;', '```'].join('\n');
    const { container } = render(<DocumentViewer markdown={md} />);

    await waitFor(() => {
      expect(container.querySelector('.mermaid svg[data-testid="rendered-mermaid"]')).not.toBeNull();
    });
    expect(container.querySelector('.mermaid-placeholder')).toBeNull();
  });

  it('falls back to raw source when mermaid.render resolves an error SVG (TS-144)', async () => {
    installMermaidStub(async () => ({
      svg: '<svg aria-roledescription="error"><text>Syntax error</text></svg>',
    }));

    const code = 'graph TD; A--invalid--';
    const md = ['```mermaid', code, '```'].join('\n');
    const { container } = render(<DocumentViewer markdown={md} />);

    await waitFor(() => {
      const fallback = container.querySelector('pre.mermaid-fallback code');
      expect(fallback).not.toBeNull();
      expect(fallback?.textContent).toBe(code);
    });
    expect(container.querySelector('.mermaid-placeholder')).toBeNull();
  });

  it('falls back to raw source when mermaid.render rejects (TS-145)', async () => {
    installMermaidStub(async () => {
      throw new Error('render failed');
    });

    const code = 'graph TD; totally broken';
    const md = ['```mermaid', code, '```'].join('\n');
    const { container } = render(<DocumentViewer markdown={md} />);

    await waitFor(() => {
      const fallback = container.querySelector('pre.mermaid-fallback code');
      expect(fallback).not.toBeNull();
      expect(fallback?.textContent).toBe(code);
    });
  });

  it('renders a blockquote and a horizontal rule (TS-146)', () => {
    const md = ['> A note', '', '---', '', 'Body text.'].join('\n');
    const { container } = render(<DocumentViewer markdown={md} />);

    expect(container.querySelector('blockquote')?.textContent).toBe('A note');
    expect(container.querySelector('hr')).not.toBeNull();
  });

  it('renders without throwing for empty markdown (TS-147)', () => {
    expect(() => render(<DocumentViewer markdown="" />)).not.toThrow();
  });

  it('renders a numbered list as <li> elements (TS-148)', () => {
    const md = ['1. one', '2. two'].join('\n');
    const { container } = render(<DocumentViewer markdown={md} />);

    const items = container.querySelectorAll('li');
    expect(items.length).toBe(2);
    expect(items[0].textContent).toBe('one');
    expect(items[1].textContent).toBe('two');
  });

  it('renders bold-italic emphasis as a combined element (TS-149)', () => {
    const md = '***bold-italic***';
    const { container } = render(<DocumentViewer markdown={md} />);

    const strong = container.querySelector('strong');
    expect(strong).not.toBeNull();
    expect(strong?.querySelector('em')?.textContent).toBe('bold-italic');
  });

  it('handles two mermaid blocks independently — one succeeds, one falls back (TS-150)', async () => {
    let callCount = 0;
    installMermaidStub(async () => {
      callCount += 1;
      if (callCount === 1) {
        return { svg: '<svg data-testid="ok-mermaid"></svg>' };
      }
      return { svg: '<svg aria-roledescription="error"><text>Syntax error</text></svg>' };
    });

    const goodCode = 'graph TD; A-->B;';
    const badCode = 'graph TD; broken---';
    const md = [
      '```mermaid',
      goodCode,
      '```',
      '',
      '```mermaid',
      badCode,
      '```',
    ].join('\n');

    const { container } = render(<DocumentViewer markdown={md} />);

    await waitFor(() => {
      expect(container.querySelector('.mermaid svg[data-testid="ok-mermaid"]')).not.toBeNull();
      expect(container.querySelector('pre.mermaid-fallback code')).not.toBeNull();
    });

    expect(container.querySelector('pre.mermaid-fallback code')?.textContent).toBe(badCode);
    expect(container.querySelectorAll('.mermaid-placeholder').length).toBe(0);
  });
});
