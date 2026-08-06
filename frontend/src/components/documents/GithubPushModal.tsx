/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
import { useEffect, useState } from 'react';
import { useIntegrations } from '@/hooks/useIntegrations';
import { api, type GithubPushResult } from '@/services/api';
import { parseDocumentToIssues, type ParsedIssue } from '@/services/githubIssueParser';
import type { GithubCredentials } from '@/types/integration.types';
import type { Project } from '@/types/project.types';
import styles from './GithubPushModal.module.css';

interface Props {
  project: Project;
  /** Markdown source to parse into issue drafts (the agent's output). */
  markdown: string;
  /** Extra labels applied to every parsed issue, e.g. ['sprint-plan']. */
  extraLabels?: string[];
  /** Display name for the source document, shown in the header. */
  sourceLabel: string;
  onClose: () => void;
}

const MAX_ISSUES_PER_PUSH = 50;

export default function GithubPushModal({ project, markdown, extraLabels, sourceLabel, onClose }: Props) {
  const { loadCredential } = useIntegrations();

  const [loadingCreds, setLoadingCreds] = useState(true);
  const [creds, setCreds] = useState<GithubCredentials | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [issues, setIssues] = useState<ParsedIssue[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const [pushing, setPushing] = useState(false);
  const [pushResult, setPushResult] = useState<GithubPushResult | null>(null);
  const [pushError, setPushError] = useState<string | null>(null);

  // Load the project's GitHub credentials and parse the document.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingCreds(true);
      setLoadError(null);
      try {
        if (!project.githubIntegrationId) {
          throw new Error('No GitHub integration configured for this project.');
        }
        const loaded = await loadCredential<GithubCredentials>(project.githubIntegrationId);
        if (!loaded) throw new Error('Saved GitHub connection could not be loaded. Reconnect it in Settings.');
        if (cancelled) return;
        setCreds(loaded);

        const parsed = parseDocumentToIssues(markdown, extraLabels);
        setIssues(parsed);
        setSelected(new Set(parsed.map((_, i) => i)));
      } catch (e) {
        if (!cancelled) setLoadError(String(e instanceof Error ? e.message : e));
      } finally {
        if (!cancelled) setLoadingCreds(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.githubIntegrationId, markdown]);

  function toggle(index: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => (prev.size === issues.length ? new Set() : new Set(issues.map((_, i) => i))));
  }

  async function handlePush() {
    if (!creds) return;
    const toPush = issues.filter((_, i) => selected.has(i));
    if (toPush.length === 0) return;
    if (toPush.length > MAX_ISSUES_PER_PUSH) {
      setPushError(`Select ${MAX_ISSUES_PER_PUSH} or fewer issues per push (${toPush.length} selected).`);
      return;
    }
    setPushing(true);
    setPushError(null);
    setPushResult(null);
    try {
      const result = await api.pushIssuesToGithub({
        ...creds,
        issues: toPush.map((i) => ({ title: i.title, body: i.body, labels: i.labels })),
      });
      setPushResult(result);
    } catch (e) {
      setPushError(String(e instanceof Error ? e.message : e));
    } finally {
      setPushing(false);
    }
  }

  const selectedCount = selected.size;

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <div>
            <h2>Push to GitHub Issues</h2>
            <p className={styles.subtitle}>
              {sourceLabel} → {creds ? `${creds.owner}/${creds.repo}` : '...'}
            </p>
          </div>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className={styles.body}>
          {loadingCreds && <p className={styles.hint}>Loading GitHub connection...</p>}

          {loadError && <p className={styles.error}>⚠ {loadError}</p>}

          {!loadingCreds && !loadError && (
            <>
              <p className={styles.hint}>
                This is an automated, best-effort breakdown of the document into issues. Review the title, body,
                and labels for each item below, uncheck anything you don't want to create, and edit the document
                itself if the breakdown looks wrong before pushing again.
              </p>

              {issues.length === 0 ? (
                <div className={styles.empty}>
                  No tasks could be parsed from this document. Try editing the document into a clearer
                  heading + list structure, or create issues manually in GitHub.
                </div>
              ) : (
                <>
                  <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input type="checkbox" checked={selected.size === issues.length} onChange={toggleAll} />
                    {selectedCount} of {issues.length} selected
                    {issues.length > MAX_ISSUES_PER_PUSH && ` (max ${MAX_ISSUES_PER_PUSH} per push)`}
                  </label>

                  <div className={styles.issueList}>
                    {issues.map((issue, i) => (
                      <div className={styles.issueItem} key={i}>
                        <input
                          type="checkbox"
                          checked={selected.has(i)}
                          onChange={() => toggle(i)}
                        />
                        <div className={styles.issueContent}>
                          <div className={styles.issueTitle}>{issue.title}</div>
                          {issue.labels.length > 0 && (
                            <div className={styles.issueLabels}>
                              {issue.labels.map((l) => <span key={l} className={styles.issueLabel}>{l}</span>)}
                            </div>
                          )}
                          {issue.body && <div className={styles.issueBody}>{issue.body}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {pushError && <p className={styles.error}>⚠ {pushError}</p>}

              {pushResult && (
                <div className={styles.resultList}>
                  <p className={styles.hint}>
                    Created {pushResult.created} of {pushResult.total} issue{pushResult.total === 1 ? '' : 's'}.
                  </p>
                  {pushResult.results.map((r, i) => (
                    <div key={i} className={`${styles.resultItem} ${r.ok ? styles.resultOk : styles.resultFail}`}>
                      {r.ok ? '✓' : '✕'}{' '}
                      {r.ok && r.url ? (
                        <a href={r.url} target="_blank" rel="noreferrer">#{r.number} {r.title}</a>
                      ) : (
                        <span>{r.title}{r.error ? ` — ${r.error}` : ''}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div className={styles.footer}>
          <span className={styles.summary}>
            {pushResult ? 'Done.' : creds ? `Connected to ${creds.owner}/${creds.repo}` : ''}
          </span>
          <div className={styles.actions}>
            <button className="btn-secondary" onClick={onClose}>
              {pushResult ? 'Close' : 'Cancel'}
            </button>
            {!pushResult && (
              <button
                className="btn-primary"
                onClick={handlePush}
                disabled={loadingCreds || !!loadError || issues.length === 0 || selectedCount === 0 || pushing}
              >
                {pushing ? '⟳ Pushing...' : `Push ${selectedCount} Issue${selectedCount === 1 ? '' : 's'}`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
