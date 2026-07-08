/**
 * © 2025 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
/**
 * Document Agent — Phase 1 DocumentSpec registry.
 *
 * See docs/Document-Agent-Feature-Plan.md Section 4.1 and Section 3.1/5 for the
 * full design and the "why 19, not 16" correction. This registry covers the 19
 * documents (of the AppDocs 72-document pack) that already have a direct,
 * existing pipeline agent as their primary source — no cross-agent synthesis
 * needed, just reformatting real agent output into the AppDocs template shape
 * with project-specific context layered in (see documentAgentService.ts).
 *
 * The ~53 remaining Synthesis-type documents (Section 6 of the plan) are
 * Phase 3 work and are NOT in this file yet.
 *
 * generator:
 *   'llm'           — standard path: read the AppDocs prompt file, fetch
 *                      sourceAgents' outputs + Context Absorption bundle, run
 *                      one L3 generation loop, persist the result.
 *   'traceability'   — special case for #16: wraps the already-implemented
 *                      generateTraceabilityMatrix() (services/traceability.ts)
 *                      instead of an LLM call — cheaper and more accurate than
 *                      re-deriving what that function already computes exactly.
 */

import type { AgentId } from '@/types/agent.types';

export interface DocumentSpec {
  /** Matches project_documents.doc_id and the AppDocs/AgenticSDLC_Docs filename stem */
  id: string;
  /** Display title, e.g. "Project Charter" */
  title: string;
  /** AppDocs/AgenticSDLC_Docs folder name, e.g. "Discovery_Initiation" */
  category: string;
  /** Path to the corresponding AppDocs prompt file, relative to repo root */
  promptFile: string;
  /**
   * Agent IDs whose completed output grounds this document. A document is
   * eligible for generation once ALL of these agents have status 'complete'
   * (see documentAgentService.ts isEligible). Empty array means the document
   * only depends on project-level context (domain, tech stack, uploads), not
   * any specific agent — eligible as soon as the Context Absorption step has
   * run once for the project.
   */
  sourceAgents: AgentId[];
  /** Per the prompt file's own stated output format */
  outputFormat: 'docx' | 'md';
  generator: 'llm' | 'traceability';
}

