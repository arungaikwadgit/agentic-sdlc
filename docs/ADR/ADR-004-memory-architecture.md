# ADR-004: Memory Architecture — Scope, Isolation, and Retrieval

**Status:** Accepted  
**Date:** 2026-06-15  
**Deciders:** Arun Gaikwad  

---

## Context

Agent runs need to inject relevant past context into LLM prompts. Two competing concerns:

1. **Isolation** — a project's private decisions must not leak to agents in a different project.
2. **Reuse** — curated knowledge (coding standards, domain patterns) should be shareable across projects within the same organizational domain.

We also need a retrieval strategy before pgvector (semantic search) is available.

---

## Decision

### Scope Taxonomy

Two scopes only — no middle tier.

| Scope | Who can read it | Approval required |
|---|---|---|
| `project_private` | Agents in the same `project_id` | No |
| `domain_shared` | Any project in the same `domain_id` | Yes — explicit `approved = TRUE` gate |

### Mandatory Dual Filter

Every memory retrieval MUST apply both predicates in a single WHERE clause:

```sql
WHERE (project_id = $1 OR (scope = 'domain_shared' AND domain_id = $2 AND approved = TRUE))
```

Omitting either predicate is a security defect, not a performance choice.

### Approval Gate for Domain-Shared Records

Domain-shared records start with `approved = FALSE`. A human reviewer (team lead or admin) must explicitly approve them before they become visible across projects. Automated agents cannot self-approve.

### v1 Retrieval: Tag + Keyword

Before pgvector is available:
- **Tag overlap:** `tags && $n::text[]` (PostgreSQL array operator)  
- **Keyword ILIKE:** `title ILIKE '%term%' OR content ILIKE '%term%'`
- **Recency sort:** `ORDER BY updated_at DESC`
- **Hard limit:** default 20 records per retrieval call

### pgvector Deferred to v2

Embedding generation and cosine similarity search (`vector <=> query_vector`) are deferred. The `embedding vector(1536)` column is already defined in the schema as a placeholder. When promoted:
1. Add a pgvector index (`ivfflat` or `hnsw`)
2. Add embedding generation on `memory_records` insert/update
3. Replace ILIKE with cosine similarity in `MemoryRecordRepository.retrieve()`

---

## Alternatives Considered

| Option | Rejected Because |
|---|---|
| Redis for memory cache | No durability; cross-session retrieval fails |
| Single flat scope | No isolation between projects — privacy defect |
| Three scopes (user/project/org) | Complexity without evidence of need; defer to v3 |
| Opt-out approval (approved by default) | Inverts the security posture; shared = more trust, not less |

---

## Consequences

- **MemoryRecordRepository.retrieve()** is the only sanctioned retrieval path. Direct SQL queries against `memory_records` in other code must also apply the dual filter.
- `domain_id` is required on the `memory_records` row when `scope = 'domain_shared'` (enforced by DB CHECK constraint).
- The approval workflow (who approves, via what UI) is deferred to Phase 2.
