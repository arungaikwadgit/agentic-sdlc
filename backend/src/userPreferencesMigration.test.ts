/**
 * Copyright 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential - Unauthorized use prohibited.
 */
const fs = require('fs');
const path = require('path');

describe('user preferences migration security', () => {
  it('keeps the backend-only table inaccessible to browser database roles', () => {
    const sql = fs.readFileSync(
      path.resolve(__dirname, '../migrations/008_user_preferences.sql'),
      'utf8',
    );
    expect(sql).toMatch(/ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY/i);
    expect(sql).toMatch(/REVOKE ALL ON TABLE user_preferences FROM anon, authenticated/i);
  });
});

export {};
