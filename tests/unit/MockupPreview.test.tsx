// tests/unit/MockupPreview.test.tsx
//
// Unit + integration tests for src/components/documents/MockupPreview.tsx
// Covers:
//   - extractHtmlBlocks(): label derivation, fence matching, heading fallback
//   - applyStyleOverrides(): CSS variable injection into <head>, <html>, bare html
//   - Style editor panel: open/close toggle, all 7 palette presets
//   - Individual controls: color pickers, font selector, radius slider,
//     spacing slider, reset button
//   - Empty-state rendering when no ```html blocks are present
//   - Iframe sandbox attributes and srcDoc patching

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MockupPreview from '../../frontend/src/components/documents/MockupPreview';

afterEach(() => vi.restoreAllMocks());

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

/** Build markdown containing one or more html fenced blocks. */
function htmlMd(blocks: Array<{ heading?: string; code: string }>): string {
  return blocks
    .map(({ heading, code }) =>
      [heading ? `## ${heading}` : '', '```html', code, '```'].filter(Boolean).join('\n')
    )
    .join('\n\n');
}

const SIMPLE_HTML = '<html><head></head><body><p>Hello</p></body></html>';
const HEADLESS_HTML = '<p>No head tag here</p>';
const BARE_HTML = '<p>No html wrapper at all</p>';

