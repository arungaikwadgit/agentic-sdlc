// © 2026 Arun Gaikwad. All rights reserved.
// Proprietary and Confidential - Unauthorized use prohibited.
//
// Extracted from backend/src/proxy.js (2026-07-19, architecture upgrade
// Phase 2 — see docs/architecture/architecture-upgrade-execution-plan.md).
// This is the single choke point every agent call in the application goes
// through: resolveDispatchTarget() picks a provider/model, dispatchAgentCall()
// actually calls it (with one automatic fallback to the default OpenAI model
// if the picked target fails).
//
// Extraction discipline (plan Section 0.1): every function body below is a
// byte-for-byte verbatim copy from proxy.js. Do not "clean up while in
// here" — if something looks odd, it was already odd in proxy.js.
//
// Dependency notes (plan Section 2, Step 4 "special care" — closures over
// module-scope state):
//   - OPENAI_API_KEY/OPENAI_MODEL/ANTHROPIC_API_KEY/ANTHROPIC_MODEL/
//     ANTHROPIC_ENABLED/HUGGINGFACE_API_KEY/DEFAULT_LLM_PROVIDER/CORP_PROXY
//     are all proxy.js module-scope `const`s, read from process.env exactly
//     once at startup and never reassigned afterward — verified via grep
//     before writing this file (no `NAME = ` assignment anywhere besides the
//     initial `const NAME = ...`). Safe to pass by value, no getter needed.
//   - AGENT_PROVIDER_MAP/MODEL_CATALOG are proxy.js module-scope `let`s, but
//     the same check confirmed they are ALSO only ever assigned once, at
//     module load (the `let` is only there because of the try/catch JSON.parse
//     pattern, not because anything reassigns them later — proxy.js's own
//     /api/settings admin route only rewrites the .env file for the *next*
//     restart, it does not mutate these live). Safe to pass by value.
//   - loadPromptOptimizationSkill is NOT moved here even though
//     dispatchAgentCall is its only caller, because it shares
//     TOKEN_OPTIMIZATION_SKILL_KEY / promptOptimizationSkillCache with
//     proxy.js's unrelated dbSetAppConfigValue/dbDeleteAllAppConfig (the
//     app-config system) — moving it would split that shared cache across
//     two files. It stays in proxy.js and is passed in as a function.
//   - optimizePromptPair/DEFAULT_PROMPT_OPTIMIZATION_SKILL come from the
//     already-separate backend/src/promptOptimizationSkill.js module, so
//     this file requires that module directly rather than having proxy.js
//     pass it through.
//   - resolveProvider() previously lived in proxy.js, right next to
//     resolveDispatchTarget, but had no call sites anywhere in the repo
//     (confirmed via repo-wide grep) and was never exported. Removed
//     entirely in a later, explicitly labeled dead-code-removal pass — this
//     comment is kept as a pointer for anyone who goes looking for it in
//     git history.

const http = require('http');
const https = require('https');
const tls = require('tls');
const { optimizePromptPair } = require('../promptOptimizationSkill');

