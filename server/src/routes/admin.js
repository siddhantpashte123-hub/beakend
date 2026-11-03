// ─────────────────────────────────────────────────────────────
// BlueBeakend — admin API (/api/v1/admin) — admin JWT required
// Powers the web dashboard and the `bb` CLI.
// ─────────────────────────────────────────────────────────────
import { mkdir, readdir, readFile, writeFile, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { z } from 'zod';
import { parse, publicUser } from '../utils/validate.js';
import { hashPassword, verifyPassword } from '../utils/passwords.js';
import { signAccessToken } from '../utils/tokens.js';
import { newApiKey, randomBase64, randomHex, sha256 } from '../utils/ids.js';
import { makeAdminGuard } from '../middleware/adminAuth.js';
import { badRequest, unauthorized, notFound, conflict } from '../errors.js';
import { listLogs, createLogger } from '../logger.js';
import { requestsToday, requestsLastNDays } from '../middleware/rateLimit.js';
import { sendMail, outbox } from '../utils/mailer.js';
import { checkCollection } from './db.js';
import { originFromReq } from './storage.js';
import { config } from '../config.js';

const log = createLogger('admin');

export async function adminRoutes(app, ctx) {
  const { db, cache, storage, hub } = ctx;
  const adminGuard = makeAdminGuard({ db });

  function firebaseStyleConfig(req, key, projectName = 'default') {
    const origin = originFromReq(req);
    const url = new URL(origin);
    const wsProto = url.protocol === 'https:' ? 'wss' : 'ws';
    const slug = String(projectName).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '') || 'default';
    return {
      apiKey: key,
      authDomain: url.host,
      projectId: slug,
      storageBucket: `${origin}/api/v1/storage`,
      realtimeUrl: `${wsProto}://${url.host}/realtime`,
    };
  }

  // ── POST /login — admin panel login (no API key needed) ───
  app.post('/login', async (req) => {
    const schema = z.object({
      email: z.string().email(),
      password: z.string().min(1).max(200),
    });
    const body = parse(schema, req.body ?? {});
    const user = await db.findUserByEmail(body.email);
    if (!user) throw unauthorized('Invalid credentials');
    const ok = await verifyPassword(body.password, user.passwordHash);
    if (!ok) throw unauthorized('Invalid credentials');
    if (user.role !== 'admin') throw unauthorized('Admin access required');
    if (user.status !== 'active') throw unauthorized('Account is banned');
    await db.updateUser(user.id, { lastLoginAt: new Date().toISOString() });
    await db.recordActivity({
      type: 'admin.login',
      actor: user.email,
      userId: user.id,
      message: `Admin signed in: ${user.email}`,
    });
    log.info(`admin signed in: ${user.email}`);
    return { accessToken: signAccessToken(user), user: publicUser(user), expiresIn: config.accessTtl };
  });

  // ── POST /forgot-password — admin password reset email ────
  app.post('/forgot-password', async (req) => {
    const schema = z.object({ email: z.string().email() });
    const body = parse(schema, req.body ?? {});
    const user = await db.findUserByEmail(body.email);
    if (user && user.role === 'admin') {
      const raw = randomHex(24);
      await db.createToken({
        tokenHash: sha256(raw),
        userId: user.id,
        type: 'reset',
        expiresAt: new Date(Date.now() + 3600_000),
      });
      const resetUrl = `${originFromReq(req)}/admin/login?resetToken=${raw}`;
      await sendMail({
        to: user.email,
        subject: 'Reset your BlueBeakend Admin password',
        text: `Reset your admin password: ${resetUrl}\nToken: ${raw}`,
        html: `<p><a href="${resetUrl}">Reset your admin password</a> (token: <code>${raw}</code>)</p>`,
      });
    }
    return { ok: true, message: 'If an admin account matches that email, a reset link has been sent.' };
  });

  // ── POST /reset-password ──────────────────────────────────
  app.post('/reset-password', async (req) => {
    const schema = z.object({
      token: z.string().min(10),
      newPassword: z.string().min(6).max(200),
    });
    const body = parse(schema, req.body ?? {});
    const record = await db.findToken(sha256(body.token), 'reset');
    if (!record) throw badRequest('Reset token is invalid or expired');
    await db.updateUser(record.userId, { passwordHash: await hashPassword(body.newPassword) });
    await db.consumeToken(sha256(body.token));
    await db.revokeAllSessions(record.userId);
    return { ok: true, message: 'Admin password updated.' };
  });

  // ── GET /me ───────────────────────────────────────────────
  app.get('/me', { preHandler: adminGuard }, async (req) => ({ user: publicUser(req.user) }));

  // ── GET /stats — dashboard stats + charts + activity ──────
  app.get('/stats', { preHandler: adminGuard }, async () => {
    const [users, docs, collections, storageUsed, keys, req7d, recentActivity] = await Promise.all([
      db.countUsers(),
      db.totalDocs(),
      db.listCollections(),
      db.totalStorageUsed(),
      db.countApiKeys(),
      requestsLastNDays(cache, 7),
      db.listActivity({ limit: 10 }),
    ]);
    const topCollections = [...collections]
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
    return {
      stats: {
        users,
        documents: docs,
        collections: collections.length,
        storageUsed,
        storageQuota: Number(await db.getSetting('maxStorageBytes', 10 * 1024 * 1024 * 1024)),
        requestsToday: await requestsToday(cache),
        apiKeys: keys,
        version: config.version,
        uptime: Math.floor(process.uptime()),
        realtimeConnections: hub.stats().connections,
      },
      requestsLast7Days: req7d,
      topCollections,
      recentActivity,
    };
  });

  // ── GET /users ────────────────────────────────────────────
  app.get('/users', { preHandler: adminGuard }, async (req) => {
    const page = Math.max(parseInt(req.query.page ?? '1', 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit ?? '20', 10) || 20, 1), 200);
    const { users, total } = await db.listUsers({
      page,
      limit,
      q: req.query.q,
      status: req.query.status,
      provider: req.query.provider,
    });
    return { users: users.map(publicUser), total, page, limit };
  });

  // ── GET /users/:id — user detail (sessions, activity, files) ─
  app.get('/users/:id', { preHandler: adminGuard }, async (req) => {
    const user = await db.findUserById(req.params.id);
    if (!user) throw notFound('User not found');
    const [sessions, activity, filesRes, storageUsed] = await Promise.all([
      db.listSessions(user.id),
      db.listActivity({ userId: user.id, limit: 25 }),
      db.listFiles({ userId: user.id, limit: 20, offset: 0 }),
      db.totalStorageUsed(user.id),
    ]);
    return {
      user: publicUser(user),
      sessions: sessions.map((s) => ({
        id: s.id,
        userAgent: s.userAgent,
        ip: s.ip,
        createdAt: s.createdAt,
        expiresAt: s.expiresAt,
      })),
      activity,
      files: filesRes.files,
      filesTotal: filesRes.total,
      storageUsed,
    };
  });

  // ── POST /users — create user manually ────────────────────
  app.post('/users', { preHandler: adminGuard }, async (req, reply) => {
    const schema = z.object({
      email: z.string().email(),
      password: z.string().min(6).max(200).optional(),
      name: z.string().max(120).optional(),
      role: z.enum(['user', 'admin']).optional(),
      metadata: z.record(z.any()).optional(),
    });
    const body = parse(schema, req.body ?? {});
    const password = body.password || randomBase64(12);
    try {
      const user = await db.createUser({
        email: body.email,
        passwordHash: await hashPassword(password),
        name: body.name || '',
        role: body.role || 'user',
        metadata: body.metadata || {},
      });
      await db.recordActivity({
        type: 'admin.user_created',
        actor: req.user.email,
        userId: user.id,
        message: `Admin created user ${user.email}`,
      });
      return reply.code(201).send({ user: publicUser(user), temporaryPassword: body.password ? undefined : password });
    } catch (err) {
      if (err.code === 'UNIQUE_VIOLATION') throw conflict('Email already exists');
      throw err;
    }
  });

  // ── POST /users/bulk — bulk ban / unban / delete ──────────
  app.post('/users/bulk', { preHandler: adminGuard }, async (req) => {
    const schema = z.object({
      action: z.enum(['ban', 'unban', 'delete']),
      ids: z.array(z.string().min(1)).min(1).max(200),
    });
    const body = parse(schema, req.body ?? {});
    let affected = 0;
    for (const id of body.ids) {
      if (id === req.user.id) continue; // never self-ban/delete
      if (body.action === 'delete') {
        if (await db.deleteUser(id)) affected++;
      } else {
        const status = body.action === 'ban' ? 'banned' : 'active';
        const updated = await db.updateUser(id, { status });
        if (updated) {
          if (status === 'banned') await db.revokeAllSessions(id);
          affected++;
        }
      }
    }
    await db.recordActivity({
      type: `admin.users_bulk_${body.action}`,
      actor: req.user.email,
      message: `Bulk ${body.action} on ${affected} user(s)`,
    });
    return { ok: true, affected };
  });

  // ── PATCH /users/:id — ban/unban/role/reset/metadata ──────
  app.patch('/users/:id', { preHandler: adminGuard }, async (req) => {
    const schema = z.object({
      status: z.enum(['active', 'banned']).optional(),
      role: z.enum(['user', 'admin']).optional(),
      password: z.string().min(6).max(200).optional(),
      name: z.string().max(120).optional(),
      emailVerified: z.boolean().optional(),
      metadata: z.record(z.any()).optional(),
    });
    const body = parse(schema, req.body ?? {});
    if (req.params.id === req.user.id && body.status === 'banned') {
      throw badRequest('You cannot ban your own account');
    }
    const patch = {};
    if (body.status) patch.status = body.status;
    if (body.role) patch.role = body.role;
    if (body.name !== undefined) patch.name = body.name;
    if (body.emailVerified !== undefined) patch.emailVerified = body.emailVerified;
    if (body.metadata !== undefined) patch.metadata = body.metadata;
    if (body.password) {
      patch.passwordHash = await hashPassword(body.password);
      await db.revokeAllSessions(req.params.id);
    }
    const user = await db.updateUser(req.params.id, patch);
    if (!user) throw notFound('User not found');
    if (body.status === 'banned') await db.revokeAllSessions(user.id);
    await db.recordActivity({
      type: 'admin.user_updated',
      actor: req.user.email,
      userId: user.id,
      message: `Updated user ${user.email}`,
    });
    log.info(`admin ${req.user.email} updated user ${user.email}`);
    return { user: publicUser(user) };
  });

  // ── DELETE /users/:id ─────────────────────────────────────
  app.delete('/users/:id', { preHandler: adminGuard }, async (req) => {
    if (req.params.id === req.user.id) throw badRequest('You cannot delete your own account');
    const ok = await db.deleteUser(req.params.id);
    if (!ok) throw notFound('User not found');
    await db.recordActivity({
      type: 'admin.user_deleted',
      actor: req.user.email,
      message: `Deleted user ${req.params.id.slice(0, 8)}`,
    });
    log.warn(`admin ${req.user.email} deleted user ${req.params.id}`);
    return { ok: true };
  });

  // ── Collections (create / list / export / import / drop) ──
  app.get('/collections', { preHandler: adminGuard }, async () => {
    const collections = await db.listCollections();
    return { collections };
  });

  app.post('/collections', { preHandler: adminGuard }, async (req, reply) => {
    const schema = z.object({ name: z.string().min(1).max(64) });
    const body = parse(schema, req.body ?? {});
    const name = checkCollection(body.name);
    const col = await db.ensureCollection(name);
    await db.recordActivity({
      type: 'admin.collection_created',
      actor: req.user.email,
      message: `Created collection "${name}"`,
    });
    return reply.code(201).send({ collection: col });
  });

  app.get('/collections/:name/export', { preHandler: adminGuard }, async (req) => {
    const name = checkCollection(req.params.name);
    const { docs, total } = await db.listDocs(name, { limit: 10000, offset: 0 });
    return { collection: name, exportedAt: new Date().toISOString(), total, docs };
  });

  app.post('/collections/:name/import', { preHandler: adminGuard }, async (req) => {
    const name = checkCollection(req.params.name);
    const schema = z.object({ docs: z.array(z.record(z.any())).min(1).max(2000) });
    const body = parse(schema, req.body ?? {});
    const ops = body.docs.map((d) => ({ op: 'create', data: d }));
    const results = await db.batchWrite(name, ops);
    await db.recordActivity({
      type: 'admin.collection_imported',
      actor: req.user.email,
      message: `Imported ${results.length} document(s) into "${name}"`,
    });
    return { ok: true, imported: results.filter((r) => r.ok).length };
  });

  app.delete('/collections/:name', { preHandler: adminGuard }, async (req) => {
    const name = checkCollection(req.params.name);
    const ok = await db.dropCollection(name);
    log.warn(`admin ${req.user.email} dropped collection ${name}`);
    await hub.publish(`db:${name}`, 'collection.dropped', { collection: name });
    await db.recordActivity({
      type: 'admin.collection_dropped',
      actor: req.user.email,
      message: `Dropped collection "${name}"`,
    });
    return { ok, dropped: name };
  });

  // ── API Keys ──────────────────────────────────────────────
  app.get('/apikeys', { preHandler: adminGuard }, async (req) => {
    const keys = await db.listApiKeys();
    return {
      apiKeys: keys.map((k) => ({
        id: k.id,
        name: k.name,
        key: `${k.key.slice(0, 12)}${'•'.repeat(12)}${k.key.slice(-4)}`,
        fullKey: k.key,
        live: k.live,
        status: k.status,
        rateLimit: k.rateLimit,
        requestsCount: k.requestsCount || 0,
        lastUsedAt: k.lastUsedAt,
        createdAt: k.createdAt,
        config: firebaseStyleConfig(req, k.key, k.name),
      })),
    };
  });

  app.post('/apikeys', { preHandler: adminGuard }, async (req, reply) => {
    const schema = z.object({
      name: z.string().min(1).max(120),
      live: z.boolean().optional(),
      rateLimit: z.number().int().min(1).max(100000).optional(),
    });
    const body = parse(schema, req.body ?? {});
    const key = await db.createApiKey({
      key: newApiKey(body.live !== false),
      name: body.name,
      live: body.live !== false,
      createdBy: req.user.id,
      rateLimit: body.rateLimit ?? null,
    });
    await db.recordActivity({
      type: 'admin.apikey_created',
      actor: req.user.email,
      message: `Created API key for project "${body.name}"`,
    });
    log.info(`admin ${req.user.email} created API key "${body.name}"`);
    return reply.code(201).send({
      apiKey: key.key,
      config: firebaseStyleConfig(req, key.key, key.name),
      id: key.id,
      name: key.name,
      createdAt: key.createdAt,
    });
  });

  app.delete('/apikeys/:id', { preHandler: adminGuard }, async (req) => {
    const ok = await db.revokeApiKey(req.params.id);
    if (!ok) throw notFound('API key not found');
    await db.recordActivity({
      type: 'admin.apikey_revoked',
      actor: req.user.email,
      message: `Revoked API key ${req.params.id.slice(0, 8)}`,
    });
    log.warn(`admin ${req.user.email} revoked API key ${req.params.id}`);
    return { ok: true };
  });

  // ── Logs ──────────────────────────────────────────────────
  app.get('/logs', { preHandler: adminGuard }, async (req) => {
    const entries = listLogs({
      level: req.query.level,
      service: req.query.service,
      q: req.query.q,
      limit: Math.min(parseInt(req.query.limit ?? '200', 10) || 200, 1000),
      since: req.query.since,
    });
    return { logs: entries };
  });

  app.get('/logs/download', { preHandler: adminGuard }, async (req, reply) => {
    const entries = listLogs({
      level: req.query.level,
      service: req.query.service,
      q: req.query.q,
      limit: 2000,
    }).reverse();
    const lines = entries
      .map((e) => `[${e.ts}] ${e.level.toUpperCase().padEnd(5)} [${e.service}] ${e.msg}${e.meta ? ' ' + JSON.stringify(e.meta) : ''}`)
      .join('\n');
    return reply
      .header('Content-Type', 'text/plain; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="bluebeakend-${new Date().toISOString().slice(0, 10)}.log"`)
      .send(lines + '\n');
  });

  // ── Health detail ─────────────────────────────────────────
  app.get('/health', { preHandler: adminGuard }, async () => {
    const dbOk = await db.ping().catch(() => false);
    return {
      services: {
        api: { ok: true, uptime: Math.floor(process.uptime()), memory: process.memoryUsage().rss },
        database: { ok: dbOk, kind: db.kind },
        cache: { ok: true, kind: cache.kind },
        storage: { ok: true, kind: storage.kind },
        realtime: { ok: true, ...hub.stats() },
      },
      version: config.version,
    };
  });

  // ── Realtime admin ────────────────────────────────────────
  app.get('/realtime/stats', { preHandler: adminGuard }, async () => hub.stats());

  app.post('/realtime/publish', { preHandler: adminGuard }, async (req) => {
    const schema = z.object({
      channel: z.string().min(1).max(200),
      event: z.string().min(1).max(100).optional(),
      payload: z.any().optional(),
    });
    const body = parse(schema, req.body ?? {});
    await hub.publish(body.channel, body.event || 'custom.message', body.payload ?? {});
    return { ok: true, channel: body.channel };
  });

  // ── Settings ──────────────────────────────────────────────
  app.get('/settings', { preHandler: adminGuard }, async () => ({
    settings: {
      siteName: await db.getSetting('siteName', 'BlueBeakend'),
      logoUrl: await db.getSetting('logoUrl', ''),
      domain: await db.getSetting('domain', config.domain),
      smtpHost: await db.getSetting('smtpHost', config.smtp.host),
      smtpPort: await db.getSetting('smtpPort', config.smtp.port),
      smtpUser: await db.getSetting('smtpUser', config.smtp.user),
      smtpPass: (await db.getSetting('smtpPass', config.smtp.pass)) ? '••••••••' : '',
      smtpFrom: await db.getSetting('smtpFrom', config.smtp.from),
      rateLimitRpm: await db.getSetting('rateLimitRpm', config.rateLimitRpm),
      maxStorageBytes: await db.getSetting('maxStorageBytes', 10 * 1024 * 1024 * 1024),
      enableSignups: await db.getSetting('enableSignups', config.enableSignups),
      corsOrigins: await db.getSetting('corsOrigins', config.corsOrigins.join(',')),
      ipWhitelist: await db.getSetting('ipWhitelist', ''),
      autoBackupSchedule: await db.getSetting('autoBackupSchedule', 'daily'),
    },
  }));

  app.patch('/settings', { preHandler: adminGuard }, async (req) => {
    const schema = z.object({
      siteName: z.string().max(120).optional(),
      logoUrl: z.string().max(500).optional(),
      domain: z.string().max(255).optional(),
      smtpHost: z.string().max(255).optional(),
      smtpPort: z.number().int().min(1).max(65535).optional(),
      smtpUser: z.string().max(255).optional(),
      smtpPass: z.string().max(255).optional(),
      smtpFrom: z.string().max(255).optional(),
      rateLimitRpm: z.number().int().min(1).max(1000000).optional(),
      maxStorageBytes: z.number().int().min(0).optional(),
      enableSignups: z.boolean().optional(),
      corsOrigins: z.string().max(2000).optional(),
      ipWhitelist: z.string().max(2000).optional(),
      autoBackupSchedule: z.enum(['off', 'daily', 'weekly']).optional(),
    });
    const body = parse(schema, req.body ?? {});
    for (const [k, v] of Object.entries(body)) {
      if (k === 'smtpPass' && v === '••••••••') continue;
      await db.setSetting(k, v);
      // Reflect live SMTP settings in runtime config as well
      if (k === 'smtpHost') config.smtp.host = v;
      if (k === 'smtpPort') config.smtp.port = v;
      if (k === 'smtpUser') config.smtp.user = v;
      if (k === 'smtpPass') config.smtp.pass = v;
      if (k === 'smtpFrom') config.smtp.from = v;
    }
    await db.recordActivity({
      type: 'admin.settings_updated',
      actor: req.user.email,
      message: 'Updated platform settings',
    });
    log.info(`admin ${req.user.email} updated settings`);
    return { ok: true };
  });

  app.post('/settings/test-email', { preHandler: adminGuard }, async (req) => {
    const schema = z.object({ to: z.string().email() });
    const body = parse(schema, req.body ?? {});
    return sendMail({
      to: body.to,
      subject: 'BlueBeakend SMTP test',
      text: 'If you can read this, SMTP is configured correctly.',
      html: '<p>If you can read this, SMTP is configured correctly.</p>',
    });
  });

  app.get('/outbox', { preHandler: adminGuard }, async () => ({ outbox }));

  // ── Backups (create / list / restore / delete) ────────────
  app.get('/backups', { preHandler: adminGuard }, async () => {
    await mkdir(config.backupsDir, { recursive: true });
    const entries = await readdir(config.backupsDir);
    const items = [];
    for (const name of entries) {
      if (!name.endsWith('.json.gz') && !name.endsWith('.tar.gz')) continue;
      const st = await stat(join(config.backupsDir, name));
      items.push({ name, size: st.size, createdAt: st.mtime.toISOString() });
    }
    items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return { backups: items };
  });

  app.post('/backups', { preHandler: adminGuard }, async (req, reply) => {
    await mkdir(config.backupsDir, { recursive: true });
    const snap = await db.exportSnapshot();
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const name = `bb-backup-${ts}.json.gz`;
    const gz = gzipSync(Buffer.from(JSON.stringify(snap, null, 2)));
    await writeFile(join(config.backupsDir, name), gz);
    await db.recordActivity({
      type: 'admin.backup_created',
      actor: req.user.email,
      message: `Created backup ${name} (${gz.length} bytes)`,
    });
    log.info(`backup created: ${name}`);
    return reply.code(201).send({ ok: true, backup: { name, size: gz.length, createdAt: new Date().toISOString() } });
  });

  app.post('/backups/:name/restore', { preHandler: adminGuard }, async (req) => {
    const safeName = String(req.params.name).replace(/[^A-Za-z0-9._-]/g, '');
    if (!safeName.endsWith('.json.gz')) throw badRequest('Unsupported backup archive format for online restore');
    const raw = await readFile(join(config.backupsDir, safeName)).catch(() => null);
    if (!raw) throw notFound('Backup file not found');
    const snap = JSON.parse(gunzipSync(raw).toString('utf8'));
    await db.importSnapshot(snap);
    await db.recordActivity({
      type: 'admin.backup_restored',
      actor: req.user.email,
      message: `Restored backup ${safeName}`,
    });
    log.warn(`admin ${req.user.email} restored backup ${safeName}`);
    return { ok: true, restored: safeName };
  });

  app.delete('/backups/:name', { preHandler: adminGuard }, async (req) => {
    const safeName = String(req.params.name).replace(/[^A-Za-z0-9._-]/g, '');
    await unlink(join(config.backupsDir, safeName)).catch(() => { throw notFound('Backup not found'); });
    return { ok: true };
  });

  // ── Danger zone ───────────────────────────────────────────
  app.post('/danger/reset', { preHandler: adminGuard }, async (req) => {
    const schema = z.object({ confirm: z.literal('DELETE ALL DATA') });
    parse(schema, req.body ?? {});
    const collections = await db.listCollections();
    for (const c of collections) await db.dropCollection(c.name);
    await db.setSetting('resetAt', new Date().toISOString());
    await db.recordActivity({
      type: 'admin.danger_reset',
      actor: req.user.email,
      message: `Reset ${collections.length} database collection(s)`,
    });
    log.warn(`admin ${req.user.email} RESET all document collections`);
    return { ok: true, dropped: collections.map((c) => c.name) };
  });

  app.post('/danger/delete-all', { preHandler: adminGuard }, async (req) => {
    const schema = z.object({ confirm: z.literal('DELETE EVERYTHING') });
    parse(schema, req.body ?? {});
    const collections = await db.listCollections();
    for (const c of collections) await db.dropCollection(c.name);
    const { files } = await db.listFiles({ limit: 5000, offset: 0 });
    for (const f of files) {
      await storage.delete(f.storageKey).catch(() => {});
      await db.deleteFile(f.id);
    }
    const { users } = await db.listUsers({ page: 1, limit: 5000 });
    for (const u of users) {
      if (u.id !== req.user.id) await db.deleteUser(u.id);
    }
    await db.recordActivity({
      type: 'admin.danger_delete_all',
      actor: req.user.email,
      message: 'Purged all collections, files, and non-admin users',
    });
    log.warn(`admin ${req.user.email} PURGED all data`);
    return { ok: true };
  });
}
