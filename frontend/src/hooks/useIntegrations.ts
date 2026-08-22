/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
import { useEffect, useState } from 'react';
import type { IntegrationCredential, IntegrationProvider } from '@/types/integration.types';
import {
  deleteIntegration,
  getIntegration,
  listIntegrations,
  saveIntegration,
  subscribeAppStateChange,
} from '@/services/appStateApi';

// Encryption is server-side as of this pass (backend/src/integrationCredentialCrypto.js,
// wired into backend/src/routes/appState.js). Previously this hook encrypted
// client-side with a passphrase auto-generated via crypto.randomUUID() and
// stored in localStorage -- meaning credentials became permanently
// undecryptable if localStorage was ever cleared, and the "key" never lived
// anywhere centrally rotatable. The backend now holds the only key
// (APP_INTEGRATION_ENCRYPTION_KEY) and this hook just passes plaintext
// credentials over the authenticated /api/app-state/integrations connection.
// Records saved under the old scheme come back as 404 from GET
// /integrations/:id (see that route's LEGACY_RECORD handling) -- loadCredential
// below treats that identically to "never connected", so existing call sites
// (ProjectSettings.tsx, GithubPushModal.tsx) already prompt reconnect without
// needing a separate migration UI.
export function useIntegrations() {
  const [integrations, setIntegrations] = useState<IntegrationCredential[]>([]);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const items = await listIntegrations();
        if (active) setIntegrations(items);
      } catch {
        if (active) setIntegrations([]);
      }
    }
    void load();
    const unsubscribe = subscribeAppStateChange((topic) => {
      if (topic === 'integrations') void load();
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  async function saveCredential(
    provider: IntegrationProvider,
    label: string,
    credentials: object,
    id?: string
  ): Promise<string> {
    const recordId = id ?? crypto.randomUUID();
    await saveIntegration(recordId, provider, label, credentials);
    return recordId;
  }

  async function loadCredential<T>(id: string): Promise<T | null> {
    const decrypted = await getIntegration(id);
    if (!decrypted) return null;
    return decrypted.credentials as T;
  }

  async function removeCredential(id: string): Promise<void> {
    await deleteIntegration(id);
  }

  return { integrations, saveCredential, loadCredential, removeCredential };
}
