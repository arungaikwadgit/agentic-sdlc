/**
 * Item #4 (Step 6 prioritization matrix), 2026-08-23 -- OpenAI embedding
 * generation for pgvector-backed semantic search (migration
 * 025_pgvector_memory_embeddings.sql).
 *
 * Model choice: text-embedding-3-small (1536 dimensions). OPENAI_API_KEY is
 * already configured on this runtime service (confirmed live before this
 * migration), so this needs no new secret. text-embedding-3-large would
 * give somewhat better retrieval quality at ~6.5x the cost and double the
 * storage per row -- not justified while memory_records has a handful of
 * rows; revisit if retrieval quality becomes a measured problem, not
 * pre-emptively.
 *
 * Best-effort by design, per the Step 4 Wave 3 spec's NFR ("must not
 * meaningfully slow down the synchronous agent pipeline... async/
 * best-effort rather than blocking"): generateEmbedding() NEVER throws. Any
 * failure (missing key, network error, timeout, malformed response) is
 * logged and resolves to null, so a caller can always fall back to
 * inserting the row with no embedding rather than failing the whole write.
 */

export const EMBEDDING_MODEL = 'text-embedding-3-small';
export const EMBEDDING_DIMENSIONS = 1536;

const EMBEDDING_TIMEOUT_MS = 8000;
// OpenAI's embeddings endpoint accepts long input, but memory_records.content
// has no enforced length cap upstream -- bound what we send so a pathological
// record can't produce an expensive or rejected request.
const MAX_INPUT_CHARS = 32_000;

export interface GenerateEmbeddingOptions {
  /** Overrides process.env.OPENAI_API_KEY -- test-only hook. */
  apiKey?: string;
  /** Overrides the module fetch -- test-only hook. */
  fetchImpl?: typeof fetch;
}

/**
 * Generates an embedding for the given text. Returns null (never throws) on
 * any failure -- see module header for why this contract matters.
 */
export async function generateEmbedding(
  text: string,
  options: GenerateEmbeddingOptions = {}
): Promise<number[] | null> {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return null;

  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn('[embeddings] OPENAI_API_KEY not configured -- skipping embedding generation.');
    return null;
  }

  const doFetch = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), EMBEDDING_TIMEOUT_MS);

  try {
    const response = await doFetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: trimmed.slice(0, MAX_INPUT_CHARS),
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      console.error(`[embeddings] OpenAI embeddings request failed: HTTP ${response.status} ${bodyText.slice(0, 200)}`);
      return null;
    }

    const data = await response.json() as { data?: Array<{ embedding?: unknown }> };
    const embedding = data?.data?.[0]?.embedding;
    if (!Array.isArray(embedding) || embedding.length !== EMBEDDING_DIMENSIONS || !embedding.every((n) => typeof n === 'number')) {
      console.error(`[embeddings] Unexpected embedding response shape (expected ${EMBEDDING_DIMENSIONS}-length number array).`);
      return null;
    }
    return embedding as number[];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[embeddings] Embedding generation failed: ${message}`);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/** pgvector accepts a bracketed literal (e.g. '[0.1,0.2,...]') cast to ::vector. */
export function toPgvectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}
