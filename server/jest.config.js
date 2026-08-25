/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/src/**/*.test.ts'],
  // src/lib/supabase.ts throws at import time if SUPABASE_URL/SUPABASE_SERVICE_KEY
  // are unset -- every route/middleware module transitively imports it, so any
  // test suite needs *some* value present before the first `require`, not a real
  // Supabase project. See jest.setup.ts.
  setupFiles: ['<rootDir>/jest.setup.ts'],
  // Coverage is opt-in via `npm run test:coverage` / `jest --coverage` (backlog
  // item #7 -- see docs/architecture/execution-status-2026-08-24.md Section 4).
  // Report-only for now, same reasoning as backend/jest.config.js: no
  // coverageThreshold until a CI run has reported the real baseline number.
  collectCoverageFrom: [
    'src/**/*.{js,ts}',
    '!src/**/*.test.{js,ts}',
    '!src/**/*.d.ts',
  ],
  coveragePathIgnorePatterns: ['/node_modules/', '/dist/'],
};
