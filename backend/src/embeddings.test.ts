import { generateEmbedding, toPgvectorLiteral, EMBEDDING_MODEL, EMBEDDING_DIMENSIONS } from './embeddings';

function makeEmbeddingArray(length = EMBEDDING_DIMENSIONS): number[] {
  return Array.from({ length }, (_, i) => i / length);
}

function okResponse(embedding: number[]) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ data: [{ embedding }] }),
    text: async () => '',
  } as unknown as Response;
}

describe('generateEmbedding', () => {
  it('returns null and makes no request for empty text', async () => {
    const fetchImpl = jest.fn();
    const result = await generateEmbedding('   ', { apiKey: 'key', fetchImpl });
    expect(result).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns null and makes no request when no API key is configured', async () => {
    const fetchImpl = jest.fn();
    const originalKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      const result = await generateEmbedding('hello world', { fetchImpl });
      expect(result).toBeNull();
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      if (originalKey !== undefined) process.env.OPENAI_API_KEY = originalKey;
    }
  });

  it('uses the default options object and falls back to process.env.OPENAI_API_KEY when called with no options argument at all', async () => {
    const originalKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      // No second argument -- exercises the `options: GenerateEmbeddingOptions = {}`
      // default-parameter path, not just the "options passed but apiKey/fetchImpl
      // omitted" path covered by other tests.
      const result = await generateEmbedding('hello world');
      expect(result).toBeNull();
    } finally {
      if (originalKey !== undefined) process.env.OPENAI_API_KEY = originalKey;
    }
  });

  it('falls back to the global fetch when no fetchImpl override is supplied', async () => {
    const embedding = makeEmbeddingArray();
    const originalFetch = globalThis.fetch;
    const globalFetchMock = jest.fn().mockResolvedValue(okResponse(embedding));
    globalThis.fetch = globalFetchMock as unknown as typeof fetch;
    try {
      // No fetchImpl -- exercises the `options.fetchImpl ?? fetch` fallback to
      // the real global fetch reference, not the test-only override.
      const result = await generateEmbedding('hello world', { apiKey: 'test-key' });
      expect(result).toEqual(embedding);
      expect(globalFetchMock).toHaveBeenCalledWith(
        'https://api.openai.com/v1/embeddings',
        expect.objectContaining({ method: 'POST' }),
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('posts to the OpenAI embeddings endpoint with the configured model and returns the embedding', async () => {
    const embedding = makeEmbeddingArray();
    const fetchImpl = jest.fn().mockResolvedValue(okResponse(embedding));

    const result = await generateEmbedding('a memory record about the API design', { apiKey: 'test-key', fetchImpl });

    expect(result).toEqual(embedding);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.openai.com/v1/embeddings',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-key',
        }),
      }),
    );
    const [, init] = fetchImpl.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.model).toBe(EMBEDDING_MODEL);
    expect(body.input).toBe('a memory record about the API design');
  });

  it('truncates input longer than the max character limit', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(okResponse(makeEmbeddingArray()));
    const longText = 'x'.repeat(40_000);

    await generateEmbedding(longText, { apiKey: 'test-key', fetchImpl });

    const [, init] = fetchImpl.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.input.length).toBe(32_000);
  });

  it('returns null (not a throw) on a non-ok HTTP response', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => 'rate limited',
      json: async () => ({}),
    } as unknown as Response);

    const result = await generateEmbedding('hello', { apiKey: 'test-key', fetchImpl });
    expect(result).toBeNull();
  });

  it('returns null (not a throw) on a non-ok HTTP response even when reading the error body itself fails', async () => {
    // Covers the `.catch(() => '')` fallback on response.text() in the non-ok
    // branch -- some HTTP clients can fail to read the body (e.g. connection
    // dropped mid-response) even after headers/status are already available.
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => { throw new Error('body stream errored'); },
      json: async () => ({}),
    } as unknown as Response);

    const result = await generateEmbedding('hello', { apiKey: 'test-key', fetchImpl });
    expect(result).toBeNull();
  });

  it('returns null when the response shape has the wrong embedding length', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(okResponse(makeEmbeddingArray(10)));
    const result = await generateEmbedding('hello', { apiKey: 'test-key', fetchImpl });
    expect(result).toBeNull();
  });

  it('returns null when the response has no embedding array at all', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [] }),
      text: async () => '',
    } as unknown as Response);
    const result = await generateEmbedding('hello', { apiKey: 'test-key', fetchImpl });
    expect(result).toBeNull();
  });

  it('returns null when the embedding array contains non-numeric entries', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ embedding: Array(EMBEDDING_DIMENSIONS).fill('not-a-number') }] }),
      text: async () => '',
    } as unknown as Response);
    const result = await generateEmbedding('hello', { apiKey: 'test-key', fetchImpl });
    expect(result).toBeNull();
  });

  it('returns null (not a throw) when fetch itself rejects', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error('network down'));
    const result = await generateEmbedding('hello', { apiKey: 'test-key', fetchImpl });
    expect(result).toBeNull();
  });

  it('returns null (not a throw) when fetch rejects with a non-Error value', async () => {
    // Covers the `error instanceof Error ? error.message : String(error)` fallback
    // branch -- a rejection that isn't an Error instance (e.g. an aborted fetch
    // implementation that rejects with a plain string or object).
    const fetchImpl = jest.fn().mockRejectedValue('connection reset');
    const result = await generateEmbedding('hello', { apiKey: 'test-key', fetchImpl });
    expect(result).toBeNull();
  });

  it('returns null (not a throw) when the response body is not valid JSON', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => { throw new Error('invalid json'); },
      text: async () => '',
    } as unknown as Response);
    const result = await generateEmbedding('hello', { apiKey: 'test-key', fetchImpl });
    expect(result).toBeNull();
  });
});

describe('toPgvectorLiteral', () => {
  it('formats a number array as a bracketed pgvector literal', () => {
    expect(toPgvectorLiteral([0.1, 0.2, -0.3])).toBe('[0.1,0.2,-0.3]');
  });

  it('formats an empty array', () => {
    expect(toPgvectorLiteral([])).toBe('[]');
  });
});
