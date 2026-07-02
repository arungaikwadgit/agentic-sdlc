import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      'file-saver': resolve(__dirname, 'node_modules/file-saver'),
      'jszip': resolve(__dirname, 'node_modules/jszip'),
      'dexie-react-hooks': resolve(__dirname, 'node_modules/dexie-react-hooks'),
      'dexie': resolve(__dirname, 'node_modules/dexie'),
      '@testing-library/react': resolve(__dirname, 'node_modules/@testing-library/react'),
      '@testing-library/user-event': resolve(__dirname, 'node_modules/@testing-library/user-event'),
    },
  },
  server: {
    port: 5173,
    headers: {
      // Vite HMR uses eval() for fast module replacement in dev mode.
      // 'unsafe-eval' is dev-only — production (Vercel) uses a strict CSP
      // set via vercel.json response headers without unsafe-eval.
      'Content-Security-Policy': [
        "default-src 'self'",
        "script-src 'self' 'unsafe-eval' 'unsafe-inline' cdn.jsdelivr.net cdnjs.cloudflare.com",
        "style-src 'self' 'unsafe-inline' fonts.googleapis.com",
        "font-src 'self' fonts.gstatic.com data: frontend-cdn.perplexity.ai",
        "img-src 'self' data: blob:",
        "connect-src 'self' ws: wss: http://localhost:* https://*.supabase.co https://cdnjs.cloudflare.com",
        "frame-src 'self' blob:",
        "worker-src 'self' blob: https://cdnjs.cloudflare.com",
      ].join('; '),
    },
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        configure(proxy) {
          // Catch ALL proxy errors (ECONNREFUSED, ECONNRESET, ETIMEDOUT, etc.)
          // and return a clear 503 so the frontend shows a useful message.
          // The original ECONNREFUSED-only check silently failed on other error
          // codes, causing the proxy to emit a bare 404 with no body.
          proxy.on('error', (err, _req, res) => {
            const code = (err as NodeJS.ErrnoException).code ?? 'ERR_PROXY';
            const srvRes = res as import('http').ServerResponse;
            if (!srvRes.headersSent) {
              srvRes.writeHead(503, { 'Content-Type': 'application/json' });
              srvRes.end(JSON.stringify({
                error: `Backend server not reachable at localhost:3001 (${code}). Run: cd backend && npm run dev`,
              }));
            }
          });
        },
      },
      '/runtime': {
        target: process.env.VITE_RUNTIME_URL ?? 'http://localhost:4000',
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/runtime/, ''),
        configure(proxy) {
          proxy.on('proxyReq', (proxyReq: { setHeader: (k: string, v: string) => void }) => {
            const token = process.env.RUNTIME_API_TOKEN;
            if (token) proxyReq.setHeader('x-api-token', token);
          });
          proxy.on('error', (err: NodeJS.ErrnoException, _req: unknown, res: unknown) => {
            if (err.code === 'ECONNREFUSED') {
              const r = res as { writeHead?: (s: number, h: Record<string, string>) => void; end?: (b: string) => void };
              if (typeof r.writeHead === 'function') {
                r.writeHead(503, { 'Content-Type': 'application/json' });
                r.end?.(JSON.stringify({ error: 'Agent Runtime not running (localhost:4000)' }));
              }
            }
          });
        },
      },
    },
    fs: {
      allow: ['..'],
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['../tests/unit/**/*.test.ts', '../tests/unit/**/*.test.tsx', '../tests/integration/**/*.test.tsx', '../tests/eval/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/main.tsx', 'src/vite-env.d.ts'],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 90,
        statements: 90,
      },
    },
  },
})
