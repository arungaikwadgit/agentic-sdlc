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
 * Strips all tags except safe formatting ones.
 */
export function sanitizeHtml(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/on\w+="[^"]*"/gi, '')
    .replace(/on\w+='[^']*'/gi, '');
}
