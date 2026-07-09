/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
/**
 * Project Context Extraction Agent
 *
 * A standalone L3 agent (NOT part of the pipeline) that analyses uploaded
 * project documents and extracts a structured ExtractionPackage.
 *
 * Uses the same L3 runtime as pipeline agents (runL3Agent) but runs
 * pre-project-creation, so it operates with a minimal AgentPromptContext.
 *
 * The agent's FINAL_OUTPUT must be a JSON block containing ExtractionPackage.
 */

import { api, extractText as extractApiText } from './api';
import type { ExtractionPackage, ExtractionFields, ExtractedField, UploadedFile } from '@/types/extraction.types';
import type { AgentDefinition, AgentPromptContext, AgentTool, L3RuntimeMeta } from '@/types/agent.types';
import { buildExtractionPrompt } from './documentExtractor';
import { runL3Agent } from './l3Runtime';
import type { L3RunResult } from './l3Runtime';

// ─── Tool registry (extraction-specific tools) ────────────────────────────────

function buildExtractionTools(files: UploadedFile[]): AgentTool[] {

  const classifyDocumentTool: AgentTool = {
    name: 'classify_document',
    description:
      'Classify an uploaded document by type (SOW, RFP, BRD, Brief, Discovery, Notes, Other). ' +
      'Use this first to understand what each document represents before extracting fields.',
    inputSchema: {
      type: 'object',
      required: ['docIndex'],
      properties: {
        docIndex: {
          type: 'number',
          description: '1-based index of the document to classify (1 = first uploaded document).',
        },
      },
    },
    execute: async (args, _ctx) => {
      const idx = Number(args.docIndex ?? 1) - 1;
      const file = files[idx];
      if (!file) return { error: `Document ${args.docIndex} not found. Total documents: ${files.length}` };
      const preview = file.extractedText.slice(0, 1500);
      return {
        docIndex: idx + 1,
        name: file.name,
        charCount: file.charCount,
        preview,
        hint: 'Classify this document based on its structure, headings, and content.',
      };
    },
  };

  const extractSectionTool: AgentTool = {
    name: 'extract_section',
    description:
      'Extract the most relevant section from a document matching a topic hint. ' +
      'Use this to pull specific sections (e.g. "project scope", "requirements", "risks") from each document.',
    inputSchema: {
      type: 'object',
      required: ['docIndex', 'sectionHint'],
      properties: {
        docIndex: {
          type: 'number',
          description: '1-based document index.',
        },
        sectionHint: {
          type: 'string',
          description: 'Topic to look for (e.g. "scope", "requirements", "risks", "timeline", "tech stack").',
        },
      },
    },
    execute: async (args, _ctx) => {
      const idx = Number(args.docIndex ?? 1) - 1;
      const file = files[idx];
      if (!file) return { error: `Document ${args.docIndex} not found.` };

      const hint = String(args.sectionHint ?? '').toLowerCase();
      const text = file.extractedText;
      const lines = text.split('\n');

      // Find the line that best matches the section hint
      let bestIdx = -1;
      let bestScore = 0;
      lines.forEach((line, i) => {
        const lower = line.toLowerCase();
        const hintWords = hint.split(/\s+/);
        const matchCount = hintWords.filter(w => lower.includes(w)).length;
        if (matchCount > bestScore && line.trim().length > 0) {
          bestScore = matchCount;
          bestIdx = i;
        }
      });

      if (bestIdx === -1) {
        // Return a window around the middle of the document
        const mid = Math.floor(lines.length / 2);
        const excerpt = lines.slice(Math.max(0, mid - 10), mid + 20).join('\n');
        return { found: false, excerpt, hint };
      }

      const start = Math.max(0, bestIdx - 2);
      const end = Math.min(lines.length, bestIdx + 30);
      const excerpt = lines.slice(start, end).join('\n');
      return {
        found: true,
        docName: file.name,
        matchedLine: lines[bestIdx],
        lineNumber: bestIdx + 1,
        excerpt: excerpt.slice(0, 1200),
      };
    },
  };

  const compareFieldTool: AgentTool = {
    name: 'compare_field_across_docs',
    description:
      'Search all uploaded documents for a specific field or topic and return matching excerpts from each. ' +
      'Use this when multiple documents may contain the same information (e.g. project name, timeline) ' +
      'to detect conflicts or find the most authoritative source.',
    inputSchema: {
      type: 'object',
      required: ['fieldHint'],
      properties: {
        fieldHint: {
          type: 'string',
          description: 'The field or topic to search for across all documents (e.g. "project name", "budget", "deadline").',
        },
      },
    },
    execute: async (args, _ctx) => {
      const hint = String(args.fieldHint ?? '').toLowerCase();
      const results: Array<{ docName: string; excerpt: string }> = [];

      for (const file of files) {
        const lines = file.extractedText.split('\n');
        const matchedLine = lines.find(l => l.toLowerCase().includes(hint));
        if (matchedLine) {
          const idx = lines.indexOf(matchedLine);
          const start = Math.max(0, idx - 1);
          const end = Math.min(lines.length, idx + 5);
          results.push({
            docName: file.name,
            excerpt: lines.slice(start, end).join('\n').slice(0, 400),
          });
        }
      }

      return results.length > 0
        ? { found: true, results }
        : { found: false, message: `No matches for "${hint}" found across documents.` };
    },
  };

  const validateCoverageTool: AgentTool = {
    name: 'validate_extraction_coverage',
    description:
      'Returns a checklist of all 25 required extraction fields. ' +
      'Call this after you have extracted as many fields as possible to confirm which are still missing.',
    inputSchema: {
      type: 'object',
      properties: {
        extractedFields: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of field names you have already extracted values for.',
        },
      },
    },
    execute: async (args, _ctx) => {
      const ALL_FIELDS = [
        'projectName', 'clientOrBusinessUnit', 'projectSummary', 'businessGoals',
        'problemStatement', 'targetUsers', 'domain', 'scope', 'outOfScope',
        'keyFeatures', 'functionalRequirements', 'nonFunctionalRequirements',
        'assumptions', 'constraints', 'risks', 'dependencies', 'milestones',
        'complianceAndSecurity', 'stakeholders', 'techStack', 'integrationPoints',
        'successCriteria', 'owner', 'team', 'agentGuidance',
      ];

      const extracted = Array.isArray(args.extractedFields)
        ? (args.extractedFields as string[])
        : [];

      const missing = ALL_FIELDS.filter(f => !extracted.includes(f));
      const coverage = Math.round((extracted.length / ALL_FIELDS.length) * 100);

      return { coverage: `${coverage}%`, extracted: extracted.length, missing, total: ALL_FIELDS.length };
    },
  };

  return [classifyDocumentTool, extractSectionTool, compareFieldTool, validateCoverageTool];
}

