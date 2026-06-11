# Module 5: Document Export & GitHub Push

Covers viewing agent-generated markdown documents, exporting them to
`.md`/`.docx`, and pushing parsed work items as GitHub issues — implemented
in `components/documents/DocumentViewer.tsx`, `ExportMenu.tsx`,
`GithubPushModal.tsx`, `services/exporters/documentExporter.ts`,
`services/githubIssueParser.ts`, the GitHub-related functions in
`services/api.ts`, the `GithubCredentials` type in
`types/integration.types.ts`, and the backend GitHub routes in
`backend/src/proxy.js`.

---

## 1. Requirements

### 1.1 Purpose

Every pipeline agent produces markdown output (`project.agentRuns[agentId].output`).
This module covers the three things a user can do with that output once an
agent run completes: **view it** rendered (including Mermaid diagrams),
**export it** as a standalone file (`.md` or `.docx`) for sharing outside the
app, and — for the two planning agents (Sprint Planner, Task Breakdown) —
**push it to GitHub** as a batch of issues, after a connected repo and a
human review pass.

### 1.2 Functional Requirements

| # | Requirement |
|---|---|
| R1 | `DocumentViewer` renders an agent's markdown output as HTML: headers (`#`-`####`), bold/italic/bold-italic, inline code and fenced code blocks, bullet and numbered lists, pipe tables, blockquotes, horizontal rules, and paragraphs. Rendering is regex-based, not a full markdown parser. |
| R2 | Fenced ` ```mermaid ` blocks are extracted before HTML escaping, rendered as live SVG via `mermaid.render()` (lazy-loaded from a CDN), and re-inserted in place. If Mermaid reports a syntax error — including v10's behavior of resolving with an error SVG rather than rejecting — the block falls back to a `<pre>` showing the raw Mermaid source, and any stray error SVGs Mermaid appended to `<body>` are removed. |
| R3 | `ExportMenu` offers two export formats for the currently selected agent's output: **Markdown (.md)** (raw text download) and **Word (.docx)** (converted via `documentExporter`). The menu is disabled while no output exists or while an export is in progress. |
| R4 | `.docx` export (`exportDocx`) converts the same markdown into a formatted Word document: headings become Word heading styles with page breaks before H1/H2, tables become real Word tables, fenced code blocks become shaded monospace paragraphs, and ` ```mermaid ` blocks are rasterized to PNG and embedded as images (falling back to a code block if rendering fails). The document includes a cover page (title, project name, generation timestamp) and a content section with header/footer and page numbers. |
| R5 | Exported `.docx` filenames follow `{ProjectShortName}_{PhaseNumber}_{AgentLabel}.docx` when a phase number is available (derived from `PHASE_ORDER.indexOf(def.phase) + 1`), otherwise `{Title}.docx` with non-alphanumeric characters stripped. |
| R6 | "Push to GitHub" is offered only when **all** of: the active session `isAdmin`, `project.githubIntegrationId` is set, and the selected agent is `sprintPlanner` or `taskBreakdown`. Clicking it opens `GithubPushModal` with the current output as `markdown` and an extra label (`sprint-plan` or `task-breakdown`). |
| R7 | `GithubPushModal` parses the markdown into a list of draft issues via `parseDocumentToIssues`, shows every parsed issue (title, labels, body) in a checklist with all items selected by default, and lets the user deselect items before pushing. The parsed preview is **always shown for review** — nothing is pushed silently. |
| R8 | Pushing calls `api.pushIssuesToGithub` with the selected issues (capped at 50 per push — `MAX_ISSUES_PER_PUSH`). The backend creates each issue individually via the GitHub REST API and returns a per-issue result (`ok`, `number`, `url`, or `error`), which the modal displays as a ✓/✕ list with links to created issues. |
| R9 | If `project.githubIntegrationId` is missing, or the saved credential can't be loaded, `GithubPushModal` shows an inline error (`'No GitHub integration configured for this project.'` / `'Saved GitHub connection could not be loaded. Reconnect it in Settings.'`) instead of attempting to parse or push. |
| R10 | `parseDocumentToIssues` splits markdown by `##`-`####` headings into sections, derives labels per section from heading keywords (backend/frontend/infrastructure/testing/setup/sprint/spike/security via `SECTION_LABEL_MAP`), splits each section's body into individual task items (numbered list items, or bullets that "look like a task"), and extracts a title (from a `Title:` line or the first non-empty line, truncated to 250 chars) plus a body re-formatted as a `Field: value` checklist. Items with an empty title (and no body) are skipped. |
| R11 | `api.testGithubConnection` and `api.pushIssuesToGithub` call backend endpoints `POST /api/github/test` and `POST /api/github/issues` rather than `api.github.com` directly, because the GitHub REST API does not return CORS headers permitting browser requests with an `Authorization` header. |

