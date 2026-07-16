/**
 * Testable boundary around Mermaid's externalized browser module.
 * Production delegates directly to Mermaid; unit tests mock this local module.
 */
import mermaid from 'mermaid';

export function initializeMermaid(config: Parameters<typeof mermaid.initialize>[0]): void {
  mermaid.initialize(config);
}

export function renderMermaid(id: string, code: string): ReturnType<typeof mermaid.render> {
  return mermaid.render(id, code);
}
