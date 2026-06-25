/**
 * © 2025 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
import { useState, useRef, useEffect } from 'react';
import type {
  ExtractionPackage,
  ExtractionFields,
  ExtractedField,
  ConversationMessage,
} from '@/types/extraction.types';
import { EXTRACTION_FIELD_LABELS, REQUIRED_FIELDS } from '@/types/extraction.types';
import FieldBadge from './FieldBadge';
import styles from './ReviewStep.module.css';

// ─── Field groups ─────────────────────────────────────────────────────────────

const FIELD_GROUPS: { label: string; fields: Array<keyof ExtractionFields> }[] = [
  {
    label: 'Identity',
    fields: ['projectName', 'clientOrBusinessUnit', 'owner', 'team'],
  },
  {
    label: 'Problem & Goals',
    fields: ['projectSummary', 'problemStatement', 'businessGoals', 'successCriteria'],
  },
  {
    label: 'Scope',
    fields: ['scope', 'outOfScope', 'keyFeatures', 'functionalRequirements', 'nonFunctionalRequirements'],
  },
  {
    label: 'Context',
    fields: ['targetUsers', 'domain', 'assumptions', 'constraints', 'risks', 'dependencies'],
  },
  {
    label: 'Delivery',
    fields: ['milestones', 'techStack', 'integrationPoints', 'complianceAndSecurity', 'stakeholders'],
  },
  {
    label: 'AI Guidance',
    fields: ['agentGuidance'],
  },
];

// ─── Source panel ─────────────────────────────────────────────────────────────

function SourcePanel({ field }: { field: ExtractedField | null }) {
  if (!field) return <div className={styles.sourcePlaceholder}>Click a field to see its source.</div>;

  return (
    <div className={styles.sourcePanel}>
      {field.sourceFile && (
        <div className={styles.sourceMeta}>
          <span className={styles.sourceFile}>📄 {field.sourceFile}</span>
          {field.sourceSection && <span className={styles.sourceSection}>{field.sourceSection}</span>}
        </div>
      )}
      {field.sourceExcerpt ? (
        <blockquote className={styles.sourceExcerpt}>{field.sourceExcerpt}</blockquote>
      ) : (
        <p className={styles.noExcerpt}>{
          field.method === 'missing' ? 'Not found in any document.' :
          field.method === 'inferred' ? 'Inferred — no direct quote available.' :
          'No source excerpt.'
        }</p>
      )}
      {field.rationale && (
        <div className={styles.rationale}>
          <strong>Rationale</strong>
          <p>{field.rationale}</p>
        </div>
      )}
      {field.conflictValues && field.conflictValues.length > 0 && (
        <div className={styles.conflicts}>
          <strong>Conflicting values</strong>
          {field.conflictValues.map((cv, i) => (
            <div key={i} className={styles.conflictRow}>
              <span className={styles.conflictFile}>{cv.sourceFile}</span>
              <span>{cv.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Chat panel ───────────────────────────────────────────────────────────────

interface ChatProps {
  history: ConversationMessage[];
  onSend: (msg: string) => void;
  isSending: boolean;
  onAcceptEdit: (fieldName: keyof ExtractionFields, value: string) => void;
}

function ChatPanel({ history, onSend, isSending, onAcceptEdit }: ChatProps) {
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history]);

  function handleSend() {
    const msg = input.trim();
    if (!msg || isSending) return;
    onSend(msg);
    setInput('');
  }

  return (
    <div className={styles.chatRoot}>
      <div className={styles.chatHistory}>
        {history.length === 0 && (
          <div className={styles.chatEmpty}>
            Ask the assistant to explain any field, update a value, or add context from your documents.
          </div>
        )}
        {history.map((msg, i) => (
          <div key={i} className={`${styles.chatMsg} ${styles[msg.role]}`}>
            <div className={styles.chatBubble}>{msg.content}</div>
            {msg.proposedEdit && (
              <div className={styles.chatEdit}>
                <span>
                  Proposed edit to <strong>{EXTRACTION_FIELD_LABELS[msg.proposedEdit.fieldName]}</strong>:
                  &quot;{msg.proposedEdit.value.slice(0, 80)}{msg.proposedEdit.value.length > 80 ? '…' : ''}&quot;
                </span>
                <button
                  className={styles.acceptEditBtn}
                  onClick={() => onAcceptEdit(msg.proposedEdit!.fieldName, msg.proposedEdit!.value)}
                >
                  Apply
                </button>
              </div>
            )}
          </div>
        ))}
        {isSending && (
          <div className={`${styles.chatMsg} ${styles.assistant}`}>
            <div className={`${styles.chatBubble} ${styles.typing}`}>
              <span />
              <span />
              <span />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      <div className={styles.chatInput}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about any field, or say 'Update project name to…'"
          rows={2}
          className={styles.chatTextarea}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
          }}
          disabled={isSending}
        />
        <button className={styles.sendBtn} onClick={handleSend} disabled={!input.trim() || isSending}>
          Send
        </button>
      </div>
    </div>
  );
}

// ─── Main ReviewStep ──────────────────────────────────────────────────────────

interface Props {
  pkg: ExtractionPackage;
  fieldValues: Record<keyof ExtractionFields, string>;
  onFieldChange: (name: keyof ExtractionFields, value: string) => void;
  onFieldUserEdited: (name: keyof ExtractionFields) => void;
  chatHistory: ConversationMessage[];
  onChatSend: (msg: string) => void;
  isChatSending: boolean;
}

export default function ReviewStep({
  pkg,
  fieldValues,
  onFieldChange,
  onFieldUserEdited,
  chatHistory,
  onChatSend,
  isChatSending,
}: Props) {
  const [tab, setTab] = useState<'form' | 'chat'>('form');
  const [activeField, setActiveField] = useState<keyof ExtractionFields | null>(null);

  const activeExtracted = activeField ? pkg.fields[activeField] : null;

  function handleAcceptEdit(fieldName: keyof ExtractionFields, value: string) {
    onFieldChange(fieldName, value);
    onFieldUserEdited(fieldName);
  }

  const missingCount = pkg.missingFields.length;
  const conflictCount = pkg.conflicts.length;

  return (
    <div className={styles.root}>
      {/* Left column: source panel */}
      <div className={styles.leftPanel}>
        <div className={styles.leftHeader}>Source</div>
        <SourcePanel field={activeExtracted} />

        {(missingCount > 0 || conflictCount > 0) && (
          <div className={styles.alertsSection}>
            {missingCount > 0 && (
              <div className={styles.alertBox}>
                <strong>{missingCount} missing field(s)</strong>
                <ul>
                  {pkg.missingFields.map((f) => (
                    <li key={f}>{EXTRACTION_FIELD_LABELS[f as keyof ExtractionFields] ?? f}</li>
                  ))}
                </ul>
              </div>
            )}
            {conflictCount > 0 && (
              <div className={`${styles.alertBox} ${styles.alertConflict}`}>
                <strong>{conflictCount} conflict(s)</strong>
                <ul>
                  {pkg.conflicts.map((c, i) => (
                    <li key={i}>{EXTRACTION_FIELD_LABELS[c.field as keyof ExtractionFields] ?? c.field}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Right column: form or chat */}
      <div className={styles.rightPanel}>
        <div className={styles.tabBar}>
          <button
            className={`${styles.tabBtn} ${tab === 'form' ? styles.tabActive : ''}`}
            onClick={() => setTab('form')}
          >
            Review Form
          </button>
          <button
            className={`${styles.tabBtn} ${tab === 'chat' ? styles.tabActive : ''}`}
            onClick={() => setTab('chat')}
          >
            Chat with Assistant
            {chatHistory.length > 0 && (
              <span className={styles.chatBadge}>{chatHistory.filter((m) => m.role === 'assistant').length}</span>
            )}
          </button>
        </div>

        {tab === 'form' ? (
          <div className={styles.formScroll}>
            {FIELD_GROUPS.map((group) => (
              <div key={group.label} className={styles.fieldGroup}>
                <div className={styles.groupLabel}>{group.label}</div>
                {group.fields.map((fieldName) => {
                  const extracted = pkg.fields[fieldName];
                  const isRequired = (REQUIRED_FIELDS as string[]).includes(fieldName);
                  const isActive = activeField === fieldName;
                  const isLong = (fieldValues[fieldName] ?? '').length > 80
                    || ['projectSummary', 'problemStatement', 'businessGoals', 'scope', 'outOfScope', 'keyFeatures',
                        'functionalRequirements', 'nonFunctionalRequirements', 'assumptions', 'constraints',
                        'risks', 'dependencies', 'milestones', 'agentGuidance', 'successCriteria',
                        'stakeholders', 'complianceAndSecurity', 'integrationPoints'].includes(fieldName);

                  return (
                    <div
                      key={fieldName}
                      className={`${styles.fieldRow} ${isActive ? styles.fieldRowActive : ''}`}
                      onClick={() => setActiveField(fieldName)}
                    >
                      <div className={styles.fieldMeta}>
                        <label className={styles.fieldLabel}>
                          {EXTRACTION_FIELD_LABELS[fieldName]}
                          {isRequired && <span className={styles.required}>*</span>}
                        </label>
                        <FieldBadge method={extracted.method} confidence={extracted.confidence} />
                      </div>
                      {isLong ? (
                        <textarea
                          className={styles.fieldTextarea}
                          value={fieldValues[fieldName] ?? ''}
                          onChange={(e) => {
                            onFieldChange(fieldName, e.target.value);
                            onFieldUserEdited(fieldName);
                          }}
                          rows={3}
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <input
                          className={styles.fieldInput}
                          value={fieldValues[fieldName] ?? ''}
                          onChange={(e) => {
                            onFieldChange(fieldName, e.target.value);
                            onFieldUserEdited(fieldName);
                          }}
                          onClick={(e) => e.stopPropagation()}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        ) : (
          <ChatPanel
            history={chatHistory}
            onSend={onChatSend}
            isSending={isChatSending}
            onAcceptEdit={handleAcceptEdit}
          />
        )}
      </div>
    </div>
  );
}
