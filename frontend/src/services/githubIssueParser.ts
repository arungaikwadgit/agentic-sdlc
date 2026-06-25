/**
 * © 2025 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
/**
 * Parses Sprint Plan / Task Breakdown agent output (free-form markdown) into a
 * list of discrete GitHub issue drafts ({ title, body, labels? }).
 *
 * IMPORTANT — confidence note: the agent output is unstructured markdown produced
 * by an LLM, not a fixed schema. This parser uses heuristics (heading sections +
 * numbered/bulleted list items + "Task ID:"/"**Title:**"-style fields) that match
 * the format requested in the Task Breakdown and Sprint Plan prompts
 * (frontend/src/agents/definitions.ts), but it is NOT guaranteed to perfectly
 * segment every possible AI phrasing. Always show the parsed preview to the user
 * for review/edit before pushing to GitHub — never push silently.
 */

export interface ParsedIssue {
  title: string;
  body: string;
  labels: string[];
}

const SECTION_LABEL_MAP: Array<{ match: RegExp; label: string }> = [
  { match: /backend/i, label: 'backend' },
  { match: /frontend/i, label: 'frontend' },
  { match: /infrastructure|devops|infra/i, label: 'infrastructure' },
  { match: /testing|qa|test/i, label: 'testing' },
  { match: /sprint\s*0|setup/i, label: 'setup' },
  { match: /sprint\s*\d+/i, label: 'sprint' },
  { match: /spike/i, label: 'spike' },
  { match: /security/i, label: 'security' },
];

function labelsForHeading(heading: string): string[] {
  const labels: string[] = [];
  for (const { match, label } of SECTION_LABEL_MAP) {
    if (match.test(heading) && !labels.includes(label)) labels.push(label);
  }
  return labels;
}

/** Strips leading markdown emphasis/markers and trailing colons from a line, e.g. "**Title:** Foo" -> "Foo". */
function cleanInlineLabel(line: string): string {
  return line
    .replace(/^[-*]\s+/, '')
    .replace(/^\d+[.)]\s+/, '')
    .replace(/^\*\*([^*]+)\*\*:?\s*/, '') // "**Task ID: T-101** ..." or "**Title:** ..."
    .replace(/^[A-Za-z][A-Za-z _-]{0,30}:\s*/, '') // "Task ID: ..." / "Title: ..."
    .replace(/^\*+\s*/, '') // strip any leftover "**" markers (e.g. from "**Title:** ..." after field-prefix strip)
    .trim();
}

/**
 * Splits markdown into top-level sections by `##`/`###` headings.
 * Returns [{ heading, body }], where the first entry may have an empty heading
 * if content precedes the first heading.
 */
function splitSections(markdown: string): Array<{ heading: string; body: string }> {
  const lines = markdown.split('\n');
  const sections: Array<{ heading: string; body: string[] }> = [{ heading: '', body: [] }];

  for (const line of lines) {
    const headingMatch = line.match(/^(#{2,4})\s+(.*)$/);
    if (headingMatch) {
      sections.push({ heading: headingMatch[2].trim(), body: [] });
    } else {
      sections[sections.length - 1].body.push(line);
    }
  }

  return sections.map((s) => ({ heading: s.heading, body: s.body.join('\n') }));
}

/**
 * Splits a section body into individual list-item blocks. A new item starts at:
 *  - a numbered list item at the top level (e.g. "1. ...")
 *  - a top-level bullet ("- " or "* ") that itself looks like a task header
 *    (starts with "**", "Task", or contains "Title:")
 * Nested/indented lines are appended to the current item as detail/body.
 */
function splitItems(body: string): string[] {
  const lines = body.split('\n');
  const items: string[] = [];
  let current: string[] = [];

  function flush() {
    const text = current.join('\n').trim();
    if (text) items.push(text);
    current = [];
  }

  for (const line of lines) {
    const numbered = /^\s{0,3}\d+[.)]\s+/.test(line);
    const topBullet = /^\s{0,3}[-*]\s+/.test(line);
    const looksLikeTaskStart =
      numbered ||
      (topBullet && (/\*\*/.test(line) || /^[\s-]*\*?\s*Task\b/i.test(line) || /Title\s*:/i.test(line)));

    if (looksLikeTaskStart) {
      flush();
      current.push(line);
    } else {
      // Continuation line (detail, blank separator, or non-task bullet) — append to current item.
      current.push(line);
    }
  }
  flush();

  return items;
}

/**
 * Extracts a title and body from a single list-item block of markdown text.
 * Looks for an explicit "Title:" field first; otherwise uses the first
 * non-empty line (cleaned of markdown list/bold markers) as the title.
 */
function extractTitleAndBody(itemText: string): { title: string; body: string } {
  const lines = itemText.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0) return { title: '', body: '' };

  const titleFieldLine = lines.find((l) => /title\s*:/i.test(l));
  let title: string;
  let bodyLines: string[];

  if (titleFieldLine) {
    title = cleanInlineLabel(titleFieldLine.replace(/^.*?title\s*:/i, 'Title:'));
    bodyLines = lines.filter((l) => l !== titleFieldLine);
  } else {
    title = cleanInlineLabel(lines[0]);
    bodyLines = lines.slice(1);
  }

  // Re-format remaining "Field: value" lines as a markdown checklist for readability in GitHub.
  const body = bodyLines
    .map((l) => (/^[A-Za-z][A-Za-z _-]{0,30}:\s*/.test(l) || /^\*\*[^*]+\*\*:?/.test(l) ? `- ${l}` : l))
    .join('\n')
    .trim();

  return { title: title.slice(0, 250), body };
}

/**
 * Parses Sprint Plan or Task Breakdown markdown into GitHub issue drafts.
 *
 * @param markdown The raw agent output.
 * @param extraLabels Labels applied to every issue (e.g. ['sprint-plan'] or ['task-breakdown']).
 */
export function parseDocumentToIssues(markdown: string, extraLabels: string[] = []): ParsedIssue[] {
  const issues: ParsedIssue[] = [];
  const sections = splitSections(markdown);

  for (const { heading, body } of sections) {
    if (!heading) continue; // skip preamble before the first heading
    const sectionLabels = labelsForHeading(heading);
    const items = splitItems(body);

    for (const item of items) {
      const { title, body: itemBody } = extractTitleAndBody(item);
      if (!title) continue;
      // Skip items that are clearly not individual tasks (e.g. narrative paragraphs
      // accidentally captured as "items" because they start a top-level line).
      if (title.length > 250 && !itemBody) continue;

      issues.push({
        title,
        body: itemBody,
        labels: [...new Set([...extraLabels, ...sectionLabels])],
      });
    }
  }

  return issues;
}
