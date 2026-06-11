# Architecture Decision Records

## ADR-001: Use IndexedDB instead of a backend database

**Context:** Multi-user collaboration not required initially; offline support desired.
**Decision:** Dexie.js over IndexedDB.
**Consequences:** No server costs, but data is per-browser. Use backup/restore for portability.

## ADR-002: Staggered parallel agents with 1.5s delay

**Context:** OpenAI/Anthropic rate limits (~50 req/min).
**Decision:** Start each parallel agent after 1.5s delay, max 5 concurrently (see `utils/queue.ts`).
**Consequences:** Full 22-agent run takes 15–25 minutes; acceptable for MVP.

## ADR-003: Express proxy for API key

**Context:** Frontend cannot safely hold the API key.
**Decision:** Local Express proxy with token auth and rate limiting.
**Consequences:** Extra startup step but required for security. Can be replaced with Cloudflare Worker for production.

## ADR-004: OpenAI gpt-4o as default model

**Context:** Anthropic credit balance issues in development; OpenAI widely available.
**Decision:** Use OpenAI Chat Completions API. Model configurable via `OPENAI_MODEL` env var.
**Consequences:** Response shape differs from Anthropic (choices[].message.content vs content[].text). Frontend `extractText` handles this.

## ADR-005: Markdown-only document renderer (no heavy library)

**Context:** Libraries like `react-markdown` add ~50KB to bundle.
**Decision:** Custom lightweight markdown-to-HTML renderer in `DocumentViewer.tsx`.
**Consequences:** Covers 95% of agent output formatting; edge cases may render imperfectly.

## System Overview

```
Browser (React + Vite)
  └── Dexie.js (IndexedDB)        — project + output storage
  └── PipelineEngine.ts           — orchestrates 22 agents
  └── /api/agent (fetch proxy)
        └── Express (localhost:3001)
              └── OpenAI API (gpt-4o)
```

## Key Files

| File | Purpose |
|------|---------|
| `src/agents/definitions.ts` | All 22 agent system/user prompts |
| `src/agents/domains.ts` | 10 domain knowledge stores |
| `src/services/pipelineEngine.ts` | Phase orchestration, review gates, resume |
| `src/db/projectRepository.ts` | Dexie CRUD with optimistic concurrency |
| `src/services/traceability.ts` | Requirements ↔ Stories ↔ Tests CSV |
| `src/services/exporters/` | .md, .docx, .xlsx export |
| `backend/src/proxy.js` | Express API key proxy |
