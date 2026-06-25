/**
 * © 2025 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
import { useState } from 'react';
import type { ExtractionPackage, ExtractionFields } from '@/types/extraction.types';
import { EXTRACTION_FIELD_LABELS, REQUIRED_FIELDS } from '@/types/extraction.types';
import FieldBadge from './FieldBadge';
import styles from './ApprovalStep.module.css';

const APPROVER_ROLES = [
  'Project Manager',
  'Product Owner',
  'Technical Lead',
  'Business Analyst',
  'Engineering Manager',
  'Other',
];

interface CoverageStat {
  label: string;
  count: number;
  total: number;
  color: string;
}

interface Props {
  pkg: ExtractionPackage;
  fieldValues: Record<keyof ExtractionFields, string>;
  approverRole: string;
  approverNotes: string;
  onApproverRoleChange: (v: string) => void;
  onApproverNotesChange: (v: string) => void;
  onCreateProject: () => void;
  isCreating: boolean;
}

function coverageStats(pkg: ExtractionPackage): CoverageStat[] {
  const fields = Object.values(pkg.fields);
  const extracted = fields.filter((f) => f.method === 'extracted').length;
  const inferred  = fields.filter((f) => f.method === 'inferred').length;
  const missing   = fields.filter((f) => f.method === 'missing').length;
  const conflict  = fields.filter((f) => f.method === 'conflict').length;
  const edited    = fields.filter((f) => f.method === 'user-edited').length;
  const total     = fields.length;

  return [
    { label: 'Extracted',  count: extracted, total, color: '#16a34a' },
    { label: 'Inferred',   count: inferred,  total, color: '#2563eb' },
    { label: 'User-edited',count: edited,    total, color: '#7c3aed' },
    { label: 'Conflicts',  count: conflict,  total, color: '#d97706' },
    { label: 'Missing',    count: missing,   total, color: '#94a3b8' },
  ];
}

export default function ApprovalStep({
  pkg,
  fieldValues,
  approverRole,
  approverNotes,
  onApproverRoleChange,
  onApproverNotesChange,
  onCreateProject,
  isCreating,
}: Props) {
  const stats = coverageStats(pkg);
  const missingRequired = (REQUIRED_FIELDS as Array<keyof ExtractionFields>).filter(
    (f) => !fieldValues[f]?.trim()
  );
  const canCreate = missingRequired.length === 0 && approverRole;

  return (
    <div className={styles.root}>
      <div className={styles.intro}>
        <h2 className={styles.title}>Review & Approve</h2>
        <p className={styles.sub}>
          Confirm the extracted context before the project is created.
          All 21 AI agents will use this as their starting brief.
        </p>
      </div>

      {/* Coverage summary */}
      <div className={styles.coverageCard}>
        <div className={styles.coverageHeader}>
          Extraction Coverage
          <span className={styles.coverageDoc}>
            {pkg.documentCount} document{pkg.documentCount !== 1 ? 's' : ''}
          </span>
        </div>
        <div className={styles.statRow}>
          {stats.map((s) => (
            <div key={s.label} className={styles.stat}>
              <span className={styles.statNum} style={{ color: s.color }}>{s.count}</span>
              <span className={styles.statLabel}>{s.label}</span>
            </div>
          ))}
        </div>
        {/* Stacked bar */}
        <div className={styles.stackBar}>
          {stats.map((s) => (
            s.count > 0 ? (
              <div
                key={s.label}
                className={styles.stackSlice}
                style={{ width: `${(s.count / stats[0].total) * 100}%`, background: s.color }}
                title={`${s.count} ${s.label}`}
              />
            ) : null
          ))}
        </div>
      </div>

      {/* Doc classifications */}
      {pkg.documentClassifications.length > 0 && (
        <div className={styles.docList}>
          {pkg.documentClassifications.map((dc, i) => (
            <div key={i} className={styles.docRow}>
              <span className={styles.docName}>📄 {dc.name}</span>
              <span className={styles.docType}>{dc.type}</span>
              <span className={styles.docConf}>{Math.round(dc.confidence * 100)}%</span>
            </div>
          ))}
        </div>
      )}

      {/* Missing required fields warning */}
      {missingRequired.length > 0 && (
        <div className={styles.warnBanner}>
          <strong>Missing required fields</strong>
          <p>
            Please fill in: {missingRequired.map((f) => EXTRACTION_FIELD_LABELS[f]).join(', ')}.
            Go back to the Review step to complete them.
          </p>
        </div>
      )}

      {/* Conflicts */}
      {pkg.conflicts.length > 0 && (
        <div className={styles.conflictBanner}>
          <strong>{pkg.conflicts.length} field conflict(s)</strong>
          <p>
            These fields had disagreements between documents:{' '}
            {pkg.conflicts.map((c) => EXTRACTION_FIELD_LABELS[c.field as keyof ExtractionFields] ?? c.field).join(', ')}.
            The values shown reflect the highest-confidence source, but you should verify them.
          </p>
        </div>
      )}

      {/* Key field preview */}
      <div className={styles.fieldPreview}>
        <div className={styles.previewHeader}>Key Fields Preview</div>
        {(['projectName', 'problemStatement', 'businessGoals', 'owner'] as Array<keyof ExtractionFields>).map((fn) => (
          <div key={fn} className={styles.previewRow}>
            <div className={styles.previewMeta}>
              <span className={styles.previewLabel}>{EXTRACTION_FIELD_LABELS[fn]}</span>
              <FieldBadge method={pkg.fields[fn].method} confidence={pkg.fields[fn].confidence} />
            </div>
            <p className={styles.previewValue}>
              {fieldValues[fn] || <em className={styles.emptyVal}>Not set</em>}
            </p>
          </div>
        ))}
      </div>

      {/* Approver */}
      <div className={styles.approverCard}>
        <div className={styles.approverHeader}>Approver</div>
        <label className={styles.fieldLabel}>Your Role *</label>
        <select
          value={approverRole}
          onChange={(e) => onApproverRoleChange(e.target.value)}
          className={styles.roleSelect}
        >
          <option value="">Select your role…</option>
          {APPROVER_ROLES.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>

        <label className={styles.fieldLabel} style={{ marginTop: 12 }}>Notes (optional)</label>
        <textarea
          value={approverNotes}
          onChange={(e) => onApproverNotesChange(e.target.value)}
          placeholder="Any caveats, decisions made, or items to revisit later…"
          rows={3}
          className={styles.notesTextarea}
        />
      </div>

      {canCreate && (
        <div className={styles.readyBanner}>
          ✓ Everything looks good — ready to create the project.
        </div>
      )}

      <button
        className={styles.createBtn}
        onClick={onCreateProject}
        disabled={!canCreate || isCreating}
      >
        {isCreating ? 'Creating project…' : '🚀 Create Project'}
      </button>
    </div>
  );
}
