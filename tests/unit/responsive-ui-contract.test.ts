/**
 * Arun Gaikwad 2026
 * Responsive UI contract tests protect the adaptive navigation and critical
 * viewport rules that are not observable through jsdom layout calculations.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(process.cwd(), '..');

function read(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

describe('responsive UI contracts', () => {
  it('provides explicit mobile navigation between pipeline and artifact panes', () => {
    const workspace = read('frontend/src/components/pipeline/ProjectWorkspace.tsx');

    expect(workspace).toContain("useState<'pipeline' | 'artifact'>('pipeline')");
    expect(workspace).toContain('aria-label="Workspace view"');
    expect(workspace).toContain("setMobilePane('artifact')");
    expect(workspace).toContain('styles.mobilePaneHidden');
    expect(workspace).toContain('selectAgent(agentId)');
  });

  it('keeps desktop behavior while defining tablet and mobile workspace layouts', () => {
    const css = read('frontend/src/components/pipeline/ProjectWorkspace.module.css');

    expect(css).toContain('/* ADAPTIVE WORKSPACE 2026 */');
    expect(css).toContain('@media (max-width: 1024px)');
    expect(css).toContain('@media (max-width: 767px)');
    expect(css).toMatch(/\.workspaceNav\s*\{\s*display:\s*none/);
    expect(css).toMatch(/\.mobilePaneHidden\s*\{\s*display:\s*none\s*!important/);
    expect(css).toContain('min-height: var(--touch-target)');
  });

  it('covers the primary dashboard, settings, admin, and team surfaces', () => {
    const contracts = [
      ['frontend/src/components/dashboard/Dashboard.module.css', 'RESPONSIVE DASHBOARD 2026'],
      ['frontend/src/components/team/TeamPanel.module.css', 'RESPONSIVE TEAM PANEL 2026'],
      ['frontend/src/components/settings/ProjectSettings.module.css', 'RESPONSIVE PROJECT SETTINGS 2026'],
      ['frontend/src/components/settings/AppSettingsModal.module.css', 'RESPONSIVE APP SETTINGS 2026'],
      ['frontend/src/components/admin/AdminPanel.module.css', 'RESPONSIVE ADMIN PANEL 2026'],
    ] as const;

    for (const [file, marker] of contracts) {
      const css = read(file);
      expect(css, file).toContain(marker);
      expect(css, file).toContain('@media (max-width: 767px)');
    }
  });

  it('keeps diagrams, mockups, prototypes, and documents usable on narrow screens', () => {
    const contracts = [
      ['frontend/src/components/documents/DiagramPreview.module.css', 'RESPONSIVE DIAGRAM PREVIEW 2026'],
      ['frontend/src/components/documents/MockupPreview.module.css', 'RESPONSIVE MOCKUP PREVIEW 2026'],
      ['frontend/src/components/documents/PrototypeViewer.module.css', 'RESPONSIVE PROTOTYPE VIEWER 2026'],
      ['frontend/src/components/documents/DocumentViewer.module.css', 'RESPONSIVE DOCUMENT VIEWER 2026'],
    ] as const;

    for (const [file, marker] of contracts) {
      const css = read(file);
      expect(css, file).toContain(marker);
      expect(css, file).toMatch(/overflow-x:\s*auto|overflow:\s*auto/);
    }
  });

  it('provides reduced-motion support and mobile form sizing globally', () => {
    const css = read('frontend/src/index.css');

    expect(css).toContain('/* RESPONSIVE FOUNDATION 2026 */');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('--touch-target: 44px');
    expect(css).toMatch(/input, select, textarea\s*\{\s*font-size:\s*16px/);
  });
});