// ─── Agent definition ─────────────────────────────────────────────────────────

const EXTRACTION_SYSTEM_PROMPT = `You are an expert project context analyst. Your task is to read the uploaded project documents and extract a complete, structured project context package.

## Extraction Rules
- Extract only what is explicitly stated or clearly implied in the documents.
- Never hallucinate values that are not present or reasonably inferable.
- When a field is not mentioned in any document, set method to "missing" and value to "".
- When two documents give contradictory values for the same field, set method to "conflict".
- Only use method "extracted" (confidence ≥ 0.80) when you have a direct textual quote.
- Only use method "inferred" (confidence 0.50–0.79) when you can reasonably deduce the value.
- Anything below confidence 0.50 must be method "missing".

## Confidence Scoring
- 0.95–1.0: Exact verbatim quote from a clearly labelled section
- 0.80–0.94: Paraphrased from an unambiguous source
- 0.60–0.79: Inferred from related content
- 0.40–0.59: Weak inference
- Below 0.40: Use method "missing"

## Domain Mapping
The "domain" field must be exactly one of: saas, fintech, healthcare, ecommerce, edtech, logistics, hrtech, legaltech, proptech, govtech, media, devtools, other

## Required Output Format
Your FINAL_OUTPUT must be ONLY valid JSON. No preamble, no explanation, no markdown code fences.
The JSON must exactly match this structure:

{
  "extractedAt": <unix timestamp ms>,
  "documentCount": <number>,
  "documentClassifications": [{"name": "...", "type": "SOW|RFP|BRD|Brief|Discovery|Notes|Other", "confidence": 0.0}],
  "fields": {
    "projectName":               {"value":"","confidence":0,"method":"missing","sourceFile":"","sourceSection":"","sourceExcerpt":"","rationale":""},
    "clientOrBusinessUnit":      {"value":"","confidence":0,"method":"missing",...},
    "projectSummary":            {"value":"","confidence":0,"method":"missing",...},
    "businessGoals":             {"value":"","confidence":0,"method":"missing",...},
    "problemStatement":          {"value":"","confidence":0,"method":"missing",...},
    "targetUsers":               {"value":"","confidence":0,"method":"missing",...},
    "domain":                    {"value":"saas","confidence":0,"method":"missing",...},
    "scope":                     {"value":"","confidence":0,"method":"missing",...},
    "outOfScope":                {"value":"","confidence":0,"method":"missing",...},
    "keyFeatures":               {"value":"","confidence":0,"method":"missing",...},
    "functionalRequirements":    {"value":"","confidence":0,"method":"missing",...},
    "nonFunctionalRequirements": {"value":"","confidence":0,"method":"missing",...},
    "assumptions":               {"value":"","confidence":0,"method":"missing",...},
    "constraints":               {"value":"","confidence":0,"method":"missing",...},
    "risks":                     {"value":"","confidence":0,"method":"missing",...},
    "dependencies":              {"value":"","confidence":0,"method":"missing",...},
    "milestones":                {"value":"","confidence":0,"method":"missing",...},
    "complianceAndSecurity":     {"value":"","confidence":0,"method":"missing",...},
    "stakeholders":              {"value":"","confidence":0,"method":"missing",...},
    "techStack":                 {"value":"","confidence":0,"method":"missing",...},
    "integrationPoints":         {"value":"","confidence":0,"method":"missing",...},
    "successCriteria":           {"value":"","confidence":0,"method":"missing",...},
    "owner":                     {"value":"","confidence":0,"method":"missing",...},
    "team":                      {"value":"","confidence":0,"method":"missing",...},
    "agentGuidance":             {"value":"","confidence":0,"method":"missing",...}
  },
  "missingFields": [],
  "conflicts": [],
  "domainKnowledgeSummary": "## Extracted Project Context\\n..."
}

The "agentGuidance" field should contain specific instructions for downstream SDLC agents derived from the documents, formatted as bullet points.
The "domainKnowledgeSummary" should be a formatted markdown brief (## headings) that downstream agents can use as domain knowledge context.`;