export const DOCUMENT_PACK: DocumentSpec[] = [
  {
    id: '01_project_charter',
    title: 'Project Charter',
    category: 'Discovery_Initiation',
    promptFile: 'AppDocs/Discovery_Initiation/01_Project_Charter_Prompt.md',
    sourceAgents: ['projectCharter'],
    outputFormat: 'docx',
    generator: 'llm',
  },
  {
    id: '04_stakeholder_register',
    title: 'Stakeholder Register',
    category: 'Discovery_Initiation',
    promptFile: 'AppDocs/Discovery_Initiation/04_Stakeholder_Register_Prompt.md',
    sourceAgents: ['stakeholder'],
    outputFormat: 'docx',
    generator: 'llm',
  },
  {
    id: '09_business_requirements_document',
    title: 'Business Requirements Document',
    category: 'Requirements',
    promptFile: 'AppDocs/Requirements/09_Business_Requirements_Document_Prompt.md',
    sourceAgents: ['brd'],
    outputFormat: 'docx',
    generator: 'llm',
  },
  {
    id: '10_product_requirements_document',
    title: 'Product Requirements Document',
    category: 'Requirements',
    promptFile: 'AppDocs/Requirements/10_Product_Requirements_Document_Prompt.md',
    sourceAgents: ['manager'],
    outputFormat: 'docx',
    generator: 'llm',
  },
  {
    id: '14_user_stories_use_case_document',
    title: 'User Stories / Use Case Document',
    category: 'Requirements',
    promptFile: 'AppDocs/Requirements/14_User_Stories_Use_Case_Document_Prompt.md',
    sourceAgents: ['userStory'],
    outputFormat: 'docx',
    generator: 'llm',
  },
  {
    id: '16_requirements_traceability_matrix',
    title: 'Requirements Traceability Matrix',
    category: 'Requirements',
    promptFile: 'AppDocs/Requirements/16_Requirements_Traceability_Matrix_Prompt.md',
    // Depends on all three source agents traceability.ts pulls IDs from
    // (userStory: US-xxx, brd: BR-xxx/FR-xxx, testCases: TC-xxx).
    sourceAgents: ['userStory', 'brd', 'testCases'],
    outputFormat: 'docx',
    generator: 'traceability',
  },
  {
    id: '17_domain_context_document',
    title: 'Domain Context Document',
    category: 'Requirements',
    promptFile: 'AppDocs/Requirements/17_Domain_Context_Document_Prompt.md',
    // Not grounded in any single agent — eligible once Context Absorption has
    // run once for the project (domain, tech stack, uploads, style guide).
    sourceAgents: [],
    outputFormat: 'docx',
    generator: 'llm',
  },
  {
    id: '18_architecture_document',
    title: 'Architecture Document',
    category: 'Architecture_Design',
    promptFile: 'AppDocs/Architecture_Design/18_Architecture_Document_Prompt.md',
    sourceAgents: ['architecture'],
    // This is the one prompt file (of 72) that explicitly targets Markdown —
    // same exception applied when this pack was hand-built earlier.
    outputFormat: 'md',
    generator: 'llm',
  },
  {
    id: '23_data_model_erd_document',
    title: 'Data Model / ERD Document',
    category: 'Architecture_Design',
    promptFile: 'AppDocs/Architecture_Design/23_Data_Model_ERD_Document_Prompt.md',
    sourceAgents: ['dataModel'],
    outputFormat: 'docx',
    generator: 'llm',
  },
  {
    id: '24_api_design_document',
    title: 'API Design Document',
    category: 'Architecture_Design',
    promptFile: 'AppDocs/Architecture_Design/24_API_Design_Document_Prompt.md',
    sourceAgents: ['apiDesign'],
    outputFormat: 'docx',
    generator: 'llm',
  },
  {
    id: '26_security_architecture_document',
    title: 'Security Architecture Document',
    category: 'Architecture_Design',
    promptFile: 'AppDocs/Architecture_Design/26_Security_Architecture_Document_Prompt.md',
    sourceAgents: ['securityCompliance'],
    outputFormat: 'docx',
    generator: 'llm',
  },
  {
    id: '27_infrastructure_architecture_document',
    title: 'Infrastructure Architecture Document',
    category: 'Architecture_Design',
    promptFile: 'AppDocs/Architecture_Design/27_Infrastructure_Architecture_Document_Prompt.md',
    sourceAgents: ['infraEngineer'],
    outputFormat: 'docx',
    generator: 'llm',
  },
  {
    id: '31_ux_research_document',
    title: 'UX Research Document',
    category: 'UX_UI',
    promptFile: 'AppDocs/UX_UI/31_UX_Research_Document_Prompt.md',
    sourceAgents: ['uxResearch'],
    outputFormat: 'docx',
    generator: 'llm',
  },
  {
    id: '33_wireframes_mockups_document',
    title: 'Wireframes / Mockups Document',
    category: 'UX_UI',
    promptFile: 'AppDocs/UX_UI/33_Wireframes_Mockups_Document_Prompt.md',
    sourceAgents: ['uxMockups'],
    outputFormat: 'docx',
    generator: 'llm',
  },
  {
    id: '37_coding_standards_document',
    title: 'Coding Standards Document',
    category: 'Development',
    promptFile: 'AppDocs/Development/37_Coding_Standards_Document_Prompt.md',
    sourceAgents: ['codeReviewStandards'],
    outputFormat: 'docx',
    generator: 'llm',
  },
  {
    id: '39_code_review_checklist',
    title: 'Code Review Checklist',
    category: 'Development',
    promptFile: 'AppDocs/Development/39_Code_Review_Checklist_Prompt.md',
    // Same source agent as #37 — one agent output, two different document framings.
    sourceAgents: ['codeReviewStandards'],
    outputFormat: 'docx',
    generator: 'llm',
  },
  {
    id: '43_test_plan',
    title: 'Test Plan',
    category: 'Testing_Quality',
    promptFile: 'AppDocs/Testing_Quality/43_Test_Plan_Prompt.md',
    sourceAgents: ['testPlan'],
    outputFormat: 'docx',
    generator: 'llm',
  },
  {
    id: '44_test_case_document',
    title: 'Test Case Document',
    category: 'Testing_Quality',
    promptFile: 'AppDocs/Testing_Quality/44_Test_Case_Document_Prompt.md',
    sourceAgents: ['testCases'],
    outputFormat: 'docx',
    generator: 'llm',
  },
  {
    id: '64_monitoring_and_observability_document',
    title: 'Monitoring and Observability Document',
    category: 'Operations_Support',
    promptFile: 'AppDocs/Operations_Support/64_Monitoring_and_Observability_Document_Prompt.md',
    sourceAgents: ['observabilityEngineer'],
    outputFormat: 'docx',
    generator: 'llm',
  },
];

/** Lookup by doc_id — used by documentAgentService.ts and the Admin Panel status view. */
export const DOCUMENT_PACK_BY_ID: Record<string, DocumentSpec> = Object.fromEntries(
  DOCUMENT_PACK.map((spec) => [spec.id, spec])
);

/** All DocumentSpecs whose sourceAgents include the given agent — used by the onAgentComplete hook. */
export function specsDependingOn(agentId: AgentId): DocumentSpec[] {
  return DOCUMENT_PACK.filter((spec) => spec.sourceAgents.includes(agentId));
}
