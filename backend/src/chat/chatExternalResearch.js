/**
 * Copyright 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential - Unauthorized use prohibited.
 */

const TAVILY_SEARCH_URL = 'https://api.tavily.com/search';
const MAX_QUERY_CHARS = 500;
const MAX_RESULTS = 5;
const MAX_EXCERPT_CHARS = 3_000;
const DEFAULT_TIMEOUT_MS = 12_000;

class ExternalResearchError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ExternalResearchError';
    this.status = status;
  }
}

function createExternalResearch({
  apiKey = process.env.TAVILY_API_KEY ?? '',
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  async function search(rawQuery, signal) {
    const query = String(rawQuery ?? '').trim();
    if (!query || query.length > MAX_QUERY_CHARS) {
      throw new ExternalResearchError(`Research query must be between 1 and ${MAX_QUERY_CHARS} characters.`, 400);
    }
    if (!apiKey) throw new ExternalResearchError('External research is not configured.', 503);
    if (typeof fetchImpl !== 'function') throw new ExternalResearchError('External research transport is unavailable.', 503);

    const controller = new AbortController();
    const abortFromCaller = () => controller.abort();
    signal?.addEventListener('abort', abortFromCaller, { once: true });
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(TAVILY_SEARCH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: apiKey,
          query,
          search_depth: 'basic',
          max_results: MAX_RESULTS,
          include_answer: false,
          include_raw_content: false,
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new ExternalResearchError('External research provider rejected the request.', 502);
      const payload = await response.json();
      return (Array.isArray(payload?.results) ? payload.results : [])
        .slice(0, MAX_RESULTS)
        .filter((item) => /^https?:\/\//i.test(String(item?.url ?? '')))
        .map((item) => ({
          sourceType: 'external',
          sourceId: String(item.url),
          title: String(item.title ?? item.url).slice(0, 300),
          version: null,
          updatedAt: new Date().toISOString(),
          excerpt: String(item.content ?? '').slice(0, MAX_EXCERPT_CHARS),
          authority: Math.max(70, Math.min(95, Math.round(Number(item.score ?? 0.8) * 100))),
          authorized: true,
        }));
    } catch (error) {
      if (error instanceof ExternalResearchError) throw error;
      if (controller.signal.aborted) throw new ExternalResearchError('External research timed out.', 503);
      throw new ExternalResearchError('External research failed.', 502);
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abortFromCaller);
    }
  }

  return { search };
}

module.exports = { ExternalResearchError, createExternalResearch };
