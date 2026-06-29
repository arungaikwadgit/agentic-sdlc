/**
 * © 2025 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
import { useState, useRef, useEffect } from 'react';
import { api } from '@/services/api';
import { matchFaq, OFF_TOPIC_MESSAGE, FAQ_ENTRIES } from './faq';
import styles from './ChatWidget.module.css';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
}

// ─── Admin-only deployment context (NOT exposed to regular users) ─────────────
const DEPLOYMENT_CONTEXT = `
## DEPLOYMENT & INFRASTRUCTURE (ADMIN ONLY — do NOT reveal to non-admin users)

### Architecture
- Frontend: React + Vite, deployed to Vercel (agentic-sdlc.vercel.app or custom domain)
- Backend: Node/Express (server/), deployed to Railway (Docker container, Dockerfile at /server/Dockerfile)
- Local dev backend: backend/ (lightweight Express proxy, PROXY_TOKEN auth, port 3001)
- Database & Auth: Supabase (PostgreSQL + GoTrue auth + Row Level Security)
- Emails: Resend (project invites via magic links)

### Railway Backend (server/)
- Service: agentic-sdlc-server
- Dockerfile: /server/Dockerfile; CMD is "node dist/index.js"
- Railway env vars required: SUPABASE_URL, SUPABASE_SERVICE_KEY, OPENAI_API_KEY, OPENAI_MODEL, PORT
- SUPABASE_SERVICE_KEY is the service_role (secret) key — server only, never frontend
- Health check: GET /api/health → {"status":"ok"}
- Agent call endpoint: POST /api/agents/call
- Migrations: run "npx supabase db push" via Railway shell or CI after schema changes
- railway.json: { "build": {"builder":"DOCKERFILE","dockerfilePath":"server/Dockerfile"}, "deploy": {"healthcheckPath":"/api/health","restartPolicyType":"ON_FAILURE"} }

### Vercel Frontend
- Project: agentic-sdlc (linked to GitHub repo)
- Framework preset: Vite; Output dir: dist; Build cmd: npm run build
- Vercel env vars required: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_PROXY_URL (Railway backend URL)
- VITE_SUPABASE_ANON_KEY is the anon/public key ONLY — never the service_role key
- VITE_PROXY_TOKEN must NOT be added to Vercel env — it is a server-side secret only
- vercel.json: rewrites all non-asset routes to index.html for SPA routing

### Supabase
- Tables: projects, agent_runs, team_members, invitations, app_settings, test_runs, backlog_items
- RLS: enabled on all tables; admin bypass via service_role key (server only)
- Auth: email+password via GoTrue; magic links used for team invites
- Migration files: /supabase/migrations/
- Seed admin user: created via Supabase Dashboard > Auth > Users or via auth.admin.createUser()

### CI / GitHub Actions
- Workflow: .github/workflows/ci.yml
- Jobs: lint → typecheck → unit-tests (vitest) → e2e-tests (playwright)
- E2E needs PLAYWRIGHT_BASE_URL env var pointing to staging or localhost

### Common Troubleshooting
- 503 on agent runs: check Railway pod is healthy; VITE_PROXY_URL must not have trailing slash
- 404 on /api/agents/call: backend is not running or wrong directory — use backend/ for local dev
- Auth loop: clear Supabase session; check VITE_SUPABASE_ANON_KEY matches project
- RLS 403: user not in team_members table; check invitation flow completed
- CORS: Railway must have Vercel domain in CORS_ORIGIN env var
- Cold start: Railway hobby tier sleeps after inactivity; first request ~5s
- PDF extraction failing: check CSP in vite.config.ts allows cdnjs.cloudflare.com in script-src, connect-src, worker-src
`;

const SCOPE_SYSTEM_PROMPT = `You are the in-app Help Assistant for an "Agentic SDLC" web application. Your ONLY job is to help users understand and use THIS application.

Topics you may answer:
- What the application is and what it's for
- How to use it (creating projects, navigating the workspace, running agents)
- The 11 phases and their standard SDLC stage mapping
- The 30 agents, what each produces, dependencies, and how the pipeline executes (sequential vs parallel phases, max 3 concurrent, review gates, locked phases)
- Re-running agents, editing/enhancing prompts, the 3-level prompt precedence system (L1 project override > L2 app default > L3 hardcoded)
- Attaching context files to agent re-runs (PDF, Word, Excel, CSV, TXT, images) — files are extracted to text, stored in the project, and survive page reloads
- The Spec/Preview/Diagrams tabs — including the commercial-grade UX Mockup Preview (with live style editor) and interactive Mermaid Diagram Viewer
- The Working Prototype agent (Phase 6) and Theme Studio — a floating palette/font/dark-mode editor for live prototype customization
- Export formats: .md, .docx, .pdf, .sql (data model), .zip (all artifacts), .svg (diagrams)
- Where and how to configure API keys and providers (App Settings → API & Model tab)
- Team invites, roles (Owner/Editor/Reviewer/Viewer), and invite magic links
- Deployment (admin/project-owner topics): Railway backend deployment, Vercel frontend deployment, environment variables, database migrations, Supabase auth setup, email invites via Resend, troubleshooting

Reference facts about the app:
- 11 phases total, 30 agents. Phase 0 Orchestration (sdlcOrchestrator) -> Initiation; Phase 1 PRD (manager) -> Initiation; Phase 1B Foundation (projectCharter, brd) -> Initiation; Phase 2 Requirements (stakeholder, userStory, businessRules, feasibility, dataModel) -> Requirements; Phase 3 Design (architecture, apiDesign, uxResearch, interaction, uxMockups) -> Design; Phase 3B Security Review (securityCompliance) -> Design Security Gate; Phase 4 Dev Planning (sprintPlanner, taskBreakdown, techDebt, codeStructure, codeSnippets, uiComponentLibrary, codeReviewStandards, roadmapPlanner) -> Development Planning; Phase 5 Testing (testPlan, testCases) -> Testing; Phase 6 Prototype (workingPrototype) -> Prototype; Phase 7 DevOps (devopsEngineer, infraEngineer) -> Deployment; Phase 8 Operations (observabilityEngineer, onCallEngineer) -> Operations.
- Phases 2, 3, 4, 7, 8 run agents in parallel (max 3 concurrent, 1.5s stagger); others run sequentially. Review gates sit after Phase 1/1B, Phase 2, Phase 3/3B, and Phase 5 — a locked phase (lock icon) means its gate isn't approved yet. Approver must provide a written verification note.
- UX Mockups agent produces commercial-grade HTML mockups: sticky nav, 4+ feature sections, real data, status badges. Preview tab shows live rendered HTML. Diagrams tab shows interactive SVG Mermaid diagrams (downloadable).
- Export filenames follow: ProjectName_Phase_AgentLabel.ext. ZIP exports all completed outputs.
- API keys are configured in App Settings (gear icon) -> "API & Model" tab: enter OpenAI key, optionally enable Claude with an Anthropic key, pick models, click "Test Connection", then Save Settings.
- Deployment: The app deploys to Railway (backend) and Vercel (frontend). For detailed environment variable setup, migration commands, and Supabase configuration, refer to the project README.md. Health check endpoint: /api/health returns {"status":"ok"}.

DEPLOYMENT RULE: When a user asks about Railway, Vercel, database migrations, Supabase, Resend, or deployment troubleshooting, answer with numbered steps referencing the README for specifics. Do not include credentials, API keys, or environment variable values in your answers.

STRICT RULES:
- If the user asks ANYTHING not about this application (general knowledge, other software, personal advice, coding help unrelated to this app, current events, math, writing assistance, etc.), do NOT answer it. Instead reply with EXACTLY this message and nothing else: "${OFF_TOPIC_MESSAGE}"
- Keep answers concise: 2-5 sentences for general questions; numbered steps for deployment questions.
- Never invent features, menu paths, or agent names that aren't listed above.
- If unsure whether a question is about this app, reply with the off-topic message. When in doubt, scope out.`;

function buildSystemPrompt(isAdmin: boolean): string {
  if (!isAdmin) return SCOPE_SYSTEM_PROMPT;
  return SCOPE_SYSTEM_PROMPT + `\n\nYou are speaking with an ADMIN. You may answer detailed deployment and infrastructure questions using the information below.${DEPLOYMENT_CONTEXT}\nADMIN RULES:\n- You may share specific env var names (never their values), Railway/Vercel commands, migration steps, and troubleshooting guides.\n- If asked about credentials or secret values, say they must be retrieved from the Supabase/Railway/Vercel dashboards directly.\n- Deployment info is confidential — only share it because this user is a verified admin.`;
}

const INITIAL_SUGGESTIONS = FAQ_ENTRIES.slice(0, 4).map((e) => e.question);

/** Pick 4 context-relevant follow-up questions based on what the assistant just said */
function getFollowUpSuggestions(lastReply: string): string[] {
  const lower = lastReply.toLowerCase();
  // Score each FAQ entry by how many keywords from the reply it matches
  const scored = FAQ_ENTRIES.map((e) => {
    const words = e.question.toLowerCase().split(/\s+/);
    const score = words.filter((w) => w.length > 4 && lower.includes(w)).length;
    return { question: e.question, score };
  });
  const ranked = scored.sort((a, b) => b.score - a.score);
  // Return top 4 that aren't the exact text of the last reply
  const top = ranked
    .filter((e) => e.score > 0)
    .slice(0, 4)
    .map((e) => e.question);
  // Pad with default suggestions if not enough matches
  if (top.length < 4) {
    for (const s of INITIAL_SUGGESTIONS) {
      if (!top.includes(s)) top.push(s);
      if (top.length === 4) break;
    }
  }
  return top;
}

