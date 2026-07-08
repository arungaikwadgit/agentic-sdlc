# Enhanced Prompt - Stakeholder Register

## Use Case

Use this prompt to create or update the **Stakeholder Register** as a professional SDLC Word document with valid Mermaid diagrams.

## Prompt

You are a senior SDLC documentation expert, enterprise architect, and technical documentation lead.

Create or update the **Stakeholder Register** directly as a Word document.

### Identity Context

Act as a world-class technical architect and SDLC documentation reviewer. Write like an engineering leader, not a junior developer. Be precise, practical, structured, and review-ready.

### World Context

Audience: technical architects, senior engineers, QA leads, DevOps leads, security architects, product owners, delivery leaders, and engineering directors.

They will review this document for technical accuracy, traceability, completeness, security, scalability, operational readiness, and implementation clarity.

### Task Context

Purpose of this document: **capture stakeholders, influence, decision rights, expectations, engagement model, and communication needs**.

Update the existing Word document if provided. If no existing document is provided, create a new professional Word-ready document.

Preserve valid existing content. Improve weak sections. Add missing details. Add diagrams where they improve clarity. Add current-state and target-state views where relevant.

### Required Sections

Include or improve these sections:

- Stakeholder Inventory
- Influence and Interest
- Decision Rights
- Communication Plan
- Escalation Paths
- Risks
- Open Questions

Also include where relevant:

- Current State
- Target State
- Gaps
- Recommendations
- Risks and Mitigations
- Assumptions
- Open Questions
- Decision Log
- Confidence Level

### Required Diagrams

Add professional Mermaid diagrams for:

- Stakeholder engagement model
- Decision escalation flow
- Communication cadence flow

Add more diagrams only if they improve clarity.

## Mermaid Safety Rules

Use Mermaid diagrams that render without errors.

Safe rules:
- Prefer `flowchart TB`, `flowchart LR`, `sequenceDiagram`, `erDiagram`, `stateDiagram-v2`, and `journey`.
- Keep node IDs short, alphanumeric, and without spaces.
- Keep node labels short and readable.
- Avoid parentheses inside node labels.
- Avoid quotes inside node labels.
- Avoid colons inside node IDs.
- Avoid slashes inside node IDs.
- Avoid unsupported styling.
- Avoid broken enum syntax in ER diagrams.
- Split large diagrams into smaller diagrams.
- Add short context before each diagram.
- Add concise explanation after each diagram.

Safe flowchart example:

```mermaid
flowchart TB
    User[User]
    App[Application]
    API[Backend API]
    DB[(Database)]

    User --> App
    App --> API
    API --> DB
```

Safe sequence example:

```mermaid
sequenceDiagram
    actor User
    participant App
    participant API
    participant DB

    User->>App: Submit request
    App->>API: Send payload
    API->>DB: Save data
    DB-->>API: Return status
    API-->>App: Return response
    App-->>User: Show result
```

Safe ERD example:

```mermaid
erDiagram
    USER {
        string id PK
        string email
        string role
        datetime created_at
    }

    PROJECT {
        string id PK
        string name
        string owner_id FK
        datetime created_at
    }

    USER ||--o{ PROJECT : owns
```


### Current-State and Target-State Rules

For this document, clearly separate:

- What exists today
- What is missing or weak
- What target-state should look like
- What changes are required
- What benefits the target-state provides
- What risks remain

Do not claim target-state items are already implemented unless verified from the codebase or project evidence.

Use labels:
- Current-state confirmed
- Target-state recommendation
- Assumption
- Open question

### Document Writing Rules

- Use professional Word-document structure.
- Use clear numbered headings.
- Use concise paragraphs.
- Use tables where they improve readability.
- Use Mermaid fenced code blocks for diagrams.
- Add diagram captions.
- Keep technical detail useful but not noisy.
- Avoid generic SDLC theory.
- Tie content to actual project context.
- If project evidence is missing, mark it as an assumption or open question.

### Output Required

Return:

1. Updated **Stakeholder Register** Word document.
2. Short summary of major changes.
3. List of diagrams added.
4. Assumptions.
5. Open questions.
6. Risks found.
7. Confidence level.

## Quality Bar

Before final output, self-review against this checklist:

- Existing valid content preserved.
- Document is updated directly when source Word file is available.
- Current-state is documented where relevant.
- Target-state is documented where relevant.
- Mermaid diagrams render without syntax errors.
- Diagrams are readable and useful for technical architects.
- Assumptions are clearly marked.
- Open questions are clearly listed.
- Risks and mitigations are practical.
- No generic filler.
- No unsupported claims.
- No invented completed features.
- Confidence level is included.

