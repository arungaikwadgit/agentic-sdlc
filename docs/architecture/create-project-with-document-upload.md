# Create New Project — Document Upload & Agentic Extraction
## Implementation-Ready Design Specification

**App context:** Agentic SDLC — client-side React/Dexie app with an Express LLM proxy.  
**Version:** 1.0 · June 2026  
**Replaces:** `NewProjectModal.tsx` (2-step modal)

---

## 1. Feature Overview

The Create New Project experience is upgraded from a 2-step modal to a full-screen wizard that accepts uploaded project documents (SOW, RFP, project brief, discovery notes, BRD), runs an L3 agentic extraction loop against them, and prefills every project field with source-traced, confidence-scored values that the user reviews and approves before the project is created.

**What's new vs. the existing modal:**
- Multi-file upload (PDF, DOCX, TXT) with drag-and-drop
- Client-side text extraction (PDF.js, mammoth.js — no server round-trip for content)
- L3 agentic extraction: the existing `runL3Agent` loop drives a `projectContextExtractor` agent
- Every extracted field carries: source file, section/page hint, confidence score, extraction method (extracted | inferred | missing)
- Dual review modes: structured form (editable fields with badges) + conversational assistant
- Human approval checkpoint before project creation
- Permanent document storage in IndexedDB (`projectDocuments` table) attached to the project record
- Downstream artifact-generation guidance package injected into `domainKnowledge`

**What doesn't change:**
- `createProject()` in `projectRepository.ts` — called at the end of the wizard, same signature
- `Project` type — extended with optional `sourceDocumentIds` array only
- All existing `AgentDefinition` agents — unchanged
- `proxy.js` backend — no changes needed (extraction uses existing `/api/agent` endpoint)

---

## 2. User Journey

```
1. Dashboard → "New Project" button
   └─ Opens full-screen wizard (replaces modal overlay)

2. STEP 1 — Upload Documents
   ├─ Drag-and-drop or browse: PDF, DOCX, TXT (up to 5 files, 10MB each)
   ├─ Per-file: validation → size check → client-side text extraction → preview
   ├─ "Skip upload" → goes directly to manual form (existing behaviour)
   └─ "Analyse Documents" → triggers L3 extraction agent

3. STEP 2 — Extraction in Progress
   ├─ Animated progress: Classify → Plan → Extract → Validate → Synthesise
   ├─ Live plan-revision + tool-call log (same AgentThinkingPanel style)
   └─ On complete → auto-advance to Step 3

4. STEP 3 — Review Extracted Context
   ├─ Structured form: every field shows value + derived badge + confidence bar
   ├─ Clicking any field's badge opens the Source Panel (file, section, excerpt)
   ├─ User edits, accepts, rejects fields
   ├─ "Missing fields" panel shows what could not be extracted
   ├─ "Conflicts" panel shows multi-document disagreements
   ├─ Tab toggle: Form ↔ Chat (conversational review)
   └─ "Proceed to Approval" button (enabled when required fields are filled)

5. STEP 4 — Approval
   ├─ Summary card: project name, domain, doc count, field coverage %
   ├─ Approval role selector (Project Owner / Delivery Manager / Admin)
   ├─ Optional notes field
   ├─ "Create Project" button → calls createProject() → navigates to workspace
   └─ Project record includes: sourceDocumentIds[], domainKnowledge (enriched)
```

---

## 3. Full-Screen UX Layout

```
┌─────────────────────────────────────────────────────────────────────┐
│  ← Back   Create New Project                     Step 2 of 4  [✕]  │
├─────────────────────────────────────────────────────────────────────┤
│  ① Upload  ──────  ② Extracting  ──────  ③ Review  ──────  ④ Approve │
├──────────────────────────────┬──────────────────────────────────────┤
│                              │                                       │
│   LEFT PANEL                 │   RIGHT PANEL                         │
│   (context-sensitive)        │   (always: extracted field form)      │
│                              │                                       │
│   Step 1: Drop zone          │   [hidden until step 3]               │
│   Step 2: Agent trace        │                                       │
│   Step 3: Source preview     │   Step 3: Editable form with          │
│   Step 4: Approval summary   │   derived-field badges                │
│                              │                                       │
└──────────────────────────────┴──────────────────────────────────────┘
│  [Back]                                             [Next / Create]  │
└─────────────────────────────────────────────────────────────────────┘
```

