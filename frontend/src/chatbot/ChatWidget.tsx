/**
 * Copyright 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential - Unauthorized use prohibited.
 */
import { useEffect, useRef, useState } from 'react';
import { askAgenticChat, getChatHistory, type AgenticChatResponse } from './chatApi';
import { matchFaq } from './faq';
import styles from './ChatWidget.module.css';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  result?: AgenticChatResponse;
}

interface ChatWidgetProps {
  isAdmin?: boolean;
  projectId?: string;
  currentView: 'dashboard' | 'project';
}

const MAX_HISTORY_TURNS = 8;
const INITIAL_SUGGESTIONS = [
  'How does the SDLC Orchestrator plan the pipeline?',
  'Which agents run in each phase?',
  'How do review gates work?',
  'What is the current project status?',
];

function initialAssistantMessage(isAdmin: boolean, currentView: 'dashboard' | 'project'): string {
  if (currentView === 'project') {
    return 'Hi. I can inspect this project\'s authorized context, agent runs, outputs, gates, and approved memory in real time. What would you like to know?';
  }
  return isAdmin
    ? 'Hi Admin. I can inspect the live agent catalog and help you navigate Agentic SDLC. Open a project for project-specific runtime evidence.'
    : 'Hi. I can help with the live Agentic SDLC agent catalog and application workflow. Open a project for project-specific status and outputs.';
}

function getFollowUpSuggestions(lastReply: string): string[] {
  const lower = lastReply.toLowerCase();
  const dynamic: string[] = [];
  if (lower.includes('gate') || lower.includes('approve')) dynamic.push('What blocks the next review gate?');
  if (lower.includes('agent') || lower.includes('phase')) dynamic.push('Show the current phase and agent sequence.');
  if (lower.includes('evidence') || lower.includes('missing')) dynamic.push('Which evidence is still missing?');
  if (lower.includes('runtime') || lower.includes('failed')) dynamic.push('Which agent failed most recently?');
  for (const fallback of INITIAL_SUGGESTIONS) {
    if (!dynamic.includes(fallback)) dynamic.push(fallback);
    if (dynamic.length >= 4) break;
  }
  return dynamic.slice(0, 4);
}

function fallbackReply(question: string): string {
  const faqHit = matchFaq(question);
  if (faqHit) {
    return faqHit.answer + '\n\nNote: I answered from the local help fallback because the real-time agentic service was unavailable.';
  }
  return 'I could not reach the real-time agentic service, so I cannot provide a verified answer. Confirm the backend proxy, sign-in session, and model provider are reachable, then try again.';
}

function formatSourceDate(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString();
}

