/* eslint-disable no-console */
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const seedFile = path.resolve(__dirname, '..', 'seeds', 'seed_mock_data.psql');

function escapeSqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function compilePsqlTemplate(source) {
  const variables = new Map();
  const withoutSetLines = source
    .split(/\r?\n/)
    .filter((line) => {
      const match = line.match(
        /^\\set\s+([A-Za-z_][A-Za-z0-9_]*)\s+'((?:''|[^'])*)'\s*(?:--.*)?$/,
      );
      if (!match) return true;
      variables.set(match[1], match[2].replace(/''/g, "'"));
      return false;
    })
    .join('\n');

  return withoutSetLines.replace(/:'([A-Za-z_][A-Za-z0-9_]*)'/g, (_all, name) => {
    if (!variables.has(name)) {
      throw new Error(`Missing psql variable: ${name}`);
    }
    return escapeSqlLiteral(variables.get(name));
  });
}

async function main() {
  if (!process.env.POSTGRES_URL) {
    throw new Error('POSTGRES_URL is required');
  }

  const raw = fs.readFileSync(seedFile, 'utf8');
  const sql = compilePsqlTemplate(raw);

  // See seedMasterData.js for why this is conditional: local docker-compose
  // Postgres has no SSL listener and rejects an SSL negotiation attempt
  // outright, while Supabase/managed Postgres requires it.
  const seedTargetHost = (process.env.POSTGRES_URL ?? '').replace(/^[a-z]+:\/\/[^@]*@/, '').split(/[:/]/)[0];
  const seedIsLocalHost = /^(localhost|127\.0\.0\.1|db)$/i.test(seedTargetHost ?? '');

  const pool = new Pool({
    connectionString: process.env.POSTGRES_URL,
    ssl: seedIsLocalHost ? false : { rejectUnauthorized: false },
  });

  try {
    await pool.query(sql);
    console.log('Sample data seeded successfully.');
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
