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
};