**Step 3 right panel field layout:**
```
┌──────────────────────────────────────────────────────────┐
│  Project Name          [EXTRACTED · 0.95] [⚠ EDIT]      │
│  ┌────────────────────────────────────────────────────┐  │
│  │ FinPay — Payment Processing Platform               │  │
│  └────────────────────────────────────────────────────┘  │
│  Source: sow-v2.pdf · Section 1.1 · "Project Title"     │
│                                                           │
│  Business Goals        [INFERRED · 0.72]                 │
│  ┌────────────────────────────────────────────────────┐  │
│  │ Reduce payment processing fees by 30% for SME...  │  │
│  └────────────────────────────────────────────────────┘  │
│                                                           │
│  Tech Stack            [MISSING]                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │ (not mentioned in uploaded documents)              │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

---

## 4. Functional Requirements

### Document Upload
- FR-01: Accept PDF, DOCX, TXT. Reject all other types with a clear error message.
- FR-02: Max 5 files per upload session. Max 10MB per file. Max 25MB total.
- FR-03: Client-side text extraction before sending to the LLM (PDF.js for PDF, mammoth.js for DOCX, FileReader for TXT).
- FR-04: Display file name, type icon, size, extraction status, and character count per file.
- FR-05: Allow removal of individual files before extraction starts.
- FR-06: "Skip upload" bypasses extraction and opens the manual form (identical to current modal behaviour).

### Extraction
- FR-07: Extraction runs as an L3 agent using the existing `runL3Agent` runtime.
- FR-08: The agent receives all extracted text concatenated with document boundary markers.
- FR-09: The agent must return a structured JSON block (inside FINAL_OUTPUT) containing all 25 project context fields.
- FR-10: Each field in the JSON must include: `value`, `confidence` (0–1), `method` (extracted|inferred|missing), `sourceFile`, `sourceSection`, `sourceExcerpt`, `rationale`.
- FR-11: The extraction agent must not hallucinate values absent from source documents.
- FR-12: Fields that cannot be safely extracted or inferred must be returned as `method: "missing"`.
- FR-13: Multi-document conflicts (same field with contradictory values across files) must be flagged as `method: "conflict"` with both values listed.

### Review Form
- FR-14: Every derived field shows a colour-coded badge: EXTRACTED (green), INFERRED (amber), MISSING (red), CONFLICT (orange), USER-EDITED (blue).
- FR-15: Confidence score shown as a percentage bar next to each badge.
- FR-16: Clicking a badge opens the Source Panel (right side on ≥ 1400px, bottom drawer on narrower) showing file name, section, and highlighted excerpt.
- FR-17: Every field is editable inline. Editing a derived field changes its badge to USER-EDITED.
- FR-18: Users can reject a derived value (clears it, marks REJECTED, badge turns grey).
- FR-19: The "Missing Fields" panel lists all fields with method=missing and suggests what document type could provide them.
- FR-20: The "Conflicts" panel shows side-by-side comparisons of conflicting values with source attribution.

### Conversational Review
- FR-21: A chat panel (toggled from the form tab) accepts natural-language questions about the extracted context.
- FR-22: Supported question intents: "Why was X extracted?", "What is missing?", "What risks did you find?", "Show all assumptions", "Compare SOW and RFP conflicts", "What should I add before creating this project?"
- FR-23: Answers are grounded in the extraction output and source documents only — the assistant must not invent context.
- FR-24: Chat answers can propose field edits; clicking "Apply" updates the form field.

### Approval
- FR-25: Before creating the project, the user must select an approver role from: Project Owner, Delivery Manager, Solution Architect, Business Sponsor, Admin.
- FR-26: An optional approval notes field is provided.
- FR-27: A field coverage summary is shown: N of 25 fields filled, M extracted, K inferred, J missing.
- FR-28: The Create Project button is disabled until: (a) Project Name and Description are filled, (b) Owner is filled, (c) an approval role is selected.
- FR-29: After creation the approval record (role, timestamp, notes) is stored in the project record.
- FR-30: Artifact generation does NOT start automatically — it requires a separate human action in the workspace (existing gate behaviour unchanged).

### Document Storage
- FR-31: Uploaded document text and metadata are stored in a new `projectDocuments` IndexedDB table.
- FR-32: Documents are linked to the project via `projectId`.
- FR-33: The extraction output (full JSON with field traces) is stored in the project record as `extractionPackage`.
- FR-34: The enriched domain knowledge (extraction output formatted as agent context) is stored in `domainKnowledge` and used by all downstream agents automatically.

---

## 5. Non-Functional Requirements

- NFR-01: Client-side text extraction must complete within 5 seconds for a 10MB PDF.
- NFR-02: LLM extraction call must use `max_tokens: 8192` (already set in proxy.js).
- NFR-03: The full-screen wizard must be responsive down to 1024px.
- NFR-04: The extraction progress animation must update every 500ms without blocking the UI.
- NFR-05: The wizard must be keyboard-navigable (Tab, Enter, Escape).
- NFR-06: All IndexedDB writes are transactional — partial extraction failures must not corrupt existing projects.
- NFR-07: The conversational assistant must respond within 10 seconds (same LLM timeout as agent calls).
- NFR-08: Source panel excerpts must be highlighted using `<mark>` tags matching the extracted text.

---

## 6. Agentic Workflow Design

The extraction is driven by a new `projectContextExtractor` agent definition — NOT added to the pipeline (it's pre-creation), but using the same L3 runtime.

```
Goal: "Extract a complete, sourced project context package from the uploaded documents"

