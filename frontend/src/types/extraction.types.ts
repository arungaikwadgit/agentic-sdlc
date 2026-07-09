/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
/**
 * Types for the document upload, L3 agentic extraction, and project context
 * package that powers the Create New Project full-screen wizard.
 */

import type { DocType } from '@/services/documentExtractor';

// ─── Extracted field ──────────────────────────────────────────────────────────

export type ExtractionMethod =
  | 'extracted'      // Directly quoted from a document
  | 'inferred'       // Reasonably deduced from context
  | 'missing'        // Not found in any document
  | 'conflict'       // Multiple documents disagree
  | 'user-edited'    // User overrode the extracted value
  | 'user-rejected'; // User explicitly cleared the value

export interface ConflictValue {
  value: string;
  sourceFile: string;
}

export interface ExtractedField {
  value: string;
  confidence: number;                      // 0.0 – 1.0
  method: ExtractionMethod;
  sourceFile?: string;                     // e.g. "sow-v2.pdf"
  sourceSection?: string;                  // e.g. "Section 1.1 – Project Overview"
  sourceExcerpt?: string;                  // Up to 300 chars of source text
  rationale?: string;                      // Why this value was chosen / inferred
  conflictValues?: ConflictValue[];        // Only when method === 'conflict'
  userEditedAt?: number;                   // Timestamp of last user edit
}

// ─── Extraction package ───────────────────────────────────────────────────────

export interface DocumentClassification {
  name: string;
  type: 'SOW' | 'RFP' | 'BRD' | 'Brief' | 'Discovery' | 'Notes' | 'Other';
  confidence: number;
}

export interface ExtractionConflict {
  field: string;
  values: ConflictValue[];
}

export interface ExtractionFields {
  projectName:               ExtractedField;
  clientOrBusinessUnit:      ExtractedField;
  projectSummary:            ExtractedField;
  businessGoals:             ExtractedField;
  problemStatement:          ExtractedField;
  targetUsers:               ExtractedField;
  domain:                    ExtractedField;   // Maps to DomainId
  scope:                     ExtractedField;
  outOfScope:                ExtractedField;
  keyFeatures:               ExtractedField;
  functionalRequirements:    ExtractedField;
  nonFunctionalRequirements: ExtractedField;
  assumptions:               ExtractedField;
  constraints:               ExtractedField;
  risks:                     ExtractedField;
  dependencies:              ExtractedField;
  milestones:                ExtractedField;
  complianceAndSecurity:     ExtractedField;
  stakeholders:              ExtractedField;
  techStack:                 ExtractedField;
  integrationPoints:         ExtractedField;
  successCriteria:           ExtractedField;
  owner:                     ExtractedField;   // Maps to Project.owner
  team:                      ExtractedField;
  agentGuidance:             ExtractedField;   // Downstream agent instructions
}

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  /** Field edit proposed by the assistant — parsed from FIELD_EDIT: marker */
  proposedEdit?: { fieldName: keyof ExtractionFields; value: string };
}

export interface ApprovalRecord {
  approverRole: string;
  approvedAt: number;
  notes?: string;
}

export interface ExtractionPackage {
  extractedAt: number;
  documentCount: number;
  documentClassifications: DocumentClassification[];
  fields: ExtractionFields;
  missingFields: string[];
  conflicts: ExtractionConflict[];
  domainKnowledgeSummary: string;          // Formatted text for agent domainKnowledge
  conversationHistory: ConversationMessage[];
  approvalRecord?: ApprovalRecord;
}

// ─── Uploaded file (in-memory, pre-storage) ───────────────────────────────────

export interface UploadedFile {
  id: string;                              // crypto.randomUUID()
  file: File;
  name: string;
  type: DocType;
  size: number;
  status: 'pending' | 'extracting' | 'ready' | 'error';
  extractedText: string;
  charCount: number;
  error?: string;
}

// ─── Persisted project document ───────────────────────────────────────────────

export interface ProjectDocument {
  id: string;
  projectId: string;
  fileName: string;
  fileType: 'pdf' | 'docx' | 'txt' | 'xlsx' | 'csv';
  fileSize: number;
  mimeType: string;
  extractedText: string;
  charCount: number;
  uploadedAt: number;
  uploadedBy?: string;
  // Set by extraction agent
  documentType?: DocumentClassification['type'];
  classificationConfidence?: number;
}

// ─── Wizard state ─────────────────────────────────────────────────────────────

export type WizardStep = 'upload' | 'extracting' | 'review' | 'approval';

export type ReviewTab = 'form' | 'chat';

export const EXTRACTION_FIELD_LABELS: Record<keyof ExtractionFields, string> = {
  projectName:               'Project Name',
  clientOrBusinessUnit:      'Client / Business Unit',
  projectSummary:            'Project Summary',
  businessGoals:             'Business Goals',
  problemStatement:          'Problem Statement',
  targetUsers:               'Target Users',
  domain:                    'Domain / Industry',
  scope:                     'Scope',
  outOfScope:                'Out of Scope',
  keyFeatures:               'Key Features',
  functionalRequirements:    'Functional Requirements',
  nonFunctionalRequirements: 'Non-Functional Requirements',
  assumptions:               'Assumptions',
  constraints:               'Constraints',
  risks:                     'Risks',
  dependencies:              'Dependencies',
  milestones:                'Milestones',
  complianceAndSecurity:     'Compliance & Security',
  stakeholders:              'Stakeholders',
  techStack:                 'Technology Stack',
  integrationPoints:         'Integration Points',
  successCriteria:           'Success Criteria',
  owner:                     'Project Owner',
  team:                      'Team / Squad',
  agentGuidance:             'Agent Generation Guidance',
};

export const REQUIRED_FIELDS: Array<keyof ExtractionFields> = [
  'projectName', 'problemStatement', 'owner',
];

/** Fields that map directly to Project record fields */
export const PROJECT_FIELD_MAPPING: Partial<Record<keyof ExtractionFields, string>> = {
  projectName:    'name',
  problemStatement: 'description',
  targetUsers:    'targetUsers',
  techStack:      'techStack',
  risks:          'initialRisks',
  owner:          'owner',
  team:           'team',
};
