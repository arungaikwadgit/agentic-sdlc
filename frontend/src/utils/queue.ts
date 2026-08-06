/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
/**
 * Staggered parallel queue (ADR-002).
 * Starts each parallel agent after a 1.5s delay, max 5 concurrently.
 * This avoids hitting OpenAI / Anthropic rate limits (~50 req/min).
 */

export async function runStaggered<T>(
  tasks: Array<() => Promise<T>>,
  options: { concurrency?: number; delayMs?: number } = {}
): Promise<PromiseSettledResult<T>[]> {
  const { concurrency = 5, delayMs = 1500 } = options;
  const results: PromiseSettledResult<T>[] = [];
  const queue = [...tasks];
  const active = new Set<Promise<void>>();

  let index = 0;

  function next(): Promise<void> | null {
    if (index >= queue.length) return null;
    const task = queue[index];
    const i = index++;
    const delay = i * delayMs;

    const p: Promise<void> = new Promise((resolve) => {
      setTimeout(async () => {
        try {
          const result = await task();
          results[i] = { status: 'fulfilled', value: result };
        } catch (err) {
          results[i] = { status: 'rejected', reason: err };
        }
        active.delete(p);
        const n = next();
        if (n) active.add(n);
        resolve();
      }, delay);
    });

    return p;
  }

  // Seed with up to `concurrency` tasks
  while (active.size < concurrency && index < queue.length) {
    const p = next();
    if (p) active.add(p);
  }

  // Wait for all to complete
  while (active.size > 0) {
    await Promise.race(active);
  }

  return results;
}
