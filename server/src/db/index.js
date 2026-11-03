// ─────────────────────────────────────────────────────────────
// BlueBeakend — database facade
// Uses PostgreSQL when DATABASE_URL is set, otherwise a fully
// functional in-memory store (development & tests).
// ─────────────────────────────────────────────────────────────
import { config } from '../config.js';
import { MemoryDb } from './memory.js';
import { PgDb } from './pg.js';

export async function createDb({ databaseUrl = config.databaseUrl, forceMemory = false } = {}) {
  let db;
  if (!forceMemory && databaseUrl) {
    db = new PgDb(databaseUrl);
  } else {
    db = new MemoryDb();
  }
  await db.init();
  return db;
}

export { MemoryDb, PgDb };
