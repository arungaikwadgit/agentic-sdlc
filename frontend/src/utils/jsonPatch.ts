/**
 * Thin wrapper around fast-json-patch for prompt override diffs.
 * Stores only the patch (delta) rather than the full prompt.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Operation = any;

export async function computePatch(original: object, modified: object): Promise<Operation[]> {
  const { compare } = await import('fast-json-patch') as any;
  return compare(original, modified);
}

export async function applyPatch(document: object, patch: Operation[]): Promise<object> {
  const { applyPatch: apply } = await import('fast-json-patch') as any;
  const result = apply(structuredClone(document), patch);
  return result.newDocument ?? result;
}