function buildMinimalContext(files: UploadedFile[]): AgentPromptContext {
  return {
    projectName: 'New Project (being created)',
    projectDescription: `Extracting context from ${files.length} uploaded document(s)`,
    domain: 'other',
    domainContext: '',
    priorOutputs: {},
    teamRoster: [],
  };
}

// ─── Main extraction runner ───────────────────────────────────────────────────

export interface ExtractionCallbacks {
  onProgress?: (message: string) => void;
  onL3Trace?: (meta: L3RuntimeMeta) => void;
}

export async function runProjectContextExtraction(
  files: UploadedFile[],
  callbacks: ExtractionCallbacks = {}
): Promise<ExtractionPackage> {
  if (files.length === 0) throw new Error('No files provided for extraction');

  callbacks.onProgress?.('Building extraction context...');

  const tools = buildExtractionTools(files);
  const userPrompt = buildExtractionPrompt(
    files.map(f => ({
      name: f.name,
      type: f.type,
      charCount: f.charCount,
      extractedText: f.extractedText,
    }))
  );

  const agentDef: AgentDefinition = {
    id: 'manager' as const,       // Borrow a valid AgentId for type compat; not used for routing
    name: 'Project Context Extractor',
    phase: 'phase1',
    description: 'Extracts project context from uploaded documents',
    outputLabel: 'Extraction Package',
    systemPrompt: EXTRACTION_SYSTEM_PROMPT,
    buildUserPrompt: () => userPrompt,
    goal: () =>
      `Extract a complete, sourced project context package from the ${files.length} uploaded document(s). ` +
      `Classify each document, extract all 25 context fields with confidence scores and source attribution, ` +
      `detect conflicts, identify missing fields, and synthesise a domain knowledge brief.`,
    tools,
    maxIterations: 6,
  };

  callbacks.onProgress?.('Starting L3 extraction agent...');

  let l3Result: L3RunResult;
  try {
    l3Result = await runL3Agent(agentDef, buildMinimalContext(files), {
      systemPrompt: EXTRACTION_SYSTEM_PROMPT,
      userPrompt,
      agentId: 'projectContextExtractor',
    });
  } catch (err) {
    throw new Error(`Extraction agent failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  callbacks.onL3Trace?.(l3Result.l3);
  callbacks.onProgress?.('Parsing extraction output...');

  // ── Parse JSON from FINAL_OUTPUT ──────────────────────────────────────────
  const raw = l3Result.output;
  let parsed: ExtractionPackage;

  try {
    // Try direct parse first
    parsed = JSON.parse(raw);
  } catch {
    // LLM may have wrapped JSON in markdown fences — strip them
    const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]+?)```/) ?? raw.match(/(\{[\s\S]+\})/);
    if (!jsonMatch) {
      throw new Error(
        'Extraction agent did not return valid JSON. Please retry or use the manual form.'
      );
    }
    try {
      parsed = JSON.parse(jsonMatch[1]);
    } catch (e2) {
      throw new Error(
        `Failed to parse extraction JSON: ${e2 instanceof Error ? e2.message : String(e2)}`
      );
    }
  }

  // Validate minimal structure
  if (!parsed.fields || typeof parsed.fields !== 'object') {
    throw new Error('Extraction output is missing required "fields" object.');
  }

  // Ensure extractedAt is set
  parsed.extractedAt = parsed.extractedAt ?? Date.now();
  parsed.documentCount = files.length;
  parsed.conversationHistory = [];

  // Compute missingFields if not set
  if (!Array.isArray(parsed.missingFields)) {
    parsed.missingFields = Object.entries(parsed.fields)
      .filter(([, v]) => (v as ExtractedField).method === 'missing')
      .map(([k]) => k);
  }

  // Compute conflicts if not set
  if (!Array.isArray(parsed.conflicts)) {
    parsed.conflicts = Object.entries(parsed.fields)
      .filter(([, v]) => (v as ExtractedField).method === 'conflict')
      .map(([k, v]) => ({
        field: k,
        values: (v as ExtractedField).conflictValues ?? [],
      }));
  }

  callbacks.onProgress?.('Extraction complete.');
  return parsed;
}

