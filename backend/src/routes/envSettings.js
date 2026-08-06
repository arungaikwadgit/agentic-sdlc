// © 2026 Arun Gaikwad. All rights reserved.
// Proprietary and Confidential - Unauthorized use prohibited.
//
// Extracted from backend/src/proxy.js (2026-07-19, architecture upgrade
// Phase 3 — see docs/architecture/architecture-upgrade-execution-plan.md).
// The Settings group: GET/POST /api/settings, which read/write
// backend/.env directly on disk. Fully self-contained -- unlike most of
// this phase, this route group touches ONLY the raw .env FILE via fs/path
// (never proxy.js's own live module-scope OPENAI_API_KEY/MODEL_CATALOG/etc.
// variables), so there is no shared in-memory state to worry about moving
// correctly. Confirmed via grep before extracting: rejectsEnvInjection has
// no callers outside this block.
//
// Extraction discipline (plan Section 0.1): every function body below is a
// byte-for-byte verbatim copy from proxy.js.

function createEnvSettingsRouter({ checkToken, requireAdmin }) {
  const { Router } = require('express');
  const router = Router();

  // ── Settings (read backend .env) ─────────────────────────────────────────────
  router.get('/', checkToken, requireAdmin, (req, res) => {
    const fs   = require('fs');
    const path = require('path');
    const envPath = path.resolve(__dirname, '../../.env');

    try {
      const lines = fs.existsSync(envPath)
        ? fs.readFileSync(envPath, 'utf8').split('\n')
        : [];

      function readKey(key) {
        const line = lines.find((l) => l.startsWith(key + '='));
        return line ? line.slice(key.length + 1).trim() : '';
      }

      const openaiApiKey     = readKey('OPENAI_API_KEY');
      const openaiModel      = readKey('OPENAI_MODEL');
      const proxyToken       = readKey('PROXY_TOKEN');
      const anthropicApiKey  = readKey('ANTHROPIC_API_KEY');
      const anthropicModel   = readKey('ANTHROPIC_MODEL');
      const anthropicEnabled = readKey('ANTHROPIC_ENABLED');
      const defaultLlmProvider = readKey('DEFAULT_LLM_PROVIDER');
      const agentProviderMapRaw = readKey('AGENT_PROVIDER_MAP');
      const huggingfaceApiKey = readKey('HUGGINGFACE_API_KEY');
      const modelCatalogRaw  = readKey('MODEL_CATALOG');
      const gmailUser        = readKey('GMAIL_USER');
      const gmailAppPassword = readKey('GMAIL_APP_PASSWORD');
      const appUrl           = readKey('APP_URL');

      let agentProviderMap = {};
      try { agentProviderMap = agentProviderMapRaw ? JSON.parse(agentProviderMapRaw) : {}; } catch (_) {}

      let modelCatalog = [];
      try { modelCatalog = modelCatalogRaw ? JSON.parse(modelCatalogRaw) : []; } catch (_) {}

      return res.json({
        openaiApiKey:      openaiApiKey  ? '***' : '',          // never expose raw keys
        anthropicApiKey:   anthropicApiKey ? '***' : '',
        huggingfaceApiKey: huggingfaceApiKey ? '***' : '',
        proxyToken:        proxyToken    ? '***' : '',
        openaiModel:       openaiModel   || 'gpt-4o',
        anthropicModel:    anthropicModel || 'claude-opus-4-5',
        anthropicEnabled:  anthropicEnabled === 'true',
        defaultLlmProvider: defaultLlmProvider || 'openai',
        agentProviderMap,
        modelCatalog,
        hasOpenaiKey:      !!openaiApiKey,
        hasAnthropicKey:   !!anthropicApiKey,
        hasHuggingfaceKey: !!huggingfaceApiKey,
        hasProxyToken:     !!proxyToken,
        hasGmailAppPassword: !!gmailAppPassword,               // never expose raw app password
        gmailUser,
        appUrl,
      });
    } catch (err) {
      console.error('Settings read error:', err.message);
      return res.status(500).json({ error: 'Failed to read settings: ' + err.message });
    }
  });

  // ── Settings (write backend .env) ─────────────────────────────────────────────
  // Values are written verbatim into a `KEY=value` line in backend/.env. Without
  // validation, a value containing a newline lets the caller inject arbitrary
  // extra lines into the file (e.g. a second KEY=VALUE pair, or content that
  // comments out an existing line) — a CRLF/env-injection vector. Reject any
  // field containing \r or \n before writing anything, and lock down the file's
  // permissions afterward since it holds plaintext API keys.
  function rejectsEnvInjection(value) {
    return typeof value === 'string' && /[\r\n]/.test(value);
  }

  router.post('/', checkToken, requireAdmin, (req, res) => {
    const {
      openaiApiKey, proxyToken, openaiModel,
      anthropicApiKey, anthropicModel, anthropicEnabled,
      defaultLlmProvider, agentProviderMap,
      huggingfaceApiKey, modelCatalog,
      gmailUser, gmailAppPassword, appUrl,
    } = req.body ?? {};
    const fs   = require('fs');
    const path = require('path');
    const envPath = path.resolve(__dirname, '../../.env');

    const stringFields = {
      openaiApiKey, proxyToken, openaiModel,
      anthropicApiKey, anthropicModel, huggingfaceApiKey,
      defaultLlmProvider, gmailUser, gmailAppPassword, appUrl,
    };
    for (const [field, value] of Object.entries(stringFields)) {
      if (rejectsEnvInjection(value)) {
        return res.status(400).json({ error: `${field} cannot contain newline characters` });
      }
    }
    if (agentProviderMap !== undefined && rejectsEnvInjection(JSON.stringify(agentProviderMap))) {
      return res.status(400).json({ error: 'agentProviderMap cannot contain newline characters' });
    }
    if (modelCatalog !== undefined && rejectsEnvInjection(JSON.stringify(modelCatalog))) {
      return res.status(400).json({ error: 'modelCatalog cannot contain newline characters' });
    }

    try {
      let lines = [];
      if (fs.existsSync(envPath)) {
        lines = fs.readFileSync(envPath, 'utf8').split('\n');
      }

      function upsert(arr, key, value) {
        if (value === undefined || value === null || value === '') return arr;
        const idx = arr.findIndex((l) => l.startsWith(key + '='));
        const line = key + '=' + value;
        if (idx >= 0) arr[idx] = line;
        else arr.push(line);
        return arr;
      }

      // upsertFlag writes even when value is false/empty string — used for
      // booleans and fields that need an explicit "off"/cleared state.
      function upsertFlag(arr, key, value) {
        const idx = arr.findIndex((l) => l.startsWith(key + '='));
        const line = key + '=' + value;
        if (idx >= 0) arr[idx] = line;
        else arr.push(line);
        return arr;
      }

      if (openaiApiKey) upsert(lines, 'OPENAI_API_KEY', openaiApiKey);
      if (proxyToken)   upsert(lines, 'PROXY_TOKEN', proxyToken);
      if (openaiModel)  upsert(lines, 'OPENAI_MODEL', openaiModel);

      if (anthropicApiKey)            upsert(lines, 'ANTHROPIC_API_KEY', anthropicApiKey);
      if (anthropicModel)             upsert(lines, 'ANTHROPIC_MODEL', anthropicModel);
      if (anthropicEnabled !== undefined) upsertFlag(lines, 'ANTHROPIC_ENABLED', anthropicEnabled ? 'true' : 'false');
      if (defaultLlmProvider)         upsert(lines, 'DEFAULT_LLM_PROVIDER', defaultLlmProvider);
      if (agentProviderMap)           upsertFlag(lines, 'AGENT_PROVIDER_MAP', JSON.stringify(agentProviderMap));
      if (huggingfaceApiKey)          upsert(lines, 'HUGGINGFACE_API_KEY', huggingfaceApiKey);
      if (modelCatalog)               upsertFlag(lines, 'MODEL_CATALOG', JSON.stringify(modelCatalog));

      // Email / invite settings
      // Google's UI displays the app password as space-separated groups; strip
      // whitespace on save so a direct copy-paste of that format still works
      // (SMTP auth fails on the literal spaces otherwise — 535-5.7.8 BadCredentials).
      if (gmailUser)         upsert(lines, 'GMAIL_USER', gmailUser.trim());
      if (gmailAppPassword)  upsert(lines, 'GMAIL_APP_PASSWORD', gmailAppPassword.replace(/\s+/g, ''));
      if (appUrl)            upsert(lines, 'APP_URL', appUrl);

      fs.writeFileSync(envPath, lines.filter((l) => l.trim()).join('\n') + '\n', 'utf8');
      // Lock the file to owner read/write only — it holds plaintext API keys.
      // Best-effort: chmod isn't meaningful on all platforms (e.g. Windows),
      // so failures here shouldn't block the save.
      try { fs.chmodSync(envPath, 0o600); } catch { /* not supported on this platform/fs */ }
      return res.json({ ok: true, message: 'Settings saved. Restart the backend for changes to take effect.' });
    } catch (err) {
      console.error('Settings write error:', err.message);
      return res.status(500).json({ error: 'Failed to write settings: ' + err.message });
    }
  });

  return router;
}

module.exports = { createEnvSettingsRouter };