Initial plan (derived automatically):
  1. Classify each document by type (SOW, RFP, BRD, discovery notes, brief)
  2. Identify the primary project name, client, and summary from the most authoritative document
  3. Extract business goals, problem statement, target users, and scope
  4. Extract or infer functional and non-functional requirements
  5. Extract assumptions, constraints, risks, and dependencies
  6. Extract technology stack, integrations, and compliance considerations
  7. Extract milestones, stakeholders, and success criteria
  8. Detect conflicts between documents and flag them
  9. Identify missing critical fields
  10. Synthesise a domain knowledge brief for downstream agents
  11. Return structured JSON with field-level confidence and source attribution

Available tools:
  - classify_document(docIndex): returns document type classification
  - extract_section(docIndex, sectionHint): returns the best matching section from a document
  - compare_field_across_docs(fieldName): returns values for a field from all documents
  - validate_extraction_coverage(): returns list of missing required fields

Max iterations: 6
```

The agent produces a JSON extraction package (see Section 8) inside FINAL_OUTPUT.

---

## 7. Multi-Document Ingestion and Extraction Flow

```
Browser
  │
  ├─ File selected (drop or browse)
  │   ├─ Validate type (PDF/DOCX/TXT) + size (≤10MB)
  │   ├─ Extract text client-side:
  │   │   ├─ PDF    → PDF.js (loaded from CDN or npm)
  │   │   ├─ DOCX   → mammoth.js (already available in this project for exports)
  │   │   └─ TXT    → FileReader.readAsText()
  │   └─ Store in component state: { name, type, size, text, charCount }
  │
  ├─ "Analyse Documents" clicked
  │   ├─ Build extraction userPrompt (see below)
  │   ├─ Build extraction systemPrompt (see Section 9)
  │   └─ Call runL3Agent(projectContextExtractorDef, minimalCtx, options)
  │       ├─ Iteration 1: LLM classifies docs, calls classify_document tool
  │       ├─ Iteration 2: Extracts primary fields via extract_section tool
  │       ├─ Iteration 3: Cross-document comparison via compare_field_across_docs
  │       ├─ Iteration 4: Coverage validation + conflict detection
  │       ├─ Iteration 5: Synthesises domain knowledge
  │       └─ FINAL_OUTPUT: { extractionPackage: ExtractionPackage }
  │
  ├─ Parse ExtractionPackage from FINAL_OUTPUT
  ├─ Prefill form state from extractionPackage.fields
  └─ Advance to Step 3 (Review)
```

**Extraction user prompt format:**
```
You are analysing the following project documents to extract context for a new software project.

DOCUMENT 1 — sow-v2.pdf (PDF, 12,450 characters)
===================================================
[full extracted text]

DOCUMENT 2 — project-brief.docx (DOCX, 3,200 characters)
==========================================================
[full extracted text]

