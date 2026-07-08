// backend/src/projectDocuments.test.ts
//
// Unit tests for the pure, DB-free validation logic backing
// POST /api/project-documents/:projectId (see proxy.js, validateDocumentUpsertPayload).
// These run without a database, same convention as proxy.inviteSecurity.test.ts.
// The full authorize + persist + download flow (which needs a real project_documents
// row and team_members data) is covered separately in
// proxy.projectDocuments.integration.test.ts, gated on POSTGRES_URL_TEST.

describe('validateDocumentUpsertPayload', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV, PORT: '0', RESEND_API_KEY: '', RESEND_FROM_EMAIL: '', POSTGRES_URL: '', POSTGRES_URL_LOCAL: '' };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  const validBase64Docx = Buffer.from('fake docx bytes for testing').toString('base64');

  function basePayload(overrides: Record<string, unknown> = {}) {
    return {
      docId: '01_project_charter',
      category: 'Discovery_Initiation',
      title: 'Project Charter',
      format: 'docx',
      contentBase64: validBase64Docx,
      sourceAgentIds: ['projectCharter'],
      sourceOutputHash: 'abc123',
      trigger: 'agent_complete',
      ...overrides,
    };
  }

  it('accepts a well-formed docx payload', () => {
    const { validateDocumentUpsertPayload } = require('./proxy');
    const result = validateDocumentUpsertPayload(basePayload());
    expect(result.valid).toBe(true);
    expect(result.format).toBe('docx');
    expect(result.contentBuffer).toBeInstanceOf(Buffer);
    expect(result.contentBuffer.length).toBeGreaterThan(0);
  });

  it('accepts a well-formed md payload', () => {
    const { validateDocumentUpsertPayload } = require('./proxy');
    const result = validateDocumentUpsertPayload(basePayload({ format: 'md' }));
    expect(result.valid).toBe(true);
    expect(result.format).toBe('md');
  });

  it.each(['docId', 'category', 'title', 'format', 'contentBase64', 'sourceOutputHash'])(
    'rejects a payload missing required field "%s"',
    (field) => {
      const { validateDocumentUpsertPayload } = require('./proxy');
      const payload = basePayload({ [field]: undefined });
      const result = validateDocumentUpsertPayload(payload);
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/required/i);
    }
  );

  it('rejects a format that is neither docx nor md', () => {
    const { validateDocumentUpsertPayload } = require('./proxy');
    const result = validateDocumentUpsertPayload(basePayload({ format: 'pdf' }));
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/docx.*md|format/i);
  });

  // docId/category get concatenated into ZIP entry paths client-side
  // (documentExporter.ts: `Documentation/${doc.category}/${filename}`). A direct
  // API caller (bypassing the frontend's fixed DOCUMENT_PACK registry) must not be
  // able to smuggle path-traversal or separator characters through either field.
  it.each([
    ['../../etc/passwd', 'docId'],
    ['01/../../secret', 'docId'],
    ['01 project charter', 'docId'],
    ['<script>alert(1)</script>', 'docId'],
  ])('rejects an unsafe docId value: %s', (unsafeValue) => {
    const { validateDocumentUpsertPayload } = require('./proxy');
    const result = validateDocumentUpsertPayload(basePayload({ docId: unsafeValue }));
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/docId/);
  });

  it.each([
    ['../../etc', 'category'],
    ['Discovery/Initiation', 'category'],
    ['Discovery Initiation', 'category'],
  ])('rejects an unsafe category value: %s', (unsafeValue) => {
    const { validateDocumentUpsertPayload } = require('./proxy');
    const result = validateDocumentUpsertPayload(basePayload({ category: unsafeValue }));
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/category/);
  });

  it('accepts docId/category values using only letters, numbers, underscores, and hyphens', () => {
    const { validateDocumentUpsertPayload } = require('./proxy');
    const result = validateDocumentUpsertPayload(
      basePayload({ docId: 'doc-01_v2', category: 'Post-Launch_Review' })
    );
    expect(result.valid).toBe(true);
  });

  it('rejects a title over the 200-character cap', () => {
    const { validateDocumentUpsertPayload } = require('./proxy');
    const result = validateDocumentUpsertPayload(basePayload({ title: 'a'.repeat(201) }));
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/title/i);
  });

  it('accepts a title right at the 200-character cap', () => {
    const { validateDocumentUpsertPayload } = require('./proxy');
    const result = validateDocumentUpsertPayload(basePayload({ title: 'a'.repeat(200) }));
    expect(result.valid).toBe(true);
  });

  it('rejects invalid base64 content', () => {
    const { validateDocumentUpsertPayload } = require('./proxy');
    // Buffer.from with 'base64' encoding is lenient and rarely throws, so this
    // also exercises the empty-buffer branch below when garbage decodes to 0 bytes.
    const result = validateDocumentUpsertPayload(basePayload({ contentBase64: '' }));
    expect(result.valid).toBe(false);
  });

  it('rejects a payload over the 5MB cap', () => {
    const { validateDocumentUpsertPayload } = require('./proxy');
    const oversized = Buffer.alloc(6 * 1024 * 1024, 'a').toString('base64');
    const result = validateDocumentUpsertPayload(basePayload({ contentBase64: oversized }));
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/5MB/);
  });

  it('accepts a payload right at a safely small size (sanity check, not a boundary probe)', () => {
    const { validateDocumentUpsertPayload } = require('./proxy');
    const small = Buffer.alloc(1024, 'a').toString('base64');
    const result = validateDocumentUpsertPayload(basePayload({ contentBase64: small }));
    expect(result.valid).toBe(true);
  });

  it('falls back to "agent_complete" for a missing or unrecognized trigger', () => {
    const { validateDocumentUpsertPayload } = require('./proxy');
    expect(validateDocumentUpsertPayload(basePayload({ trigger: undefined })).generationTrigger).toBe('agent_complete');
    expect(validateDocumentUpsertPayload(basePayload({ trigger: 'not_a_real_trigger' })).generationTrigger).toBe('agent_complete');
  });

  it('accepts "gate_sync" and "manual" as explicit triggers', () => {
    const { validateDocumentUpsertPayload } = require('./proxy');
    expect(validateDocumentUpsertPayload(basePayload({ trigger: 'gate_sync' })).generationTrigger).toBe('gate_sync');
    expect(validateDocumentUpsertPayload(basePayload({ trigger: 'manual' })).generationTrigger).toBe('manual');
  });

  it('defaults sourceAgentIds to an empty array when absent or not an array', () => {
    const { validateDocumentUpsertPayload } = require('./proxy');
    expect(validateDocumentUpsertPayload(basePayload({ sourceAgentIds: undefined })).sourceAgentIds).toEqual([]);
    expect(validateDocumentUpsertPayload(basePayload({ sourceAgentIds: 'not-an-array' })).sourceAgentIds).toEqual([]);
  });

  it('handles a completely empty body without throwing', () => {
    const { validateDocumentUpsertPayload } = require('./proxy');
    expect(() => validateDocumentUpsertPayload(undefined)).not.toThrow();
    expect(validateDocumentUpsertPayload(undefined).valid).toBe(false);
  });
});
