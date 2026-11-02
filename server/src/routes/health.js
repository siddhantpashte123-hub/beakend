// ─────────────────────────────────────────────────────────────
// BlueBeakend — health endpoints (no auth required)
// ─────────────────────────────────────────────────────────────
import { config } from '../config.js';

export async function healthRoutes(app, ctx) {
  const startedAt = Date.now();

  app.get('/health', async () => {
    const [dbOk, cacheOk] = await Promise.all([
      ctx.db.ping().catch(() => false),
      Promise.resolve(true), // cache ops fail loudly elsewhere; presence is enough
    ]);
    return {
      status: dbOk ? 'ok' : 'degraded',
      version: config.version,
      uptime: Math.floor((Date.now() - startedAt) / 1000),
      services: {
        database: { ok: dbOk, kind: ctx.db.kind },
        cache: { ok: cacheOk, kind: ctx.cache.kind },
        storage: { ok: true, kind: ctx.storage.kind },
        realtime: { ok: true, connections: ctx.hub.stats().connections },
      },
      time: new Date().toISOString(),
    };
  });

  app.get('/healthz', async (_req, reply) => reply.code(200).send('OK'));
}