Extract a complete project context package. Return ONLY valid JSON inside FINAL_OUTPUT.
The JSON must conform to the ExtractionPackage schema (see system prompt).
```

---

## 8. Project Context Package Design

The `ExtractionPackage` is the authoritative output of the extraction agent. It is stored in the project record and injected (formatted) into `domainKnowledge` for all downstream agents.

```typescript
interface ExtractedField {
  value: string;                                         // Extracted or inferred value
  confidence: number;                                    // 0.0 – 1.0
  method: 'extracted' | 'inferred' | 'missing' | 'conflict' | 'user-edited' | 'user-rejected';
  sourceFile?: string;                                   // e.g. "sow-v2.pdf"
  sourceSection?: string;                               // e.g. "Section 1.1 – Project Overview"
  sourceExcerpt?: string;                               // Up to 300 chars of source text
  rationale?: string;                                   // Why this value was chosen
  conflictValues?: Array<{ value: string; sourceFile: string }>; // For method=conflict
  userEditedAt?: number;                                // Timestamp of last user edit
}

interface ExtractionPackage {
  extractedAt: number;
  documentCount: number;
  documentClassifications: Array<{ name: string; type: string; confidence: number }>;
  fields: {
    projectName:              ExtractedField;
    clientOrBusinessUnit:     ExtractedField;
    projectSummary:           ExtractedField;
    businessGoals:            ExtractedField;
    problemStatement:         ExtractedField;
    targetUsers:              ExtractedField;
    domain:                   ExtractedField;           // Maps to DomainId
    scope:                    ExtractedField;
    outOfScope:               ExtractedField;
    keyFeatures:              ExtractedField;
    functionalRequirements:   ExtractedField;
    nonFunctionalRequirements:ExtractedField;
    assumptions:              ExtractedField;
    constraints:              ExtractedField;
    risks:                    ExtractedField;
    dependencies:             ExtractedField;
    milestones:               ExtractedField;
    complianceAndSecurity:    ExtractedField;
    stakeholders:             ExtractedField;
    techStack:                ExtractedField;
    integrationPoints:        ExtractedField;
    successCriteria:          ExtractedField;
    owner:                    ExtractedField;           // Maps to Project.owner
    team:                     ExtractedField;
    agentGuidance:            ExtractedField;           // Downstream agent instructions
  };
  missingFields: string[];
  conflicts: Array<{ field: string; values: Array<{ value: string; sourceFile: string }> }>;
  domainKnowledgeSummary: string;                       // Formatted for agent prompts
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
  approvalRecord?: {
    approverRole: string;
    approvedAt: number;
    notes?: string;
  };
}
```

---

## 9. Data Model

### New: `ExtractedField` and `ExtractionPackage` (see Section 8)

### Extended: `Project` type (project.types.ts)
```typescript
// Add to existing Project interface:
sourceDocumentIds?: string[];      // IDs of ProjectDocument records
extractionPackage?: ExtractionPackage;
approvalRecord?: {
  approverRole: string;
  approvedAt: number;
  notes?: string;
};
```

### New: `ProjectDocument` (stored in Dexie `projectDocuments` table)
```typescript
interface ProjectDocument {
  id: string;                     // crypto.randomUUID()
  projectId: string;              // FK to Project.id
  fileName: string;               // Original file name
  fileType: 'pdf' | 'docx' | 'txt';
  fileSize: number;               // Bytes
  mimeType: string;
  extractedText: string;          // Full client-extracted text
  charCount: number;
  uploadedAt: number;
  uploadedBy?: string;            // TeamMember.id if set
  // Metadata
  documentType?: string;          // Classified by extraction agent: SOW | RFP | BRD | Brief | Notes | Other
  classificationConfidence?: number;
  pageCount?: number;             // PDF only
}
```

### Dexie migration (version 6)
```typescript
this.version(6).stores({
  projects:         'id, domain, status, createdAt, updatedAt',
  integrations:     'id, provider',
  settings:         'key',
  projectDocuments: 'id, projectId, uploadedAt',  // NEW TABLE
});
```

---

## 10. Derived-Field Tagging Approach

Each field in the review form renders a `<FieldBadge>` component:

| Badge        | Colour  | Meaning                                              |
|--------------|---------|------------------------------------------------------|
| EXTRACTED    | #16a34a | Directly quoted from a document; confidence ≥ 0.85   |
| INFERRED     | #d97706 | Reasonably deduced from context; confidence 0.5–0.84 |
| MISSING      | #dc2626 | Not found in any document                            |
| CONFLICT     | #ea580c | Multiple documents disagree on this value            |
| USER-EDITED  | #2563eb | User has overridden the extracted value              |
| USER-REJECTED| #6b7280 | User explicitly cleared the extracted value          |

Confidence bar: rendered as a 10-segment block bar (same `confidenceBar()` function used in AgentThinkingPanel) alongside the percentage.

---

## 11. Confidence Scoring and Validation Rules

The extraction agent is instructed to assign confidence per these rules (injected in system prompt):

```
Confidence 0.95–1.0: Exact verbatim quote from a clear, unambiguous section heading or labelled field
Confidence 0.80–0.94: Paraphrased from a clear source with no ambiguity
Confidence 0.60–0.79: Inferred from related content but not explicitly stated
Confidence 0.40–0.59: Weak inference from indirect clues
Confidence 0.00–0.39: Speculation — must use method: "missing" instead

