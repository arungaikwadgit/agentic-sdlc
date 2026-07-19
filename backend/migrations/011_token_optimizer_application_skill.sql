-- Copyright (c) 2026 Arun Gaikwad. All rights reserved.
-- Application-level Token Optimizer preflight skill shared by every project.

CREATE TABLE IF NOT EXISTS app_config (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT 'null'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO app_config (key, value, updated_at)
VALUES (
  'app:tokenOptimizationSkill',
  '{
    "id": "token-optimizer-preflight",
    "name": "Token Optimizer Preflight Skill",
    "version": 1,
    "enabled": true,
    "strategy": "conservative-deterministic",
    "description": "Reduces avoidable prompt tokens before every LLM call without weakening intent, controls, evidence, or output requirements.",
    "rules": {
      "normalizeLineEndings": true,
      "trimTrailingWhitespace": true,
      "collapseBlankLines": true,
      "deduplicateExactProseBlocks": true,
      "minimumDuplicateCharacters": 120
    },
    "protectedTerms": [
      "must", "never", "required", "mandatory", "approval", "security",
      "privacy", "governance", "legal", "audit", "acceptance", "requirement",
      "step", "output"
    ]
  }'::jsonb,
  NOW()
)
ON CONFLICT (key) DO NOTHING;
