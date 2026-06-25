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

const SCOPE_SYSTEM_PROMPT = `You are the in-app Help Assistant for an "Agentic SDLC" web application. Your ONLY job is to help users understand and use THIS application.

Topics you may answer:
- What the application is and what it's for
- How to use it (creating projects, navigating the workspace, running agents)
- The 11 phases and their standard SDLC stage mapping
- The 30 agents, what each produces, dependencies, and how the pipeline executes (sequential vs parallel phases, L2 vs L3 agent modes, review gates, locked phases)
- Re-running agents, editing/enhancing prompts, the 3-level prompt precedence system (L1 project override > L2 app default > L3 hardcoded)
- The Spec/Preview/Diagrams tabs — including the commercial-grade UX Mockup Preview and interactive Mermaid Diagram Viewer
- Export formats: .md, .docx, .pdf, .sql (data model), .zip (all artifacts), .svg (diagrams)
- Where and how to configure API keys and providers (App Settings → API & Model tab)
- Team invites, roles (Owner/Editor/Reviewer/Viewer), and invite magic links
- Deployment (admin/project-owner topics): Railway backend deployment, Vercel frontend deployment, environment variables, database migrations, Supabase auth setup, email invites via Resend, troubleshooting

Reference facts about the app:
- 11 phases total, 30 agents. Phase 0 Orchestration (sdlcOrchestrator) -> Initiation; Phase 1 PRD (manager) -> Initiation; Phase 1B Foundation (projectCharter, brd) -> Initiation; Phase 2 Requirements (stakeholder, userStory, businessRules, feasibility, dataModel) -> Requirements; Phase 3 Design (architecture, apiDesign, uxResearch, interaction, uxMockups) -> Design; Phase 3B Security Review (securityCompliance) -> Design Security Gate; Phase 4 Dev Planning (sprintPlanner, taskBreakdown, techDebt, codeStructure, codeSnippets, uiComponentLibrary, codeReviewStandards, roadmapPlanner) -> Development Planning; Phase 5 Testing (testPlan, testCases) -> Testing; Phase 6 Prototype (workingPrototype) -> Prototype; Phase 7 DevOps (devopsEngineer, infraEngineer) -> Deployment; Phase 8 Operations (observabilityEngineer, onCallEngineer) -> Operations.
- Phases 2, 3, 4, 7, 8 run agents in parallel (max 5 concurrent, 1.5s stagger); others run sequentially. Review gates sit after Phase 1/1B, Phase 2, Phase 3/3B, and Phase 5 — a locked phase (lock icon) means its gate isn't approved yet. Approver must provide a written verification note.
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

export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      text: "Hi! I can answer questions about this app — its purpose, phases, SDLC stages, agents, pipeline execution, and where to set API keys. What would you like to know?",
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

    // FAQ-first: try a local keyword match before calling the LLM.
    const faqHit = matchFaq(trimmed);
    if (faqHit) {
      setMessages((prev) => [...prev, { id: `a-${Date.now()}`, role: 'assistant', text: faqHit.answer }]);
      return;
    }

    // LLM fallback, scoped to app-only topics.
    setLoading(true);
    try {
      const resp = await api.callAgent({
        systemPrompt: SCOPE_SYSTEM_PROMPT,
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
              ✕
            </button>
          </div>

          <div className={styles.messages} ref={scrollRef}>
            {messages.map((m) => (
              <div key={m.id} className={m.role === 'user' ? styles.msgUser : styles.msgAssistant}>
                {m.text}
              </div>
            ))}
            {loading && <div className={styles.msgAssistant}>Thinking…</div>}
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
              placeholder="Ask about this app…"
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
        {open ? '✕' : '?'}
      </button>
    </div>
  );
}
