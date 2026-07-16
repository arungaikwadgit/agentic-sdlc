describe('proxy app-state fallback', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = {
      ...originalEnv,
      OPENAI_API_KEY: 'test-openai-key',
      PROXY_TOKEN: '',
      SUPABASE_URL: '',
      SUPABASE_ANON_KEY: '',
      SUPABASE_SERVICE_KEY: '',
      POSTGRES_URL_LOCAL: '',
      POSTGRES_URL_PRODUCTION: '',
      DATABASE_URL: '',
      SERVER_API_URL: '',
      POSTGRES_URL: '',
      NODE_ENV: 'test',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('serves app-state config from an in-memory store when Postgres is unavailable', async () => {
    const { app } = require('./proxy');
    const server = app.listen(0);

    try {
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Failed to allocate test server port');
      }

      const response = await fetch(`http://127.0.0.1:${address.port}/api/app-state/config`);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ values: {} });
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('serves the project permissions endpoint locally when the server backend is unavailable', async () => {
    const { app } = require('./proxy');
    const server = app.listen(0);

    try {
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Failed to allocate test server port');
      }

      const response = await fetch(`http://127.0.0.1:${address.port}/api/projects/permissions/me`);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ isAppAdmin: false });
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
