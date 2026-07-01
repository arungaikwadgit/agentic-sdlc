/**
 * App-level backend state (Postgres-backed via the proxy).
 *
 * This replaces browser-local state for mutable app settings, integration credentials,
 * and the admin backlog so the browser is no longer the source of truth.
 */
import { getAuthHeader } from '@/services/api';
import type { BacklogItem } from '@/types/adminData.types';
import type { IntegrationCredential } from '@/types/integration.types';

function getApiBase(raw: string | undefined): string {
  const base = (raw ?? '/api').replace(/\/$/, '');
  if (!base || base === '/') return '/api';
  if (base === '/api' || base.endsWith('/api')) return base;
  return `${base}/api`;
}

const API_URL = getApiBase(import.meta.env.VITE_API_URL);

type AppStateTopic = 'config' | 'integrations' | 'backlog';
type AppStateListener = (topic: AppStateTopic) => void;

const listeners = new Set<AppStateListener>();

function emit(topic: AppStateTopic) {
  for (const listener of listeners) listener(topic);
}

export function subscribeAppStateChange(listener: AppStateListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function apiFetch(path: string, init: RequestInit = {}) {
  const headers = {
    ...(await getAuthHeader()),
    ...(init.headers ?? {}),
  };
  const response = await fetch(`${API_URL}${path}`, { ...init, headers });
  const text = await response.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!response.ok) {
    const message = typeof data === 'object' && data
      ? (data.error ?? data.message ?? JSON.stringify(data))
      : String(data ?? response.statusText);
    throw new Error(message);
  }
  return data;
}

export async function listAppConfig(): Promise<Record<string, unknown>> {
  const data = await apiFetch('/app-state/config');
  return (data?.values ?? {}) as Record<string, unknown>;
}

export async function getAppConfigValue<T>(key: string, fallback: T): Promise<T> {
  const data = await apiFetch(`/app-state/config/${encodeURIComponent(key)}`);
  return (data?.value ?? fallback) as T;
}

export async function setAppConfigValue(key: string, value: unknown): Promise<void> {
  await apiFetch(`/app-state/config/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value }),
  });
  emit('config');
}

export async function setAppConfigValues(values: Record<string, unknown>): Promise<void> {
  await apiFetch('/app-state/config/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ values }),
  });
  emit('config');
}

export async function clearAppConfig(): Promise<void> {
  await apiFetch('/app-state/config', { method: 'DELETE' });
  emit('config');
}

export async function listIntegrations(): Promise<IntegrationCredential[]> {
  const data = await apiFetch('/app-state/integrations');
  return (data?.items ?? []) as IntegrationCredential[];
}

export async function getIntegration(id: string): Promise<IntegrationCredential | null> {
  try {
    return await apiFetch(`/app-state/integrations/${encodeURIComponent(id)}`) as IntegrationCredential;
  } catch (error) {
    if (error instanceof Error && /not found/i.test(error.message)) return null;
    throw error;
  }
}

export async function saveIntegration(record: IntegrationCredential): Promise<void> {
  await apiFetch(`/app-state/integrations/${encodeURIComponent(record.id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(record),
  });
  emit('integrations');
}

export async function deleteIntegration(id: string): Promise<void> {
  await apiFetch(`/app-state/integrations/${encodeURIComponent(id)}`, { method: 'DELETE' });
  emit('integrations');
}

export async function listBacklogItems(): Promise<BacklogItem[]> {
  const data = await apiFetch('/app-state/backlog-items');
  return (data?.items ?? []) as BacklogItem[];
}

export async function createBacklogItem(item: BacklogItem): Promise<void> {
  await apiFetch('/app-state/backlog-items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(item),
  });
  emit('backlog');
}

export async function updateBacklogItem(id: string, patch: Partial<BacklogItem>): Promise<void> {
  await apiFetch(`/app-state/backlog-items/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  emit('backlog');
}

export async function deleteBacklogItem(id: string): Promise<void> {
  await apiFetch(`/app-state/backlog-items/${encodeURIComponent(id)}`, { method: 'DELETE' });
  emit('backlog');
}
