export {};

const express = require('express');
const { createMasterDataRouter } = require('./masterData');

function authOk(req: any, _res: any, next: any) {
  req.authUser = { email: 'admin@example.com', user: { id: 'admin-1' }, adminBypass: true };
  next();
}

function adminOk(_req: any, _res: any, next: any) {
  next();
}

function buildApp(overrides: any = {}) {
  const app = express();
  app.use(express.json());
  const checkToken = overrides.checkToken ?? authOk;
  const requireAdmin = overrides.requireAdmin ?? adminOk;
  const dbGetMasterCatalog = overrides.dbGetMasterCatalog ?? jest.fn();
  const dbUpsertDomain = overrides.dbUpsertDomain ?? jest.fn();
  const router = createMasterDataRouter({ checkToken, requireAdmin, dbGetMasterCatalog, dbUpsertDomain });
  app.use('/api/master-data', router);
  return app;
}

async function withServer(app: any, fn: (baseUrl: string) => Promise<void>) {
  const server = app.listen(0);
  try {
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Failed to allocate test server port');
    }
    const baseUrl = `http://127.0.0.1:${address.port}`;
    await fn(baseUrl);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

describe('createMasterDataRouter', () => {
  describe('GET /catalog', () => {
    it('returns the catalog as JSON (public, no auth required)', async () => {
      const dbGetMasterCatalog = jest.fn().mockResolvedValue({ domains: [{ id: 'tech', label: 'Technology' }] });
      const app = buildApp({ dbGetMasterCatalog });
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/master-data/catalog`);
        const body: any = await response.json();
        expect(response.status).toBe(200);
        expect(body).toEqual({ domains: [{ id: 'tech', label: 'Technology' }] });
      });
    });

    it('returns an empty object when the catalog resolves to null/undefined', async () => {
      const dbGetMasterCatalog = jest.fn().mockResolvedValue(null);
      const app = buildApp({ dbGetMasterCatalog });
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/master-data/catalog`);
        const body: any = await response.json();
        expect(response.status).toBe(200);
        expect(body).toEqual({});
      });
    });

    it('returns 500 when the catalog query throws', async () => {
      const dbGetMasterCatalog = jest.fn().mockRejectedValue(new Error('db down'));
      const app = buildApp({ dbGetMasterCatalog });
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/master-data/catalog`);
        const body: any = await response.json();
        expect(response.status).toBe(500);
        expect(body.error).toMatch(/unavailable/i);
      });
    });
  });

  describe('PUT /domains/:id', () => {
    it('rejects with 403 when requireAdmin denies the caller', async () => {
      const requireAdmin = jest.fn((_req: any, res: any) => res.status(403).json({ error: 'Admins only.' }));
      const dbUpsertDomain = jest.fn();
      const app = buildApp({ requireAdmin, dbUpsertDomain });
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/master-data/domains/logistics`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ label: 'Logistics', context: 'Supply chain' }),
        });
        expect(response.status).toBe(403);
        expect(dbUpsertDomain).not.toHaveBeenCalled();
      });
    });

    it('rejects an id that fails the id regex with 400', async () => {
      const dbUpsertDomain = jest.fn();
      const app = buildApp({ dbUpsertDomain });
      await withServer(app, async (baseUrl) => {
        // single character: fails {1,49} minimum length requirement after the leading letter
        const response = await fetch(`${baseUrl}/api/master-data/domains/a`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ label: 'X', context: 'Y' }),
        });
        const body: any = await response.json();
        expect(response.status).toBe(400);
        expect(body.error).toMatch(/2-50 characters/i);
        expect(dbUpsertDomain).not.toHaveBeenCalled();
      });
    });

    it('rejects a missing label with 400', async () => {
      const dbUpsertDomain = jest.fn();
      const app = buildApp({ dbUpsertDomain });
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/master-data/domains/logistics`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ context: 'Supply chain' }),
        });
        const body: any = await response.json();
        expect(response.status).toBe(400);
        expect(body.error).toMatch(/label is required/i);
        expect(dbUpsertDomain).not.toHaveBeenCalled();
      });
    });

    it('rejects a missing context with 400', async () => {
      const dbUpsertDomain = jest.fn();
      const app = buildApp({ dbUpsertDomain });
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/master-data/domains/logistics`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ label: 'Logistics' }),
        });
        const body: any = await response.json();
        expect(response.status).toBe(400);
        expect(body.error).toMatch(/context is required/i);
        expect(dbUpsertDomain).not.toHaveBeenCalled();
      });
    });

    it('falls back to default colors when hex color values are invalid', async () => {
      const dbUpsertDomain = jest.fn().mockResolvedValue({ id: 'logistics', label: 'Logistics' });
      const app = buildApp({ dbUpsertDomain });
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/master-data/domains/logistics`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ label: 'Logistics', context: 'Supply chain', color: 'notacolor', bgColor: '#zzzzzz' }),
        });
        expect(response.status).toBe(200);
        expect(dbUpsertDomain).toHaveBeenCalledWith({
          id: 'logistics',
          label: 'Logistics',
          color: '#64748b',
          bgColor: '#e2e8f0',
          context: 'Supply chain',
          template: '',
        });
      });
    });

    it('trims label/context and forwards valid hex colors and template on success', async () => {
      const dbUpsertDomain = jest.fn().mockResolvedValue({ id: 'logistics', label: 'Logistics' });
      const app = buildApp({ dbUpsertDomain });
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/master-data/domains/logistics`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            label: '  Logistics  ',
            context: '  Supply chain  ',
            color: '#123abc',
            bgColor: '#abcdef',
            template: 'custom',
          }),
        });
        const body: any = await response.json();
        expect(response.status).toBe(200);
        expect(body).toEqual({ ok: true, domain: { id: 'logistics', label: 'Logistics' } });
        expect(dbUpsertDomain).toHaveBeenCalledWith({
          id: 'logistics',
          label: 'Logistics',
          color: '#123abc',
          bgColor: '#abcdef',
          context: 'Supply chain',
          template: 'custom',
        });
      });
    });

    it('returns 501 when dbUpsertDomain resolves falsy (no direct Postgres connection configured)', async () => {
      const dbUpsertDomain = jest.fn().mockResolvedValue(null);
      const app = buildApp({ dbUpsertDomain });
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/master-data/domains/logistics`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ label: 'Logistics', context: 'Supply chain' }),
        });
        const body: any = await response.json();
        expect(response.status).toBe(501);
        expect(body.error).toMatch(/direct Postgres connection/i);
      });
    });

    it('returns 500 when dbUpsertDomain throws', async () => {
      const dbUpsertDomain = jest.fn().mockRejectedValue(new Error('constraint violation'));
      const app = buildApp({ dbUpsertDomain });
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/master-data/domains/logistics`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ label: 'Logistics', context: 'Supply chain' }),
        });
        const body: any = await response.json();
        expect(response.status).toBe(500);
        expect(body.error).toMatch(/constraint violation/i);
      });
    });


    it('falls back to {} when the request has no body-parsing middleware at all (req.body ?? {} fallback)', async () => {
      // No express.json() mounted at all, so req.body is truly undefined --
      // this is the only way to exercise the `req.body ?? {}` nullish
      // fallback (express.json() itself defaults bodyless requests to {},
      // which is already a defined, non-nullish value).
      const dbUpsertDomain = jest.fn();
      const app = express();
      const router = createMasterDataRouter({
        checkToken: authOk,
        requireAdmin: adminOk,
        dbGetMasterCatalog: jest.fn(),
        dbUpsertDomain,
      });
      app.use('/api/master-data', router);
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/master-data/domains/logistics`, { method: 'PUT' });
        const body: any = await response.json();
        expect(response.status).toBe(400);
        expect(body.error).toMatch(/label is required/i);
        expect(dbUpsertDomain).not.toHaveBeenCalled();
      });
    });
  });
});
