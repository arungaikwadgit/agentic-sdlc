/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential - Unauthorized use prohibited.
 */
import { useState, useRef, useEffect } from 'react';
import { api } from '@/services/api';
import { AGENT_DEFINITIONS } from '@/agents/definitions';
import { PHASE_AGENTS, PHASE_LABELS, PHASE_ORDER, PHASE_SDLC_STAGE, REVIEW_GATES, TOTAL_AGENTS } from '@/agents/constants';
import { DOMAINS } from '@/agents/domains';
import { ROLE_TEMPLATES } from '@/data/roleTemplates';
import { matchFaq, OFF_TOPIC_MESSAGE, FAQ_ENTRIES } from './faq';
import styles from './ChatWidget.module.css';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
}

const MAX_CONTEXT_CHARS = 12_000;
const MAX_HISTORY_TURNS = 8;

const CHAT_SYSTEM_PROMPT = `You are the in-app Help Assistant for the Agentic SDLC application.

You must produce agentic, context-grounded answers:
1. Identify what the user is asking about.
2. Use the supplied live application context first: current phase map, agent catalog, roles, domains, architecture, deployment model, and recent chat.
3. If the context is missing something, say what is unknown and give the safest next step. Do not invent menu paths, credentials, URLs, or feature behavior.
4. Keep answers concise and practical. Use numbered steps for how-to or troubleshooting questions.
5. Stay scoped to this application. If a request is unrelated to Agentic SDLC, answer exactly with the off-topic message.

The assistant is not a static FAQ bot. Do not simply repeat canned text. Synthesize the answer from the current context and the user's question.

Security rules:
- Never reveal secret values, API keys, service-role keys, database passwords, tokens, or invite tokens.
- You may mention environment variable names and where they are configured.
- Deployment/admin details may be explained only when the runtime says the current user is an admin.
- If asked for credentials or secret values, tell the user to retrieve them from the relevant platform dashboard.`;

function compact(value: string, max = 900): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean.length > max ? clean.slice(0, max) + '...' : clean;
}

function buildPhaseSummary(): string {
  return PHASE_ORDER.map((phaseId) => {
    const agents = PHASE_AGENTS[phaseId] ?? [];
    const names = agents.map((agentId) => AGENT_DEFINITIONS[agentId]?.name ?? agentId).join(', ');
    return [
      PHASE_LABELS[phaseId] ?? phaseId,
      'SDLC stage: ' + (PHASE_SDLC_STAGE[phaseId] ?? 'Unknown'),
      'Agents: ' + (names || 'None'),
    ].join(' | ');
  }).join('\n');
}

function buildAgentSummary(): string {
  return Object.values(AGENT_DEFINITIONS)
    .map((agent) => {
      const dependsOn = agent.dependsOn?.length
        ? agent.dependsOn.map((id) => AGENT_DEFINITIONS[id]?.name ?? id).join(', ')
        : 'None';
      const maxIterations = agent.maxIterations ? String(agent.maxIterations) : 'default';
      return [
        agent.name + ' (' + agent.id + ')',
        'phase=' + agent.phase,
        'output=' + agent.outputLabel,
        'dependsOn=' + dependsOn,
        'maxIterations=' + maxIterations,
      ].join(' | ');
    })
    .join('\n');
}

function buildGateSummary(): string {
  return Object.entries(REVIEW_GATES)
    .map(([gateId, phases]) => gateId + ': ' + (phases.length ? phases.map((p) => PHASE_LABELS[p] ?? p).join(', ') : 'retained/no active phase lock'))
    .join('\n');
}

function buildDomainSummary(): string {
  return Object.values(DOMAINS)
    .map((domain) => domain.label + ' (' + domain.id + '): ' + compact(domain.context, 220))
    .join('\n');
}

function buildRoleSummary(): string {
  return ROLE_TEMPLATES
    .map((role) => role.title + ' (' + role.id + '): ' + compact(role.description, 180) + ' | suggested agents: ' + role.suggestedAgents.join(', '))
    .join('\n');
}

function buildArchitectureSummary(isAdmin: boolean): string {
  const adminLine = isAdmin
    ? 'Current user is an app admin: deployment architecture, env var names, and troubleshooting steps may be discussed without secret values.'
    : 'Current user is not an app admin: keep deployment answers high-level and do not provide sensitive operations detail.';

  return [
    'Application: Agentic SDLC - an API-mediated, Postgres-backed, multi-agent SDLC delivery platform.',
    'Frontend: React + Vite SPA on Vercel. Browser is a thin client for project/app/runtime data.',
    'Backend/API pattern: frontend calls backend APIs; project CRUD, app-state, catalog, invites, and LLM calls are backend-mediated.',
    'Proxy/API gateway: Railway proxy handles LLM calls, app-state APIs, master catalog API, invite/session APIs, CORS, rate limiting, and selected forwarding.',
    'Project/Admin API: Railway server service handles authenticated project CRUD, app-admin checks, project permissions, and canonical team member access.',
    'Runtime API: Railway runtime handles agent runs, jobs, memory records, action proposals, rollback logs, /health, and /ready.',
    'Database/Auth: Supabase Auth plus Supabase Postgres. Postgres is the source of truth for project, membership, runtime, app-state, integration, backlog, invite, and master catalog data.',
    'LLM providers: OpenAI default; Claude optional through backend config/provider routing. Secrets are backend-only.',
    'Review gates: Gate 0 pauses after SDLC Orchestrator if the plan is rejected; later gates pause requirements, design/security, and testing phases until approved.',
    'Latest docs: architecture docs include a combined platform + L3 agent-flow diagram and per-agent input/planning/output appendix diagrams.',
    adminLine,
  ].join('\n');
}

