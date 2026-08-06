/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */

/**
 * Supabase browser client — uses the anon (public) key.
 * Only use this for auth and reading public data — all DB writes go through
 * the Express backend which uses the service_role key.
 *
 * Realtime is disabled: we only use auth, not live subscriptions.
 * This removes the WebSocket connection attempt and reduces bundle size.
 */
import { createClient } from '@supabase/supabase-js';

const supabaseUrl  = (import.meta.env.VITE_SUPABASE_URL  as string | undefined) ?? '';
const supabaseAnon = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? '';

/** True when both required env vars are present. */
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnon);

export const supabase = createClient(
  supabaseUrl  || 'https://placeholder.supabase.co',
  supabaseAnon || 'placeholder-anon-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
    realtime: {
      // Disable realtime — we don't use live subscriptions.
      // Prevents an unnecessary WebSocket connection on startup.
      params: { eventsPerSecond: 0 },
    },
    global: {
      // Ensure fetch is used (not XHR) so Vite proxy headers work correctly.
      fetch: fetch.bind(globalThis),
    },
  }
);

/** Returns the current session's JWT (for Authorization: Bearer headers). */
export async function getAuthToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
