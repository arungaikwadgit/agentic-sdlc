class InMemoryAppStateStore {
  constructor() {
    this.appConfig = new Map();
    this.integrations = new Map();
    this.backlogItems = new Map();
  }

  async getAppConfigMap(keys = null) {
    if (!keys?.length) {
      return Object.fromEntries(this.appConfig.entries());
    }

    return Object.fromEntries(
      keys.map((key) => [key, this.appConfig.get(key) ?? null]),
    );
  }

  async setAppConfigValue(key, value) {
    this.appConfig.set(key, value);
  }

  async deleteAllAppConfig() {
    this.appConfig.clear();
  }

  async listIntegrations() {
    return Array.from(this.integrations.values()).sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  }

  async getIntegration(id) {
    return this.integrations.get(id) ?? null;
  }

  async saveIntegration(record) {
    this.integrations.set(record.id, {
      id: record.id,
      provider: record.provider,
      label: record.label,
      encryptedData: record.encryptedData,
      iv: record.iv,
      createdAt: Number(record.createdAt ?? Date.now()),
    });
  }

  async deleteIntegration(id) {
    this.integrations.delete(id);
  }

  async listBacklogItems() {
    return Array.from(this.backlogItems.values()).sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  }

  async createBacklogItem(item) {
    this.backlogItems.set(item.id, {
      ...item,
      createdAt: Number(item.createdAt ?? Date.now()),
      updatedAt: Number(item.updatedAt ?? Date.now()),
    });
  }

  async updateBacklogItem(id, patch) {
    const existing = this.backlogItems.get(id);
    if (!existing) return null;
    const next = {
      ...existing,
      ...patch,
      updatedAt: Number(patch.updatedAt ?? Date.now()),
    };
    this.backlogItems.set(id, next);
    return next;
  }

  async deleteBacklogItem(id) {
    this.backlogItems.delete(id);
  }
}

function createInMemoryAppStateStore() {
  return new InMemoryAppStateStore();
}

module.exports = {
  InMemoryAppStateStore,
  createInMemoryAppStateStore,
};
