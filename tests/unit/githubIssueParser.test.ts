// tests/unit/githubIssueParser.test.ts
// Pure-function tests for services/githubIssueParser.ts.
// Covers TS-114 through TS-126 from
// docs/test-plans/document-export-github-test-plan.md.
import { describe, it, expect } from 'vitest';
import { parseDocumentToIssues } from '../../frontend/src/services/githubIssueParser';

// labelsForHeading, splitSections, splitItems, and extractTitleAndBody are not
// exported directly, so we exercise them indirectly through
// parseDocumentToIssues using small, targeted markdown fixtures that isolate
// each helper's behavior.

describe('githubIssueParser', () => {
  describe('labelsForHeading (via parseDocumentToIssues)', () => {
    it('maps a "Backend Tasks" heading to the "backend" label (TS-114)', () => {
      const md = `## Backend Tasks\n1. Title: Build API\n   Do the thing.\n`;
      const issues = parseDocumentToIssues(md);
      expect(issues).toHaveLength(1);
      expect(issues[0].labels).toContain('backend');
    });

    it('maps a "Sprint 1" heading to the "sprint" label (TS-115)', () => {
      const md = `## Sprint 1\n1. Title: Do something\n   Some details.\n`;
      const issues = parseDocumentToIssues(md);
      expect(issues).toHaveLength(1);
      expect(issues[0].labels).toContain('sprint');
    });

    it('maps a "Sprint 0 — Setup" heading to the "setup" label (TS-116)', () => {
      const md = `## Sprint 0 — Setup\n1. Title: Provision repo\n   Initial setup.\n`;
      const issues = parseDocumentToIssues(md);
      expect(issues).toHaveLength(1);
      // "Sprint 0 — Setup" matches /sprint\s*0|setup/i -> 'setup', and also
      // /sprint\s*\d+/i -> 'sprint'. Both patterns can match; 'setup' must be present.
      expect(issues[0].labels).toContain('setup');
    });

    it('returns no section labels for a "Random Notes" heading (TS-117)', () => {
      const md = `## Random Notes\n1. Title: Some task\n   Notes here.\n`;
      const issues = parseDocumentToIssues(md, ['extra']);
      expect(issues).toHaveLength(1);
      // Only the extraLabels survive — no SECTION_LABEL_MAP pattern matches "Random Notes".
      expect(issues[0].labels).toEqual(['extra']);
    });
  });

  describe('splitSections (via parseDocumentToIssues)', () => {
    it('ignores preamble content before the first heading (TS-118)', () => {
      const md = `This is some preamble text that should be ignored.\n\n## Backend\n1. Title: First task\n   Body text.\n`;
      const issues = parseDocumentToIssues(md);
      // Only the heading-bound section produces issues; preamble is skipped.
      expect(issues).toHaveLength(1);
      expect(issues[0].title).toBe('First task');
    });

    it('produces no issues when there are no headings at all (TS-119)', () => {
      const md = `1. Title: Orphan task\n   This has no section heading.\n`;
      const issues = parseDocumentToIssues(md);
      // Without any ## heading, splitSections returns a single entry with an
      // empty heading, which parseDocumentToIssues explicitly skips.
      expect(issues).toEqual([]);
    });
  });

  describe('splitItems (via parseDocumentToIssues)', () => {
    it('splits a numbered list into one item per entry, with continuation lines appended (TS-120)', () => {
      const md = `## Backend\n` +
        `1. Title: First task\n` +
        `   Continuation detail for first task.\n` +
        `2. Title: Second task\n` +
        `   Continuation detail for second task.\n` +
        `3. Title: Third task\n`;
      const issues = parseDocumentToIssues(md);
      expect(issues).toHaveLength(3);
      expect(issues[0].title).toBe('First task');
      expect(issues[0].body).toContain('Continuation detail for first task.');
      expect(issues[1].title).toBe('Second task');
      expect(issues[1].body).toContain('Continuation detail for second task.');
      expect(issues[2].title).toBe('Third task');
    });

    it('treats a bullet with **Title:** as a new item, and appends plain-prose bullets to the current item (TS-121)', () => {
      const md = `## Backend\n` +
        `- **Title:** Implement login endpoint\n` +
        `  Some detail about the endpoint.\n` +
        `- this is just a continuation note, not a new task\n` +
        `- **Title:** Implement logout endpoint\n`;
      const issues = parseDocumentToIssues(md);
      // Only 2 "task-like" items are started; the plain-prose bullet is folded
      // into the first item's body rather than starting a new issue.
      expect(issues).toHaveLength(2);
      expect(issues[0].title).toBe('Implement login endpoint');
      expect(issues[0].body).toContain('this is just a continuation note, not a new task');
      expect(issues[1].title).toBe('Implement logout endpoint');
    });
  });

  describe('extractTitleAndBody (via parseDocumentToIssues)', () => {
    it('uses the "Title:" field as the title when present (TS-122)', () => {
      const md = `## Backend\n1. Some preceding label\n   Title: Build the widget\n   More details.\n`;
      const issues = parseDocumentToIssues(md);
      expect(issues).toHaveLength(1);
      expect(issues[0].title).toBe('Build the widget');
    });

    it('uses the first non-empty line as the title when no "Title:" field is present (TS-123)', () => {
      const md = `## Backend\n1. Set up CI pipeline\n   Configure GitHub Actions for build and test.\n`;
      const issues = parseDocumentToIssues(md);
      expect(issues).toHaveLength(1);
      expect(issues[0].title).toBe('Set up CI pipeline');
    });

    it('truncates a title line longer than 250 characters to 250 characters (TS-124)', () => {
      const longTitle = 'A'.repeat(300);
      const md = `## Backend\n1. Title: ${longTitle}\n   Some body so the item is not skipped.\n`;
      const issues = parseDocumentToIssues(md);
      expect(issues).toHaveLength(1);
      expect(issues[0].title).toHaveLength(250);
      expect(issues[0].title).toBe('A'.repeat(250));
    });

    it('reformats "Field: value" continuation lines as a markdown checklist (TS-125)', () => {
      const md = `## Backend\n` +
        `1. Title: Build the widget\n` +
        `   Estimate: 3 points\n` +
        `   **Assignee**: Dev Dave\n`;
      const issues = parseDocumentToIssues(md);
      expect(issues).toHaveLength(1);
      expect(issues[0].body).toContain('- Estimate: 3 points');
      expect(issues[0].body).toContain('- **Assignee**: Dev Dave');
    });
  });

  describe('parseDocumentToIssues — realistic sprint plan (TS-126)', () => {
    it('returns one ParsedIssue per task, with extraLabels plus section labels merged', () => {
      const md =
        `# Sprint 1 Plan\n\n` +
        `Some intro paragraph that should be ignored as preamble.\n\n` +
        `## Backend Tasks\n` +
        `1. Title: Implement user authentication\n` +
        `   Add JWT-based auth to the API.\n` +
        `   Estimate: 5 points\n` +
        `2. Title: Add database migrations\n` +
        `   Create migration scripts for the new schema.\n\n` +
        `## Frontend Tasks\n` +
        `1. Title: Build login page\n` +
        `   Create the login form and wire it to the auth API.\n`;

      const issues = parseDocumentToIssues(md, ['sprint-plan']);

      expect(issues).toHaveLength(3);

      const backendTask = issues.find((i) => i.title === 'Implement user authentication');
      expect(backendTask).toBeDefined();
      expect(backendTask!.labels).toContain('sprint-plan');
      expect(backendTask!.labels).toContain('backend');
      expect(backendTask!.body).toContain('- Estimate: 5 points');

      const migrationTask = issues.find((i) => i.title === 'Add database migrations');
      expect(migrationTask).toBeDefined();
      expect(migrationTask!.labels).toContain('sprint-plan');
      expect(migrationTask!.labels).toContain('backend');

      const frontendTask = issues.find((i) => i.title === 'Build login page');
      expect(frontendTask).toBeDefined();
      expect(frontendTask!.labels).toContain('sprint-plan');
      expect(frontendTask!.labels).toContain('frontend');

      // The empty "2." item under Frontend Tasks should be skipped (no title).
      expect(issues.find((i) => i.title === '')).toBeUndefined();
    });
  });
});
