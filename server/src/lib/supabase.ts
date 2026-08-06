import { createClient } from '@supabase/supabase-js';

const isProduction = process.env.NODE_ENV === 'production';
const supabaseUrl = (
  isProduction
    ? process.env.SUPABASE_URL_PRODUCTION
    : process.env.SUPABASE_URL_LOCAL
) ?? process.env.SUPABASE_URL ?? '';
const supabaseServiceKey = (
  isProduction
    ? process.env.SUPABASE_SERVICE_KEY_PRODUCTION
    : process.env.SUPABASE_SERVICE_KEY_LOCAL
) ?? process.env.SUPABASE_SERVICE_KEY ?? '';

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error(
    'Missing Supabase configuration. Set SUPABASE_URL/SUPABASE_SERVICE_KEY ' +
    'or the environment-specific *_LOCAL / *_PRODUCTION variants.'
  );
}

/**
 * Admin client - uses the service role key.
 * Bypasses Row Level Security. Only use on the server, NEVER expose to frontend.
 */
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
