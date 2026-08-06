-- Copyright 2026 Arun Gaikwad. All rights reserved.
-- User-scoped, cross-session UI preferences. Postgres is the only source of truth.

CREATE TABLE IF NOT EXISTS user_preferences (
    user_key    TEXT PRIMARY KEY,
    preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT user_preferences_object CHECK (jsonb_typeof(preferences) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_user_preferences_updated_at
    ON user_preferences(updated_at DESC);

-- The browser never queries this table directly. Keep it backend-only even
-- though public is exposed through the Supabase Data API.
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE user_preferences FROM anon, authenticated;
