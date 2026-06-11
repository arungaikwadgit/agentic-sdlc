# Module 5 Test Plan: Document Export & GitHub Push

Covers `components/documents/DocumentViewer.tsx`, `ExportMenu.tsx`,
`GithubPushModal.tsx`, `services/exporters/documentExporter.ts`,
`services/githubIssueParser.ts`, and the GitHub-related functions in
`services/api.ts`.

---

## 1. Scope and approach

This module spans pure-logic files and React components:

- `tests/unit/githubIssueParser.test.ts` (TS-114–TS-126) — pure-function
  tests for `parseDocumentToIssues` and its helpers (`labelsForHeading`,
  `splitSections`, `splitItems`, `extractTitleAndBody`).
- `tests/unit/documentExporter.test.ts` (TS-127–TS-141) — pure-function
  tests for filename helpers, table/list/heading parsing
  (`markdownToDocxContent`), and the export entry points
  (`exportMarkdown`, `exportDocx`, `exportCombinedDocx`,
  `exportAllArtifactsZip`), with `file-saver` and the Mermaid CDN mocked.
- `tests/unit/DocumentViewer.test.tsx` (TS-142–TS-150) — component tests
  for markdown rendering and Mermaid success/fallback handling, with
  `mermaid` mocked.
- `tests/unit/ExportMenu.test.tsx` (TS-151–TS-155) — component tests for
  menu state and export call wiring, with `documentExporter` mocked.
- `tests/unit/GithubPushModal.test.tsx` (TS-156–TS-165) — component tests
  for the integration-loading, parsed-preview, selection, and push flows,
  with `services/api`, `hooks/useIntegrations`, and
  `services/githubIssueParser` mocked.
- `tests/unit/ProjectWorkspace-github-push.test.tsx` (TS-166–TS-169) —
  composition tests for the "Push to GitHub" button visibility gating in
  `ProjectWorkspace.tsx`.

`backend/src/proxy.js`'s `/api/github/test` and `/api/github/issues`
routes are **not** unit-tested in this module (no existing backend test
harness for `proxy.js` routes was found in `tests/unit`) — they are
exercised indirectly via `services/api.ts` mocks in the frontend tests
above. Adding a backend test harness is flagged as a follow-up in
`document-export-github.md` if/when backend route testing is introduced
for other endpoints.

---

## 2. Mocking strategy

| Module | Mock |
|---|---|
| `file-saver` (`saveAs`) | `vi.fn()` — assert filename/blob args without triggering real downloads |
| `mermaid` (CDN-loaded) | `vi.mock` of the dynamically-imported/global `mermaid` object — `render: vi.fn()` resolving to `{ svg }` or rejecting |
| `jszip` (dynamic import in `exportAllArtifactsZip`) | `vi.mock('jszip', ...)` — `file: vi.fn()`, `generateAsync: vi.fn(async () => new Blob())` |
| `@/services/api` | `api.testGithubConnection`, `api.pushIssuesToGithub` — `vi.fn()` |
| `@/hooks/useIntegrations` | `useIntegrations()` → `{ loadCredential: vi.fn(), saveCredential: vi.fn(), removeCredential: vi.fn() }` |
| `@/services/githubIssueParser` | `parseDocumentToIssues: vi.fn()` (for `GithubPushModal` tests that need a fixed parsed-issue list) |
| `@/db/database`, `@/db/projectRepository` | Same stubs as Modules 2–4, transitively required by `ProjectWorkspace` |

---

## 3. Test cases — `githubIssueParser.test.ts`