Rules:
- Never assign method: "extracted" with confidence < 0.60
- Never assign method: "inferred" with confidence < 0.40
- Use method: "missing" + value: "" when evidence is absent
- Use method: "conflict" when two documents give contradictory values for the same field
- The domain field must map to one of: saas, fintech, healthcare, ecommerce, edtech,
  logistics, hrtech, legaltech, proptech, govtech, media, devtools, other
```

Client-side validation (in `ReviewStep.tsx`) enforces:
- `projectName.value` non-empty
- `description.value` non-empty (mapped from problemStatement or projectSummary)
- `owner.value` non-empty (mapped from stakeholders or user input)
- All `method: "conflict"` fields must be resolved by the user before proceeding

---

## 12. Conversational Review Experience

The chat panel shares the same extraction output as the form. It calls `/api/agent` with a dedicated system prompt:

```
You are a project context review assistant. The user has uploaded project documents
and the system has extracted a project context package. Your job is to:
1. Answer questions about WHY a value was extracted (cite the source excerpt)
2. Identify what is missing and suggest what document type would provide it
3. List all assumptions or risks from the extracted context
4. Compare conflicting values across documents
5. Recommend what the user should manually add before creating the project

You have access to:
- The extraction package (all fields, sources, confidence scores)
- The original document text (provided in context)

Rules:
- Always cite the source (file name and section) when explaining an extraction
- Never invent context not present in the documents or extraction package
- If the user asks to edit a field, respond with: FIELD_EDIT: <fieldName>|<newValue>
  so the UI can apply the edit to the form
```

The `FIELD_EDIT:` marker is parsed client-side and an "Apply to form" button appears next to the chat response.

---

## 13. Approval Workflow Design

The approval step (Step 4) is a lightweight, single-approver checkpoint — not a full multi-party workflow (that belongs in the existing ReviewGate system for artifact generation).

```typescript
const APPROVER_ROLES = [
  'Project Owner',
  'Delivery Manager',
  'Solution Architect',
  'Business Sponsor',
  'Admin',
];
```

The approval record is stored in `project.approvalRecord` and in the `domainKnowledge` preamble:

```
## Project Creation Approval
Approved by: Delivery Manager
Approved at: 2026-06-16T10:32:00Z
Notes: Scope confirmed with client. Tech stack TBC at architecture phase.
```

**Gate rules:**
- `projectName` must be non-empty
- `description` must be non-empty  
- `owner` must be non-empty
- Approver role must be selected
- All `method: "conflict"` fields must be resolved
- At least 50% of the 25 extractable fields must have a non-missing value

---

## 14. Backend Architecture

No changes to `proxy.js` are required. The extraction uses the existing `/api/agent` endpoint. The only backend concern is the `express.json({ limit: '2mb' })` middleware — the extraction prompt (all document text + instructions) may exceed this.

**Required change to `proxy.js`:**
```javascript
app.use(express.json({ limit: '10mb' }));  // Was 2mb — increase for extraction prompts
```

This is the only backend change. All storage, extraction, and document management is client-side (IndexedDB via Dexie).

---

## 15. Frontend Architecture

### New files:
```
frontend/src/
├── components/
│   └── createProject/
│       ├── CreateProjectPage.tsx         ← Full-screen wizard root
│       ├── CreateProjectPage.module.css
│       ├── UploadStep.tsx                ← Step 1: drag-drop + file list
│       ├── ExtractionStep.tsx            ← Step 2: L3 trace + progress
│       ├── ReviewStep.tsx                ← Step 3: form + source panel + chat
│       ├── ApprovalStep.tsx              ← Step 4: summary + role + create
│       ├── FieldBadge.tsx                ← Reusable badge component
│       ├── SourcePanel.tsx               ← Source excerpt drawer/panel
│       ├── ConversationalReview.tsx      ← Chat panel
│       └── MissingFieldsPanel.tsx        ← Missing + conflicts summary
├── services/
│   └── documentExtractor.ts             ← Client-side text extraction (PDF/DOCX/TXT)
│   └── projectContextAgent.ts           ← L3 agent def + extraction runner
├── types/
│   └── extraction.types.ts              ← ExtractedField, ExtractionPackage, ProjectDocument
└── db/
    └── database.ts                      ← Add version(6) with projectDocuments table
