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
        "script-src 'self' 'unsafe-eval' 'unsafe-inline' cdn.jsdelivr.net",
        "style-src 'self' 'unsafe-inline' fonts.googleapis.com",
        "font-src 'self' fonts.gstatic.com data: frontend-cdn.perplexity.ai",
        "img-src 'self' data: blob:",
        "connect-src 'self' ws: wss: http://localhost:* https://*.supabase.co",
        "frame-src 'self' blob:",
        "worker-src 'self' blob:",
      ].join('; '),
    },
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        configure(proxy) {
          proxy.on('error', (err, _req, res) => {
            if ((err as NodeJS.ErrnoException).code === 'ECONNREFUSED') {
              if ('writeHead' in res && typeof (res as any).writeHead === 'function') {
                (res as any).writeHead(503, { 'Content-Type': 'application/json' });
                (res as any).end(JSON.stringify({ error: 'Backend proxy not running (localhost:3001)' }));
              }
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
