# ADR-005: Action Type Taxonomy and Policy Engine (v1)

**Status:** Accepted  
**Date:** 2026-06-15  
**Deciders:** Arun Gaikwad  

---

## Context

Autonomous agents propose actions that may have side effects (writing files, tagging memory, flagging for human review). We need:

1. A finite, versioned list of action types so policies are auditable.
2. A deterministic policy function that maps (action_type, risk_level) → approval status without LLM involvement.
3. A path to add new action types in v2 without breaking existing consumers.

---

## Decision

### v1 Action Type Taxonomy

Three action types only. No catch-all.

| `action_type` | Description | Default `risk_level` | Policy outcome |
|---|---|---|---|
| `generate_document` | Agent outputs a draft artifact (spec, plan, report) | `low` | `auto_approved` |
| `tag_memory_record` | Agent suggests a tag on an existing memory record | `low` | `auto_approved` |
| `flag_for_review` | Agent surfaces an issue requiring human decision | `medium` | `pending` |

### Policy Engine — Pure Function

```typescript
type PolicyResult = 'auto_approved' | 'pending';

function evaluateProposal(
  action_type: ActionType,
  risk_level: RiskLevel
): PolicyResult {
  if (risk_level === 'high') return 'pending';
  if (action_type === 'flag_for_review') return 'pending';
  return 'auto_approved';
}
```

Rules (in priority order):
1. **Rule 1:** Any `high` risk_level → `pending` (regardless of action_type).
2. **Rule 2:** `flag_for_review` → always `pending` (medium risk by design).
3. **Rule 3:** Everything else → `auto_approved`.

The policy function is a pure function with no DB calls. It is unit-testable in isolation.

### Validation on Create

`ActionProposalRepository.create()` validates `action_type` against the v1 taxonomy at the application layer and throws if unknown. This prevents taxonomy drift from DB-level misuse.

### Versioning

When v2 adds new action types (e.g., `modify_file`, `send_notification`):
1. Add to `ActionType` union in `shared-types`.
2. Add to `V1_ACTION_TYPES` → rename to `KNOWN_ACTION_TYPES`.
3. Write a new ADR (ADR-005a or ADR-006) documenting the new type and its default policy.
4. Do NOT change existing action type behavior — additive only.

---

## Alternatives Considered

| Option | Rejected Because |
|---|---|
| LLM-evaluated risk scoring | Non-deterministic; not auditable; introduces latency on every proposal |
| DB-level policy rules table | Flexibility not needed at v1; adds operational complexity |
| Free-form action_type strings | No contract between agent and policy engine; impossible to audit |
| All proposals require human approval | Kills agent throughput for routine low-risk actions |

---

## Consequences

- `action_proposals.action_type` column has a DB-level enum (`action_type_enum`) that must be migrated in sync when new types are added.
- The `risk_level` on a proposal is set by the agent at creation time. Agents are trusted to self-report risk level for v1. A verification layer (comparing action_type default vs. reported risk) is deferred to v2.
- `auto_approved` proposals are executed immediately by the worker. `pending` proposals block until a human approves via the Action Proposal UI (Phase 5).