// ─── Conversational review call ───────────────────────────────────────────────

const CHAT_SYSTEM_PROMPT = `You are a project context review assistant.
The user has uploaded project documents and an AI agent has extracted a project context package.
Your job is to help the user understand, validate, and improve the extracted context.

You can:
- Explain why a value was extracted (always cite the source file and section)
- List what is missing and suggest what document type would provide it
- Enumerate all assumptions, risks, or constraints found
- Compare conflicting values across documents
- Recommend what to add manually before creating the project

Rules:
- Only reference information present in the extraction package or documents
- Never invent project details
- If the user wants to edit a field, respond with FIELD_EDIT: <fieldName>|<newValue> on its own line
  (e.g. "FIELD_EDIT: techStack|React, Node.js, PostgreSQL")
- Keep answers concise and directly useful`;

export async function sendReviewChatMessage(
  question: string,
  extractionPackage: ExtractionPackage,
  chatHistory: Array<{ role: 'user' | 'assistant'; content: string }>
): Promise<{ answer: string; proposedEdit?: { fieldName: keyof ExtractionFields; value: string } }> {

  const contextBlock = `
## Extraction Package Summary
- Documents: ${extractionPackage.documentCount}
- Missing fields: ${extractionPackage.missingFields.join(', ') || 'none'}
- Conflicts: ${extractionPackage.conflicts.map(c => c.field).join(', ') || 'none'}

## Extracted Fields
${Object.entries(extractionPackage.fields)
  .map(([k, v]) => {
    const f = v as ExtractedField;
    return `- ${k}: ${f.value ? `"${f.value.slice(0, 80)}"` : '(missing)'} [${f.method}, confidence: ${Math.round(f.confidence * 100)}%${f.sourceFile ? `, source: ${f.sourceFile}` : ''}]`;
  })
  .join('\n')}`;

  const historyBlock = chatHistory
    .slice(-6)  // Last 6 turns for context
    .map(m => `[${m.role.toUpperCase()}]: ${m.content}`)
    .join('\n\n');

  const userPrompt = `${contextBlock}\n\n## Chat History\n${historyBlock}\n\n## User Question\n${question}`;

  const resp = await api.callAgent({
    systemPrompt: CHAT_SYSTEM_PROMPT,
    userPrompt,
    agentId: 'contextReviewChat',
  });

  const answer = extractApiText(resp).trim();

  // Parse FIELD_EDIT: marker
  const editMatch = answer.match(/FIELD_EDIT:\s*(\w+)\|(.+)/);
  if (editMatch) {
    const fieldName = editMatch[1] as keyof ExtractionFields;
    const value = editMatch[2].trim();
    const cleanAnswer = answer.replace(/FIELD_EDIT:\s*\w+\|.+/g, '').trim();
    return { answer: cleanAnswer, proposedEdit: { fieldName, value } };
  }

  return { answer };
}