function createAgentDispatch({
  OPENAI_API_KEY,
  OPENAI_MODEL,
  ANTHROPIC_API_KEY,
  ANTHROPIC_MODEL,
  ANTHROPIC_ENABLED,
  HUGGINGFACE_API_KEY,
  DEFAULT_LLM_PROVIDER,
  AGENT_PROVIDER_MAP,
  MODEL_CATALOG,
  CORP_PROXY,
  loadPromptOptimizationSkill,
}) {
  // ── HTTPS POST with optional corporate proxy tunnel ───────────────────────────
  function httpsPost(urlStr, headers, body) {
    return new Promise((resolve, reject) => {
      const url     = new URL(urlStr);
      const payload = Buffer.from(body, 'utf8');

      if (CORP_PROXY) {
        // Tunnel through corporate proxy via HTTP CONNECT
        const proxy = new URL(CORP_PROXY);
        const connectReq = http.request({
          host:   proxy.hostname,
          port:   Number(proxy.port) || 80,
          method: 'CONNECT',
          path:   `${url.hostname}:443`,
        });

        connectReq.on('connect', (_res, socket) => {
          const tlsSocket = tls.connect({
            host:               url.hostname,
            socket,
            servername:         url.hostname,
            rejectUnauthorized: false,  // allow corp SSL-inspection certs
          });

          tlsSocket.on('secureConnect', () => {
            const reqLines = [
              `POST ${url.pathname}${url.search} HTTP/1.1`,
              `Host: ${url.hostname}`,
              ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`),
              `Content-Length: ${payload.length}`,
              'Connection: close',
              '',
              '',
            ].join('\r\n');

            tlsSocket.write(reqLines);
            tlsSocket.write(payload);

            let raw = '';
            tlsSocket.on('data', d => { raw += d.toString(); });
            tlsSocket.on('end', () => {
              const sep   = raw.indexOf('\r\n\r\n');
              const head  = sep >= 0 ? raw.slice(0, sep) : raw;
              const rbody = sep >= 0 ? raw.slice(sep + 4) : '';
              const status = parseInt(head.split('\r\n')[0].split(' ')[1], 10);
              resolve({ status, body: rbody });
            });
            tlsSocket.on('error', reject);
          });
          tlsSocket.on('error', reject);
        });

        connectReq.on('error', reject);
        connectReq.end();

      } else {
        // Direct HTTPS
        const req = https.request(
          {
            hostname: url.hostname,
            port:     443,
            path:     url.pathname + url.search,
            method:   'POST',
            headers:  { ...headers, 'Content-Length': payload.length },
          },
          (res) => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => resolve({ status: res.statusCode, body: data }));
          },
        );
        req.on('error', reject);
        req.write(payload);
        req.end();
      }
    });
  }

  // Resolves what to actually call for a request. AGENT_PROVIDER_MAP[agentId]
  // can now hold either a legacy 'openai'/'claude' string (today's only case,
  // unaffected by anything below) or a MODEL_CATALOG entry's `id` (new — an
  // admin-assigned model, e.g. a Hugging Face model routed through the
  // 'openai-compatible' branch). This is the one place that distinction gets
  // resolved, so both /api/agent and /api/agents/call stay in sync instead of
  // duplicating this logic and risking drift between them.
  function resolveDispatchTarget(requestedProvider, agentId) {
    // Priority: explicit per-request override (what the frontend actually
    // sends on every real call, via its DB-backed 'app:agentProviderHints' /
    // 'app:agentModelAssignments' config — see promptDefaults.ts) beats the
    // AGENT_PROVIDER_MAP env var (legacy/backup path, only reached if the
    // frontend sends no override at all) beats DEFAULT_LLM_PROVIDER.
    // requestedProvider can be 'openai', 'claude', or a MODEL_CATALOG entry id
    // (e.g. an admin-assigned Hugging Face model) — any non-empty value here
    // is trusted and classified below, not just the two legacy literals.
    let hint = DEFAULT_LLM_PROVIDER;
    if (agentId && AGENT_PROVIDER_MAP[agentId]) hint = AGENT_PROVIDER_MAP[agentId];
    if (requestedProvider) hint = requestedProvider;

    if (hint === 'openai' || hint === 'claude') {
      const provider = hint === 'claude' && !ANTHROPIC_ENABLED ? 'openai' : hint;
      return { kind: 'legacy', provider };
    }

    const entry = MODEL_CATALOG.find((m) => m.id === hint);
    if (entry && entry.enabled !== false) {
      return { kind: 'catalog', entry };
    }

    // Unknown or disabled catalog id (e.g. an admin disabled it after
    // assigning it to an agent, or MODEL_CATALOG was cleared/never saved) —
    // fall back to the default legacy provider rather than erroring the
    // whole request over a stale routing hint.
    const fallbackProvider = DEFAULT_LLM_PROVIDER === 'claude' && !ANTHROPIC_ENABLED ? 'openai' : DEFAULT_LLM_PROVIDER;
    return { kind: 'legacy', provider: fallbackProvider };
  }

  // Normalize an OpenAI-shaped response into our common shape.
  function fromOpenAiResponse(data) {
    return {
      choices: data.choices,
      usage: data.usage,
    };
  }

  // Normalize an Anthropic Messages API response into the OpenAI-shaped
  // `{ choices: [...], usage: {...} }` contract the frontend already expects.
  function fromAnthropicResponse(data) {
    const text = (data.content || [])
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('');

    const promptTokens     = data.usage?.input_tokens ?? 0;
    const completionTokens = data.usage?.output_tokens ?? 0;

    return {
      choices: [
        {
          message: { role: 'assistant', content: text },
          finish_reason: data.stop_reason ?? 'stop',
        },
      ],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
      },
    };
  }

  // Output-token enforcement (2026-07-17): every call used to hardcode
  // max_tokens: 8192 unconditionally, regardless of whether the response was
  // expected to be a full document or a two-line TOOL_CALL/PLAN_REVISION
  // marker (see l3Runtime.ts, which makes several such short-response calls
  // per agent run before ever writing the real deliverable). Callers may now
  // pass a smaller budget for those intermediate calls; omitting it (every
  // pre-existing caller) preserves today's exact 8192 behavior. Clamped so a
  // bad/missing value can't zero out a call or blow the ceiling back open.
  const DEFAULT_MAX_TOKENS = 8192;
  const MIN_MAX_TOKENS = 256;

  function clampMaxTokens(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return DEFAULT_MAX_TOKENS;
    return Math.min(DEFAULT_MAX_TOKENS, Math.max(MIN_MAX_TOKENS, Math.round(n)));
  }

  async function callOpenAi(systemPrompt, userPrompt, maxTokens) {
    const requestBody = JSON.stringify({
      model:    OPENAI_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt },
      ],
      temperature: 0.4,
      max_tokens:  clampMaxTokens(maxTokens),
    });

    const { status, body } = await httpsPost(
      'https://api.openai.com/v1/chat/completions',
      {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      requestBody,
    );

    if (status < 200 || status >= 300) {
      console.error(`OpenAI ${status}:`, body.slice(0, 300));
      throw Object.assign(new Error(`OpenAI error ${status}: ${body.slice(0, 200)}`), { status });
    }

    let data;
    try {
      data = JSON.parse(body);
    } catch {
      throw Object.assign(new Error('Invalid JSON from OpenAI'), { status: 502, raw: body.slice(0, 200) });
    }

    return fromOpenAiResponse(data);
  }

  async function callClaude(systemPrompt, userPrompt, maxTokens) {
    const requestBody = JSON.stringify({
      model:      ANTHROPIC_MODEL,
      system:     systemPrompt,
      messages:   [{ role: 'user', content: userPrompt }],
      max_tokens: clampMaxTokens(maxTokens),
      temperature: 0.4,
    });

    const { status, body } = await httpsPost(
      'https://api.anthropic.com/v1/messages',
      {
        'Content-Type':      'application/json',
        'x-api-key':         ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      requestBody,
    );

    if (status < 200 || status >= 300) {
      console.error(`Anthropic ${status}:`, body.slice(0, 300));
      throw Object.assign(new Error(`Anthropic error ${status}: ${body.slice(0, 200)}`), { status });
    }

    let data;
    try {
      data = JSON.parse(body);
    } catch {
      throw Object.assign(new Error('Invalid JSON from Anthropic'), { status: 502, raw: body.slice(0, 200) });
    }

    return fromAnthropicResponse(data);
  }

  // Calls a MODEL_CATALOG entry with providerType 'openai-compatible' — a
  // generic branch for any provider exposing an OpenAI-style /chat/completions
  // endpoint (Hugging Face Inference Providers, OpenRouter, Groq, etc.), not a
  // bespoke integration per provider. entry.id is expected to be the model
  // string that provider expects (for Hugging Face specifically, the
  // "<org>/<model>:<provider>" convention — see comment on HUGGINGFACE_BASE_URL
  // above); entry.modelSlug can override this if the catalog id needs to differ
  // from the literal model string sent upstream for some other gateway.
  async function callOpenAiCompatible(entry, systemPrompt, userPrompt, maxTokens) {
    const apiKey = entry.apiKeyEnvVar === 'HUGGINGFACE_API_KEY'
      ? HUGGINGFACE_API_KEY
      : (entry.apiKeyEnvVar ? process.env[entry.apiKeyEnvVar] : '');

    if (!entry.endpointUrl || !apiKey) {
      throw Object.assign(
        new Error(`Model "${entry.label ?? entry.id}" is missing its endpoint URL or API key (${entry.apiKeyEnvVar ?? 'no apiKeyEnvVar set'}) — check Admin Settings.`),
        { status: 500 },
      );
    }

    const requestBody = JSON.stringify({
      model: entry.modelSlug ?? entry.id,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt },
      ],
      temperature: 0.4,
      max_tokens:  clampMaxTokens(maxTokens),
    });

    const url = entry.endpointUrl.replace(/\/+$/, '') + '/chat/completions';
    const { status, body } = await httpsPost(
      url,
      {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      requestBody,
    );

    if (status < 200 || status >= 300) {
      console.error(`${entry.label ?? entry.id} (openai-compatible) ${status}:`, body.slice(0, 300));
      throw Object.assign(new Error(`${entry.label ?? entry.id} error ${status}: ${body.slice(0, 200)}`), { status });
    }

    let data;
    try {
      data = JSON.parse(body);
    } catch {
      throw Object.assign(new Error(`Invalid JSON from ${entry.label ?? entry.id}`), { status: 502, raw: body.slice(0, 200) });
    }

    return fromOpenAiResponse(data);
  }

  // Single choke point for actually dispatching an agent call, used by both
  // /api/agent and /api/agents/call. Wraps whatever resolveDispatchTarget()
  // picked with ONE automatic fallback to the default OpenAI model if that
  // call fails — this is the "fall back to default LLM" behavior: it applies
  // to any non-default target (Claude or any MODEL_CATALOG entry), not just
  // Hugging Face specifically, since bad credentials/rate limits/outages can
  // hit any of them the same way. If the default OpenAI call itself is what
  // failed, there's nothing left to fall back to — the error propagates as-is,
  // identical to today's behavior.
  async function dispatchAgentCall(target, systemPrompt, userPrompt, maxTokens) {
    const attemptLabel = target.kind === 'catalog' ? (target.entry.label ?? target.entry.id) : target.provider;
    const skill = await loadPromptOptimizationSkill();
    const optimized = optimizePromptPair({ systemPrompt, userPrompt, skill });
    const optimizedSystemPrompt = optimized.systemPrompt;
    const optimizedUserPrompt = optimized.userPrompt;

    if (optimized.metadata.estimatedTokensSaved > 0) {
      console.log(
        `[token-optimizer] skill=${optimized.metadata.skillId}@${optimized.metadata.skillVersion} ` +
        `saved~${optimized.metadata.estimatedTokensSaved} prompt tokens (${optimized.metadata.estimatedReductionPercent}%)`
      );
    }

    try {
      if (target.kind === 'catalog') {
        const result = await withRetry(() => callOpenAiCompatible(target.entry, optimizedSystemPrompt, optimizedUserPrompt, maxTokens));
        return { ...result, provider: target.entry.providerType, model: target.entry.id, promptOptimization: optimized.metadata };
      }
      const result = await withRetry(() =>
        target.provider === 'claude'
          ? callClaude(optimizedSystemPrompt, optimizedUserPrompt, maxTokens)
          : callOpenAi(optimizedSystemPrompt, optimizedUserPrompt, maxTokens)
      );
      return {
        ...result,
        provider: target.provider,
        model: target.provider === 'claude' ? ANTHROPIC_MODEL : OPENAI_MODEL,
        promptOptimization: optimized.metadata,
      };
    } catch (err) {
      if (target.kind === 'legacy' && target.provider === 'openai') throw err;

      console.error(`[dispatchAgentCall] ${attemptLabel} failed (${err.message}) — falling back to default OpenAI model`);
      const fallbackResult = await withRetry(() => callOpenAi(optimizedSystemPrompt, optimizedUserPrompt, maxTokens));
      return {
        ...fallbackResult,
        provider: 'openai',
        model: OPENAI_MODEL,
        fallbackFrom: attemptLabel,
        promptOptimization: optimized.metadata,
      };
    }
  }

  // ── Rate-limit retry helper ───────────────────────────────────────────────────
  // Retries the given async fn up to maxAttempts on 429, with exponential backoff.
  // Parses "Please try again in Xs" from the OpenAI error body when available.
  async function withRetry(fn, maxAttempts = 4) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (err) {
        const is429 = err.status === 429 || String(err.message).includes('429');
        if (!is429 || attempt === maxAttempts) throw err;
        // Parse suggested wait from OpenAI error body, e.g. "Please try again in 2.5s"
        const match = String(err.message).match(/try again in (\d+(?:\.\d+)?)(s| second)/i);
        const waitMs = match
          ? Math.ceil(parseFloat(match[1])) * 1000 + 500
          : Math.min(2000 * 2 ** (attempt - 1), 30_000); // 2s, 4s, 8s
        console.warn(`429 rate limit — waiting ${waitMs}ms before retry ${attempt}/${maxAttempts - 1}`);
        await new Promise(r => setTimeout(r, waitMs));
      }
    }
  }

  return { resolveDispatchTarget, dispatchAgentCall, clampMaxTokens };
}

module.exports = { createAgentDispatch };
