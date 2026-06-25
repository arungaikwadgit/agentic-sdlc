/**
 * © 2025 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
/**
 * CreateProjectPage — full-screen wizard for document-assisted project creation.
 *
 * Step machine:  upload  →  extracting  →  review  →  approval
 *
 * Service layer used:
 *   documentExtractor.ts  — client-side text extraction (PDF / DOCX / TXT)
 *   projectContextAgent.ts — L3 extraction agent + conversational review
 *   projectRepository.ts  — createProject, addProjectDocument
 */

import { useState, useCallback, useRef } from 'react';
import { createProject, addProjectDocument } from '@/db/projectRepository';
import { inferDocType, extractText } from '@/services/documentExtractor';
import {
  runProjectContextExtraction,
  sendReviewChatMessage,
  formatExtractionAsDomainKnowledge,
} from '@/services/projectContextAgent';
import { getEffectiveDomainKnowledgeDefault } from '@/agents/domainKnowledgeDefaults';
import type {
  UploadedFile,
  ExtractionPackage,
  ExtractionFields,
  ConversationMessage,
  WizardStep,
} from '@/types/extraction.types';
import type { DomainId } from '@/types/domain.types';

import UploadStep from './UploadStep';
import ExtractionStep, { type TraceEvent } from './ExtractionStep';
import ReviewStep from './ReviewStep';
import ApprovalStep from './ApprovalStep';
import styles from './CreateProjectPage.module.css';

// ─── Helper: build empty field values from a package ─────────────────────────

function packageToFieldValues(pkg: ExtractionPackage): Record<keyof ExtractionFields, string> {
  return Object.fromEntries(
    Object.entries(pkg.fields).map(([k, v]) => [k, v.value])
  ) as Record<keyof ExtractionFields, string>;
}

// ─── Step metadata ────────────────────────────────────────────────────────────

const STEPS: { id: WizardStep; label: string }[] = [
  { id: 'upload',     label: 'Upload Documents' },
  { id: 'extracting', label: 'Extract Context' },
  { id: 'review',     label: 'Review & Edit' },
  { id: 'approval',   label: 'Approve & Create' },
];

