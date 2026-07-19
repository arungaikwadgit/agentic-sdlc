# Design Critique: Agentic SDLC App — Responsiveness Audit

Last updated: 2026-07-19
Method: code-level audit (CSS modules + component layout), not a Figma pull — this app doesn't have a design file connected, so the critique is grounded directly in the shipped CSS. One concrete bug (Review Gate modal header overflow) was fixed as part of this pass; see commit `ec157180`.

---

## Overall Impression

The core visual language is solid and consistent — a single dark theme driven by CSS custom properties (`--surface`, `--accent`, `--border`, etc.), consistent 8px-ish spacing rhythm, and a clean information-dense layout appropriate for an internal engineering tool. The biggest gap isn't visual polish, it's structural: **responsive behavior was added reactively, per-component, only when someone hit a problem** (Dashboard, the chat widget, the new-project modal, and now the review gate modal each have their own one-off breakpoint), rather than as a systematic layer. Most of the app — including the primary workspace screen users spend the most time in — has zero responsive handling at all.

---

## Usability

| Finding | Severity | Recommendation |
|---|---|---|
| Review Gate modal header (title + approver select + hints + Reject/Approve) overflowed past the modal edge on narrower viewports, clipped by `overflow:hidden` instead of wrapping | 🔴 Critical | **Fixed** in `ec157180` — `.header` now wraps, `.headerActions`/`.headerTitle` get `min-width:0` so the existing `flex-wrap` actually engages. |
| `ProjectWorkspace.module.css` (the main workspace — phase sidebar + agent list + document panel) has **zero** `@media` rules; the phase sidebar is a fixed 240px column | 🔴 Critical | Same class of bug as the review gate modal is latent here. On a laptop at ~1280px with the browser at anything less than full width, or on a tablet, the three-column layout (sidebar + agent list + doc panel) has nowhere to shrink to. Needs the same wrap-and-stack treatment before it's "fully responsive." |
| `AgentThinkingPanel`, `AdminPanel`, `TeamPanel`, `ProjectSettings`, `AppSettingsModal` — all modals/panels with real data tables and multi-column layouts — have zero breakpoints | 🟡 Moderate | Lower traffic than the workspace/review-gate, but same risk: content will overflow or get clipped rather than reflow below ~900px. |
| Native `<select>` elements (approver picker, model pickers, etc.) have no `max-width`/`min-width:0` — on Windows/Chrome a `<select>` can refuse to shrink below its longest `<option>` text width, which was a contributing factor in the header overflow bug | 🟡 Moderate | Add `min-width: 0; max-width: 100%;` to select styles wherever they sit inside a flex row that needs to shrink. |
| Close button (28×28px), assignee badges (26×26px) fall below the ~44×44px minimum comfortable touch target | 🟢 Minor | Fine for a desktop-first internal tool used with a mouse; worth bumping on the new `<=640px` breakpoint if phone use is expected (already increased touch-friendliness for Reject/Approve/select in the fix). |

---

## Visual Hierarchy

- **What draws the eye first**: In the review gate modal (pre-fix), *nothing* did — the eye had no clear entry point because the overflow bug scattered the approver select, hint text, and buttons across uneven whitespace with no consistent baseline. Post-fix, the title reads first (correct), then the action row.
- **Reading flow**: Left-to-right, top-to-bottom is used consistently across the app (sidebar → content, tab bar → panel) — this is the right pattern for a document-review tool and doesn't need to change.
- **Emphasis**: Primary actions (`Approve & Continue`, `Run Pipeline`) correctly use the accent color; destructive actions (`Reject & Stop`) correctly use red. The new `actionRequiredHint` red text added this session risks competing with the Reject button's own red for attention — worth confirming in review that "why is this disabled" text doesn't read as more urgent than the button itself.

---

## Consistency

