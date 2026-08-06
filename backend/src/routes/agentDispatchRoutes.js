/**
 * 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential - Unauthorized use prohibited.
 */

const { Router } = require('express');

const INJECTION_PATTERNS = [
  /ignore previous/i, /ignore rules/i, /ignore (all )?instructions/i,
  /forget your instructions/i, /disregard (all )?previous/i,
  /you are now/i, /override (your )?system/i, /bypass (the )?filter/i,
];

/**
 * POST /api/agent + POST /api/agents/call -- verbatim extraction from
 * proxy.js (architecture upgrade Phase 3). These two handlers are
 * near-duplicates in the ORIGINAL code (agents/call adds diagnostic
 * console.log calls; the comment above it says "Delegate to /api/agent
 * handler by reusing the same logic inline", but the logic is actually
 * copy-pasted, not literally shared) -- preserved verbatim/separately here
 * rather than de-duplicated, since de-duplication is a design
 * improvement out of scope for a zero-behavior-change extraction.
 *
 * All dependencies here are either proxy.js function DECLARATIONS
 * (authorizeAgentRun -- hoisted, never reassigned) or `const`s already
 * assigned earlier in proxy.js's top-level execution order than these
 * routes were registered (resolveDispatchTarget, dispatchAgentCall,
 * ANTHROPIC_MODEL, OPENAI_MODEL -- see agentDispatch.js's own extraction
 * comment for why these are safe to pass by value/reference). No getter
 * needed for any of them, unlike adminReset.js's ensureInviteSessionTable.
 */
function createAgentDispatchRouter({ checkToken, authorizeAgentRun, resolveDispatchTarget, dispatchAgentCall, anthropicModel, openaiModel }) {
  const router = Router();

  router.post('/agent', checkToken, async (req, res) => {
    const { systemPrompt, userPrompt, testMode, agentId, projectId, provider: requestedProvider, maxTokens } = req.body ?? {};

    if (!systemPrompt || !userPrompt)
      return res.status(400).json({ error: 'systemPrompt and userPrompt are required' });

    // Per-agent access scoping (see authorizeAgentRun() in proxy.js) — only
    // runs when both projectId and agentId were sent; writes its own 403 on
    // denial.
    const agentAuthz = await authorizeAgentRun(req, res, { projectId, agentId });
    if (!agentAuthz.ok) return;

    // M-05 fix: server-side prompt injection detection — client-side check is bypassable
    const combinedPrompt = `${systemPrompt} ${userPrompt}`;
    for (const pattern of INJECTION_PATTERNS) {
      if (pattern.test(combinedPrompt)) {
        return res.status(400).json({ error: 'Request rejected: potential prompt injection detected.' });
      }
    }

    const target = resolveDispatchTarget(requestedProvider, agentId);
    const provider = target.kind === 'catalog' ? target.entry.providerType : target.provider;
    const model = target.kind === 'catalog' ? target.entry.id : (target.provider === 'claude' ? anthropicModel : openaiModel);

    // Test mode — no external call
    if (testMode) {
      return res.json({
        choices: [{ message: { role: 'assistant', content: '[TEST] ' + systemPrompt.slice(0, 80) }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        provider,
        model,
      });
    }

    try {
      const result = await dispatchAgentCall(target, systemPrompt, userPrompt, maxTokens);
      return res.json(result);

    } catch (err) {
      console.error('Proxy error:', err.message);
      const status = err.status ?? 502;
      return res.status(status).json({ error: err.message, raw: err.raw });
    }
  });

  // Alias — newer frontend builds call /api/agents/call; route to the same handler
  router.post('/agents/call', checkToken, async (req, res) => {
    // Delegate to /api/agent handler by reusing the same logic inline
    const { systemPrompt, userPrompt, testMode, agentId, projectId, provider: requestedProvider, maxTokens } = req.body ?? {};

    // Diagnostic logging (temporary) — see checkToken() above. Traces the full
    // Test Connection / agent-call lifecycle on the backend, from authenticated
    // user through provider resolution to the actual LLM call result.
    const callTag = `[agents/call]`;
    console.log(
      `${callTag} authenticated as user=${req.authUser?.email ?? (req.authUser?.adminBypass ? '(admin-bypass)' : '(unknown)')} ` +
      `agentId=${agentId ?? '(none)'} requestedProvider=${requestedProvider ?? '(default)'} testMode=${!!testMode}`
    );

    if (!systemPrompt || !userPrompt)
      return res.status(400).json({ error: 'systemPrompt and userPrompt are required' });

    // Per-agent access scoping (see authorizeAgentRun() in proxy.js) — only
    // runs when both projectId and agentId were sent; writes its own 403 on
    // denial.
    const agentAuthz = await authorizeAgentRun(req, res, { projectId, agentId });
    if (!agentAuthz.ok) return;

    const combinedPrompt = `${systemPrompt} ${userPrompt}`;
    for (const pattern of INJECTION_PATTERNS) {
      if (pattern.test(combinedPrompt)) {
        return res.status(400).json({ error: 'Request rejected: potential prompt injection detected.' });
      }
    }

    const target = resolveDispatchTarget(requestedProvider, agentId);
    const provider = target.kind === 'catalog' ? target.entry.providerType : target.provider;
    const model = target.kind === 'catalog' ? target.entry.id : (target.provider === 'claude' ? anthropicModel : openaiModel);
    console.log(`${callTag} resolved provider=${provider} model=${model}`);

    if (testMode) {
      console.log(`${callTag} testMode=true — returning stub response without calling the LLM`);
      return res.json({
        choices: [{ message: { role: 'assistant', content: '[TEST] ' + systemPrompt.slice(0, 80) }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        provider,
        model,
      });
    }

    try {
      console.log(`${callTag} calling ${provider} API...`);
      const started = Date.now();
      const result = await dispatchAgentCall(target, systemPrompt, userPrompt, maxTokens);
      console.log(`${callTag} ${provider} call succeeded in ${Date.now() - started}ms` + (result.fallbackFrom ? ` (fell back from ${result.fallbackFrom})` : ''));
      return res.json(result);
    } catch (err) {
      console.error(`${callTag} ${provider} call FAILED — status=${err.status ?? 502} message=${err.message}`);
      const status = err.status ?? 502;
      return res.status(status).json({ error: err.message, raw: err.raw });
    }
  });

  return router;
}

module.exports = { createAgentDispatchRouter };