function stepIndex(s: WizardStep): number {
  return STEPS.findIndex((x) => x.id === s);
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  onClose: () => void;
  onCreated: (id: string) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CreateProjectPage({ onClose, onCreated }: Props) {
  // ── Wizard state ─────────────────────────────────────────────────────────
  const [step, setStep]     = useState<WizardStep>('upload');
  const [error, setError]   = useState<string>('');

  // ── Upload step ───────────────────────────────────────────────────────────
  const [files, setFiles]   = useState<UploadedFile[]>([]);

  // ── Extraction step ───────────────────────────────────────────────────────
  const [traceEvents, setTraceEvents]           = useState<TraceEvent[]>([]);
  const [currentIteration, setCurrentIteration] = useState(0);
  const [fieldsExtracted, setFieldsExtracted]   = useState(0);
  const [extractionError, setExtractionError]   = useState<string>('');

  // ── Review step ───────────────────────────────────────────────────────────
  const [pkg, setPkg]                   = useState<ExtractionPackage | null>(null);
  const [fieldValues, setFieldValues]   = useState<Record<keyof ExtractionFields, string> | null>(null);
  const [chatHistory, setChatHistory]   = useState<ConversationMessage[]>([]);
  const [isChatSending, setIsChatSending] = useState(false);

  // ── Approval step ─────────────────────────────────────────────────────────
  const [approverRole, setApproverRole]   = useState('');
  const [approverNotes, setApproverNotes] = useState('');
  const [isCreating, setIsCreating]       = useState(false);

  // Prevent double-run
  const extractionRunning = useRef(false);

  // ── File management ───────────────────────────────────────────────────────

  const handleFilesAdded = useCallback(async (raw: File[]) => {
    // Deduplicate by name against already-added files
    const existing = new Set(files.map((f) => f.name));
    const newRaw = raw.filter((f) => !existing.has(f.name)).slice(0, 5 - files.length);
    if (!newRaw.length) return;

    const pending: UploadedFile[] = newRaw.map((f) => ({
      id: crypto.randomUUID(),
      file: f,
      name: f.name,
      type: inferDocType(f) ?? 'txt',
      size: f.size,
      status: 'extracting',
      extractedText: '',
      charCount: 0,
    }));

    setFiles((prev) => [...prev, ...pending]);

    // Extract text for each file in parallel
    await Promise.all(
      pending.map(async (pf) => {
        try {
          const text = await extractText(pf.file, pf.type);
          setFiles((prev) =>
            prev.map((f) =>
              f.id === pf.id
                ? { ...f, status: 'ready', extractedText: text, charCount: text.length }
                : f
            )
          );
        } catch (err) {
          setFiles((prev) =>
            prev.map((f) =>
              f.id === pf.id
                ? { ...f, status: 'error', error: err instanceof Error ? err.message : 'Extraction failed' }
                : f
            )
          );
        }
      })
    );
  }, [files]);

  const handleFileRemove = useCallback((id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  }, []);

  // ── Start extraction ──────────────────────────────────────────────────────

  async function startExtraction() {
    if (extractionRunning.current) return;

    const readyFiles = files.filter((f) => f.status === 'ready');
    if (!readyFiles.length) {
      // Skip extraction, go straight to a blank review form
      const blankPkg = buildBlankPackage();
      setPkg(blankPkg);
      setFieldValues(packageToFieldValues(blankPkg));
      setStep('review');
      return;
    }

    extractionRunning.current = true;
    setStep('extracting');
    setExtractionError('');
    setTraceEvents([]);
    setCurrentIteration(0);
    setFieldsExtracted(0);

    try {
      const result = await runProjectContextExtraction(readyFiles, {
        onProgress: (msg) => {
          setTraceEvents((prev) => [
            ...prev,
            { timestamp: Date.now(), type: 'thinking', label: msg },
          ]);
        },
        onL3Trace: (meta) => {
          // Map L3 runtime metadata into our TraceEvent shape
          setCurrentIteration(meta.iterationCount ?? 0);

          // Convert tool trace entries to TraceEvents
          const traceEntries = meta.toolTrace ?? [];
          const newEvents: TraceEvent[] = traceEntries.map((entry) => ({
            timestamp: entry.timestamp ?? Date.now(),
            type: 'tool_call' as const,
            label: entry.tool ?? 'Tool call',
            detail: entry.args ? JSON.stringify(entry.args).slice(0, 120) : undefined,
          }));

          if (newEvents.length > 0) {
            setTraceEvents((prev) => {
              // Only append entries not already shown (by comparing total length)
              if (newEvents.length <= prev.filter((e) => e.type === 'tool_call').length) return prev;
              return [...prev, ...newEvents.slice(prev.filter((e) => e.type === 'tool_call').length)];
            });
          }

          // Estimate fields extracted from decisions/plan revisions
          const nonMissingHint = (meta.decisions ?? [])
            .filter((d) => d.type === 'output_accepted').length;
          if (nonMissingHint > 0) setFieldsExtracted(Math.min(nonMissingHint * 4, 25));
        },
      });

      // Mark all non-missing fields as extracted
      const extracted = Object.values(result.fields).filter((f) => f.method !== 'missing').length;
      setFieldsExtracted(extracted);
      setTraceEvents((prev) => [
        ...prev,
        { timestamp: Date.now(), type: 'iteration', label: `Complete — ${extracted} of 25 fields extracted` },
      ]);

      setPkg(result);
      setFieldValues(packageToFieldValues(result));
      setStep('review');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setExtractionError(msg);
      setTraceEvents((prev) => [
        ...prev,
        { timestamp: Date.now(), type: 'thinking', label: `Error: ${msg}` },
      ]);
    } finally {
      extractionRunning.current = false;
    }
  }

  async function retryExtraction() {
    extractionRunning.current = false;
    await startExtraction();
  }

  // ── Field editing ─────────────────────────────────────────────────────────

  const handleFieldChange = useCallback((name: keyof ExtractionFields, value: string) => {
    setFieldValues((prev) => prev ? { ...prev, [name]: value } : prev);
  }, []);

  const handleFieldUserEdited = useCallback((name: keyof ExtractionFields) => {
    setPkg((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        fields: {
          ...prev.fields,
          [name]: {
            ...prev.fields[name],
            method: 'user-edited' as const,
            userEditedAt: Date.now(),
          },
        },
      };
    });
  }, []);

  // ── Chat ──────────────────────────────────────────────────────────────────

  async function handleChatSend(msg: string) {
    if (!pkg || isChatSending) return;

    const userMsg: ConversationMessage = {
      role: 'user',
      content: msg,
      timestamp: Date.now(),
    };
    setChatHistory((prev) => [...prev, userMsg]);
    setIsChatSending(true);

    try {
      const { answer, proposedEdit } = await sendReviewChatMessage(
        msg,
        pkg,
        chatHistory.map((m) => ({ role: m.role, content: m.content }))
      );

      const assistantMsg: ConversationMessage = {
        role: 'assistant',
        content: answer,
        timestamp: Date.now(),
        proposedEdit,
      };
      setChatHistory((prev) => [...prev, assistantMsg]);

      // Persist chat into package
      setPkg((prev) =>
        prev
          ? { ...prev, conversationHistory: [...(prev.conversationHistory ?? []), userMsg, assistantMsg] }
          : prev
      );
    } catch (err) {
      const errorMsg: ConversationMessage = {
        role: 'assistant',
        content: `Error: ${err instanceof Error ? err.message : String(err)}`,
        timestamp: Date.now(),
      };
      setChatHistory((prev) => [...prev, errorMsg]);
    } finally {
      setIsChatSending(false);
    }
  }

  // ── Create project ────────────────────────────────────────────────────────

  async function handleCreateProject() {
    if (!pkg || !fieldValues || !approverRole || isCreating) return;
    setIsCreating(true);
    setError('');

    try {
      // Stamp approval record
      const approvalRecord = {
        approverRole,
        approvedAt: Date.now(),
        notes: approverNotes.trim() || undefined,
      };

      const finalPkg: ExtractionPackage = {
        ...pkg,
        approvalRecord,
        conversationHistory: chatHistory,
        // Update fields with any user edits
        fields: Object.fromEntries(
          Object.entries(pkg.fields).map(([k, v]) => {
            const key = k as keyof ExtractionFields;
            const editedVal = fieldValues[key];
            if (editedVal !== v.value) {
              return [key, { ...v, value: editedVal, method: 'user-edited' as const, userEditedAt: Date.now() }];
            }
            return [key, v];
          })
        ) as ExtractionPackage['fields'],
      };

      // Build domain knowledge from extraction
      const extractedDomainKnowledge = formatExtractionAsDomainKnowledge(finalPkg);
      const domainFromPkg = (fieldValues.domain || 'saas') as DomainId;
      const templateDomainKnowledge = await getEffectiveDomainKnowledgeDefault(domainFromPkg);

      const combinedDomainKnowledge = [
        extractedDomainKnowledge,
        '',
        '---',
        '## Domain Template Context',
        templateDomainKnowledge,
      ].join('\n');

      // Create project record
      const project = await createProject({
        name: fieldValues.projectName?.trim() || 'Untitled Project',
        description: fieldValues.problemStatement?.trim() || '',
        domain: domainFromPkg,
        status: 'draft',
        mode: 'simple',
        domainKnowledge: combinedDomainKnowledge,
        owner: fieldValues.owner?.trim() || undefined,
        team: fieldValues.team?.trim() || undefined,
        techStack: fieldValues.techStack?.trim() || undefined,
        targetUsers: fieldValues.targetUsers?.trim() || undefined,
        initialRisks: fieldValues.risks?.trim() || undefined,
        extractionPackage: finalPkg,
        creationApproval: approvalRecord,
        sourceDocumentIds: files.filter((f) => f.status === 'ready').map((f) => f.id),
      });

      // Persist document records to IndexedDB
      await Promise.all(
        files
          .filter((f) => f.status === 'ready')
          .map((f) =>
            addProjectDocument({
              id: f.id,
              projectId: project.id,
              fileName: f.name,
              fileType: f.type,
              fileSize: f.size,
              mimeType: f.file.type,
              extractedText: f.extractedText,
              charCount: f.charCount,
              uploadedAt: Date.now(),
              documentType: finalPkg.documentClassifications.find((dc) => dc.name === f.name)?.type,
              classificationConfidence: finalPkg.documentClassifications.find((dc) => dc.name === f.name)?.confidence,
            })
          )
      );

      onCreated(project.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsCreating(false);
    }
  }

  // ── Skip extraction — go manual ───────────────────────────────────────────

  function skipToManual() {
    const blankPkg = buildBlankPackage();
    setPkg(blankPkg);
    setFieldValues(packageToFieldValues(blankPkg));
    setStep('review');
  }

  // ── Navigation guards ─────────────────────────────────────────────────────

  function canAdvance(): boolean {
    if (step === 'upload') return true; // Can always advance (skip is valid)
    if (step === 'extracting') return !!pkg;
    if (step === 'review') return !!pkg && !!fieldValues;
    return false;
  }

  function handleBack() {
    if (step === 'review')   { setStep('upload'); return; }
    if (step === 'approval') { setStep('review'); return; }
    if (step === 'extracting') { setStep('upload'); extractionRunning.current = false; return; }
  }

  function handleNext() {
    if (step === 'upload') {
      startExtraction();
    } else if (step === 'review') {
      setStep('approval');
    }
  }

  // ── Layout helpers ────────────────────────────────────────────────────────

  const currentIdx = stepIndex(step);
  const isReviewOrApproval = step === 'review' || step === 'approval';

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className={styles.root}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          {step !== 'upload' && step !== 'extracting' && (
            <button className={styles.backBtn} onClick={handleBack}>
              ← Back
            </button>
          )}
          <span className={styles.headerTitle}>Create New Project</span>
        </div>

        {/* Step progress */}
        <div className={styles.stepBar}>
          {STEPS.map((s, i) => {
            const done   = i < currentIdx;
            const active = i === currentIdx;
            return (
              <span key={s.id} style={{ display: 'contents' }}>
                {i > 0 && (
                  <div className={`${styles.stepConnector} ${done ? styles.done : ''}`} />
                )}
                <div className={`${styles.stepItem} ${done ? styles.done : ''} ${active ? styles.active : ''}`}>
                  <div className={styles.stepNum}>
                    {done ? '✓' : i + 1}
                  </div>
                  {s.label}
                </div>
              </span>
            );
          })}
        </div>

        <div className={styles.headerRight}>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close wizard">✕</button>
        </div>
      </div>

      {/* Body */}
      <div className={styles.body}>
        {error && (
          <div className={styles.errorBanner}>
            <span>⚠</span>
            <span style={{ flex: 1 }}>{error}</span>
            <button className={styles.retryBtn} onClick={() => setError('')}>Dismiss</button>
          </div>
        )}

        {/* Step: upload */}
        {step === 'upload' && (
          <div className={styles.singleCol}>
            <div className={styles.centeredPane}>
              <UploadStep
                files={files}
                onFilesAdded={handleFilesAdded}
                onFileRemove={handleFileRemove}
              />
            </div>
          </div>
        )}

        {/* Step: extracting */}
        {step === 'extracting' && (
          <div className={styles.singleCol}>
            <div className={styles.centeredPane}>
              <ExtractionStep
                files={files}
                traceEvents={traceEvents}
                currentIteration={currentIteration}
                maxIterations={6}
                fieldsExtracted={fieldsExtracted}
                totalFields={25}
                error={extractionError}
                onRetry={retryExtraction}
              />
            </div>
          </div>
        )}

        {/* Step: review — two-column layout */}
        {step === 'review' && pkg && fieldValues && (
          <div className={styles.columns}>
            <ReviewStep
              pkg={pkg}
              fieldValues={fieldValues}
              onFieldChange={handleFieldChange}
              onFieldUserEdited={handleFieldUserEdited}
              chatHistory={chatHistory}
              onChatSend={handleChatSend}
              isChatSending={isChatSending}
            />
          </div>
        )}

        {/* Step: approval */}
        {step === 'approval' && pkg && fieldValues && (
          <div className={styles.singleCol} style={{ padding: 0 }}>
            <ApprovalStep
              pkg={pkg}
              fieldValues={fieldValues}
              approverRole={approverRole}
              approverNotes={approverNotes}
              onApproverRoleChange={setApproverRole}
              onApproverNotesChange={setApproverNotes}
              onCreateProject={handleCreateProject}
              isCreating={isCreating}
            />
          </div>
        )}
      </div>

      {/* Footer — hide during extraction and approval (approval has its own create button) */}
      {step !== 'extracting' && step !== 'approval' && (
        <div className={styles.footer}>
          <div>
            {step === 'upload' && (
              <button className="btn-secondary" onClick={skipToManual} style={{ fontSize: 12 }}>
                Skip — fill form manually
              </button>
            )}
          </div>
          <div className={styles.footerRight}>
            <button className="btn-secondary" onClick={onClose}>Cancel</button>
            {step === 'upload' && (
              <button
                className="btn-primary"
                onClick={handleNext}
                disabled={files.some((f) => f.status === 'extracting')}
              >
                {files.filter((f) => f.status === 'ready').length > 0
                  ? `Extract Context from ${files.filter((f) => f.status === 'ready').length} File(s) →`
                  : 'Continue without documents →'}
              </button>
            )}
            {step === 'review' && (
              <button
                className="btn-primary"
                onClick={handleNext}
                disabled={!canAdvance()}
              >
                Review & Approve →
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Blank package (used when skipping upload) ────────────────────────────────

function makeBlankField() {
  return { value: '', confidence: 0, method: 'missing' as const };
}

function buildBlankPackage(): ExtractionPackage {
  return {
    extractedAt: Date.now(),
    documentCount: 0,
    documentClassifications: [],
    fields: {
      projectName:               makeBlankField(),
      clientOrBusinessUnit:      makeBlankField(),
      projectSummary:            makeBlankField(),
      businessGoals:             makeBlankField(),
      problemStatement:          makeBlankField(),
      targetUsers:               makeBlankField(),
      domain:                    { ...makeBlankField(), value: 'saas' },
      scope:                     makeBlankField(),
      outOfScope:                makeBlankField(),
      keyFeatures:               makeBlankField(),
      functionalRequirements:    makeBlankField(),
      nonFunctionalRequirements: makeBlankField(),
      assumptions:               makeBlankField(),
      constraints:               makeBlankField(),
      risks:                     makeBlankField(),
      dependencies:              makeBlankField(),
      milestones:                makeBlankField(),
      complianceAndSecurity:     makeBlankField(),
      stakeholders:              makeBlankField(),
      techStack:                 makeBlankField(),
      integrationPoints:         makeBlankField(),
      successCriteria:           makeBlankField(),
      owner:                     makeBlankField(),
      team:                      makeBlankField(),
      agentGuidance:             makeBlankField(),
    },
    missingFields: [],
    conflicts: [],
    domainKnowledgeSummary: '',
    conversationHistory: [],
  };
}