function buildLiveAppContext(isAdmin: boolean): string {
  const sections = [
    '## Current Architecture\n' + buildArchitectureSummary(isAdmin),
    '## Current Phase Map\n' + buildPhaseSummary(),
    '## Current Review Gates\n' + buildGateSummary(),
    '## Current Agent Catalog\n' + buildAgentSummary(),
    '## Current Domain Catalog\n' + buildDomainSummary(),
    '## Current Role Templates\n' + buildRoleSummary(),
    '## Current Totals\n' + TOTAL_AGENTS + ' agents across ' + PHASE_ORDER.length + ' execution phases.',
  ];

  const joined = sections.join('\n\n');
  return joined.length > MAX_CONTEXT_CHARS
    ? joined.slice(0, MAX_CONTEXT_CHARS) + '\n...[live app context truncated]'
    : joined;
}

function buildUserPrompt(question: string, history: ChatMessage[], isAdmin: boolean): string {
  const recentHistory = history
    .slice(-MAX_HISTORY_TURNS)
    .map((message) => message.role.toUpperCase() + ': ' + message.text)
    .join('\n');

  return [
    '## Live Application Context',
    buildLiveAppContext(isAdmin),
    '',
    '## Recent Chat',
    recentHistory || 'No prior chat in this widget session.',
    '',
    '## User Question',
    question,
    '',
    'Answer from the live application context. If the answer requires missing deployment values or secrets, explain where the user should check, but never invent or expose secret values.',
  ].join('\n');
}

function initialAssistantMessage(isAdmin: boolean): string {
  return isAdmin
    ? 'Hi Admin. I can reason over the current Agentic SDLC architecture, live agent catalog, phases, gates, project flow, deployment topology, and troubleshooting guidance. What would you like to inspect?'
    : 'Hi. I can help with Agentic SDLC: creating projects, understanding phases and agents, running the pipeline, review gates, team roles, outputs, and common setup issues. What would you like to do?';
}

const INITIAL_SUGGESTIONS = [
  'How does the SDLC Orchestrator plan the pipeline?',
  'Which agents run in each phase?',
  'How do review gates work?',
  'Where do API keys and providers get configured?',
];

function getFollowUpSuggestions(lastReply: string): string[] {
  const lower = lastReply.toLowerCase();
  const dynamic: string[] = [];

  if (lower.includes('gate') || lower.includes('approve')) dynamic.push('What happens if Gate 0 is rejected?');
  if (lower.includes('agent') || lower.includes('phase')) dynamic.push('Show me the current phase and agent sequence.');
  if (lower.includes('api') || lower.includes('provider') || lower.includes('key')) dynamic.push('How do I test OpenAI or Claude connectivity?');
  if (lower.includes('invite') || lower.includes('role')) dynamic.push('How does project-scoped invite access work?');
  if (lower.includes('postgres') || lower.includes('database')) dynamic.push('Which data is stored in Postgres?');
  if (lower.includes('prototype') || lower.includes('mockup')) dynamic.push('How do UX Mockups feed the Working Prototype?');

  for (const fallback of INITIAL_SUGGESTIONS) {
    if (!dynamic.includes(fallback)) dynamic.push(fallback);
    if (dynamic.length >= 4) break;
  }
  return dynamic.slice(0, 4);
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
      text: initialAssistantMessage(isAdmin),
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, open]);

  useEffect(() => {
    setMessages((prev) => {
      if (prev.length !== 1 || prev[0]?.id !== 'welcome') return prev;
      return [{ id: 'welcome', role: 'assistant', text: initialAssistantMessage(isAdmin) }];
    });
  }, [isAdmin]);

  async function getAgenticReply(question: string, currentMessages: ChatMessage[]): Promise<string> {
    const resp = await api.callAgent({
      systemPrompt: CHAT_SYSTEM_PROMPT + '\n\nOff-topic message: ' + OFF_TOPIC_MESSAGE,
      userPrompt: buildUserPrompt(question, currentMessages, isAdmin),
      agentId: 'helpAssistant',
      signal: AbortSignal.timeout(90_000),
    });
    return api.extractText(resp).trim();
  }

  function getFallbackReply(question: string): string {
    const faqHit = matchFaq(question);
    if (faqHit) {
      return faqHit.answer + '\n\nNote: I answered from the local help fallback because the AI service was unavailable.';
    }
    return "I couldn't reach the AI service, so I cannot produce a context-grounded answer right now. Try again after confirming the backend proxy and model provider are reachable.";
  }

  async function handleSend(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    const userMsg: ChatMessage = { id: 'u-' + Date.now(), role: 'user', text: trimmed };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput('');
    setLoading(true);

    try {
      const reply = await getAgenticReply(trimmed, nextMessages);
      setMessages((prev) => [...prev, { id: 'a-' + Date.now(), role: 'assistant', text: reply || getFallbackReply(trimmed) }]);
    } catch {
      setMessages((prev) => [...prev, { id: 'a-' + Date.now(), role: 'assistant', text: getFallbackReply(trimmed) }]);
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
            {loading && <div className={styles.msgAssistant}>Thinking with current app context...</div>}
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
