/* eslint-disable no-console */
/**
 * One-off backfill: generates embeddings for memory_records rows that
 * predate the pgvector migration (025_pgvector_memory_embeddings.sql) and
 * item #4's embedding-on-create wiring (repositories/MemoryRecordRepository.
 * create()). New rows get an embedding automatically at write time; this
 * script only needs to run once for the rows that existed before that.
 *
 * Mirrors src/embeddings.ts's generateEmbedding() exactly (same model, same
 * timeout, same best-effort "never throw" contract) rather than importing
 * it, since this script is plain CommonJS run directly via `node`, matching
 * every other script in this directory (seedMasterData.js etc.) -- none of
 * them go through ts-node, and adding that dependency for one script would
 * be a bigger footprint than duplicating ~20 stable lines.
 *
 * Usage: node scripts/backfillMemoryEmbeddings.js [--dry-run]
 */
require('dotenv').config();

const { Pool } = require('pg');

const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMENSIONS = 1536;
const EMBEDDING_TIMEOUT_MS = 8000;
const MAX_INPUT_CHARS = 32_000;

async function generateEmbedding(text) {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return null;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn('[backfill] OPENAI_API_KEY not configured -- cannot generate embeddings.');
    return null;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), EMBEDDING_TIMEOUT_MS);
  try {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: trimmed.slice(0, MAX_INPUT_CHARS) }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      console.error(`[backfill] OpenAI embeddings request failed: HTTP ${response.status} ${bodyText.slice(0, 200)}`);
      return null;
    }
    const data = await response.json();
    const embedding = data?.data?.[0]?.embedding;
    if (!Array.isArray(embedding) || embedding.length !== EMBEDDING_DIMENSIONS || !embedding.every((n) => typeof n === 'number')) {
      console.error('[backfill] Unexpected embedding response shape.');
      return null;
    }
    return embedding;
  } catch (error) {
    console.error(`[backfill] Embedding generation failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

function toPgvectorLiteral(embedding) {
  return `[${embedding.join(',')}]`;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const pool = new Pool({ connectionString: process.env.POSTGRES_URL });

  try {
    const { rows } = await pool.query(
      'SELECT id, title, content FROM memory_records WHERE embedding IS NULL ORDER BY created_at ASC'
    );
    console.log(`[backfill] ${rows.length} row(s) with no embedding.${dryRun ? ' (dry run -- no writes)' : ''}`);

    let succeeded = 0;
    let failed = 0;
    for (const row of rows) {
      const embedding = await generateEmbedding(`${row.title}\n\n${row.content}`);
      if (!embedding) {
        failed += 1;
        console.warn(`[backfill] SKIP ${row.id} -- "${row.title}" (embedding generation failed)`);
        continue;
      }
      if (!dryRun) {
        await pool.query('UPDATE memory_records SET embedding = $2::vector WHERE id = $1', [
          row.id,
          toPgvectorLiteral(embedding),
        ]);
      }
      succeeded += 1;
      console.log(`[backfill] OK   ${row.id} -- "${row.title}"`);
    }

    console.log(`[backfill] Done. ${succeeded} succeeded, ${failed} failed, ${rows.length} total.`);
    if (failed > 0) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('[backfill] Fatal error:', error);
  process.exitCode = 1;
});
