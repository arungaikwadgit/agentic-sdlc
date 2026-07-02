const { randomUUID } = require('crypto');

function createLocalProjectStore() {
  const rows = new Map();

  function clone(row) {
    return row ? { ...row, data: { ...(row.data ?? {}) } } : row;
  }

  function normalizePayload(payload = {}) {
    return {
      name: payload.name ?? '',
      description: payload.description ?? '',
      domain: payload.domain ?? '',
      status: payload.status ?? 'draft',
      data: payload.data ?? {},
    };
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function list() {
    return Array.from(rows.values())
      .map(clone)
      .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
  }

  function get(id) {
    return clone(rows.get(id));
  }

  function create(payload, ownerId = 'local-dev-user') {
    const normalized = normalizePayload(payload);
    const ts = nowIso();
    const row = {
      id: randomUUID(),
      owner_id: ownerId,
      name: normalized.name,
      description: normalized.description,
      domain: normalized.domain,
      status: normalized.status,
      data: normalized.data,
      created_at: ts,
      updated_at: ts,
      members: [],
    };
    rows.set(row.id, row);
    return clone(row);
  }

  function update(id, payload) {
    const existing = rows.get(id);
    if (!existing) return null;
    const normalized = normalizePayload(payload);
    const next = {
      ...existing,
      ...normalized,
      data: { ...(existing.data ?? {}), ...(normalized.data ?? {}) },
      updated_at: nowIso(),
    };
    rows.set(id, next);
    return clone(next);
  }

  function remove(id) {
    const existing = rows.get(id);
    if (!existing) return null;
    rows.delete(id);
    return clone(existing);
  }

  function restore(id) {
    const existing = rows.get(id);
    if (!existing) return null;
    const next = {
      ...existing,
      data: {
        ...(existing.data ?? {}),
        archived: false,
        archivedReason: undefined,
        archivedAt: undefined,
        archivedBy: undefined,
      },
      updated_at: nowIso(),
    };
    rows.set(id, next);
    return clone(next);
  }

  return { list, get, create, update, remove, restore };
}

module.exports = { createLocalProjectStore };
