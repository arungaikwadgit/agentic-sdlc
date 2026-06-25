/**
 * © 2025 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */

/**
 * /api/agents — AI proxy routes
 *
 * Keeps API keys server-side. The frontend never sees OPENAI_API_KEY or
 * ANTHROPIC_API_KEY — it only sends its own Supabase JWT.
 */
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';

const router = Router();

const CallAgentSchema = z.object({
  systemPrompt: z.string(),
  userPrompt: z.string(),
  agentId: z.string().optional(),
  model: z.string().optional(),
  provider: z.enum(['openai', 'anthropic']).optional().default('openai'),
  maxTokens: z.number().optional().default(4096),
  temperature: z.number().optional().default(0.7),
});

/**
 * POST /api/agents/call
 * Generic agent call — proxies to OpenAI or Anthropic.
 */
router.post('/call', requireAuth, async (req, res) => {
  try {
    const body = CallAgentSchema.parse(req.body);

    if (body.provider === 'anthropic') {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) return res.status(500).json({ error: 'Anthropic API key not configured' });

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: body.model || 'claude-opus-4-8',
          max_tokens: body.maxTokens,
          system: body.systemPrompt,
          messages: [{ role: 'user', content: body.userPrompt }],
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        return res.status(response.status).json({ error: err });
      }

      const data = await response.json() as {
        content?: Array<{ text?: string }>;
        usage?: { input_tokens?: number; output_tokens?: number };
        model?: string;
      };
      // Normalise to OpenAI-compatible shape so frontend needs no changes
      return res.json({
        choices: [{
          message: {
            content: data.content?.[0]?.text ?? '',
            role: 'assistant',
          },
        }],
        usage: {
          prompt_tokens: data.usage?.input_tokens ?? 0,
          completion_tokens: data.usage?.output_tokens ?? 0,
        },
        model: data.model,
        provider: 'anthropic',
      });
    }

    // Default: OpenAI
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'OpenAI API key not configured' });

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: body.model || 'gpt-4o',
        max_tokens: body.maxTokens,
        temperature: body.temperature,
        messages: [
          { role: 'system', content: body.systemPrompt },
          { role: 'user', content: body.userPrompt },
        ],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(response.status).json({ error: err });
    }

    const data = await response.json() as Record<string, unknown>;
    return res.json({ ...data, provider: 'openai' });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors });
    console.error('[POST /agents/call]', err);
    res.status(500).json({ error: 'Agent call failed' });
  }
});

/**
 * POST /api/agents/stream
 * Streaming agent call — proxies SSE from OpenAI directly to the client.
 */
router.post('/stream', requireAuth, async (req, res) => {
  try {
    const body = CallAgentSchema.parse(req.body);
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'OpenAI API key not configured' });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: body.model || 'gpt-4o',
        max_tokens: body.maxTokens,
        temperature: body.temperature,
        stream: true,
        messages: [
          { role: 'system', content: body.systemPrompt },
          { role: 'user', content: body.userPrompt },
        ],
      }),
    });

    if (!upstream.ok || !upstream.body) {
      const err = await upstream.text();
      res.write(`data: ${JSON.stringify({ error: err })}\n\n`);
      return res.end();
    }

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(decoder.decode(value, { stream: true }));
    }

    res.end();
  } catch (err) {
    console.error('[POST /agents/stream]', err);
    res.write(`data: ${JSON.stringify({ error: 'Stream failed' })}\n\n`);
    res.end();
  }
});

export default router;
