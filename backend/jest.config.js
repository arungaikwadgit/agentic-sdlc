/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/src/**/*.test.ts'],
  // Coverage is opt-in via `npm run test:coverage` / `jest --coverage` (backlog
  // item #7 -- see docs/architecture/execution-status-2026-08-24.md Section 4).
  // Report-only for now: CI prints the real number on every push so a
  // threshold can be set from an actual baseline instead of a guess. No
  // coverageThreshold here yet -- adding one before a CI run has reported the
  // true whole-suite number would just break the pipeline on the next push.
  collectCoverageFrom: [
    'src/**/*.{js,ts}',
    '!src/**/*.test.{js,ts}',
    '!src/**/*.d.ts',
    '!src/worker/**',
  ],
  coveragePathIgnorePatterns: ['/node_modules/', '/dist/'],
};
