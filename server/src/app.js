// ─────────────────────────────────────────────────────────────
// BlueBeakend — Fastify application factory
// ─────────────────────────────────────────────────────────────
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';

import { config } from './config.js';
import { createDb } from './db/index.js';
import { createCache } from './cache/index.js';
import { createStorage } from './storage/index.js';
import { RealtimeHub } from './realtime/hub.js';
import { bootstrap } from './bootstrap.js';
import { makeApiKeyGuard } from './middleware/apiKey.js';
import { makeRateLimiter, makeRequestCounter } from './middleware/rateLimit.js';
import { healthRoutes } from './routes/health.js';
import { authRoutes } from './routes/auth.js';
import { dbRoutes } from './routes/db.js';
import { storageRoutes } from './routes/storage.js';
import { adminRoutes } from './routes/admin.js';
import { realtimeRoutes } from './routes/realtime.js';
import { docsRoutes } from './routes/docs.js';
import { ApiError } from './errors.js';
import { onLogEntry, createLogger } from './logger.js';

const log = createLogger('http');
const __dirname = dirname(fileURLToPath(import.meta.url));

function resolveAdminDistDir() {
  const candidates = [
    process.env.ADMIN_DIST_DIR,
    resolve(__dirname, '../../admin/out'),
    resolve(__dirname, '../admin-dist'),
  ].filter(Boolean);
  for (const dir of candidates) {
    if (existsSync(join(dir, 'index.html'))) return dir;
  }
  return null;
}