| ID | Scenario | Expected result |
|---|---|---|
| TS-114 | `labelsForHeading('Backend Tasks')` | Returns `['backend']` |
| TS-115 | `labelsForHeading('Sprint 1')` | Returns labels including `'sprint'` (matches `Sprint \d+`/`sprint` pattern) |
| TS-116 | `labelsForHeading('Sprint 0 — Setup')` | Returns labels including `'setup'` (matches `sprint 0`/`setup` before falling through to generic `sprint`) |
| TS-117 | `labelsForHeading('Random Notes')` | Returns `[]` — no `SECTION_LABEL_MAP` pattern matches |
| TS-118 | `splitSections(markdown)` with a preamble before the first `##` heading | First entry has empty `heading` and the preamble text as `body`; subsequent entries have `heading`/`body` from each `##`-`####` section |
| TS-119 | `splitSections(markdown)` with no headings at all | Returns a single entry with empty `heading` and the full text as `body` |
| TS-120 | `splitItems(body)` with a numbered list (`1.`, `2.`, `3.`) | Returns 3 items, one per numbered entry, with continuation lines appended to the preceding item |
| TS-121 | `splitItems(body)` with top-level bullets where one contains `**Title:**` and another is plain prose | The `**Title:**` bullet starts a new item; plain-prose bullets that don't "look like a task" are appended to the current item rather than starting new ones |
| TS-122 | `extractTitleAndBody(itemText)` where a line matches `/title\s*:/i` | Title = cleaned text after `Title:` (via `cleanInlineLabel`); remaining lines become the body |
| TS-123 | `extractTitleAndBody(itemText)` with no `Title:` line | Title = first non-empty line (cleaned); remaining lines form the body |
| TS-124 | `extractTitleAndBody(itemText)` where the title line exceeds 250 characters | Title truncated to 250 characters |
| TS-125 | `extractTitleAndBody(itemText)` with `**Field**: value` continuation lines | Body re-formats each as `- Field: value` checklist items |
| TS-126 | `parseDocumentToIssues(markdown, ['sprint-plan'])` on a realistic two-section Sprint Plan (`## Backend`, `## Frontend`, each with numbered tasks) | Returns one `ParsedIssue` per task; each `labels` array contains `'sprint-plan'` plus the section's derived label (`'backend'`/`'frontend'`); items with empty title and no body are skipped |

---

## 4. Test cases — `documentExporter.test.ts`