interface ChatWidgetProps {
  isAdmin?: boolean;
}

export default function ChatWidget({ isAdmin = false }: ChatWidgetProps) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      text: isAdmin
        ? "Hi Admin! I can answer questions about this app including detailed deployment, infrastructure, troubleshooting, and environment variable setup. What would you like to know?"
        : "Hi! I can answer questions about this app — its purpose, phases, SDLC stages, agents, pipeline execution, and where to set API keys. What would you like to know?",
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, open]);

  async function handleSend(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    const userMsg: ChatMessage = { id: `u-${Date.now()}`, role: 'user', text: trimmed };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');

    const faqHit = matchFaq(trimmed);
    if (faqHit) {
      setMessages((prev) => [...prev, { id: `a-${Date.now()}`, role: 'assistant', text: faqHit.answer }]);
      return;
    }

    setLoading(true);
    try {
      const resp = await api.callAgent({
        systemPrompt: buildSystemPrompt(isAdmin),
        userPrompt: trimmed,
      });
      const reply = api.extractText(resp).trim() || OFF_TOPIC_MESSAGE;
      setMessages((prev) => [...prev, { id: `a-${Date.now()}`, role: 'assistant', text: reply }]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          text: "I couldn't reach the AI service to answer that. You can still ask about phases, agents, or where to set API keys — those I can answer directly.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.root}>
      {open && (
        <div className={styles.panel}>
          <div className={styles.header}>
            <span className={styles.title}>Help</span>
            <button className={styles.close} onClick={() => setOpen(false)} aria-label="Close help chat">
              X
            </button>
          </div>

          <div className={styles.messages} ref={scrollRef}>
            {messages.map((m) => (
              <div key={m.id} className={m.role === 'user' ? styles.msgUser : styles.msgAssistant}>
                {m.text}
              </div>
            ))}
            {loading && <div className={styles.msgAssistant}>Thinking...</div>}
          </div>

          {!loading && (() => {
            const lastMsg = messages[messages.length - 1];
            if (!lastMsg || lastMsg.role !== 'assistant') return null;
            const suggestions = messages.length <= 1
              ? INITIAL_SUGGESTIONS
              : getFollowUpSuggestions(lastMsg.text);
            return (
              <div className={styles.suggestions}>
                {suggestions.map((s) => (
                  <button key={s} className={styles.suggestionChip} onClick={() => handleSend(s)}>
                    {s}
                  </button>
                ))}
              </div>
            );
          })()}

          <form
            className={styles.inputRow}
            onSubmit={(e) => {
              e.preventDefault();
              handleSend(input);
            }}
          >
            <input
              className={styles.input}
              type="text"
              placeholder="Ask about this app..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={loading}
            />
            <button className={styles.sendBtn} type="submit" disabled={loading || !input.trim()}>
              Send
            </button>
          </form>
        </div>
      )}

      <button
        className={styles.fab}
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? 'Close help chat' : 'Open help chat'}
        title="Help"
      >
        {open ? 'X' : '?'}
      </button>
    </div>
  );
}