function AgenticResult({ result }: { result: AgenticChatResponse }) {
  return (
    <div className={styles.resultMeta}>
      <div className={styles.metaRow}>
        <div className={result.supported ? styles.confidenceSupported : styles.confidenceIncomplete}>
          {result.supported
            ? '✓ ' + result.confidence + '% evidence confidence'
            : '⚠ Evidence incomplete (' + result.confidence + '%)'}
        </div>
        <div
          className={result.responseMode === 'memory' ? styles.memoryUsage : styles.tokenUsage}
          title={result.responseMode === 'memory'
            ? 'Answered from approved project memory without calling an LLM.'
            : result.tokenUsage.promptTokens + ' input + ' + result.tokenUsage.completionTokens + ' output tokens'}
        >
          {result.responseMode === 'memory'
            ? '\u{1F9E0} Memory answer - 0 LLM tokens - ' + result.tokenUsage.avoidedModelCalls + ' model calls avoided'
            : '⚡ ' + result.tokenUsage.totalTokens.toLocaleString() + ' tokens - ' + result.tokenUsage.modelCalls + ' model ' + (result.tokenUsage.modelCalls === 1 ? 'call' : 'calls')}
        </div>
      </div>
      {result.followUp && <div className={styles.followUp}>{result.followUp}</div>}
      {result.evidence.length > 0 && (
        <details className={styles.evidenceDetails}>
          <summary>View {result.evidence.length} {result.evidence.length === 1 ? 'source' : 'sources'}</summary>
          <ul className={styles.evidenceList}>
            {result.evidence.map((item, index) => {
              const freshness = formatSourceDate(item.updatedAt);
              return (
                <li key={item.sourceType + ':' + item.sourceId + ':' + index}>
                  <strong>{item.title}</strong>
                  <span>{item.sourceType + ' / ' + item.sourceId}</span>
                  {item.version !== null && item.version !== undefined && <span>Version {item.version}</span>}
                  {freshness && <span>Updated {freshness}</span>}
                </li>
              );
            })}
          </ul>
        </details>
      )}
      {result.trace.length > 0 && (
        <details className={styles.traceDetails}>
          <summary>Execution trace</summary>
          <ul className={styles.traceList}>
            {result.trace.map((entry, index) => (
              <li key={entry.stage + ':' + (entry.name ?? '') + ':' + index}>
                {[entry.stage, entry.name, entry.status].filter(Boolean).join(' - ')}
                {typeof entry.sourceCount === 'number' ? ' (' + entry.sourceCount + ' sources)' : ''}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export default function ChatWidget({ isAdmin = false, projectId, currentView }: ChatWidgetProps) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([{
    id: 'welcome',
    role: 'assistant',
    text: initialAssistantMessage(isAdmin, currentView),
  }]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef<AbortController | null>(null);

  useEffect(() => () => requestRef.current?.abort(), []);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    if (typeof node.scrollTo === 'function') node.scrollTo({ top: node.scrollHeight, behavior: 'smooth' });
    else node.scrollTop = node.scrollHeight;
  }, [messages, open]);

  // Private-view history hydration (2026-07-20): when a project is open,
  // load THIS user's own persisted chat turns for it (see chatApi.ts's
  // getChatHistory) instead of always starting from a blank welcome
  // message -- the conversation now survives a refresh/new tab/new device.
  // Only this caller's own rows ever come back here; the shared-context
  // benefit of the whole team's history happens server-side inside
  // /api/chat/respond, never as raw transcripts sent to the client. Falls
  // back to the plain welcome message on dashboard view, when no project is
  // open, or when history is empty/unavailable -- same as before this
  // feature existed.
  useEffect(() => {
    requestRef.current?.abort();
    const controller = new AbortController();
    let cancelled = false;

    if (currentView === 'project' && projectId) {
      getChatHistory(projectId, controller.signal).then((history) => {
        if (cancelled) return;
        setMessages(
          history.length > 0
            ? history.map((entry) => ({ id: entry.id, role: entry.role, text: entry.text }))
            : [{ id: 'welcome', role: 'assistant', text: initialAssistantMessage(isAdmin, currentView) }],
        );
      });
    } else {
      setMessages([{ id: 'welcome', role: 'assistant', text: initialAssistantMessage(isAdmin, currentView) }]);
    }

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [currentView, isAdmin, projectId]);

  async function handleSend(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    const userMessage: ChatMessage = { id: 'u-' + Date.now(), role: 'user', text: trimmed };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInput('');
    setLoading(true);

    const controller = new AbortController();
    requestRef.current?.abort();
    requestRef.current = controller;
    const timeoutId = window.setTimeout(() => controller.abort(), 90_000);
    try {
      const result = await askAgenticChat({
        question: trimmed,
        projectId: currentView === 'project' ? projectId : undefined,
        currentView,
        history: nextMessages
          .filter((message) => message.id !== 'welcome')
          .slice(-MAX_HISTORY_TURNS)
          .map(({ role, text: historyText }) => ({ role, text: historyText })),
      }, controller.signal);
      setMessages((prev) => [...prev, {
        id: 'a-' + Date.now(),
        role: 'assistant',
        text: result.answer,
        result,
      }]);
    } catch (error) {
      if (controller.signal.aborted && requestRef.current !== controller) return;
      setMessages((prev) => [...prev, {
        id: 'a-' + Date.now(),
        role: 'assistant',
        text: fallbackReply(trimmed),
      }]);
    } finally {
      window.clearTimeout(timeoutId);
      if (requestRef.current === controller) requestRef.current = null;
      setLoading(false);
    }
  }

  const lastMessage = messages[messages.length - 1];
  const suggestions = lastMessage?.role === 'assistant'
    ? (messages.length <= 1 ? INITIAL_SUGGESTIONS : getFollowUpSuggestions(lastMessage.text))
    : [];

  return (
    <div className={styles.root}>
      {open && (
        <section className={styles.panel} aria-label="Agentic help chat">
          <div className={styles.header}>
            <span className={styles.title}>Agentic Help</span>
            <button className={styles.close} onClick={() => setOpen(false)} aria-label="Close help chat">X</button>
          </div>

          <div className={styles.messages} ref={scrollRef} aria-live="polite">
            {messages.map((message) => (
              <div key={message.id} className={message.role === 'user' ? styles.msgUser : styles.msgAssistant}>
                <div>{message.text}</div>
                {message.result && <AgenticResult result={message.result} />}
              </div>
            ))}
            {loading && <div className={styles.msgAssistant}>Planning and gathering authorized evidence...</div>}
          </div>

          {!loading && suggestions.length > 0 && (
            <div className={styles.suggestions}>
              {suggestions.map((suggestion) => (
                <button key={suggestion} className={styles.suggestionChip} onClick={() => handleSend(suggestion)}>
                  {suggestion}
                </button>
              ))}
            </div>
          )}

          <form className={styles.inputRow} onSubmit={(event) => { event.preventDefault(); void handleSend(input); }}>
            <input
              className={styles.input}
              type="text"
              placeholder="Ask about this app..."
              value={input}
              onChange={(event) => setInput(event.target.value)}
              disabled={loading}
              maxLength={4000}
            />
            <button className={styles.sendBtn} type="submit" disabled={loading || !input.trim()}>Send</button>
          </form>
        </section>
      )}

      <button
        className={styles.fab}
        onClick={() => setOpen((value) => !value)}
        aria-label={open ? 'Close help chat' : 'Open help chat'}
        title="Agentic Help"
      >
        {open ? 'X' : '?'}
      </button>
    </div>
  );
}
