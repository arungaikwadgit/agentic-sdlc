const { createInMemoryAppStateStore } = require('./appStateStore');

describe('createInMemoryAppStateStore', () => {
  it('persists config values and returns them by key', async () => {
    const store = createInMemoryAppStateStore();

    await store.setAppConfigValue('app:theme', 'dark');
    const values = await store.getAppConfigMap(['app:theme']);

    expect(values).toEqual({ 'app:theme': 'dark' });
  });

  it('tracks integrations and backlog items without a database', async () => {
    const store = createInMemoryAppStateStore();

    await store.saveIntegration({
      id: 'int-1',
      provider: 'github',
      label: 'GitHub',
      encryptedData: 'abc',
      iv: '123',
      createdAt: 1,
    });

    await store.createBacklogItem({
      id: 'item-1',
      title: 'Add theme toggle',
      description: '...',
      category: 'ux',
      priority: 'high',
      status: 'open',
      source: 'manual',
      createdAt: 2,
      updatedAt: 2,
    });

    expect(await store.listIntegrations()).toHaveLength(1);
    expect(await store.listBacklogItems()).toHaveLength(1);
  });
});
