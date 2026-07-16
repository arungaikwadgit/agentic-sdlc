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

export interface AgenticChatResponse {
  answer: string;
  confidence: number;
  supported: boolean;
  evidence: ChatEvidenceSummary[];
  trace: ChatTraceEntry[];
  followUp: string | null;
}

function chatEndpoint(): string {
  const base = String(import.meta.env.VITE_API_URL ?? '/api').replace(/\/$/, '');
  return base === '/api' || base.endsWith('/api')
    ? base + '/chat/respond'
    : base + '/api/chat/respond';
}

function isAgenticChatResponse(value: unknown): value is AgenticChatResponse {
  if (!value || typeof value !== 'object') return false;
  const response = value as Partial<AgenticChatResponse>;
  return typeof response.answer === 'string'
    && typeof response.confidence === 'number'
    && typeof response.supported === 'boolean'
    && Array.isArray(response.evidence)
    && Array.isArray(response.trace)
    && (response.followUp === null || typeof response.followUp === 'string');
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