```

### Modified files:
```
frontend/src/
├── App.tsx                              ← Route to CreateProjectPage (fullscreen, no modal)
├── components/dashboard/Dashboard.tsx  ← "New Project" opens CreateProjectPage not modal
├── types/project.types.ts              ← Add sourceDocumentIds, extractionPackage, approvalRecord
└── db/
    ├── database.ts                     ← version(6) migration
    └── projectRepository.ts            ← addProjectDocument(), getProjectDocuments()
```

### State machine (CreateProjectPage):
```typescript
type WizardStep = 'upload' | 'extracting' | 'review' | 'approval';

interface WizardState {
  step: WizardStep;
  files: UploadedFile[];
  extractionPackage: ExtractionPackage | null;
  formValues: ProjectFormValues;         // User-editable mirror of extraction fields
  chatHistory: ChatMessage[];
  approverRole: string;
  approvalNotes: string;
  creating: boolean;
  error: string | null;
}
```

---

## 16. API Design

All extraction goes through the existing `/api/agent` endpoint. No new API routes needed.

### Extraction call:
```typescript
POST /api/agent
{
  "systemPrompt": "<projectContextExtractor system prompt>",
  "userPrompt": "<concatenated documents + extraction instructions>",
  "agentId": "projectContextExtractor",
  "provider": "openai"  // or "claude" per user/app setting
}
```

### Conversational review call:
```typescript
POST /api/agent
{
  "systemPrompt": "<conversational review assistant system prompt>",
  "userPrompt": "<chat history + user question>",
  "agentId": "contextReviewChat"
}
```

### `projectDocuments` repository methods (new):
```typescript
// db/projectRepository.ts additions
export async function addProjectDocument(doc: ProjectDocument): Promise<void>
export async function getProjectDocuments(projectId: string): Promise<ProjectDocument[]>
export async function deleteProjectDocument(docId: string): Promise<void>
```

---

## 17. Security and Compliance Controls

Given this app currently runs client-side with no auth layer, these controls are pragmatic for the current architecture:

| Control                    | Implementation                                                      |
|----------------------------|---------------------------------------------------------------------|
| File type validation       | Check MIME type + extension; reject non-PDF/DOCX/TXT                |
| File size limit            | 10MB per file, 25MB total — enforced before text extraction         |
| Malware scanning           | Not possible client-side — document in README as known limitation   |
| Content in transit         | All LLM calls go through proxy.js over HTTPS                        |
| Extraction data at rest    | Stored in IndexedDB (browser-sandboxed); same as all project data   |
| PII detection              | Extraction agent instructed to flag PII fields (names, emails) in   |
|                            | its output; UI shows a ⚠ PII indicator on flagged fields            |
| Data used for extraction   | Consent banner shown before extraction: "Your document content will |
|                            | be sent to the configured LLM provider for context extraction."     |
| Document retention         | User can delete project (which cascades to projectDocuments)        |
| Access control             | Same as existing: no server-side auth; project-scoped in IndexedDB  |
| Audit logging              | approvalRecord timestamps stored in project; extraction timestamped |

---

## 18. Error Handling and Edge Cases

| Scenario                          | Handling                                                              |
|-----------------------------------|-----------------------------------------------------------------------|
| PDF with scanned images only      | Text extraction returns empty string; show "No text found in PDF"     |
| DOCX with embedded images/tables  | mammoth.js extracts text only; tables become plain text               |
| LLM returns malformed JSON        | Parse error caught; show retry button; fallback to manual form        |
| Partial extraction (some fields)  | Valid — form shows partial results with MISSING badges                |
| Files with conflicting project names | Conflict flagged; user chooses in Step 3                           |
| Network failure during extraction | Error state with "Retry extraction" button; files kept in state       |
| User uploads same file twice      | Deduplicated by name+size hash before sending                         |
| Extraction exceeds 8192 tokens    | Truncate document text at 6000 chars per file with a notice           |
| User closes wizard mid-flow       | State is not persisted (no draft project) — confirmation dialog shown |
| Very large document (>50k chars)  | Chunked extraction: first 6000 chars + table-of-contents hint         |

---

## 19. Acceptance Criteria

### AC-01: Upload flow
- Upload 1 PDF, 1 DOCX, 1 TXT — all show as "Ready" with char counts
- Upload a .xlsx file — rejected with error "Unsupported file type"
- Upload a 12MB PDF — rejected with "File exceeds 10MB limit"
- Remove a file — it disappears from the list, char count updates

### AC-02: Extraction
- Click "Analyse Documents" with 2 files — extraction progress shows plan steps
- Extraction completes — form auto-populates ≥ 10 fields from a typical SOW
- A field present in both docs with different values shows as CONFLICT badge
- A field absent from all docs shows as MISSING badge

### AC-03: Review form
- Click EXTRACTED badge on Project Name — Source Panel opens showing file name, section, excerpt
- Edit Project Name — badge changes to USER-EDITED
- Click ✕ on a field value — badge changes to USER-REJECTED, value clears
- Open Chat tab — type "What is missing?" — response lists MISSING fields

### AC-04: Approval step
- "Create Project" button is disabled if Owner is empty
- "Create Project" button is disabled if no approver role is selected
- "Create Project" button is disabled if any CONFLICT fields are unresolved
- Select role, fill notes, click Create — project created, workspace opens

### AC-05: Post-creation
- New project's domainKnowledge contains the extracted summary
- Project has sourceDocumentIds array with IDs of uploaded documents
- Project Settings tab shows "Source Documents" section with uploaded file names

---

## 20. Test Scenarios

### Happy path
1. Upload SOW PDF → extraction → 18/25 fields extracted → review → approve → create → workspace loads
2. Upload RFP + project brief → conflicts detected → user resolves → approve → create

### Edge cases  
3. Upload only a TXT notes file → 8/25 fields extracted → rest marked MISSING → user fills manually → create
4. Conversational review: "Why was React selected?" → response cites SOW section 4.2 with excerpt
5. Conversational review: "What risks did you find?" → lists 3 risks from extraction with sources
6. FIELD_EDIT via chat → "Apply" clicked → form field updates, badge turns USER-EDITED

### Error cases
7. LLM returns non-JSON in FINAL_OUTPUT → error shown → "Retry" re-runs extraction → success
8. Network timeout during extraction → error state → "Retry" works on second attempt
9. Skip upload → manual form → matches existing NewProjectModal behaviour exactly

---

## 21. Open Questions and Assumptions

**OQ-01:** Should the extraction prompt include the full document text or a truncated version?
*Assumption: First 6,000 chars per document. Documents over 50,000 total chars get the first 4,000 chars each with a note that the document was truncated.*

**OQ-02:** Should extraction use the `runL3Agent` runtime directly, or a simplified single-shot call?
*Assumption: L3 for documents ≥ 2 files or ≥ 5,000 chars total (multi-doc comparison benefits from iterative tool calls). Single-shot for a single small TXT file.*

**OQ-03:** Should the extraction agent definition be added to `definitions.ts` alongside pipeline agents?
*Assumption: No — it's a pre-pipeline utility agent. Defined inline in `projectContextAgent.ts` to avoid polluting AgentId union type.*

**OQ-04:** Where should the source document text live long-term?
*Assumption: IndexedDB `projectDocuments` table. This is sufficient for current client-side architecture. A future backend migration can move to S3/blob storage.*

**OQ-05:** Should the conversational review chat history be persisted to the project?
*Assumption: Yes, stored in `project.extractionPackage.conversationHistory`. Visible in Project Settings for audit purposes.*

**OQ-06:** Should mammoth.js be added as an npm dependency?
*Assumption: No — it's already used in `documentExporter.ts`. Confirm import path before building.*