export async function buildApp(opts = {}) {
  const app = Fastify({
    logger: false,
    trustProxy: true,
    bodyLimit: (opts.maxUploadMb || config.maxUploadMb) * 1024 * 1024,
  });

  const db = opts.db || (await createDb({ databaseUrl: opts.databaseUrl, forceMemory: opts.forceMemory }));
  const cache = opts.cache || (await createCache({ redisUrl: opts.redisUrl, forceMemory: opts.forceMemory }));
  const storage = opts.storage || (await createStorage({ storageDir: opts.storageDir, forceLocal: opts.forceLocal }));
  const hub = new RealtimeHub(cache);
  await hub.start();

  // Stream structured logs to connected admin WebSocket clients
  const unsubLogs = onLogEntry((entry) => {
    hub.publish('admin:logs', 'log.entry', entry).catch(() => {});
  });

  const bootInfo = opts.skipBootstrap ? null : await bootstrap({ db, cache, storage });
  const ctx = { db, cache, storage, hub, bootInfo };
  app.decorate('bb', ctx);

  // ── Plugins ────────────────────────────────────────────────
  await app.register(cors, {
    origin: async (origin) => {
      if (!origin) return true;
      const raw = await db.getSetting('corsOrigins', config.corsOrigins.join(','));
      const list = String(raw || '*').split(',').map((s) => s.trim()).filter(Boolean);
      if (list.includes('*')) return true;
      return list.includes(origin);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-API-Key',
      'X-Tunnel-Skip-AntiPhishing-Page',
      'ngrok-skip-browser-warning',
    ],
  });

  await app.register(multipart, {
    limits: {
      fileSize: (opts.maxUploadMb || config.maxUploadMb) * 1024 * 1024,
      files: 5,
    },
  });

  await app.register(websocket);

  // Gracefully allow empty body when Content-Type: application/json is sent on bodyless POST/DELETE
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    if (!body || !body.trim()) return done(null, {});
    try {
      done(null, JSON.parse(body));
    } catch (err) {
      err.statusCode = 400;
      done(err, undefined);
    }
  });

  // Allow raw binary payloads on direct-upload endpoints (e.g. image/png, application/octet-stream)
  app.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, payload, done) => {
    done(null, payload);
  });

  // ── Request counter ────────────────────────────────────────
  app.addHook('onRequest', makeRequestCounter({ cache }));

  // ── Error handler ──────────────────────────────────────────
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ApiError) {
      return reply.code(err.status).send({
        error: {
          code: err.code,
          message: err.message,
          ...(err.details ? { details: err.details } : {}),
        },
      });
    }
    if (err.statusCode && err.statusCode < 500) {
      return reply.code(err.statusCode).send({
        error: { code: 'BAD_REQUEST', message: err.message },
      });
    }
    log.error(`unhandled error on ${req.method} ${req.url}: ${err.message}`);
    return reply.code(500).send({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
  });

  // ── Core health & realtime routes ──────────────────────────
  await app.register(healthRoutes, ctx);
  await app.register(realtimeRoutes, ctx);

  if ((opts.role || config.role) !== 'realtime') {
    const rateLimiter = makeRateLimiter({ cache, db });

    await app.register(docsRoutes);

    // /api/v1/auth — requires project X-API-Key
    await app.register(
      async (sub) => {
        sub.addHook('preHandler', makeApiKeyGuard({ db }));
        sub.addHook('preHandler', rateLimiter);
        await authRoutes(sub, ctx);
      },
      { prefix: '/api/v1/auth' }
    );

    // /api/v1/db — requires X-API-Key (or admin Bearer JWT from dashboard)
    await app.register(
      async (sub) => {
        sub.addHook('preHandler', async (req) => {
          // WebSocket upgrades pass credentials via query string
          if (req.headers.upgrade?.toLowerCase() === 'websocket') return;
          await makeApiKeyGuard({ db, allowAdminBearer: true })(req);
          await rateLimiter(req);
        });
        await dbRoutes(sub, ctx);
      },
      { prefix: '/api/v1/db' }
    );

    // /api/v1/storage — requires X-API-Key, admin Bearer, or HMAC signed query
    await app.register(
      async (sub) => {
        sub.addHook('preHandler', makeApiKeyGuard({ db, allowAdminBearer: true, allowSignedQuery: true }));
        sub.addHook('preHandler', rateLimiter);
        await storageRoutes(sub, ctx);
      },
      { prefix: '/api/v1/storage' }
    );

    // /api/v1/admin — admin JWT guarded per route
    await app.register(
      async (sub) => {
        sub.addHook('preHandler', rateLimiter);
        await adminRoutes(sub, ctx);
      },
      { prefix: '/api/v1/admin' }
    );

    // ── Serve official browser ESM SDK at /sdk/bluebeakend.js ──
    app.get('/sdk/bluebeakend.js', async (_req, reply) => {
      const sdkCandidates = [
        resolve(__dirname, '../../sdk/js/src/index.js'),
        resolve(__dirname, '../sdk-js/index.js'),
      ];
      for (const p of sdkCandidates) {
        if (existsSync(p)) {
          const js = await readFile(p, 'utf8');
          return reply
            .header('Access-Control-Allow-Origin', '*')
            .header('Cache-Control', 'public, max-age=300')
            .type('application/javascript; charset=utf-8')
            .send(js);
        }
      }
      return reply.code(404).send('// SDK bundle not found');
    });

    // ── Serve Blueee Chat sample app at /chat ──────────────────
    app.get('/chat', async (_req, reply) => {
      const chatCandidates = [
        resolve(__dirname, '../../examples/blueee-chat/index.html'),
        resolve(__dirname, '../examples/blueee-chat/index.html'),
      ];
      for (const p of chatCandidates) {
        if (existsSync(p)) {
          const html = await readFile(p, 'utf8');
          return reply.type('text/html; charset=utf-8').send(html);
        }
      }
      return reply.code(404).send('Chat example not found');
    });

    // ── Serve Next.js 14 Admin Dashboard under /admin ─────────
    const adminDir = resolveAdminDistDir();
    if (adminDir) {
      await app.register(fastifyStatic, {
        root: adminDir,
        prefix: '/admin/',
        decorateReply: false,
        index: ['index.html'],
      });

      app.get('/admin', async (_req, reply) => reply.redirect('/admin/'));

      // Clean route fallback for static Next.js export pages (/admin/users -> users/index.html or users.html)
      app.setNotFoundHandler(async (req, reply) => {
        const pathname = req.url.split('?')[0];
        if (pathname.startsWith('/admin/')) {
          const rel = pathname.slice('/admin/'.length).replace(/\/+$/, '');
          const candidates = [
            join(adminDir, rel, 'index.html'),
            join(adminDir, `${rel}.html`),
            join(adminDir, 'index.html'),
          ];
          for (const file of candidates) {
            if (existsSync(file)) {
              const html = await readFile(file, 'utf8');
              return reply.type('text/html; charset=utf-8').send(html);
            }
          }
        }
        return reply.code(404).send({
          error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.url} not found` },
        });
      });
    }

    // Root route: redirect browsers to /admin/, return JSON discovery for curl/SDKs
    app.get('/', async (req, reply) => {
      const accept = String(req.headers.accept || '');
      if (adminDir && accept.includes('text/html')) {
        return reply.redirect('/admin/');
      }
      return {
        name: 'BlueBeakend',
        tagline: 'Self-Hosted Firebase Alternative',
        version: config.version,
        status: 'ok',
        endpoints: {
          admin: '/admin',
          docs: '/docs',
          openapi: '/openapi.json',
          health: '/health',
          auth: '/api/v1/auth',
          database: '/api/v1/db',
          storage: '/api/v1/storage',
          realtime: '/realtime',
        },
      };
    });
  }

  app.addHook('onClose', async () => {
    unsubLogs();
    await hub.stop();
    await storage.close();
    await cache.close();
    await db.close();
  });

  return app;
}