### 1.3 Non-Functional Requirements

| # | Requirement |
|---|---|
| NFR1 | The backend `/api/github/*` endpoints require the existing proxy auth (`checkToken` / `X-API-Token`), same as other proxy routes — they do not introduce a separate auth scheme. |
| NFR2 | `/api/github/issues` rejects requests with more than 50 issues (`400`) before making any GitHub calls, and processes the rest of the array even if individual issue creations fail (per-item `try/catch`, aggregated into `results`). |
| NFR3 | GitHub PATs are stored using the existing encrypted-credential mechanism (`IntegrationCredential` / `loadCredential` / `saveCredential`, AES-GCM) covered by the integrations infrastructure — this module only adds the `GithubCredentials` shape (`{ token, owner, repo }`) and its GitHub-specific UI. |
| NFR4 | Mermaid is loaded lazily from a CDN (`cdn.jsdelivr.net/npm/mermaid@10`) in two independent code paths (`DocumentViewer` for live rendering, `documentExporter` for PNG rasterization) — neither path blocks initial render if Mermaid fails to load; both degrade to showing raw source. |

---

## 2. Design

### 2.1 `DocumentViewer.tsx`

```ts
// components/documents/DocumentViewer.tsx
function renderMarkdown(md: string): { html: string; mermaidBlocks: { id: string; code: string }[] }
```

- Extracts ` ```mermaid ... ``` ` blocks first, replacing each with
  `<div class="mermaid-placeholder" data-id="{id}">`, so the raw Mermaid
  source is never HTML-escaped or mangled by the regex markdown pass.
- Converts the remaining markdown to HTML with sequential regex passes:
  headers (`# `–`#### ` → `<h1>`–`<h4>`), bold/italic/bold-italic, fenced
  code blocks and inline code, bullet/numbered list items wrapped into
  `<ul>`/`<ol>`, pipe tables wrapped into `<table>`, blockquotes (`> `),
  horizontal rules (`---`/`***`), and paragraph wrapping on blank-line
  boundaries.
- `loadMermaid()` lazy-loads the Mermaid script once (module-level
  `mermaidLoaded` flag) and initializes it with
  `{ startOnLoad: false, theme: 'neutral', securityLevel: 'loose' }`.
- A `useEffect` walks `mermaidBlocks` after render, calls
  `mermaid.render(renderId, code)` for each, and replaces the placeholder
  `<div>` with the resulting SVG. Mermaid v10 can *resolve* with an SVG
  that itself represents an error (`aria-roledescription="error"` or
  `Syntax error in text` inside the markup); the component detects this via
  regex and treats it the same as a thrown error — replacing the
  placeholder with `<pre class="mermaid-fallback"><code>{raw source}</code></pre>`
  and removing any stray `svg[aria-roledescription="error"]` /
  `svg[id^="mermaid-svg-"]` elements Mermaid appended directly to
  `document.body`.
- The final HTML is rendered via `dangerouslySetInnerHTML` into a `ref`'d
  container (`styles.viewer`).

### 2.2 `ExportMenu.tsx`

```ts
interface Props { agentId: AgentId; project: Project; }
```

- Reads `def = AGENT_DEFINITIONS[agentId]` and
  `output = project.agentRuns[agentId]?.output ?? ''`.
