// ─────────────────────────────────────────────────────────────
// BlueBeakend — SQL migration runner (idempotent)
// Usage: node src/db/migrate.js   (runs against DATABASE_URL)
// ─────────────────────────────────────────────────────────────
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../migrations');

// Strip SQL comments that would confuse nothing, but keep it simple:
// the migration files are plain SQL executed in filename order.
export async function runMigrations(db) {
  await db.query(`CREATE TABLE IF NOT EXISTS _migrations (
    name TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  const applied = new Set((await db.query('SELECT name FROM _migrations')).rows.map((r) => r.name));
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    await db.query(sql);
    await db.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
  }
}

// CLI entry
if (process.argv[1] && process.argv[1].endsWith('migrate.js')) {
  const { config } = await import('../config.js');
  if (!config.databaseUrl) {
    console.log('DATABASE_URL not set — nothing to migrate (memory mode).');
    process.exit(0);
  }
  const { PgDb } = await import('./pg.js');
  const db = new PgDb(config.databaseUrl);
  await runMigrations(db);
  console.log('✅ Migrations applied.');
  await db.close();
}
