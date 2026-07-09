/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
export type IntegrationProvider = 'jira' | 'confluence' | 'github' | 'gitlab' | 'slack';

export interface IntegrationCredential {
  id: string;
  provider: IntegrationProvider;
  label: string;
  /** AES-GCM encrypted JSON blob of the actual credentials */
  encryptedData: string;
  /** Base64 IV used during encryption */
  iv: string;
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
