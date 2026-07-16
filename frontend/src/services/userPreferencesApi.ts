/**
 * Copyright 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential - Unauthorized use prohibited.
 */
import { getAuthHeader, getProxyToken } from '@/services/api';

export type DashboardView = 'tiles' | 'table';

function dashboardViewEndpoint(): string {
  const base = String(import.meta.env.VITE_API_URL ?? '/api').replace(/\/$/, '');
  return base === '/api' || base.endsWith('/api')
    ? base + '/user-preferences/dashboard-view'
    : base + '/api/user-preferences/dashboard-view';
}

async function requestDashboardView(init?: RequestInit): Promise<DashboardView> {
  const authHeaders = await getAuthHeader();
  const proxyToken = getProxyToken();
  const response = await fetch(dashboardViewEndpoint(), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
      ...(proxyToken ? { 'X-API-Token': proxyToken } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload && typeof payload.error === 'string'
      ? payload.error
      : 'Could not access dashboard preferences.';
    throw new Error(message);
  }
  if (payload?.dashboardView !== 'tiles' && payload?.dashboardView !== 'table') {
    throw new Error('Dashboard preference response was malformed.');
  }
  return payload.dashboardView;
}

export function getDashboardViewPreference(): Promise<DashboardView> {
  return requestDashboardView();
}

export async function setDashboardViewPreference(dashboardView: DashboardView): Promise<void> {
  await requestDashboardView({ method: 'PUT', body: JSON.stringify({ dashboardView }) });
}