- Renders an "Export ▾" button, disabled if `loading || !output`, with a
  dropdown offering "📄 Markdown (.md)" and "📝 Word (.docx)".
- `doExport(format)`:
  - `'md'` → `exportMarkdown(output, \`${def?.outputLabel ?? agentId}.md\`)`
    — a synchronous `Blob` download via `saveAs`.
  - `'docx'` → computes `phaseNumber = def ? PHASE_ORDER.indexOf(def.phase) + 1 : undefined`
    and calls
    `await exportDocx(output, def?.outputLabel ?? agentId, project.name, phaseNumber, def?.outputLabel ?? agentId)`.
  - Sets `loading` around the `docx` path (the `.md` path is effectively
    instant) and closes the dropdown immediately on either choice.

### 2.3 `documentExporter.ts`

The largest file in this module (~570 lines). Key pieces:

#### 2.3.1 Styling constants

```ts
const ACCENT = '1d4ed8';   // headings, header/footer accents, table header fill
const MUTED = '64748b';    // secondary text (header/footer labels, blockquotes)
const FAINT = '94a3b8';    // timestamps, page-number text
const RULE = 'cbd5e1';     // table borders, header/footer rule lines
const CODE_BG = 'f1f5f9';  // code block shading
const CODE_BORDER = 'cbd5e1';
```

This is a **separate palette** from the one used by the per-module
architecture-doc generator scripts (`1F3864`/`2E5395`) — `documentExporter`
is the production exporter end users see; the architecture docs are an
internal documentation deliverable with their own house style.

#### 2.3.2 Filename helpers

```ts
function sanitizeSegment(value: string): string        // strips non-alphanumerics
function projectShortName(projectName: string): string // first segment before — / – / -, sanitized
function buildArtifactFilename(projectName: string, phaseNumber?: number, agentLabel?: string): string
  // → `${shortName}_${phaseNumber}_${sanitizedLabel}.docx`
```

#### 2.3.3 Markdown → docx content (`markdownToDocxContent`)

An async, line-by-line parser producing an array of docx-js `Paragraph`/`Table`
elements:

