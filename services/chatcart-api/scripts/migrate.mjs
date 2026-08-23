import 'dotenv/config';
import dotenv from 'dotenv';
dotenv.config({ override: true });

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '../migrations');

const DRY_RUN = process.argv.includes('--dry-run');

/**
 * Single source of truth for schema migrations.
 *
 * - Every file must be named `NNN_description.sql` with a unique numeric prefix.
 * - Files run in ascending numeric order, each wrapped in its own transaction.
 * - Applied migrations are recorded in `schema_migrations` (version + checksum),
 *   so re-running this script is always safe: already-applied migrations are
 *   skipped, and editing an already-applied file's contents is caught as an
 *   error instead of silently drifting from what actually ran in prod.
 *
 * This replaces the old per-feature runner scripts (run-migration.mjs,
 * run-posts-migration.mjs, run-orders-migration.mjs, run-chat-migration.mjs),
 * which each hardcoded their own filename list with no shared ordering or
 * applied-state tracking — which is how two pairs of migrations ended up
 * sharing the same version number, and two files were never wired into any
 * runner at all.
 */

function loadMigrationFiles() {
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));
  const byVersion = new Map();

  for (const file of files) {
    const match = file.match(/^(\d+)_/);
    if (!match) {
      throw new Error(
        `Migration file "${file}" has no numeric prefix. Expected "NNN_description.sql".`
      );
    }
    const version = match[1];
    if (byVersion.has(version)) {
      throw new Error(
        `Migration version collision: "${byVersion.get(version)}" and "${file}" ` +
          `both use version ${version}. Renumber one of them before running migrations.`
      );
    }
    byVersion.set(version, file);
  }

  return [...byVersion.entries()]
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([version, file]) => ({ version, file }));
}

function normalizeMigrationSql(sql) {
  // Checksums are computed on LF-normalized SQL so Windows CRLF checkouts
  // match what ran on Linux/Cloud Run when migrations were first applied.
  return sql.replace(/\r\n/g, '\n');
}

function checksumOf(sql) {
  return crypto.createHash('sha256').update(normalizeMigrationSql(sql)).digest('hex');
}

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     TEXT PRIMARY KEY,
      filename    TEXT NOT NULL,
      checksum    TEXT NOT NULL,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL missing — set it in services/chatcart-api/.env');
    process.exit(1);
  }

  const migrations = loadMigrationFiles();
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    await ensureMigrationsTable(client);

    const { rows: appliedRows } = await client.query(
      'SELECT version, filename, checksum FROM schema_migrations'
    );
    const applied = new Map(appliedRows.map((r) => [r.version, r]));

    let appliedCount = 0;

    for (const { version, file } of migrations) {
      const sqlPath = path.join(MIGRATIONS_DIR, file);
      const sql = normalizeMigrationSql(fs.readFileSync(sqlPath, 'utf8'));
      const checksum = checksumOf(sql);
      const existing = applied.get(version);

      if (existing) {
        if (existing.filename !== file || existing.checksum !== checksum) {
          throw new Error(
            `Migration ${version} was already applied as "${existing.filename}" ` +
              `(checksum ${existing.checksum.slice(0, 12)}...), but "${file}" now has a ` +
              `different filename/content (checksum ${checksum.slice(0, 12)}...). ` +
              'Never edit an applied migration — add a new one instead.'
          );
        }
        console.log(`skip   ${version}_${file.replace(/^\d+_/, '')} (already applied)`);
        continue;
      }

      if (DRY_RUN) {
        console.log(`would apply ${file}`);
        continue;
      }

      console.log(`apply  ${file}`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (version, filename, checksum) VALUES ($1, $2, $3)',
          [version, file, checksum]
        );
        await client.query('COMMIT');
        appliedCount += 1;
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration "${file}" failed and was rolled back: ${err.message}`);
      }
    }

    if (DRY_RUN) {
      console.log('Dry run complete — no changes made.');
    } else {
      console.log(
        appliedCount > 0
          ? `Applied ${appliedCount} migration(s). Schema is up to date.`
          : 'No pending migrations. Schema is up to date.'
      );
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