| ID | Scenario | Expected result |
|---|---|---|
| TS-127 | `projectShortName('Acme Retail — Loyalty Platform')` | Returns `'AcmeRetail'` (first segment before the em-dash, sanitized) |
| TS-128 | `projectShortName('Project_With_No_Separator')` | Returns the sanitized full name (no `—`/`–`/`-` to split on) |
| TS-129 | `projectShortName('')` | Returns `'Project'` (fallback) |
| TS-130 | `buildArtifactFilename('Acme Retail — Loyalty', 2, 'Architecture')` | Returns `'AcmeRetail_2_Architecture.docx'` |
| TS-131 | `exportMarkdown('# Hello', 'doc.md')` | Calls `saveAs` with a `Blob` of type `text/markdown;charset=utf-8` and filename `'doc.md'` |
| TS-132 | `markdownToDocxContent` on a markdown table (header + separator + 2 body rows) | Produces a `Table` element; header row cells are solid-filled `ACCENT` with white text; body row count matches input rows, padded/truncated to header column count |
| TS-133 | `markdownToDocxContent` on a fenced code block with no language tag | Produces a single shaded `Paragraph` (Consolas, `CODE_BG` fill) with one line break per source line |
| TS-134 | `markdownToDocxContent` on a ` ```mermaid ` block, with `renderMermaidToPng` mocked to resolve a PNG | Produces a centered `Paragraph` containing an `ImageRun` |
| TS-135 | `markdownToDocxContent` on a ` ```mermaid ` block, with `renderMermaidToPng` mocked to resolve `null` (render failure) | Falls back to a shaded code-block `Paragraph` showing the raw Mermaid source |
| TS-136 | `markdownToDocxContent` on `# H1` followed by `## H2` as the first two headings | First heading does **not** get `pageBreakBefore` (it's the first heading in the document); H1 has a bottom border in `ACCENT` |
| TS-137 | `markdownToDocxContent` on nested bullets (`- top`, `  - nested`, `    - double-nested`) | Produces list paragraphs at increasing `numbering.level` (0, 1, 2) per `Math.floor(indent.length / 2)`, capped at 4 |
| TS-138 | `markdownToDocxContent` on a line containing `**bold**`, `*italic*`, and `` `code` `` | `inlineRuns` produces separate `TextRun`s with `bold: true`, `italics: true`, and `font: 'Consolas'` (code run 2pt smaller) respectively |
| TS-139 | `exportDocx(markdown, 'Sprint Plan', 'Acme Retail', 4, 'Sprint Plan')` | Calls `buildDocxBlob` and `saveAs` with filename from `buildArtifactFilename('Acme Retail', 4, 'Sprint Plan')` |
| TS-140 | `exportDocx(markdown, 'My Title!', 'Acme Retail')` (no `phaseNumber`) | `saveAs` filename = `'My_Title_.docx'` (non-alphanumerics replaced with `_`) |
| TS-141 | `exportAllArtifactsZip([...two artifacts with the same agentLabel and phaseNumber...], 'Acme Retail')` | Both artifacts are added to the zip; the second's filename has a `_2` suffix to avoid collision; `saveAs` called with `'AcmeRetail_artifacts.zip'` |

---

## 5. Test cases — `DocumentViewer.test.tsx`

| ID | Scenario | Expected result |
|---|---|---|
| TS-142 | Render with markdown containing `# Title`, `**bold**`, a bullet list, and a pipe table | Output HTML contains `<h1>`, a `<strong>` (or equivalent bold) element, a `<ul>` with `<li>` items, and a `<table>` |
| TS-143 | Render with a fenced ` ```mermaid ` block, `mermaid.render` mocked to resolve `{ svg: '<svg>...</svg>' }` | The placeholder is replaced with the returned SVG markup |
| TS-144 | Render with a ` ```mermaid ` block, `mermaid.render` mocked to resolve an SVG containing `aria-roledescription="error"` | Placeholder replaced with `<pre class="mermaid-fallback"><code>` containing the raw Mermaid source, not the error SVG |
| TS-145 | Render with a ` ```mermaid ` block, `mermaid.render` mocked to reject | Same fallback as TS-144 — raw source shown in `<pre class="mermaid-fallback">` |
| TS-146 | Render with a blockquote (`> note`) and a horizontal rule (`---`) | Output contains a `<blockquote>` and an `<hr>` (or equivalent) |
| TS-147 | Render with empty string markdown | Renders without throwing; viewer container is empty or shows no content blocks |
| TS-148 | Render with a numbered list (`1. one`, `2. two`) | Output contains an `<ol>` with two `<li>` items in order |
| TS-149 | Render with mixed inline emphasis `***bold-italic***` | Output contains an element that is both bold and italic |
| TS-150 | Render with two ` ```mermaid ` blocks, one succeeding and one returning an error SVG | Successful block renders its SVG; the failing block falls back to `<pre class="mermaid-fallback">` — independent per-block handling |

---

## 6. Test cases — `ExportMenu.test.tsx`

| ID | Scenario | Expected result |
|---|---|---|
| TS-151 | Render with `project.agentRuns[agentId]` undefined (no output yet) | "Export ▾" button is `disabled` |
| TS-152 | Render with output present; click "Export ▾" then "📄 Markdown (.md)" | `exportMarkdown` called with the agent's output and `${outputLabel}.md`; dropdown closes |
| TS-153 | Render with output present; click "Export ▾" then "📝 Word (.docx)" | `exportDocx` called with `(output, outputLabel, project.name, phaseNumber, outputLabel)` where `phaseNumber = PHASE_ORDER.indexOf(def.phase) + 1` |
| TS-154 | Click "📝 Word (.docx)" while `exportDocx` is pending (mocked with an unresolved promise) | Button shows a loading state and is `disabled` until the promise resolves |
| TS-155 | `exportDocx` mocked to reject | Loading state clears (via `finally`) even though the export failed; no unhandled rejection surfaces as a test failure |

---

## 7. Test cases — `GithubPushModal.test.tsx`

| ID | Scenario | Expected result |
|---|---|---|
| TS-156 | `project.githubIntegrationId` is `undefined` | Modal shows error `'No GitHub integration configured for this project.'`; `parseDocumentToIssues` is not called; Push button disabled |
| TS-157 | `project.githubIntegrationId` set, but `loadCredential` resolves `null` | Modal shows error `'Saved GitHub connection could not be loaded. Reconnect it in Settings.'`; Push button disabled |
| TS-158 | Valid integration + credentials; `parseDocumentToIssues` mocked to return 3 issues | All 3 issues rendered in the checklist, all pre-checked (`selected` initialized to all indices); header shows `"{sourceLabel} → {owner}/{repo}"` |
| TS-159 | User unchecks one of 3 issues, then clicks "Select all" toggle | Unchecking removes that index from `selected` and updates the displayed count; "Select all" re-adds it |
| TS-160 | Click "Push" with 2 of 3 issues selected; `api.pushIssuesToGithub` mocked to resolve `{ created: 2, total: 2, results: [...] }` | `api.pushIssuesToGithub` called with `issues` containing only the 2 selected items (`{ title, body, labels }` shape); results render as a ✓ list with links `#{number} {title}` |
| TS-161 | Push with `api.pushIssuesToGithub` mocked to resolve a result containing one `ok: false` entry with an `error` message | That entry renders as ✕ with `"{title} — {error}"` |
| TS-162 | Push with `api.pushIssuesToGithub` mocked to **reject** | `pushError` is set and displayed; no result list rendered |
| TS-163 | `parseDocumentToIssues` returns more than 50 issues, all selected; click "Push" | `pushError` set (cap exceeded message); `api.pushIssuesToGithub` not called |
| TS-164 | `parseDocumentToIssues` returns an empty array | Empty-state message shown; Push button disabled (`issues.length === 0`) |
| TS-165 | Click "Cancel" / "Close" | `onClose` callback invoked |

---

## 8. Test cases — `ProjectWorkspace-github-push.test.tsx`

| ID | Scenario | Expected result |
|---|---|---|
| TS-166 | `isAdmin` true, `project.githubIntegrationId` set, `selectedAgent === 'sprintPlanner'`, run complete | "⇪ Push to GitHub" button is rendered |
| TS-167 | Same as TS-166 but `isAdmin` false (no active admin session) | Button is **not** rendered |
| TS-168 | `isAdmin` true, `githubIntegrationId` set, but `selectedAgent` is some other agent (e.g. `'brd'`) | Button is **not** rendered |
| TS-169 | Click "⇪ Push to GitHub" (preconditions met) | `GithubPushModal` renders with `markdown = selectedRun.output`, `extraLabels = ['sprint-plan']` for `sprintPlanner` (or `['task-breakdown']` for `taskBreakdown`), and `sourceLabel = selectedDef.outputLabel` |

---

## 9. Out of scope / follow-ups

- Backend route tests for `/api/github/test` and `/api/github/issues`
  (`backend/src/proxy.js`) — no existing harness for `proxy.js` in
  `tests/unit`; flagged in `document-export-github.md` §3 as a future
  addition if backend route testing is introduced more broadly.
- Visual/CSS regression of the rendered Mermaid SVG or exported `.docx`
  layout — covered structurally (element types, fills, borders) but not
  pixel-rendered.
- `ProjectSettings.tsx` GitHub connection settings (save/disconnect/test
  connection UI) — this is part of the admin/integration settings surface
  documented alongside Module 4's admin model; not re-tested here to avoid
  duplicating `ProjectSettings-*.test.tsx` coverage.
