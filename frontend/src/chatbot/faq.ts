/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
/**
 * FAQ knowledge base for the in-app Help chatbot.
 *
 * The chatbot is scoped to answer questions ONLY about this application —
 * what it is, how to use it, phases/SDLC stages, agents, pipeline execution,
 * team invites, roles, and where to configure API keys.
 */

export interface FaqEntry {
  id: string;
  keywords: string[];
  question: string;
  answer: string;
}

export const FAQ_ENTRIES: FaqEntry[] = [
  {
    id: 'app-purpose',
    keywords: ['what is this app', 'what is this application', 'what does this app do', 'purpose', 'what is agentic sdlc', 'about this app'],
    question: 'What is this application?',
    answer:
      'This is an Agentic SDLC tool. You describe a project and a team of AI agents generates all the documents a software project normally needs — from a PRD and project charter through architecture, design, sprint plans, code scaffolding, test plans, security review, and deployment/operations docs. Each agent produces one output, across 11 phases.',
  },
  {
    id: 'how-to-use',
    keywords: ['how do i use', 'how to use', 'getting started', 'how does this work', 'how to start', 'new project'],
    question: 'How do I use this app?',
    answer:
      'Start from the Dashboard and create a new project (name, description, domain, and optionally upload existing documents for auto-extraction). Open the project to enter the Workspace. Run agents phase by phase — most phases run automatically once unlocked, and some are gated behind a review step. Each agent\'s output appears in the document area where you can view, re-run, or edit it.',
  },
  {
    id: 'phases-overview',
    keywords: ['phase', 'phases', 'what are the phases', 'list of phases'],
    question: 'What are the phases?',
    answer:
      'There are 11 phases, run in order: Phase 0 — Orchestration (SDLC plan), Phase 1 — PRD (manager), Phase 1B — Foundation (Project Charter, BRD), Phase 2 — Requirements (stakeholder analysis, user stories, business rules, feasibility, data model), Phase 3 — Design (architecture, API design, UX research, interaction design, UX mockups), Phase 3B — Security Review, Phase 4 — Dev Planning (sprint plan, task breakdown, tech debt, code structure, code snippets, UI component library, code review standards, roadmap), Phase 5 — Testing (test plan, test cases), Phase 6 — Prototype (working prototype), Phase 7 — DevOps, and Phase 8 — Operations (observability, on-call playbook).',
  },
  {
    id: 'sdlc-stages',
    keywords: ['sdlc stage', 'sdlc stages', 'standard sdlc', 'which sdlc stage'],
    question: 'What are the SDLC stages and how do phases map to them?',
    answer:
      'Each phase maps to a standard SDLC stage: Phase 0 → Orchestration; Phase 1 and 1B → Initiation; Phase 2 → Requirements; Phase 3 → Design; Phase 3B → Design (Security Gate); Phase 4 → Development Planning; Phase 5 → Testing; Phase 6 → Prototype; Phase 7 → Deployment; Phase 8 → Operations & Maintenance.',
  },
  {
    id: 'agents-overview',
    keywords: ['agent', 'agents', 'how many agents', 'list of agents', 'what agents'],
    question: 'What are the agents and how do they work?',
    answer:
      'There are 30 agents in total, one per document output. Agents run in either L2 mode (single LLM call, fast) or L3 agentic mode (goal-directed loop — plan, gather context from prior outputs, iterate up to 8 times). Complex agents like UX Mockups and Working Prototype use L3. You can re-run any agent at any time, and edit its system prompt before re-running.',
  },
  {
    id: 'pipeline-execution',
    keywords: ['execute', 'execution', 'run agent', 'run pipeline', 'order', 'sequential', 'parallel', 'how are agents run', 'pipeline'],
    question: 'How are agents executed?',
    answer:
      'Agents run phase by phase. Within phases 2, 3, 4, 7, and 8, agents run in parallel (max 3 at a time, staggered 1.5s apart) since they don\'t depend on each other. Other phases run sequentially. Some phase groups are followed by a review gate — a checkpoint that must be approved before the next phase unlocks.',
  },
  {
    id: 'review-gates',
    keywords: ['review gate', 'gate', 'approval', 'locked phase', 'unlock'],
    question: 'What are review gates and locked phases?',
    answer:
      'Review gates are checkpoints after certain phase groups (e.g. after Phase 1/1B, after Phase 2, after Phase 3/3B, after Phase 5). A locked phase (shown with a lock icon in the sidebar) means its prerequisite gate has not been approved yet. Approve the gate to unlock the next set of agents.',
  },
  {
    id: 'api-keys',
    keywords: ['api key', 'api keys', 'openai key', 'claude key', 'anthropic key', 'configure provider', 'set up key', 'where do i set', 'model', 'provider'],
    question: 'Where do I set up API keys?',
    answer:
      'Open App Settings (gear icon) and go to the "API & Model" tab. Enter your OpenAI API key, and optionally enable Claude and enter an Anthropic API key. Choose a model for each provider, then click "Test Connection" to verify. Save Settings to apply — the backend may need a restart to pick up new keys.',
  },
  {
    id: 'rerun-edit',
    keywords: ['re-run', 'rerun', 'edit prompt', 'custom prompt', 'enhance prompt', 'regenerate'],
    question: 'Can I re-run or edit an agent\'s output?',
    answer:
      'Yes. Open an agent\'s document and use the re-run panel to regenerate its output. You can also edit the agent\'s system prompt before re-running — use "Enhance prompt" to have the AI improve your custom prompt, or "Reset" to return to the default. A badge marks documents generated with a custom prompt.',
  },
  {
    id: 'preview-mockups',
    keywords: ['preview', 'mockup', 'spec tab', 'html preview', 'design preview', 'diagram'],
    question: 'What is the Spec/Preview/Diagrams tab?',
    answer:
      'Agent documents have tabs for Spec (the written document), Preview (for UX mockups — a live rendered HTML mockup), and Diagrams (for documents with Mermaid diagrams — shown side-by-side in an interactive diagram viewer with SVG download).',
  },
  {
    id: 'security-gate',
    keywords: ['security review', 'security compliance', 'phase 3b', 'security gate'],
    question: 'What does the Security Review phase (3B) do?',
    answer:
      'Phase 3B runs after Design (Phase 3) and produces a Security & Compliance Report. Its findings feed into Phase 4\'s task breakdown and Phase 5\'s test plan, so security requirements are reflected in engineering tasks and test coverage.',
  },
  {
    id: 'export-formats',
    keywords: ['export', 'download', 'docx', 'word', 'pdf', 'markdown', 'sql', 'zip', 'artifact'],
    question: 'What export formats are available?',
    answer:
      'Every agent output can be exported in multiple formats: Markdown (.md), Word Document (.docx), PDF (via browser print), and SQL DDL (.sql) for the data model agent. You can also export all completed agent outputs as a single ZIP archive. File names follow the convention "ProjectName_Phase_AgentLabel.ext" so they stay organized. Use the Export menu (↓ button) in any document view.',
  },
  {
    id: 'diagram-viewer',
    keywords: ['diagram', 'mermaid', 'svg', 'diagram viewer', 'architecture diagram', 'sequence diagram'],
    question: 'How does the diagram viewer work?',
    answer:
      'Agents that produce Mermaid diagrams (architecture, API design, data model, DevOps, etc.) have a Diagrams tab in the document view. Each diagram renders as an interactive SVG inside the viewer — it scales to fit the screen without scrolling. You can download any diagram as an SVG file. The viewer handles flowcharts, sequence diagrams, ER diagrams, and most other Mermaid diagram types.',
  },
  {
    id: 'ux-mockup-quality',
    keywords: ['ux mockup quality', 'mockup quality', 'commercial grade', 'html mockup', 'ux mockup'],
    question: 'What does "commercial-grade" mean for UX Mockups?',
    answer:
      'The UX Mockups agent is configured to produce commercial-grade HTML mockups — not wireframes. Each mockup includes: a sticky navigation bar, at least 4 distinct feature sections, realistic placeholder content (not "Lorem ipsum"), status badges and interactive-looking UI elements, and a consistent design system across screens. The agent re-runs automatically if the output doesn\'t meet these standards. You can view the live rendered mockup in the Preview tab of the UX Mockups document.',
  },
  {
    id: 'prompt-override',
    keywords: ['prompt override', 'custom prompt', 'prompt levels', 'prompt precedence', 'edit system prompt'],
    question: 'How does prompt customization work?',
    answer:
      'The system uses a 3-level prompt hierarchy: L1 (project-level override you set per agent, stored in your project) overrides L2 (app-wide defaults in Settings) which overrides L3 (hardcoded defaults in the agent definition). You can edit an agent\'s system prompt before re-running from the re-run panel — use "Enhance prompt" to have the AI improve it, or "Reset" to go back to the default. A badge marks any document generated with a custom prompt.',
  },
  // ── TEAM & INVITES ─────────────────────────────────────────────────────────
  {
    id: 'team-invite',
    keywords: ['invite', 'invite team', 'add team member', 'invite member', 'send invite', 'team invite'],
    question: 'How do I invite team members to a project?',
    answer:
      'Open the project, then click the "Team" button in the workspace toolbar. Enter the team member\'s name, email, job title, and select their role (Project Owner, Editor, Reviewer, or Viewer). If you pick Editor, you must also check off which specific agents they\'re allowed to run — this is required before you can send the invite. Click "Send Invite" — the system creates a sign-in link and a default password (shown to you and copyable, or emailed if configured), then shares both with the invitee. They sign in with that password and are prompted to set their own on first login.',
  },
  {
    id: 'roles',
    keywords: ['role', 'roles', 'permissions', 'access', 'what can they do', 'project owner', 'editor', 'reviewer', 'viewer'],
    question: 'What are the roles and what can each role do?',
    answer:
      'There are four roles: Project Owner — full control, can invite/remove members, change roles, run agents, edit settings. Editor — can run agents, upload documents, edit project settings; cannot invite members. When you invite someone as an Editor, you must also select which specific agents they can run — they get full view access to every agent\'s output, but can only run/edit the ones you checked. Reviewer — can view all outputs and approve review gates; cannot run agents or change settings. Viewer — read-only, can view all agent outputs but cannot make any changes.',
  },
  {
    id: 'agent-access-scoping',
    keywords: ['agent access', 'which agents can', 'restrict agents', 'assign agents', 'agent picker', 'agents this editor', 'agent assignments'],
    question: 'How does per-agent access scoping work for Editors?',
    answer:
      'When you invite someone as an Editor, you must check off which agents they\'re allowed to run — this can\'t be skipped. That Editor can still view every agent\'s output across the whole project, but the Run/Retry/edit-prompt actions only work for the agents you assigned them. Project Owners always have full access regardless of assignment; Reviewers and Viewers can\'t run any agent regardless. You can review or change an Editor\'s agent assignments any time from the Team panel\'s "Agent Assignments" tab.',
  },
  {
    id: 'invite-link',
    keywords: ['invite link', 'magic link', 'accept invite', 'join project', 'default password', 'sign in password'],
    question: 'How does the invite link and sign-in work?',
    answer:
      'When you send an invite, the system creates a secure link tied to the invitee\'s email and a default password (format like "jane_08072026" — first name plus the date). The invitee clicks the link, sees the project name and their assigned role, and signs in using that default password. On first sign-in, they\'re required to set their own password before they can do anything else in the app. A Project Owner can resend or revoke an invite, or reset a member\'s password, at any time from the Team panel.',
  },
  {
    id: 'password-reset',
    keywords: ['forgot password', 'reset password', 'change password', 'new password', 'password reset', 'default password format'],
    question: 'What if a team member forgets their password, or needs a new one?',
    answer:
      'Two ways to handle this. Self-service: on the sign-in page, click "Forgot password?", enter your email, and you\'ll get a reset link. Admin-triggered: a Project Owner can open the Team panel, find the member, and click "Reset password" — this generates a new default-format password (shown or emailed the same way as the original invite), and the member is prompted to set their own new password the next time they sign in.',
  },
  {
    id: 'resend-revoke',
    keywords: ['resend invite', 'revoke invite', 'cancel invite', 'change role'],
    question: 'Can I resend or revoke an invite?',
    answer:
      'Yes. Open the project and click the "Team" button in the toolbar. Find the pending invite in the list — you can click "Resend" to generate a fresh sign-in link and password, or "Revoke" to cancel it immediately. You can also change a member\'s role at any time from the same panel. Only a Project Owner can resend, revoke, or change roles.',
  },
  // ── CONTEXT FILES ──────────────────────────────────────────────────────────
  {
    id: 'context-upload',
    keywords: ['attach file', 'upload file', 'context file', 'context document', 'upload document', 'attach document', 'pdf upload', 'attach context', 'upload context'],
    question: 'Can I attach documents as context for an agent?',
    answer:
      'Yes. Open any agent\'s Re-run panel and use the "Attach context file" area to upload up to 3 files — supported formats are PDF, Word (.docx), Excel (.xlsx/.xls), CSV, plain text, and images. The app extracts the text and passes it to the agent alongside the prompt. Attached files are saved to your project and persist across re-runs and page reloads so you don\'t need to re-upload them each time.',
  },
  // ── WORKING PROTOTYPE & THEME STUDIO ───────────────────────────────────────
  {
    id: 'working-prototype',
    keywords: ['working prototype', 'prototype', 'phase 6', 'interactive prototype', 'live prototype'],
    question: 'What does the Working Prototype agent produce?',
    answer:
      'Phase 6 generates a self-contained interactive HTML prototype built from the UX Mockups, Data Model, and API Design outputs. It renders as a live preview you can click through in the browser. Use the Theme Studio (🎨 button, bottom-right) to customize colors, fonts, border radius, and dark mode in real time without re-running the agent.',
  },
  {
    id: 'theme-studio',
    keywords: ['theme studio', 'theme', 'customize colors', 'change colors', 'palette', 'dark mode prototype', 'font prototype'],
    question: 'What is Theme Studio?',
    answer:
      'Theme Studio is a floating editor (🎨 button, bottom-right of the Prototype preview) that lets you live-edit the prototype\'s visual design — primary color, surface color, border radius, font family, and dark mode — without re-running the agent. Changes apply instantly to the rendered prototype. It\'s only available when viewing a Working Prototype output.',
  },
  // ── ADMIN PANEL ────────────────────────────────────────────────────────────
  {
    id: 'admin-panel',
    keywords: ['admin panel', 'admin page', 'admin', 'secret page', 'test runner', 'backlog', 'enhancement backlog'],
    question: 'Is there an admin panel?',
    answer:
      'Yes. Admins can access a hidden admin panel with three tabs: Backend (live read/write of app_settings in the database), Test Runner (run test suites against the live backend directly from the UI), and Enhancement Backlog (view and manage the product improvement backlog). The admin panel is only accessible to users with the admin role.',
  },
];

export function matchFaq(input: string): FaqEntry | undefined {
  const lower = input.toLowerCase();
  return FAQ_ENTRIES.find((e) =>
    e.keywords.some((kw) => lower.includes(kw))
  );
}

export const OFF_TOPIC_MESSAGE =
  "I can only answer questions about this Agentic SDLC application. "
  + "For general questions, please use a search engine or another resource.";