// ─── Format extraction package as domain knowledge ────────────────────────────

export function formatExtractionAsDomainKnowledge(pkg: ExtractionPackage): string {
  const f = pkg.fields;

  const section = (label: string, field: ExtractedField | undefined): string => {
    if (!field || field.method === 'missing' || !field.value) return '';
    return `## ${label}\n${field.value}\n`;
  };

  const approvalSection = pkg.approvalRecord
    ? `## Project Creation Approval\nApproved by: ${pkg.approvalRecord.approverRole}\nApproved at: ${new Date(pkg.approvalRecord.approvedAt).toISOString()}\n${pkg.approvalRecord.notes ? `Notes: ${pkg.approvalRecord.notes}\n` : ''}\n`
    : '';

  return [
    `# Extracted Project Context\n`,
    `*Extracted from ${pkg.documentCount} uploaded document(s) on ${new Date(pkg.extractedAt).toLocaleDateString()}.*\n`,
    section('Client / Business Unit', f.clientOrBusinessUnit),
    section('Project Summary', f.projectSummary),
    section('Business Goals', f.businessGoals),
    section('Problem Statement', f.problemStatement),
    section('Target Users', f.targetUsers),
    section('Scope', f.scope),
    section('Out of Scope', f.outOfScope),
    section('Key Features', f.keyFeatures),
    section('Functional Requirements', f.functionalRequirements),
    section('Non-Functional Requirements', f.nonFunctionalRequirements),
    section('Assumptions', f.assumptions),
    section('Constraints', f.constraints),
    section('Risks', f.risks),
    section('Dependencies', f.dependencies),
    section('Milestones', f.milestones),
    section('Compliance & Security', f.complianceAndSecurity),
    section('Stakeholders', f.stakeholders),
    section('Technology Stack', f.techStack),
    section('Integration Points', f.integrationPoints),
    section('Success Criteria', f.successCriteria),
    section('Agent Generation Guidance', f.agentGuidance),
    pkg.domainKnowledgeSummary ? `\n---\n${pkg.domainKnowledgeSummary}` : '',
    approvalSection ? `\n---\n${approvalSection}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}