// ─────────────────────────────────────────────────────────────────
// 1. Empty state
// ─────────────────────────────────────────────────────────────────
describe('MockupPreview — empty state', () => {
  it('renders the empty-state message when there are no html blocks', () => {
    render(<MockupPreview markdown="# Title\n\nSome prose." />);
    expect(screen.getByText(/No HTML mockups in this output/i)).toBeInTheDocument();
  });

  it('empty-state message tells user to switch to the Spec tab', () => {
    render(<MockupPreview markdown="" />);
    expect(screen.getByText(/Reset to built-in default/i)).toBeInTheDocument();
  });

  it('does not render any iframes in the empty state', () => {
    const { container } = render(<MockupPreview markdown="```mermaid\ngraph TD; A-->B\n```" />);
    expect(container.querySelectorAll('iframe')).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────
// 2. extractHtmlBlocks — label derivation
// ─────────────────────────────────────────────────────────────────
describe('MockupPreview — block label derivation', () => {
  // NOTE: the component renders both the markdown heading itself (as a real
  // <h2>/<h1>/etc inside the article body) AND the derived block.label in the
  // HtmlFrame header/title — so a heading used as a label legitimately
  // appears twice in the DOM. We assert via the iframe's title attribute
  // (block.label is unambiguous there) rather than getByText, which fails
  // with "multiple elements found" once a heading is present.
  it('uses the nearest preceding heading as the label', () => {
    const md = htmlMd([{ heading: 'Login Screen', code: SIMPLE_HTML }]);
    const { container } = render(<MockupPreview markdown={md} />);
    expect(container.querySelector('iframe')!.getAttribute('title')).toBe('Login Screen');
  });

  it('falls back to "Mockup N" when there is no preceding heading', () => {
    const md = '```html\n' + SIMPLE_HTML + '\n```';
    const { container } = render(<MockupPreview markdown={md} />);
    expect(container.querySelector('iframe')!.getAttribute('title')).toBe('Mockup 1');
  });

  it('increments the fallback index for each headingless block', () => {
    const md = [
      '```html', SIMPLE_HTML, '```',
      '',
      '```html', SIMPLE_HTML, '```',
    ].join('\n');
    const { container } = render(<MockupPreview markdown={md} />);
    const titles = Array.from(container.querySelectorAll('iframe')).map(f => f.getAttribute('title'));
    expect(titles).toEqual(['Mockup 1', 'Mockup 2']);
  });

  it('each block uses the most recent heading independently', () => {
    const md = [
      '## Screen A',
      '```html', SIMPLE_HTML, '```',
      '',
      '## Screen B',
      '```html', SIMPLE_HTML, '```',
    ].join('\n');
    const { container } = render(<MockupPreview markdown={md} />);
    const titles = Array.from(container.querySelectorAll('iframe')).map(f => f.getAttribute('title'));
    expect(titles).toEqual(['Screen A', 'Screen B']);
  });

  it('matches h1 through h6 headings as labels', () => {
    const md = [
      '# H1', '```html', SIMPLE_HTML, '```',
      '### H3', '```html', SIMPLE_HTML, '```',
    ].join('\n');
    const { container } = render(<MockupPreview markdown={md} />);
    const titles = Array.from(container.querySelectorAll('iframe')).map(f => f.getAttribute('title'));
    expect(titles).toEqual(['H1', 'H3']);
  });

  it('ignores ```mermaid blocks and does not count them as mockups', () => {
    const md = [
      '```mermaid', 'graph TD; A-->B', '```',
      '```html', SIMPLE_HTML, '```',
    ].join('\n');
    render(<MockupPreview markdown={md} />);
    // Only one iframe for the html block
    const { container } = render(<MockupPreview markdown={md} />);
    expect(container.querySelectorAll('iframe')).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────
// 3. applyStyleOverrides — CSS variable injection
// ─────────────────────────────────────────────────────────────────
describe('MockupPreview — applyStyleOverrides', () => {
  // The toolbar has exactly 2 type="color" swatches: Primary (index 0) and
  // Surface (index 1). Secondary/Text colors are only settable via the
  // palette presets, not individual swatches (see "palette presets" below).
  it('injects :root variables into <head> when the HTML has a <head> tag', () => {
    const md = htmlMd([{ heading: 'Test', code: SIMPLE_HTML }]);
    const { container } = render(<MockupPreview markdown={md} />);

    const swatches = container.querySelectorAll('input[type="color"]');
    fireEvent.change(swatches[0], { target: { value: '#ff0000' } });

    const srcDoc = (container.querySelector('iframe') as HTMLIFrameElement).getAttribute('srcdoc') ?? '';
    expect(srcDoc).toContain('<head>');
    expect(srcDoc).toContain('--color-primary: #ff0000');
    expect(srcDoc).toContain(':root');
  });

  it('injects after <html> when there is no <head>', () => {
    const md = htmlMd([{ code: '<html><body><p>hi</p></body></html>' }]);
    const { container } = render(<MockupPreview markdown={md} />);

    const swatches = container.querySelectorAll('input[type="color"]');
    fireEvent.change(swatches[0], { target: { value: '#00ff00' } });

    const srcDoc = (container.querySelector('iframe') as HTMLIFrameElement).getAttribute('srcdoc') ?? '';
    expect(srcDoc).toContain('--color-primary: #00ff00');
  });

  it('prepends the override block when there is neither <head> nor <html>', () => {
    const md = htmlMd([{ code: BARE_HTML }]);
    const { container } = render(<MockupPreview markdown={md} />);

    const swatches = container.querySelectorAll('input[type="color"]');
    fireEvent.change(swatches[0], { target: { value: '#0000ff' } });

    const srcDoc = (container.querySelector('iframe') as HTMLIFrameElement).getAttribute('srcdoc') ?? '';
    expect(srcDoc).toContain('--color-primary: #0000ff');
    // The override should appear before the original HTML
    expect(srcDoc.indexOf(':root')).toBeLessThan(srcDoc.indexOf('<p>No html wrapper'));
  });

  it('applies a :root block with radius/spacing defaults even when colors are blank', () => {
    const md = htmlMd([{ code: SIMPLE_HTML }]);
    const { container } = render(<MockupPreview markdown={md} />);
    // Default state: radius=8, spacingUnit=8, colors/font blank.
    const srcDoc = (container.querySelector('iframe') as HTMLIFrameElement).getAttribute('srcdoc') ?? '';
    expect(srcDoc).toContain('--radius: 8px');
    expect(srcDoc).toContain('--spacing-unit: 8px');
  });

  it('injects --color-surface when the surface swatch is set', () => {
    const md = htmlMd([{ code: SIMPLE_HTML }]);
    const { container } = render(<MockupPreview markdown={md} />);

    const swatches = container.querySelectorAll('input[type="color"]');
    fireEvent.change(swatches[1], { target: { value: '#f0f0f0' } });

    const srcDoc = (container.querySelector('iframe') as HTMLIFrameElement).getAttribute('srcdoc') ?? '';
    expect(srcDoc).toContain('--color-surface: #f0f0f0');
  });

  it('injects --color-secondary and --color-text via a palette preset', async () => {
    const md = htmlMd([{ code: SIMPLE_HTML }]);
    const { container } = render(<MockupPreview markdown={md} />);

    await userEvent.click(screen.getByTitle('Ocean'));

    const srcDoc = (container.querySelector('iframe') as HTMLIFrameElement).getAttribute('srcdoc') ?? '';
    expect(srcDoc).toContain('--color-secondary: #00b4d8');
    expect(srcDoc).toContain('--color-text: #1a2533');
  });

  it('applies overrides to every iframe simultaneously', () => {
    const md = htmlMd([
      { heading: 'Screen 1', code: SIMPLE_HTML },
      { heading: 'Screen 2', code: SIMPLE_HTML },
    ]);
    const { container } = render(<MockupPreview markdown={md} />);

    const swatches = container.querySelectorAll('input[type="color"]');
    fireEvent.change(swatches[0], { target: { value: '#123456' } });

    const iframes = container.querySelectorAll('iframe');
    iframes.forEach((iframe) => {
      expect(iframe.getAttribute('srcdoc')).toContain('--color-primary: #123456');
    });
  });
});

// ─────────────────────────────────────────────────────────────────
// 4. Sticky toolbar — viewport switcher
// ─────────────────────────────────────────────────────────────────
// NOTE: the old collapsible "Style Editor" side panel (◀/▶ toggle, "Color
// Palette" header) no longer exists. The current component uses a single
// always-visible sticky toolbar (viewport + palette + color swatches +
// radius slider + font menu + reset), so there's nothing to collapse/expand
// anymore. This block now covers the viewport switcher that replaced it.
describe('MockupPreview — viewport switcher', () => {
  it('renders Desktop, Tablet, and Mobile viewport buttons, Desktop active by default', () => {
    const md = htmlMd([{ code: SIMPLE_HTML }]);
    render(<MockupPreview markdown={md} />);
    expect(screen.getByTitle(/Desktop/)).toBeInTheDocument();
    expect(screen.getByTitle(/Tablet/)).toBeInTheDocument();
    expect(screen.getByTitle(/Mobile/)).toBeInTheDocument();
  });

  it('clicking Tablet constrains the iframe viewport width to 768px', async () => {
    const md = htmlMd([{ code: SIMPLE_HTML }]);
    const { container } = render(<MockupPreview markdown={md} />);

    await userEvent.click(screen.getByTitle(/Tablet/));

    const viewportDiv = container.querySelector('[class*="htmlFrameViewport"]') as HTMLElement;
    expect(viewportDiv.style.maxWidth).toBe('768px');
  });

  it('clicking Mobile constrains the iframe viewport width to 375px', async () => {
    const md = htmlMd([{ code: SIMPLE_HTML }]);
    const { container } = render(<MockupPreview markdown={md} />);

    await userEvent.click(screen.getByTitle(/Mobile/));

    const viewportDiv = container.querySelector('[class*="htmlFrameViewport"]') as HTMLElement;
    expect(viewportDiv.style.maxWidth).toBe('375px');
  });
});

// ─────────────────────────────────────────────────────────────────
// 5. Palette presets
// ─────────────────────────────────────────────────────────────────
describe('MockupPreview — palette presets', () => {
  const EXPECTED_PRESETS = ['Original', 'Ocean', 'Forest', 'Sunset', 'Violet', 'Rose', 'Dark'];

  it('renders all 7 palette preset buttons', () => {
    const md = htmlMd([{ code: SIMPLE_HTML }]);
    render(<MockupPreview markdown={md} />);
    // The preset label row shows all names in a text node
    for (const label of EXPECTED_PRESETS) {
      expect(screen.getByTitle(label)).toBeInTheDocument();
    }
  });

  it('Ocean preset sets primary to #0077b6', async () => {
    const md = htmlMd([{ code: SIMPLE_HTML }]);
    const { container } = render(<MockupPreview markdown={md} />);
    await userEvent.click(screen.getByTitle('Ocean'));

    const srcDoc = (container.querySelector('iframe') as HTMLIFrameElement).getAttribute('srcdoc') ?? '';
    expect(srcDoc).toContain('--color-primary: #0077b6');
  });

  it('Forest preset sets primary to #2d6a4f', async () => {
    const md = htmlMd([{ code: SIMPLE_HTML }]);
    const { container } = render(<MockupPreview markdown={md} />);
    await userEvent.click(screen.getByTitle('Forest'));

    const srcDoc = (container.querySelector('iframe') as HTMLIFrameElement).getAttribute('srcdoc') ?? '';
    expect(srcDoc).toContain('--color-primary: #2d6a4f');
  });

  it('Sunset preset sets primary to #e85d04', async () => {
    const md = htmlMd([{ code: SIMPLE_HTML }]);
    const { container } = render(<MockupPreview markdown={md} />);
    await userEvent.click(screen.getByTitle('Sunset'));

    const srcDoc = (container.querySelector('iframe') as HTMLIFrameElement).getAttribute('srcdoc') ?? '';
    expect(srcDoc).toContain('--color-primary: #e85d04');
  });

  it('Violet preset sets primary to #6d28d9', async () => {
    const md = htmlMd([{ code: SIMPLE_HTML }]);
    const { container } = render(<MockupPreview markdown={md} />);
    await userEvent.click(screen.getByTitle('Violet'));

    const srcDoc = (container.querySelector('iframe') as HTMLIFrameElement).getAttribute('srcdoc') ?? '';
    expect(srcDoc).toContain('--color-primary: #6d28d9');
  });

  it('Rose preset sets primary to #be123c', async () => {
    const md = htmlMd([{ code: SIMPLE_HTML }]);
    const { container } = render(<MockupPreview markdown={md} />);
    await userEvent.click(screen.getByTitle('Rose'));

    const srcDoc = (container.querySelector('iframe') as HTMLIFrameElement).getAttribute('srcdoc') ?? '';
    expect(srcDoc).toContain('--color-primary: #be123c');
  });

  it('Dark preset sets surface to #0f172a', async () => {
    const md = htmlMd([{ code: SIMPLE_HTML }]);
    const { container } = render(<MockupPreview markdown={md} />);
    await userEvent.click(screen.getByTitle('Dark'));

    const srcDoc = (container.querySelector('iframe') as HTMLIFrameElement).getAttribute('srcdoc') ?? '';
    expect(srcDoc).toContain('--color-surface: #0f172a');
  });

  it('Original preset clears all color overrides (primary becomes blank)', async () => {
    const md = htmlMd([{ code: SIMPLE_HTML }]);
    const { container } = render(<MockupPreview markdown={md} />);

    // Apply Ocean first, then reset to Original
    await userEvent.click(screen.getByTitle('Ocean'));
    await userEvent.click(screen.getByTitle('Original'));

    const srcDoc = (container.querySelector('iframe') as HTMLIFrameElement).getAttribute('srcdoc') ?? '';
    expect(srcDoc).not.toContain('--color-primary:');
  });

  it('each preset also sets secondary and text colors', async () => {
    const md = htmlMd([{ code: SIMPLE_HTML }]);
    const { container } = render(<MockupPreview markdown={md} />);
    await userEvent.click(screen.getByTitle('Ocean'));

    const srcDoc = (container.querySelector('iframe') as HTMLIFrameElement).getAttribute('srcdoc') ?? '';
    expect(srcDoc).toContain('--color-secondary: #00b4d8');
    expect(srcDoc).toContain('--color-text: #1a2533');
  });
});

// ─────────────────────────────────────────────────────────────────
// 6. Font family selector
// ─────────────────────────────────────────────────────────────────
// NOTE: the font control is no longer a <select>. It's an "Aa" toggle
// button that opens a dropdown menu of font-option buttons (one of which
// is "Use original" to clear the override).
describe('MockupPreview — font family selector', () => {
  it('renders the "Aa" font menu toggle button', () => {
    render(<MockupPreview markdown={htmlMd([{ code: SIMPLE_HTML }])} />);
    expect(screen.getByTitle('Font family')).toBeInTheDocument();
  });

  it('selecting Roboto injects --font-family into the iframe', async () => {
    const md = htmlMd([{ code: SIMPLE_HTML }]);
    const { container } = render(<MockupPreview markdown={md} />);

    await userEvent.click(screen.getByTitle('Font family'));
    await userEvent.click(screen.getByText('Roboto'));

    const srcDoc = (container.querySelector('iframe') as HTMLIFrameElement).getAttribute('srcdoc') ?? '';
    expect(srcDoc).toContain('--font-family:');
    expect(srcDoc).toContain('Roboto');
  });

  it('selecting "Use original" removes the font-family override', async () => {
    const md = htmlMd([{ code: SIMPLE_HTML }]);
    const { container } = render(<MockupPreview markdown={md} />);

    await userEvent.click(screen.getByTitle('Font family'));
    await userEvent.click(screen.getByText('Roboto'));
    await userEvent.click(screen.getByTitle('Font family'));
    await userEvent.click(screen.getByText('Use original'));

    const srcDoc = (container.querySelector('iframe') as HTMLIFrameElement).getAttribute('srcdoc') ?? '';
    expect(srcDoc).not.toContain('--font-family:');
  });

  it('selecting Georgia (Serif) injects Georgia into srcDoc', async () => {
    const md = htmlMd([{ code: SIMPLE_HTML }]);
    const { container } = render(<MockupPreview markdown={md} />);

    await userEvent.click(screen.getByTitle('Font family'));
    await userEvent.click(screen.getByText('Georgia (Serif)'));

    const srcDoc = (container.querySelector('iframe') as HTMLIFrameElement).getAttribute('srcdoc') ?? '';
    expect(srcDoc).toContain('Georgia');
  });
});

// ─────────────────────────────────────────────────────────────────
// 7. Border radius slider
// ─────────────────────────────────────────────────────────────────
// NOTE: there is now exactly one range slider in the toolbar (radius). The
// spacing-unit slider UI was removed — spacingUnit still exists in
// StyleState/buildStyleBlock (always injected at its default of 8px, see
// the "applies a :root block" test above) but there's no control to change
// it anymore, so that describe block has been removed.
describe('MockupPreview — border radius slider', () => {
  it('renders the radius value next to the slider, default 8px', () => {
    render(<MockupPreview markdown={htmlMd([{ code: SIMPLE_HTML }])} />);
    expect(screen.getByText('8px')).toBeInTheDocument();
  });

  it('changing the slider updates the displayed value and the injected --radius value', () => {
    const md = htmlMd([{ code: SIMPLE_HTML }]);
    const { container } = render(<MockupPreview markdown={md} />);

    const slider = container.querySelector('input[type="range"]') as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '16' } });

    expect(screen.getByText('16px')).toBeInTheDocument();
    const srcDoc = (container.querySelector('iframe') as HTMLIFrameElement).getAttribute('srcdoc') ?? '';
    expect(srcDoc).toContain('--radius: 16px');
  });

  it('slider minimum is 0', () => {
    const md = htmlMd([{ code: SIMPLE_HTML }]);
    const { container } = render(<MockupPreview markdown={md} />);
    const slider = container.querySelector('input[type="range"]') as HTMLInputElement;
    expect(slider.min).toBe('0');
  });

  it('slider maximum is 24', () => {
    const md = htmlMd([{ code: SIMPLE_HTML }]);
    const { container } = render(<MockupPreview markdown={md} />);
    const slider = container.querySelector('input[type="range"]') as HTMLInputElement;
    expect(slider.max).toBe('24');
  });
});

// ─────────────────────────────────────────────────────────────────
// 9. Reset button
// ─────────────────────────────────────────────────────────────────
describe('MockupPreview — reset button', () => {
  it('renders the reset button', () => {
    render(<MockupPreview markdown={htmlMd([{ code: SIMPLE_HTML }])} />);
    expect(screen.getByTitle('Reset all style overrides')).toBeInTheDocument();
  });

  it('clicking reset clears all color overrides', async () => {
    const md = htmlMd([{ code: SIMPLE_HTML }]);
    const { container } = render(<MockupPreview markdown={md} />);

    // Apply Ocean palette
    await userEvent.click(screen.getByTitle('Ocean'));

    // Now reset (resets back to DEFAULT_STYLE: colors blank, radius/spacing 8, font blank)
    await userEvent.click(screen.getByTitle('Reset all style overrides'));

    const srcDoc = (container.querySelector('iframe') as HTMLIFrameElement).getAttribute('srcdoc') ?? '';
    expect(srcDoc).not.toContain('--color-primary:');
    expect(srcDoc).not.toContain('--color-secondary:');
    expect(srcDoc).not.toContain('--color-surface:');
    expect(srcDoc).not.toContain('--color-text:');
    expect(srcDoc).not.toContain('--font-family:');
  });

  it('clicking reset restores default radius and spacing', async () => {
    const md = htmlMd([{ code: SIMPLE_HTML }]);
    const { container } = render(<MockupPreview markdown={md} />);

    const slider = container.querySelector('input[type="range"]') as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '24' } });

    await userEvent.click(screen.getByTitle('Reset all style overrides'));

    const srcDoc = (container.querySelector('iframe') as HTMLIFrameElement).getAttribute('srcdoc') ?? '';
    expect(srcDoc).toContain('--radius: 8px');
    expect(srcDoc).toContain('--spacing-unit: 8px');
  });
});

// ─────────────────────────────────────────────────────────────────
// 10. Iframe attributes
// ─────────────────────────────────────────────────────────────────
describe('MockupPreview — iframe attributes', () => {
  it('renders one iframe per html block', () => {
    const md = htmlMd([
      { heading: 'A', code: SIMPLE_HTML },
      { heading: 'B', code: SIMPLE_HTML },
      { heading: 'C', code: SIMPLE_HTML },
    ]);
    const { container } = render(<MockupPreview markdown={md} />);
    expect(container.querySelectorAll('iframe')).toHaveLength(3);
  });

  it('each iframe has sandbox="allow-scripts"', () => {
    const md = htmlMd([{ code: SIMPLE_HTML }]);
    const { container } = render(<MockupPreview markdown={md} />);
    const iframe = container.querySelector('iframe')!;
    expect(iframe.getAttribute('sandbox')).toBe('allow-scripts');
  });

  it('each iframe title matches its block label', () => {
    const md = htmlMd([{ heading: 'Dashboard', code: SIMPLE_HTML }]);
    const { container } = render(<MockupPreview markdown={md} />);
    const iframe = container.querySelector('iframe')!;
    expect(iframe.getAttribute('title')).toBe('Dashboard');
  });

  it('iframe srcDoc contains the original html code', () => {
    const code = '<html><head></head><body><p>Unique content abc123</p></body></html>';
    const md = htmlMd([{ code }]);
    const { container } = render(<MockupPreview markdown={md} />);
    const srcDoc = (container.querySelector('iframe') as HTMLIFrameElement).getAttribute('srcdoc') ?? '';
    expect(srcDoc).toContain('Unique content abc123');
  });
});

// ─────────────────────────────────────────────────────────────────
// 11. Color picker inputs
// ─────────────────────────────────────────────────────────────────
// NOTE: the toolbar has exactly 2 color swatches now (Primary, Surface).
// Secondary and Text colors are preset-only (see applyStyleOverrides above)
// — there's no individual swatch or label for them anymore.
describe('MockupPreview — color picker inputs', () => {
  it('renders 2 color swatches (type=color inputs)', () => {
    const md = htmlMd([{ code: SIMPLE_HTML }]);
    const { container } = render(<MockupPreview markdown={md} />);
    const swatches = container.querySelectorAll('input[type="color"]');
    expect(swatches).toHaveLength(2);
  });

  it('changing the primary color swatch updates the srcDoc', () => {
    const md = htmlMd([{ code: SIMPLE_HTML }]);
    const { container } = render(<MockupPreview markdown={md} />);

    const swatches = container.querySelectorAll('input[type="color"]');
    fireEvent.change(swatches[0], { target: { value: '#aabbcc' } });

    const srcDoc = (container.querySelector('iframe') as HTMLIFrameElement).getAttribute('srcdoc') ?? '';
    expect(srcDoc).toContain('--color-primary: #aabbcc');
  });

  it('changing the surface color swatch updates the srcDoc', () => {
    const md = htmlMd([{ code: SIMPLE_HTML }]);
    const { container } = render(<MockupPreview markdown={md} />);

    const swatches = container.querySelectorAll('input[type="color"]');
    fireEvent.change(swatches[1], { target: { value: '#ddeeff' } });

    const srcDoc = (container.querySelector('iframe') as HTMLIFrameElement).getAttribute('srcdoc') ?? '';
    expect(srcDoc).toContain('--color-surface: #ddeeff');
  });

  it('Primary label is present', () => {
    render(<MockupPreview markdown={htmlMd([{ code: SIMPLE_HTML }])} />);
    expect(screen.getByText('Primary')).toBeInTheDocument();
  });

  it('Surface label is present', () => {
    render(<MockupPreview markdown={htmlMd([{ code: SIMPLE_HTML }])} />);
    expect(screen.getByText('Surface')).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────
// 12. Fence parsing edge cases
// ─────────────────────────────────────────────────────────────────
describe('MockupPreview — fence parsing edge cases', () => {
  it('handles ```html with trailing whitespace on the fence line', () => {
    const md = '```html   \n' + SIMPLE_HTML + '\n```';
    const { container } = render(<MockupPreview markdown={md} />);
    expect(container.querySelectorAll('iframe')).toHaveLength(1);
  });

  it('ignores ```htmlExtra blocks (not exact match)', () => {
    const md = '```htmlExtra\n<p>hi</p>\n```';
    render(<MockupPreview markdown={md} />);
    expect(screen.getByText(/No HTML mockups in this output/i)).toBeInTheDocument();
  });

  it('handles adjacent html blocks without a blank line between them', () => {
    const md = [
      '```html', SIMPLE_HTML, '```',
      '```html', SIMPLE_HTML, '```',
    ].join('\n');
    const { container } = render(<MockupPreview markdown={md} />);
    expect(container.querySelectorAll('iframe')).toHaveLength(2);
  });

  it('trims leading/trailing whitespace from extracted code', () => {
    const md = '```html\n\n  ' + SIMPLE_HTML + '  \n\n```';
    const { container } = render(<MockupPreview markdown={md} />);
    const iframe = container.querySelector('iframe')!;
    const srcDoc = iframe.getAttribute('srcdoc') ?? '';
    // The code should contain the html but without the extra leading newlines/spaces
    expect(srcDoc).toContain('<html>');
  });
});
