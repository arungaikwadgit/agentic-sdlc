/**
 * Copyright 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential - Unauthorized use prohibited.
 */
import { getAuthHeader, getProxyToken } from '@/services/api';

export interface ChatEvidenceSummary {
  sourceType: string;
  sourceId: string;
  title: string;
  version?: string | number | null;
  updatedAt?: string | number | null;
  authority: number;
}

export interface ChatTraceEntry {
  stage: string;
  name?: string;
  status: string;
  sourceCount?: number;
  elapsedMs?: number;
  confidence?: number;
}

export interface AgenticChatRequest {
  question: string;
  projectId?: string;
  currentView: 'dashboard' | 'project';
  history: Array<{ role: 'user' | 'assistant'; text: string }>;
}

export interface ChatTokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  modelCalls: number;
  avoidedModelCalls: number;
  providers: string[];
  models: string[];
}

export interface AgenticChatResponse {
  answer: string;
  confidence: number;
  supported: boolean;
  evidence: ChatEvidenceSummary[];
  trace: ChatTraceEntry[];
  followUp: string | null;
  responseMode: 'memory' | 'model';
  tokenUsage: ChatTokenUsage;
}

function chatEndpoint(): string {
  const base = String(import.meta.env.VITE_API_URL ?? '/api').replace(/\/$/, '');
  return base === '/api' || base.endsWith('/api')
    ? base + '/chat/respond'
    : base + '/api/chat/respond';
}

function chatHistoryEndpoint(projectId: string): string {
  const base = String(import.meta.env.VITE_API_URL ?? '/api').replace(/\/$/, '');
  const apiBase = base === '/api' || base.endsWith('/api') ? base : base + '/api';
  return apiBase + '/projects/' + encodeURIComponent(projectId) + '/chat/messages';
}

export interface ChatHistoryMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string | number;
}

/**
 * Private-view hydration: this caller's own persisted chatbot turns for a
 * project (see backend/src/routes/chatHistory.js). Never includes another
 * team member's messages -- the shared-context benefit of everyone's chat
 * history happens server-side, inside /api/chat/respond, not here.
 * Returns [] on any failure (missing project access, DB unavailable, etc.)
 * rather than throwing -- a history-hydration failure should degrade to
 * "start fresh", not block the chat widget from opening at all.
 */
export async function getChatHistory(projectId: string, signal?: AbortSignal): Promise<ChatHistoryMessage[]> {
  try {
    const authHeaders = await getAuthHeader();
    const proxyToken = getProxyToken();
    const response = await fetch(chatHistoryEndpoint(projectId), {
      method: 'GET',
      headers: {
        ...authHeaders,
        ...(proxyToken ? { 'X-API-Token': proxyToken } : {}),
      },
      signal,
    });
    if (!response.ok) return [];
    const payload = await response.json().catch(() => null);
    const messages = payload && Array.isArray(payload.messages) ? payload.messages : [];
    return messages.filter((message: unknown): message is ChatHistoryMessage => {
      const candidate = message as Partial<ChatHistoryMessage>;
      return !!candidate && typeof candidate.id === 'string'
        && (candidate.role === 'user' || candidate.role === 'assistant')
        && typeof candidate.text === 'string';
    });
  } catch {
    return [];
  }
}

function isAgenticChatResponse(value: unknown): value is AgenticChatResponse {
  if (!value || typeof value !== 'object') return false;
  const response = value as Partial<AgenticChatResponse>;
  return typeof response.answer === 'string'
    && typeof response.confidence === 'number'
    && typeof response.supported === 'boolean'
    && Array.isArray(response.evidence)
    && Array.isArray(response.trace)
    && (response.followUp === null || typeof response.followUp === 'string')
    && (response.responseMode === 'memory' || response.responseMode === 'model')
    && !!response.tokenUsage
    && typeof response.tokenUsage.totalTokens === 'number'
    && typeof response.tokenUsage.modelCalls === 'number';
}

export async function askAgenticChat(
  request: AgenticChatRequest,
  signal?: AbortSignal,
): Promise<AgenticChatResponse> {
  const authHeaders = await getAuthHeader();
  const proxyToken = getProxyToken();
  const response = await fetch(chatEndpoint(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
      ...(proxyToken ? { 'X-API-Token': proxyToken } : {}),
    },
    body: JSON.stringify(request),
    signal,
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = payload && typeof payload.error === 'string' ? payload.error : 'Chat request failed.';
    throw new Error(detail);
  }
  if (!isAgenticChatResponse(payload)) throw new Error('Chat response was malformed.');
  return payload;
}
