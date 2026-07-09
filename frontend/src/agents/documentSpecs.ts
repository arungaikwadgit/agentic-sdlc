/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
/**
 * Document Agent — DocumentSpec registry.
 *
 * See docs/Document-Agent-Feature-Plan.md Section 6 for the full 72-document
 * mapping and Section 7 for the phased rollout this file follows.
 *
 * Phase 1 (shipped): the 19 Direct-mapping documents — an existing pipeline
 * agent's output is the primary source, light reformatting only.
 * Phase 3 (this update): the 49 Synthesis-type documents — no single agent
 * covers them, so the LLM generator is given multiple sourceAgents and
 * combines their outputs into new content. Also includes #54 (CI/CD Design
 * Document), which the plan labels "Direct/reframe" but was not part of the
 * original 19 — added here since it was otherwise unregistered.
 *
 * That's 68 of 72 documents wired up. The remaining 4 — #53 Test Summary
 * Report, #70 Lessons Learned, #71 Project Closure Report, #72 Post
 * Implementation Review — are Data-gap documents (Section 6.6/6.9) deferred
 * to Phase 4: the platform doesn't currently capture the data they need
 * (test-execution results, retrospective input, production incident/usage
 * data), so generating them requires gap-flagging behavior this file's
 * generic 'llm' generator doesn't yet implement. NOT added in this pass.
 *
 * generator:
 *   'llm'           — standard path: read the AppDocs prompt file, fetch
 *                      sourceAgents' outputs + Context Absorption bundle, run
 *                      one L3 generation loop, persist the result. Used for
 *                      both Direct and Synthesis documents — synthesis just
 *                      means sourceAgents has more than one entry; the
 *                      generator itself needs no special-casing (see
 *                      documentAgentService.ts generateViaLlm, which already
 *                      joins sourceAgents generically into the goal prompt).
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
  // ─── Discovery & Initiation ─────────────────────────────────────────────
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
    id: '02_business_case',
    title: 'Business Case',
    category: 'Discovery_Initiation',
    promptFile: 'AppDocs/Discovery_Initiation/02_Business_Case_Prompt.md',
    sourceAgents: ['feasibility', 'sdlcOrchestrator'],
    outputFormat: 'docx',
    generator: 'llm',
  },
  {
    id: '03_vision_document',
    title: 'Vision Document',
    category: 'Discovery_Initiation',
    promptFile: 'AppDocs/Discovery_Initiation/03_Vision_Document_Prompt.md',
    sourceAgents: ['manager', 'roadmapPlanner', 'sdlcOrchestrator'],
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
    id: '05_scope_statement',
    title: 'Scope Statement',
    category: 'Discovery_Initiation',
    promptFile: 'AppDocs/Discovery_Initiation/05_Scope_Statement_Prompt.md',
    sourceAgents: ['projectCharter', 'brd'],
    outputFormat: 'docx',
    generator: 'llm',
  },
  {
    id: '06_assumptions_and_constraints_document',
    title: 'Assumptions and Constraints Document',
    category: 'Discovery_Initiation',
    promptFile: 'AppDocs/Discovery_Initiation/06_Assumptions_and_Constraints_Document_Prompt.md',
    sourceAgents: ['feasibility', 'projectCharter', 'sdlcOrchestrator'],
    outputFormat: 'docx',
    generator: 'llm',
  },
  {
    id: '07_risk_register',
    title: 'Risk Register',
    category: 'Discovery_Initiation',
    promptFile: 'AppDocs/Discovery_Initiation/07_Risk_Register_Prompt.md',
    sourceAgents: ['sdlcOrchestrator', 'feasibility', 'techDebt'],
    outputFormat: 'docx',
    generator: 'llm',
  },
  {
    id: '08_decision_log',
    title: 'Decision Log',
    category: 'Discovery_Initiation',
    promptFile: 'AppDocs/Discovery_Initiation/08_Decision_Log_Prompt.md',
    sourceAgents: ['architecture', 'sdlcOrchestrator'],
    outputFormat: 'docx',
    generator: 'llm',
  },

  // ─── Requirements ───────────────────────────────────────────────────────
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
    id: '11_functional_requirements_document',
    title: 'Functional Requirements Document',
    category: 'Requirements',
    promptFile: 'AppDocs/Requirements/11_Functional_Requirements_Document_Prompt.md',
    sourceAgents: ['userStory', 'businessRules'],
    outputFormat: 'docx',
    generator: 'llm',
  },
  {
    id: '12_software_requirements_specification',
    title: 'Software Requirements Specification',
    category: 'Requirements',
    promptFile: 'AppDocs/Requirements/12_Software_Requirements_Specification_Prompt.md',
    sourceAgents: ['brd', 'manager', 'businessRules', 'architecture'],
    outputFormat: 'docx',
    generator: 'llm',
  },
  {
    id: '13_non_functional_requirements_document',
    title: 'Non Functional Requirements Document',
    category: 'Requirements',
    promptFile: 'AppDocs/Requirements/13_Non_Functional_Requirements_Document_Prompt.md',
    sourceAgents: ['architecture', 'securityCompliance'],
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
    id: '15_acceptance_criteria_document',
    title: 'Acceptance Criteria Document',
    category: 'Requirements',
    promptFile: 'AppDocs/Requirements/15_Acceptance_Criteria_Document_Prompt.md',
    sourceAgents: ['userStory', 'testCases'],
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

  // ─── Architecture & Design ──────────────────────────────────────────────
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
    id: '19_solution_design_document',
    title: 'Solution Design Document',
    category: 'Architecture_Design',
    promptFile: 'AppDocs/Architecture_Design/19_Solution_Design_Document_Prompt.md',
    sourceAgents: ['architecture', 'apiDesign', 'dataModel'],
    outputFormat: 'docx',
    generator: 'llm',
  },
  {
    id: '20_high_level_design',
    title: 'High Level Design',
    category: 'Architecture_Design',
    promptFile: 'AppDocs/Architecture_Design/20_High_Level_Design_Prompt.md',
    sourceAgents: ['architecture'],
    outputFormat: 'docx',
    generator: 'llm',
  },
  {
    id: '21_low_level_design',
    title: 'Low Level Design',
    category: 'Architecture_Design',
    promptFile: 'AppDocs/Architecture_Design/21_Low_Level_Design_Prompt.md',
    sourceAgents: ['codeStructure', 'codeSnippets', 'apiDesign'],
    outputFormat: 'docx',
    generator: 'llm',
  },
  {
    id: '22_data_architecture_document',
    title: 'Data Architecture Document',
    category: 'Architecture_Design',
    promptFile: 'AppDocs/Architecture_Design/22_Data_Architecture_Document_Prompt.md',
    sourceAgents: ['dataModel', 'architecture'],
    outputFormat: 'docx',
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
    id: '25_integration_design_document',
    title: 'Integration Design Document',
    category: 'Architecture_Design',
    promptFile: 'AppDocs/Architecture_Design/25_Integration_Design_Document_Prompt.md',
    sourceAgents: ['apiDesign', 'architecture', 'devopsEngineer'],
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
    id: '28_deployment_architecture_document',
    title: 'Deployment Architecture Document',
    category: 'Architecture_Design',
    promptFile: 'AppDocs/Architecture_Design/28_Deployment_Architecture_Document_Prompt.md',
    sourceAgents: ['devopsEngineer', 'infraEngineer'],
    outputFormat: 'docx',
    generator: 'llm',
  },
  {
    id: '29_agentic_workflow_architecture_document',
    title: 'Agentic Workflow Architecture Document',
    category: 'Architecture_Design',
    promptFile: 'AppDocs/Architecture_Design/29_Agentic_Workflow_Architecture_Document_Prompt.md',
    // Plan also cites "the pipeline/agent registry itself" as a source — that's
    // static app config (definitions.ts), not a runtime agent, so it isn't
    // representable as a sourceAgents entry; sdlcOrchestrator is the one real
    // agent source.
    sourceAgents: ['sdlcOrchestrator'],
    outputFormat: 'docx',
    generator: 'llm',
  },
  {
    id: '30_ai_governance_ai_risk_design_document',
    title: 'AI Governance / AI Risk Design Document',
    category: 'Architecture_Design',
    promptFile: 'AppDocs/Architecture_Design/30_AI_Governance_AI_Risk_Design_Document_Prompt.md',
    sourceAgents: ['securityCompliance', 'sdlcOrchestrator'],
    outputFormat: 'docx',
    generator: 'llm',
  },

  // ─── UX/UI ──────────────────────────────────────────────────────────────
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
    id: '32_user_journey_map',
    title: 'User Journey Map',
    category: 'UX_UI',
    promptFile: 'AppDocs/UX_UI/32_User_Journey_Map_Prompt.md',
    sourceAgents: ['uxResearch', 'interaction'],
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
    id: '34_design_system_document',
    title: 'Design System Document',
    category: 'UX_UI',
    promptFile: 'AppDocs/UX_UI/34_Design_System_Document_Prompt.md',
    sourceAgents: ['uiComponentLibrary', 'uxMockups'],
    outputFormat: 'docx',
    generator: 'llm',
  },
  {
    id: '35_accessibility_design_document',
    title: 'Accessibility Design Document',
    category: 'UX_UI',
    promptFile: 'AppDocs/UX_UI/35_Accessibility_Design_Document_Prompt.md',
    sourceAgents: ['uxMockups', 'workingPrototype', 'interaction'],
    outputFormat: 'docx',
    generator: 'llm',
  },

  // ─── Development ────────────────────────────────────────────────────────
  {
    id: '36_development_plan',
    title: 'Development Plan',
    category: 'Development',
    promptFile: 'AppDocs/Development/36_Development_Plan_Prompt.md',
    sourceAgents: ['sprintPlanner', 'taskBreakdown', 'roadmapPlanner'],
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
    id: '38_branching_strategy_document',
    title: 'Branching Strategy Document',
    category: 'Development',
    promptFile: 'AppDocs/Development/38_Branching_Strategy_Document_Prompt.md',
    sourceAgents: ['devopsEngineer', 'codeReviewStandards'],
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
    id: '40_configuration_management_document',
    title: 'Configuration Management Document',
    category: 'Development',
    promptFile: 'AppDocs/Development/40_Configuration_Management_Document_Prompt.md',
    sourceAgents: ['infraEngineer', 'devopsEngineer'],
    outputFormat: 'docx',
    generator: 'llm',
  },
  {
    id: '41_environment_strategy_document',
    title: 'Environment Strategy Document',
    category: 'Development',
    promptFile: 'AppDocs/Development/41_Environment_Strategy_Document_Prompt.md',
    sourceAgents: ['infraEngineer', 'devopsEngineer'],
    outputFormat: 'docx',
    generator: 'llm',
  },

  // ─── Testing & Quality ──────────────────────────────────────────────────
  {
    id: '42_test_strategy',
    title: 'Test Strategy',
    category: 'Testing_Quality',
    promptFile: 'AppDocs/Testing_Quality/42_Test_Strategy_Prompt.md',
    sourceAgents: ['testPlan'],
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
    id: '45_automation_test_plan',
    title: 'Automation Test Plan',
    category: 'Testing_Quality',
    promptFile: 'AppDocs/Testing_Quality/45_Automation_Test_Plan_Prompt.md',
    sourceAgents: ['testPlan', 'testCases', 'codeStructure'],
    outputFormat: 'docx',
    generator: 'llm',
  },
  {
    id: '46_e2e_test_plan',
    title: 'E2E Test Plan',
    category: 'Testing_Quality',
    promptFile: 'AppDocs/Testing_Quality/46_E2E_Test_Plan_Prompt.md',
    sourceAgents: ['testPlan', 'testCases', 'workingPrototype'],
    outputFormat: 'docx',
    generator: 'llm',
  },
  {
    id: '47_performance_test_plan',
    title: 'Performance Test Plan',
    category: 'Testing_Quality',
    promptFile: 'AppDocs/Testing_Quality/47_Performance_Test_Plan_Prompt.md',
    sourceAgents: ['testPlan', 'infraEngineer'],
    outputFormat: 'docx',
    generator: 'llm',
  },
  {
    id: '48_security_test_plan',
    title: 'Security Test Plan',
    category: 'Testing_Quality',
    promptFile: 'AppDocs/Testing_Quality/48_Security_Test_Plan_Prompt.md',
    sourceAgents: ['securityCompliance', 'testPlan'],
    outputFormat: 'docx',
    generator: 'llm',
  },
  {
    id: '49_accessibility_test_plan',
    title: 'Accessibility Test Plan',
    category: 'Testing_Quality',
    promptFile: 'AppDocs/Testing_Quality/49_Accessibility_Test_Plan_Prompt.md',
    // Plan lists "uxMockups/interaction" (either) plus testPlan; including both
    // UX sources for stronger grounding at the cost of a slightly stricter
    // eligibility gate.
    sourceAgents: ['uxMockups', 'interaction', 'testPlan'],
    outputFormat: 'docx',
    generator: 'llm',
  },
  {
    id: '50_uat_plan',
    title: 'UAT Plan',
    category: 'Testing_Quality',
    promptFile: 'AppDocs/Testing_Quality/50_UAT_Plan_Prompt.md',
    sourceAgents: ['testPlan', 'userStory'],
    outputFormat: 'docx',
    generator: 'llm',
  },
  {
    id: '51_uat_sign_off_document',
    title: 'UAT Sign Off Document',
    category: 'Testing_Quality',
    promptFile: 'AppDocs/Testing_Quality/51_UAT_Sign_Off_Document_Prompt.md',
    sourceAgents: ['testPlan', 'userStory'],
    outputFormat: 'docx',
    generator: 'llm',
  },
  {
    id: '52_defect_management_plan',
    title: 'Defect Management Plan',
    category: 'Testing_Quality',
    promptFile: 'AppDocs/Testing_Quality/52_Defect_Management_Plan_Prompt.md',
    sourceAgents: ['testPlan', 'testCases'],
    outputFormat: 'docx',
    generator: 'llm',
  },
  // #53 Test Summary Report — Data-gap (needs real test-execution results).
  // Deferred to Phase 4.

  // ─── DevOps & Release ───────────────────────────────────────────────────
  {
    id: '54_ci_cd_design_document',
    title: 'CI/CD Design Document',
    category: 'DevOps_Release',
    promptFile: 'AppDocs/DevOps_Release/54_CI_CD_Design_Document_Prompt.md',
    sourceAgents: ['devopsEngineer'],
    outputFormat: 'docx',
    generator: 'llm',
  },
  {
    id: '55_devops_runbook',
    title: 'DevOps Runbook',
    category: 'DevOps_Release',
    promptFile: 'AppDocs/DevOps_Release/55_DevOps_Runbook_Prompt.md',
    sourceAgents: ['devopsEngineer', 'onCallEngineer'],
    outputFormat: 'docx',
    generator: 'llm',
  },
  {
    id: '56_release_plan',
    title: 'Release Plan',
    category: 'DevOps_Release',
    promptFile: 'AppDocs/DevOps_Release/56_Release_Plan_Prompt.md',
    sourceAgents: ['roadmapPlanner', 'devopsEngineer'],
    outputFormat: 'docx',
    generator: 'llm',
  },
  {
    id: '57_deployment_plan',
    title: 'Deployment Plan',
    category: 'DevOps_Release',
    promptFile: 'AppDocs/DevOps_Release/57_Deployment_Plan_Prompt.md',
    sourceAgents: ['devopsEngineer', 'infraEngineer'],
    outputFormat: 'docx',
    generator: 'llm',
  },
  {
    id: '58_rollback_plan',
    title: 'Rollback Plan',
    category: 'DevOps_Release',
    promptFile: 'AppDocs/DevOps_Release/58_Rollback_Plan_Prompt.md',
    sourceAgents: ['devopsEngineer', 'onCallEngineer'],
    outputFormat: 'docx',
    generator: 'llm',
  },
  {
    id: '59_cutover_plan',
    title: 'Cutover Plan',
    category: 'DevOps_Release',
    promptFile: 'AppDocs/DevOps_Release/59_Cutover_Plan_Prompt.md',
    sourceAgents: ['devopsEngineer', 'roadmapPlanner'],
    outputFormat: 'docx',
    generator: 'llm',
  },
  {
    id: '60_production_readiness_checklist',
    title: 'Production Readiness Checklist',
    category: 'DevOps_Release',
    promptFile: 'AppDocs/DevOps_Release/60_Production_Readiness_Checklist_Prompt.md',
    sourceAgents: ['devopsEngineer', 'infraEngineer', 'securityCompliance', 'observabilityEngineer'],
    outputFormat: 'docx',
    generator: 'llm',
  },
  {
    id: '61_go_live_checklist',
    title: 'Go Live Checklist',
    category: 'DevOps_Release',
    promptFile: 'AppDocs/DevOps_Release/61_Go_Live_Checklist_Prompt.md',
    sourceAgents: ['devopsEngineer', 'onCallEngineer'],
    outputFormat: 'docx',
    generator: 'llm',
  },
  {
    id: '62_change_management_document',
    title: 'Change Management Document',
    category: 'DevOps_Release',
    promptFile: 'AppDocs/DevOps_Release/62_Change_Management_Document_Prompt.md',
    sourceAgents: ['sdlcOrchestrator', 'devopsEngineer'],
    outputFormat: 'docx',
    generator: 'llm',
  },

  // ─── Operations & Support ───────────────────────────────────────────────
  {
    id: '63_operations_runbook',
    title: 'Operations Runbook',
    category: 'Operations_Support',
    promptFile: 'AppDocs/Operations_Support/63_Operations_Runbook_Prompt.md',
    sourceAgents: ['onCallEngineer', 'observabilityEngineer'],
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
  {
    id: '65_incident_management_plan',
    title: 'Incident Management Plan',
    category: 'Operations_Support',
    promptFile: 'AppDocs/Operations_Support/65_Incident_Management_Plan_Prompt.md',
    sourceAgents: ['onCallEngineer', 'observabilityEngineer'],
    outputFormat: 'docx',
    generator: 'llm',
  },
  {
    id: '66_support_handover_document',
    title: 'Support Handover Document',
    category: 'Operations_Support',
    promptFile: 'AppDocs/Operations_Support/66_Support_Handover_Document_Prompt.md',
    sourceAgents: ['onCallEngineer', 'codeStructure'],
    outputFormat: 'docx',
    generator: 'llm',
  },
  {
    id: '67_sla_slo_document',
    title: 'SLA / SLO Document',
    category: 'Operations_Support',
    promptFile: 'AppDocs/Operations_Support/67_SLA_SLO_Document_Prompt.md',
    sourceAgents: ['observabilityEngineer', 'architecture'],
    outputFormat: 'docx',
    generator: 'llm',
  },
  {
    id: '68_knowledge_transfer_document',
    title: 'Knowledge Transfer Document',
    category: 'Operations_Support',
    promptFile: 'AppDocs/Operations_Support/68_Knowledge_Transfer_Document_Prompt.md',
    sourceAgents: ['codeStructure', 'architecture', 'onCallEngineer'],
    outputFormat: 'docx',
    generator: 'llm',
  },
  {
    id: '69_maintenance_plan',
    title: 'Maintenance Plan',
    category: 'Operations_Support',
    promptFile: 'AppDocs/Operations_Support/69_Maintenance_Plan_Prompt.md',
    sourceAgents: ['techDebt', 'infraEngineer'],
    outputFormat: 'docx',
    generator: 'llm',
  },

  // ─── Closure ─────────────────────────────────────────────────────────────
  // #70 Lessons Learned, #71 Project Closure Report, #72 Post Implementation
  // Review — all Data-gap, deferred to Phase 4.
];

/** Lookup by doc_id — used by documentAgentService.ts and the Admin Panel status view. */
export const DOCUMENT_PACK_BY_ID: Record<string, DocumentSpec> = Object.fromEntries(
  DOCUMENT_PACK.map((spec) => [spec.id, spec])
);

/** All DocumentSpecs whose sourceAgents include the given agent — used by the onAgentComplete hook. */
export function specsDependingOn(agentId: AgentId): DocumentSpec[] {
  return DOCUMENT_PACK.filter((spec) => spec.sourceAgents.includes(agentId));
}
