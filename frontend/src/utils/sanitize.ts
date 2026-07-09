/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
/**
 * Prompt injection detection (Appendix X).
 * Flags attempts to override system instructions.
 */

const INJECTION_PATTERNS = [
  /ignore previous/i,
  /ignore rules/i,
  /ignore (all )?instructions/i,
  /output only/i,
  /forget your instructions/i,
  /disregard (all )?previous/i,
  /you are now/i,
  /new instruction/i,
  /override (your )?system/i,
  /bypass (the )?filter/i,
];

export interface SanitizeResult {
  safe: boolean;
  matchedPattern?: string;
}

export function checkPromptInjection(text: string): SanitizeResult {
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(text)) {
      return { safe: false, matchedPattern: pattern.toString() };
    }
  }
  return { safe: true };
}

/**
 * Sanitise HTML to prevent XSS when rendering user-edited content.
 *
 * H-02 fix: replaced the previous regex-only approach (which missed <iframe>,
 * javascript: URLs, SVG XSS, and <base> tag injection) with a DOM-based
 * allowlist sanitiser. Uses DOMParser so the browser's own HTML parser handles
 * all edge cases, then walks the tree and strips anything not on the allowlist.
 *
 * Safe tags: a subset of formatting elements with no executable surface.
 * Safe attributes: href (with protocol check), src (with protocol check), and
 *   a handful of presentational attributes — no event handlers, no data-*, no style.
 */
const ALLOWED_TAGS = new Set([
  'p', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'del',
  'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'a', 'span', 'div', 'hr',
]);

const ALLOWED_ATTRS: Record<string, Set<string>> = {
  a:   new Set(['href', 'title', 'target', 'rel']),
  img: new Set(['src', 'alt', 'width', 'height']),
  td:  new Set(['colspan', 'rowspan']),
  th:  new Set(['colspan', 'rowspan']),
};

const SAFE_PROTOCOLS = /^(https?|mailto):/i;

function isSafeUrl(value: string): boolean {
  const trimmed = value.trim().toLowerCase();
  // Reject javascript:, data:, vbscript:, and any other non-http schemes
  if (/^javascript:/i.test(trimmed)) return false;
  if (/^data:/i.test(trimmed)) return false;
  if (/^vbscript:/i.test(trimmed)) return false;
  return SAFE_PROTOCOLS.test(trimmed) || trimmed.startsWith('/') || trimmed.startsWith('#');
}

function sanitizeNode(node: Node): Node | null {
  if (node.nodeType === Node.TEXT_NODE) return node;

  if (node.nodeType !== Node.ELEMENT_NODE) {
    // Strip comments, processing instructions, etc.
    return null;
  }

  const el = node as Element;
  const tag = el.tagName.toLowerCase();

  // Strip disallowed tags entirely (including their children)
  if (!ALLOWED_TAGS.has(tag)) return null;

  // Remove all attributes, then re-add only allowed ones
  const allowed = ALLOWED_ATTRS[tag] ?? new Set<string>();
  const attrsToRemove: string[] = [];
  for (const attr of Array.from(el.attributes)) {
    if (!allowed.has(attr.name)) {
      attrsToRemove.push(attr.name);
      continue;
    }
    // Validate URL-type attributes
    if (attr.name === 'href' || attr.name === 'src') {
      if (!isSafeUrl(attr.value)) attrsToRemove.push(attr.name);
    }
  }
  attrsToRemove.forEach((a) => el.removeAttribute(a));

  // Force links to open safely
  if (tag === 'a') {
    el.setAttribute('rel', 'noopener noreferrer');
    if (!el.getAttribute('target')) el.setAttribute('target', '_blank');
  }

  // Recurse into children
  const childrenToRemove: Node[] = [];
  for (const child of Array.from(el.childNodes)) {
    const result = sanitizeNode(child);
    if (result === null) childrenToRemove.push(child);
  }
  childrenToRemove.forEach((c) => el.removeChild(c));

  return el;
}

export function sanitizeHtml(html: string): string {
  if (typeof document === 'undefined') {
    // SSR / test environment — fall back to stripping all tags
    return html.replace(/<[^>]*>/g, '');
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  // Strip <base> tags (can redirect all relative URLs)
  doc.querySelectorAll('base').forEach((el) => el.remove());

  const childrenToRemove: Node[] = [];
  for (const child of Array.from(doc.body.childNodes)) {
    const result = sanitizeNode(child);
    if (result === null) childrenToRemove.push(child);
  }
  childrenToRemove.forEach((c) => doc.body.removeChild(c));

  return doc.body.innerHTML;
}
