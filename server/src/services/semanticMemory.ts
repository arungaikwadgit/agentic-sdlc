/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential - Unauthorized use prohibited.
 *
 * Item #5 Phase 3 (2026-08-23) -- calls the Runtime API's pgvector-backed
 * similarity search (backend/src/routes/memoryRecords.ts, GET
 * /api/v1/memory-records/similar) from server/src's agent-context
 * assembly (routes/projects.ts). This is a NEW inter-service dependency:
 * server/src has never called the Runtime API before. Deliberately
 * best-effort and bounded, mirroring embeddings.ts's own contract on the
 * Runtime API side -- a failure here must never break agent-context
 * assembly for ANY agent, since that endpoint is shared by all 32 agents,
 * not just the ones that opt into semantic grounding.
 *
 * Auth: RUNTIME_API_TOKEN_INTERNAL, a secret independent of
 * RUNTIME_API_TOKEN (see backend/src/middleware/requireApiToken.ts's
 * header comment for why this is a separate credential rather than a
 * reused one).
 */

export interface SemanticEvidenceItem {
  sourceType: string;
  sourceId: string;
  title: string;
  version: string | null;
  updatedAt: string | null;
  excerpt: string;
  authority: number;
  authorized: boolean;
}

export interface SemanticEvidenceResult {
  found: boolean;
  items: SemanticEvidenceItem[];
  confidence: number;
  sufficient: boolean;
}

const TIMEOUT_MS = 5_000;

/**
 * Returns null (never throws) on any failure: missing config, timeout,
 * non-ok response, or a malformed body. Callers must treat null exactly
 * like "no semantic evidence available" and fall back to the existing
 * keyword-ranked memory context -- never block or fail agent-context
 * assembly because this call didn't work.
 */
export async function fetchSemanticEvidence(opts: {
  projectId: string;
  query: string;
  domainId?: string | null;
  limit?: number;
}): Promise<SemanticEvidenceResult | null> {
  const baseUrl = (process.env.RUNTIME_API_URL ?? '').replace(/\/$/, '');
  const token = process.env.RUNTIME_API_TOKEN_INTERNAL;
  if (!baseUrl || !token) return null;

  const params = new URLSearchParams({
    project_id: opts.projectId,
    query: opts.query,
    limit: String(opts.limit ?? 6),
  });
  if (opts.domainId) params.set('domain_id', opts.domainId);

  try {
    const response = await fetch(`${baseUrl}/api/v1/memory-records/similar?${params.toString()}`, {
      method: 'GET',
      headers: { 'X-API-Token': token },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      console.error(`[semanticMemory] similarity request failed: HTTP ${response.status}`);
      return null;
    }
    const data = (await response.json()) as Partial<SemanticEvidenceResult>;
    if (!Array.isArray(data.items)) {
      console.error('[semanticMemory] unexpected response shape (missing items array)');
      return null;
    }
    return {
      found: Boolean(data.found),
      items: data.items as SemanticEvidenceItem[],
      confidence: typeof data.confidence === 'number' ? data.confidence : 0,
      sufficient: Boolean(data.sufficient),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[semanticMemory] similarity request errored: ${message}`);
    return null;
  }
}