- **Mermaid code blocks** (` ```mermaid `): `renderMermaidToPng(code)` →
  `buildDiagramParagraph(image)` (centered `ImageRun`, max 600px wide,
  height scaled proportionally) on success; `buildCodeBlockParagraph(codeLines)`
  (raw source, shaded) on failure.
- **Other fenced code blocks**: always `buildCodeBlockParagraph` — Consolas
  font, size 19, text color `1e293b`, solid `CODE_BG` fill, `CODE_BORDER`
  border on all sides, one `TextRun` per line joined by `{ text: '', break: 1 }`.
- **Markdown tables** (header row + `---`-style separator + body rows):
  `buildMarkdownTable(headerLine, bodyLines)` — full-width table, `RULE`
  borders, header cells solid-filled `ACCENT` with white text, body cells
  `1e293b` text, vertically centered, `60`/`100` DXA cell margins. Body rows
  are padded/truncated to match the header's column count.
- **Headings** (`#`/`##`/`###`/`####`): mapped to Word `HEADING_1`–`HEADING_4`.
  H1 and H2 get `pageBreakBefore: !firstHeading` (so the very first heading
  doesn't force a blank leading page); H1 additionally gets a bottom border
  in `ACCENT`.
- **Horizontal rules** (`---`/`***`): an empty paragraph with a bottom
  border.
- **Blockquotes** (`> `): left border in `ACCENT`, `MUTED` text color.
- **Lists** (`- `/`* ` bullets, `\d+. ` numbered): nesting level computed as
  `Math.floor(indentWhitespace.length / 2)`, capped at 4, using the shared
  `default-numbering` reference (decimal/lowerLetter/lowerRoman for levels 0-2).
- **Inline runs** (`inlineRuns`): within any text-bearing line, splits on
  `***bold-italic***` / `**bold**` / `*italic*` / `` `code` ``, producing
  `TextRun`s with `bold`/`italics`/`font: 'Consolas'` as appropriate (code
  spans render 2pt smaller than surrounding text).
- Blank lines and anything not matching the above become justified body
  paragraphs.

#### 2.3.4 Document assembly (`buildDocxBlob`)

```ts
async function buildDocxBlob(markdown: string, title: string, projectName: string): Promise<Blob>
```

Two sections:

1. **Cover page** — no header/footer; centered title (size 56, `ACCENT`,
   bold), project name (size 30), "Generated {timestamp}" (size 20, `FAINT`,
   italic), then a `PageBreak`.
2. **Content** — `page.pageNumbers.start: 1`; header shows project name
   (bold) + tab + title (both `MUTED`/`FAINT`) with a `RULE` bottom border;
   footer shows centered "Page X of Y" (`FAINT`) with a `RULE` top border;
   body is the `contentParagraphs` from `markdownToDocxContent`.

#### 2.3.5 Public export functions

```ts
function exportMarkdown(content: string, filename: string): void
async function exportDocx(markdown: string, title: string, projectName: string, phaseNumber?: number, agentLabel?: string): Promise<void>
async function exportCombinedDocx(sections: { title: string; markdown: string }[], title: string, projectName: string, phaseNumber?: number, agentLabel?: string): Promise<void>
async function exportAllArtifactsZip(artifacts: ArtifactInput[], projectName: string): Promise<void>
```

- `exportDocx` uses `buildArtifactFilename` when `phaseNumber != null`,
  otherwise `${title.replace(/[^a-z0-9]/gi, '_')}.docx`.
- `exportCombinedDocx` joins multiple agent outputs into one markdown
  document (`# {section.title}\n\n{section.markdown}` per section) before
  calling `exportDocx`.
- `exportAllArtifactsZip` dynamically imports `jszip`, builds one `.docx`
  blob per artifact, de-duplicates filename collisions by appending `_2`,
  `_3`, ... to the agent label, and downloads
  `${projectShortName(projectName)}_artifacts.zip`.

### 2.4 `githubIssueParser.ts`

```ts
export interface ParsedIssue { title: string; body: string; labels: string[]; }

export function parseDocumentToIssues(markdown: string, extraLabels: string[] = []): ParsedIssue[]
```

A heuristic parser — agent output is unstructured LLM markdown, not a fixed
schema. The file's top comment is explicit: **always show the parsed
preview to the user for review/edit before pushing — never push silently**
(enforced by `GithubPushModal`, §2.6).

- `SECTION_LABEL_MAP`: ordered `{ match: RegExp, label: string }` pairs —
  headings matching `backend` → `'backend'`, `frontend` → `'frontend'`,
  `infrastructure`/`devops`/`infra` → `'infrastructure'`,
  `testing`/`qa`/`test` → `'testing'`, `sprint 0`/`setup` → `'setup'`,
  `sprint \d+`/`sprint` → `'sprint'`, `spike` → `'spike'`,
  `security` → `'security'`.
- `splitSections(markdown)`: splits on `^(#{2,4})\s+(.*)$`, returning
  `{ heading, body }[]`; a leading entry with empty `heading` holds any
  preamble before the first heading (skipped during parsing).
- `splitItems(body)`: a new item starts at a numbered list line
  (`^\s{0,3}\d+[.)]\s+`) or a top-level bullet that "looks like a task"
  (contains `**`, starts with `Task`, or contains `Title:`); all other
  lines append to the current item's text.
- `extractTitleAndBody(itemText)`: title comes from a line matching
  `/title\s*:/i` (cleaned of bullet/numbering/bold markers via
  `cleanInlineLabel`), or the first non-empty line if no `Title:` line
  exists; remaining `Field: value` / `**Field**: value` lines are
  re-formatted as `- ` checklist items in the body; title truncated to 250
  characters.
- `parseDocumentToIssues`: for each non-preamble section, computes
  `labelsForHeading(heading)`, splits the body into items, extracts
  title/body per item, skips items with an empty title (unless they have a
  body and a long first line), and returns
  `{ title, body, labels: [...new Set([...extraLabels, ...sectionLabels])] }`.

### 2.5 Backend GitHub routes (`backend/src/proxy.js`)

Server-side because `api.github.com` does not send CORS headers permitting
browser requests with an `Authorization` header.

```js
function githubRequest(method, path, token, body) // raw https.request to api.github.com
```

- Sets `User-Agent`, `Accept: application/vnd.github+json`,
  `Authorization: Bearer {token}`, `X-GitHub-Api-Version: 2022-11-28`;
  10s timeout; resolves `{ status, body, raw }` (parsed JSON, falling back
  to `null` on parse failure).

**`POST /api/github/test`** — body `{ token, owner, repo }`:
- `400` if any of `token`/`owner`/`repo` missing.
- `GET /repos/{owner}/{repo}` → `200` → `{ ok: true, message: "Connected to {full_name}{ (private)? }." }`.
- `404` → `{ ok: false, message: "Repository {owner}/{repo} not found, or the token doesn't have access to it." }`.
- `401` → `{ ok: false, message: 'Invalid or expired token.' }`.
- other status → `{ ok: false, message: "GitHub responded with HTTP {status}." }`.
- network/timeout error → `502` with `{ error: "Failed to reach GitHub: {message}" }`.

**`POST /api/github/issues`** — body `{ token, owner, repo, issues: GithubIssueDraft[] }`:
- `400` if `token`/`owner`/`repo` missing or `issues` is empty/not an array.
- `400` if `issues.length > 50` ("Cannot create more than 50 issues in one request.").
- For each issue: `400`-equivalent inline result `{ title, ok: false, error: 'Missing title' }`
  if `title` is missing/non-string; otherwise
  `POST /repos/{owner}/{repo}/issues` with `{ title, body, labels? }`.
  - `201` → `{ title, ok: true, number, url: html_url }`.
  - other → `{ title, ok: false, error: respBody?.message ?? "HTTP {status}" }`.
  - thrown error → `{ title, ok: false, error: err.message }`.
- Returns `{ created: <count of ok>, total: issues.length, results }`.

### 2.6 `GithubPushModal.tsx`

```ts
interface Props {
  project: Project;
  markdown: string;        // agent output to parse
  extraLabels?: string[];  // e.g. ['sprint-plan'] or ['task-breakdown']
  sourceLabel: string;     // shown in the header
  onClose: () => void;
}
```

`MAX_ISSUES_PER_PUSH = 50`.

- On mount (`useEffect`, keyed on `[project.githubIntegrationId, markdown]`):
  - Throws `'No GitHub integration configured for this project.'` if
    `!project.githubIntegrationId`.
  - Loads credentials via `useIntegrations().loadCredential<GithubCredentials>(id)`;
    throws `'Saved GitHub connection could not be loaded. Reconnect it in Settings.'`
    if `null`.
  - Calls `parseDocumentToIssues(markdown, extraLabels)`, stores the result
    in `issues`, and initializes `selected = new Set(parsed.map((_, i) => i))`
    — **everything selected by default**.
- `toggle(index)` / `toggleAll()` manage the `selected` Set.
- `handlePush()`:
  - Validates `toPush.length <= MAX_ISSUES_PER_PUSH` (else sets `pushError`).
  - Calls `api.pushIssuesToGithub({ ...creds, issues: toPush.map(i => ({ title: i.title, body: i.body, labels: i.labels })) })`.
  - Stores `pushResult` (success) or `pushError` (thrown error).
- UI: header shows `"{sourceLabel} → {creds.owner}/{creds.repo}"`; body
  shows loading/error/empty states or the issue checklist (title, labels,
  body preview, select-all with count); footer shows the connection summary
  and Push/Cancel/Close buttons — Push is disabled if
  `loadingCreds || !!loadError || issues.length === 0 || selectedCount === 0 || pushing`.
  After pushing, results render as a ✓/✕ list:
  `<a href={r.url}>#{r.number} {r.title}</a>` on success, or
  `{r.title}{r.error ? \` — ${r.error}\` : ''}` on failure.

### 2.7 GitHub credentials & API surface

`types/integration.types.ts`:

```ts
export interface GithubCredentials {
  token: string;
  owner: string;
  repo: string;
}
```

`services/api.ts`:

```ts
export interface GithubConnectionParams { token: string; owner: string; repo: string; }
export interface GithubTestResult { ok: boolean; message: string; }
export interface GithubIssueDraft { title: string; body?: string; labels?: string[]; }
export interface GithubIssueResult { title: string; ok: boolean; number?: number; url?: string; error?: string; }
export interface GithubPushResult { created: number; total: number; results: GithubIssueResult[]; }

async function testGithubConnection(params: GithubConnectionParams): Promise<GithubTestResult>
async function pushIssuesToGithub(params: GithubConnectionParams & { issues: GithubIssueDraft[] }): Promise<GithubPushResult>
```

Both `fetch` `${API_URL}/github/{test|issues}` with `X-API-Token: PROXY_TOKEN`.
On a non-OK response, `testGithubConnection` returns
`{ ok: false, message }` (parsed from the response body's `error` field, or
a generic `Connection check failed ({status})`); `pushIssuesToGithub`
**throws** an `Error` with the equivalent message instead, since there's no
"partial failure" shape to return at the transport level (per-issue
failures are reported inside a successful `200` response body).

### 2.8 Composition in `ProjectWorkspace.tsx`

`isAdmin` (computed the same way as Module 4, §2.3.1) gates the GitHub push
button:

```tsx
<ExportMenu agentId={selectedAgent!} project={project} />
{isAdmin && project.githubIntegrationId &&
 (selectedAgent === 'sprintPlanner' || selectedAgent === 'taskBreakdown') && (
  <button onClick={() => setShowGithubPush(true)}>⇪ Push to GitHub</button>
)}
...
<DocumentViewer markdown={selectedRun.output ?? ''} />
{showGithubPush && selectedAgent && (
  <GithubPushModal
    project={project}
    markdown={selectedRun.output ?? ''}
    extraLabels={[selectedAgent === 'sprintPlanner' ? 'sprint-plan' : 'task-breakdown']}
    sourceLabel={selectedDef?.outputLabel ?? selectedAgent}
    onClose={() => setShowGithubPush(false)}
  />
)}
```

This is rendered inside the `selectedRun?.status === 'complete'` branch of
the document area, alongside the re-run button and `ExportMenu`.

GitHub connection settings (owner/repo/PAT, "Test connection") live in
`ProjectSettings.tsx` (General tab) — `saveGithubIntegration`,
`disconnectGithub`, and `testGithubConnection` there save/clear/verify the
`GithubCredentials` record and `project.githubIntegrationId`, but are
otherwise out of this module's primary scope (they're the same
`isAdmin`-gated integration pattern as Module 4's admin model).

---

## 3. Development Notes

1. **Two independent Mermaid pipelines.** `DocumentViewer` (live SVG) and
   `documentExporter` (PNG rasterization for docx) each lazy-load Mermaid
   from the same CDN URL independently, with separate "loaded" flags and
   separate error-handling. There's no shared module-level cache between
   them — if both the viewer and an export run in the same session, Mermaid
   is fetched/initialized twice. Not a correctness issue (each load is
   idempotent and cheap after the first), but a minor duplication worth
   noting if Mermaid usage expands.

2. **Markdown rendering is regex-based, not a real parser**, in both
   `DocumentViewer.renderMarkdown` and `documentExporter.markdownToDocxContent`.
   Both implement *overlapping but not identical* subsets of markdown
   (e.g., `documentExporter` handles nested lists via indentation level;
   `DocumentViewer` does not track list nesting). Pathological or unusual
   agent output (deeply nested lists, tables with inconsistent column
   counts, mixed code-fence languages) could render differently in the live
   viewer vs. the exported `.docx`. This is a known tradeoff for avoiding a
   markdown-parser dependency, not a bug — but worth keeping in mind if a
   future agent's output format changes significantly.

3. **`pushIssuesToGithub` throws on transport failure but returns a result
   object on partial per-issue failure.** `GithubPushModal.handlePush`
   handles both: a thrown error sets `pushError` (nothing was attempted or
   the whole request failed before GitHub responded), while a returned
   `GithubPushResult` with some `ok: false` entries is shown as a mixed
   ✓/✕ list. Callers of `api.pushIssuesToGithub` must handle both cases —
   a `try/catch` around the call plus inspecting `result.results` for
   per-item status.

4. **The 50-issue cap is enforced in two places**: `GithubPushModal`
   (`MAX_ISSUES_PER_PUSH`, client-side, before calling the API) and
   `/api/github/issues` (`400` if `issues.length > 50`, server-side). Both
   checks use the same number but are independent constants — if this limit
   ever changes, both need updating (`frontend/src/components/documents/GithubPushModal.tsx`
   and `backend/src/proxy.js`).

5. **"Push to GitHub" is hardcoded to two agents** (`sprintPlanner`,
   `taskBreakdown`) in `ProjectWorkspace.tsx`'s render condition. Any future
   agent whose output should also be pushable as GitHub issues needs this
   list (and the `extraLabels` mapping) updated in `ProjectWorkspace.tsx` —
   `parseDocumentToIssues` itself is generic and not agent-specific.

---

## 4. Test Plan Summary

See `docs/test-plans/document-export-github-test-plan.md` for the full
scenario list (TS-114 onward). Highlights:

| Area | Coverage |
|---|---|
| `DocumentViewer` markdown rendering | Headers, emphasis, code, lists, tables, blockquotes, hr, paragraphs |
| `DocumentViewer` Mermaid handling | Successful render, syntax-error fallback, error-SVG cleanup |
| `documentExporter` filename helpers | `projectShortName`, `buildArtifactFilename`, sanitization edge cases |
| `documentExporter` markdown→docx parsing | Headings/page breaks, tables, code blocks, lists, blockquotes, hr, inline formatting |
| `documentExporter` export functions | `exportMarkdown`, `exportDocx`, `exportCombinedDocx`, `exportAllArtifactsZip` (filename collisions) |
| `githubIssueParser` | Section splitting, label mapping, item splitting, title/body extraction, edge cases (empty title, no headings) |
| `ExportMenu` | Disabled states, `.md` vs `.docx` export calls with correct args |
| `GithubPushModal` | Missing integration / unloadable credentials errors, parsed preview always shown, select/deselect, push success + partial failure rendering, 50-issue cap |
| `ProjectWorkspace` composition | Push-to-GitHub button visibility gating (`isAdmin`, `githubIntegrationId`, agent type) |

---

## 5. Deployment & Maintenance Notes

- No new environment variables or persistence tables. `GithubCredentials`
  reuses the existing `IntegrationCredential` encrypted-storage mechanism;
  `project.githubIntegrationId` is a plain field on the existing `Project`
  record (Dexie, per Module 1).
- The backend GitHub routes (`/api/github/test`, `/api/github/issues`)
  require outbound HTTPS access to `api.github.com` from wherever
  `backend/src/proxy.js` runs — if deployed behind a restrictive egress
  firewall, `api.github.com:443` must be allowed.
- Both Mermaid CDN loads (`DocumentViewer`, `documentExporter`) require
  outbound access to `cdn.jsdelivr.net`. If the app is deployed in an
  offline/air-gapped environment, Mermaid diagrams will fall back to raw
  source in the viewer and to code blocks in exported `.docx` files — this
  is a graceful degradation, not a hard failure.
- If GitHub's API version changes in a breaking way, update the
  `X-GitHub-Api-Version` header in `githubRequest` (`backend/src/proxy.js`).
- Any change to the 50-issue cap must update both
  `GithubPushModal.MAX_ISSUES_PER_PUSH` and the `400` check in
  `/api/github/issues` (see §3, Dev Note 4).
