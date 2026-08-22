/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
export type IntegrationProvider = 'jira' | 'confluence' | 'github' | 'gitlab' | 'slack';

export interface IntegrationCredential {
  id: string;
  provider: IntegrationProvider;
  label: string;
  /** Server-side AES-256-GCM encrypted JSON blob (backend/src/integrationCredentialCrypto.js).
   * Opaque to the frontend -- only used for the metadata list view; never decrypted client-side. */
  encryptedData: string;
  /** Storage-format marker set by the backend encryption module, not a real IV the frontend uses. */
  iv: string;
  createdAt: number;
}

/** Returned by GET /app-state/integrations/:id -- the backend decrypts
 * server-side and sends the plaintext credentials over the authenticated
 * connection. Distinct from IntegrationCredential (the list/metadata shape,
 * which stays opaque). */
export interface DecryptedIntegration<T = Record<string, unknown>> {
  id: string;
  provider: IntegrationProvider;
  label: string;
  credentials: T;
  createdAt: number;
}

export interface JiraCredentials {
  baseUrl: string;
  email: string;
  apiToken: string;
  projectKey: string;
}

export interface GithubCredentials {
  token: string;
  owner: string;
  repo: string;
}