| Element | Issue | Recommendation |
|---|---|---|
| Responsive breakpoints | Four different breakpoint values in use: 480px (ChatWidget, NewProjectModal), 640px (ReviewGateModal, just added), 900px (Dashboard), 600px (generated mockup preview HTML, not app chrome) | Define a small shared set of breakpoints (e.g. 480 / 768 / 1024) as CSS custom properties or a documented convention, so future components don't invent a fifth value. |
| Modal max-widths | ReviewGateModal caps at 1100px, NewProjectModal and others use their own values | Not urgent, but a shared `--modal-max-width` scale (sm/md/lg) would prevent drift as more modals are added. |
| Hint/warning text pattern | This session introduced two visually similar but semantically different patterns in the same component: `.gateRestrictedNote` (you can't act — permission) vs `.actionRequiredHint` (you can act, but a field is missing) | Already documented in code comments distinguishing the two — worth carrying that same distinction into any other gated-action UI in the app (e.g. if Data Model/Architecture agents later get a similar "reason it's disabled" pattern). |

---

## Accessibility

- **Color contrast**: Base palette (`--text: #f1f5f9` on `--bg: #0f172a`, `--text-muted: #94a3b8` on `--surface: #1e293b`) is a slate-on-navy combination that comfortably clears WCAG AA for normal text. No issues found in the core palette.
- **Touch targets**: See Usability table above — close button and assignee badges are undersized for touch; acceptable for a desktop-primary tool, worth revisiting if mobile/tablet use is a real target.
- **Text readability**: Several UI labels run at 10-11px (`assigneeBadge` initials at 10px, the new `actionRequiredHint` at 11px) — below the ~12px general accessibility guidance for body/label text. These are secondary/decorative in context (badge initials, inline hints with a fuller tooltip backing them), so not blocking, but shouldn't get smaller.
- **Keyboard/focus**: The review gate's approver `<select>` has a visible focus style (`border-color: var(--accent)` on `:focus`); the phase-sidebar collapse toggle added this session correctly has `role="button" tabIndex={0}` with keydown handling. Good pattern — worth confirming it's used consistently anywhere else a `<div>` is made clickable.

---

## What Works Well

- Consistent dark theme via CSS custom properties makes future palette/contrast changes cheap and low-risk — a real strength for accessibility follow-up work.
- Where responsive breakpoints *do* exist (ChatWidget, NewProjectModal, Dashboard header), they're simple, targeted, and don't over-engineer — a good model to replicate rather than replace.
- The bounded-retry, additive-flag pattern used throughout this session's backend work (`requiresDiagram`, `intermediateSystemPrompt`) has a clean UI analog already in place: new states (diagram missing, token breakdown, action-required hints) render as clearly distinct, conditionally-shown blocks rather than overloading existing UI — this is good practice to continue as responsive fixes roll out, so a component doesn't need a rewrite to gain a breakpoint.

---

## Responsive Coverage Inventory

Full sweep of `@media` usage across `frontend/src`, most-trafficked screens first:

| File | Has breakpoints? | Risk if narrow |
|---|---|---|
| `ProjectWorkspace.module.css` (main workspace) | **None** | 🔴 High — fixed 240px sidebar, multi-column layout throughout |
| `AgentThinkingPanel.module.css` | **None** | 🟡 Medium — long-form content, mostly single-column already |
| `ReviewGateModal.module.css` | Yes (640px, added this session) | Resolved |
| `Dashboard.module.css` | Yes (900px, header only) | 🟡 Medium — header covered, project grid/cards not audited here |
| `ChatWidget.module.css` | Yes (480px) | Low |
| `NewProjectModal.module.css` | Yes (480px) | Low |
| `AdminPanel.module.css`, `TeamPanel.module.css`, `ProjectSettings.module.css`, `AppSettingsModal.module.css` | **None** | 🟡 Medium — admin-only, lower traffic, but same latent risk |
| ~20 other component modules (createProject wizard, documents viewers, etc.) | **None** | Not yet assessed individually |

---

## Priority Recommendations

1. **Extend the same wrap-and-stack pattern to `ProjectWorkspace.module.css`** — this is the highest-traffic screen with zero coverage today; the same class of overflow bug just fixed in the review gate modal is latent here. Recommend as the next concrete fix, scoped the same way (add `min-width:0` where flex rows need to shrink, add one `<=768px` breakpoint that stacks the phase sidebar above the content instead of beside it).
2. **Establish a shared breakpoint convention** before adding more one-off `@media` rules — four different values already exist for what are conceptually the same two or three device classes. A short-lived cleanup now is cheaper than reconciling five more ad-hoc breakpoints later.
3. **Audit the admin/settings surfaces (`AdminPanel`, `TeamPanel`, `ProjectSettings`, `AppSettingsModal`) for the same overflow risk** — lower priority than the workspace since traffic is lower, but worth a pass once the workspace fix lands, using the same method (grep for fixed pixel widths + flex containers without `min-width:0`).

None of the above requires touching `l3Runtime.ts`, agent definitions, or any pipeline logic — this is UI-layer only and carries the same "opt-in, additive, zero impact to current flow" guarantee as the rest of this session's work.
