/**
 * © 2025 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
import { useEffect, useState } from 'react';
import { encrypt, decrypt } from '@/utils/crypto';
import type { IntegrationCredential, IntegrationProvider } from '@/types/integration.types';
import {
  deleteIntegration,
  getIntegration,
  listIntegrations,
  saveIntegration,
  subscribeAppStateChange,
} from '@/services/appStateApi';

const PASSPHRASE_KEY = 'sdlc_enc_passphrase';

function getPassphrase(): string {
  let p = localStorage.getItem(PASSPHRASE_KEY);
  if (!p) {
    p = crypto.randomUUID(); // device-scoped passphrase, persisted so saved credentials remain decryptable across sessions
    localStorage.setItem(PASSPHRASE_KEY, p);
  }
  return p;
}

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
    const passphrase = getPassphrase();
    const json = JSON.stringify(credentials);
    const { ciphertext, iv, salt } = await encrypt(json, passphrase);

    const record: IntegrationCredential = {
      id: id ?? crypto.randomUUID(),
      provider,
      label,
      encryptedData: JSON.stringify({ ciphertext, salt }),
      iv,
      createdAt: Date.now(),
    };
    await saveIntegration(record);
    return record.id;
  }

  async function loadCredential<T>(id: string): Promise<T | null> {
    const record = await getIntegration(id);
    if (!record) return null;
    const passphrase = getPassphrase();
    const { ciphertext, salt } = JSON.parse(record.encryptedData);
    const json = await decrypt({ ciphertext, iv: record.iv, salt }, passphrase);
    return JSON.parse(json) as T;
  }

  async function removeCredential(id: string): Promise<void> {
    await deleteIntegration(id);
  }

  return { integrations, saveCredential, loadCredential, removeCredential };
}
