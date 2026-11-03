// ─────────────────────────────────────────────────────────────
// BlueBeakend — document database API (/api/v1/db)
// Firestore-style collections with query, batch & realtime.
// ─────────────────────────────────────────────────────────────
import { z } from 'zod';
import { parse } from '../utils/validate.js';
import { parseWhere, parseOrderBy, parseSelect, parsePagination } from '../utils/query.js';
import { badRequest, notFound } from '../errors.js';
import { attachRealtimeSocket } from './realtime.js';
import { createLogger } from '../logger.js';

const log = createLogger('db');

const COLLECTION_RE = /^[A-Za-z0-9_-]{1,64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_DOC_BYTES = 256 * 1024;

export function checkCollection(name) {
  if (!COLLECTION_RE.test(name)) {
    throw badRequest('Collection names may only contain letters, numbers, "-" and "_" (max 64 chars)');
  }
  return name;
}

function checkId(id) {
  if (!UUID_RE.test(id)) throw badRequest('Document id must be a UUID');
  return id;
}

function checkDocSize(data) {
  const size = Buffer.byteLength(JSON.stringify(data ?? {}));
  if (size > MAX_DOC_BYTES) throw badRequest(`Document too large (${size} bytes, max ${MAX_DOC_BYTES})`);
}

const whereSchema = z.array(z.tuple([z.string(), z.string(), z.any()]).or(z.array(z.any()).min(2).max(3)));

const queryBodySchema = z.object({
  where: z.any().optional(),
  orderBy: z.any().optional(),
  limit: z.number().int().min(1).max(500).optional(),
  offset: z.number().int().min(0).optional(),
  select: z.array(z.string()).optional(),
  count: z.boolean().optional(),
});

const batchSchema = z.object({
  ops: z.array(z.object({
    op: z.enum(['create', 'update', 'replace', 'delete']),
    id: z.string().optional(),
    data: z.record(z.any()).optional(),
  })).min(1).max(500),
});

function normalizeWhere(where) {
  if (!where) return [];
  if (typeof where === 'string') return parseWhere(where);
  const parsed = parse(whereSchema, where);
  return parsed.map((c) => [String(c[0]), String(c[1]), c.length > 2 ? c[2] : null]);
}

function normalizeOrderBy(orderBy) {
  if (!orderBy) return [];
  if (typeof orderBy === 'string') return parseOrderBy(orderBy);
  if (Array.isArray(orderBy)) {
    return orderBy.map((c) => Array.isArray(c) ? [String(c[0]), c[1] === 'desc' ? 'desc' : 'asc'] : [String(c), 'asc']);
  }
  throw badRequest('orderBy must be a string or array');
}

export async function dbRoutes(app, ctx) {
  const { db, hub } = ctx;

  // ── GET /db — list collections ────────────────────────────
  app.get('/', async () => {
    const collections = await db.listCollections();
    return { collections };
  });

  // ── POST /db/:collection — create document ────────────────
  app.post('/:collection', async (req, reply) => {
    const collection = checkCollection(req.params.collection);
    const data = req.body ?? {};
    if (typeof data !== 'object' || Array.isArray(data)) throw badRequest('Document body must be a JSON object');
    checkDocSize(data);
    const doc = await db.insertDoc(collection, sanitize(data));
    await hub.publish(`db:${collection}`, 'doc.created', { collection, doc });
    await db.recordActivity({
      type: 'db.created',
      actor: req.user?.email || req.apiKey?.name || 'api',
      userId: req.user?.id || null,
      message: `Created document in "${collection}" (${doc._id.slice(0, 8)})`,
      meta: { collection, id: doc._id },
    });
    log.debug(`doc created in ${collection}`, { id: doc._id });
    return reply.code(201).send({ doc });
  });

  // ── GET /db/:collection — list documents ──────────────────
  app.get('/:collection', async (req) => {
    const collection = checkCollection(req.params.collection);
    const where = normalizeWhere(req.query.where);
    const orderBy = normalizeOrderBy(req.query.orderBy);
    const select = parseSelect(req.query.select);
    const { limit, offset } = parsePagination(req.query);
    const { docs, total } = await db.listDocs(collection, { where, orderBy, limit, offset, select });
    return { docs, total, limit, offset };
  });

  // ── WS /db/:collection/realtime — collection stream ───────
  app.get('/:collection/realtime', { websocket: true }, (socket, req) => {
    const collection = checkCollection(req.params.collection);
    attachRealtimeSocket(socket, req, ctx, [`db:${collection}`]);
  });

  // ── POST /db/:collection/query — advanced query ───────────
  app.post('/:collection/query', async (req) => {
    const collection = checkCollection(req.params.collection);
    const body = parse(queryBodySchema, req.body ?? {});
    const where = normalizeWhere(body.where);
    const orderBy = normalizeOrderBy(body.orderBy);
    const { docs, total } = await db.listDocs(collection, {
      where,
      orderBy,
      limit: body.limit ?? 50,
      offset: body.offset ?? 0,
      select: body.select ?? null,
    });
    const out = { docs, total, limit: body.limit ?? 50, offset: body.offset ?? 0 };
    if (body.count) out.count = await db.countDocs(collection, where);
    return out;
  });

  // ── POST /db/:collection/batch — bulk operations ──────────
  app.post('/:collection/batch', async (req) => {
    const collection = checkCollection(req.params.collection);
    const body = parse(batchSchema, req.body ?? {});
    for (const op of body.ops) {
      if (op.op === 'delete' || op.op === 'update' || op.op === 'replace') {
        if (!op.id) throw badRequest(`batch op "${op.op}" requires an id`);
        checkId(op.id);
      }
      if (op.data) checkDocSize(op.data);
    }
    const results = await db.batchWrite(collection, body.ops.map((op) => ({ ...op, data: sanitize(op.data || {}) })));
    for (const r of results) {
      if (!r.ok) continue;
      if (r.op === 'create') await hub.publish(`db:${collection}`, 'doc.created', { collection, doc: r.doc });
      else if (r.op === 'delete') await hub.publish(`db:${collection}`, 'doc.deleted', { collection, id: r.id });
      else await hub.publish(`db:${collection}`, 'doc.updated', { collection, doc: r.doc });
    }
    await db.recordActivity({
      type: 'db.batch',
      actor: req.user?.email || req.apiKey?.name || 'api',
      userId: req.user?.id || null,
      message: `Batch write (${body.ops.length} ops) in "${collection}"`,
      meta: { collection, count: body.ops.length },
    });
    return { results };
  });

  // ── GET /db/:collection/count ─────────────────────────────
  app.get('/:collection/count', async (req) => {
    const collection = checkCollection(req.params.collection);
    const where = normalizeWhere(req.query.where);
    return { count: await db.countDocs(collection, where) };
  });

  // ── GET /db/:collection/:id ───────────────────────────────
  app.get('/:collection/:id', async (req) => {
    const collection = checkCollection(req.params.collection);
    const id = checkId(req.params.id);
    const doc = await db.getDoc(collection, id);
    if (!doc) throw notFound('Document not found');
    return { doc };
  });

  // ── PATCH /db/:collection/:id — partial update ────────────
  app.patch('/:collection/:id', async (req) => {
    const collection = checkCollection(req.params.collection);
    const id = checkId(req.params.id);
    const data = req.body ?? {};
    if (typeof data !== 'object' || Array.isArray(data)) throw badRequest('Patch body must be a JSON object');
    checkDocSize(data);
    const doc = await db.updateDoc(collection, id, sanitize(data));
    if (!doc) throw notFound('Document not found');
    await hub.publish(`db:${collection}`, 'doc.updated', { collection, doc });
    return { doc };
  });

  // ── PUT /db/:collection/:id — replace ─────────────────────
  app.put('/:collection/:id', async (req) => {
    const collection = checkCollection(req.params.collection);
    const id = checkId(req.params.id);
    const data = req.body ?? {};
    if (typeof data !== 'object' || Array.isArray(data)) throw badRequest('Body must be a JSON object');
    checkDocSize(data);
    const doc = await db.replaceDoc(collection, id, sanitize(data));
    if (!doc) throw notFound('Document not found');
    await hub.publish(`db:${collection}`, 'doc.updated', { collection, doc });
    return { doc };
  });

  // ── DELETE /db/:collection/:id ────────────────────────────
  app.delete('/:collection/:id', async (req) => {
    const collection = checkCollection(req.params.collection);
    const id = checkId(req.params.id);
    const ok = await db.deleteDoc(collection, id);
    if (!ok) throw notFound('Document not found');
    await hub.publish(`db:${collection}`, 'doc.deleted', { collection, id });
    await db.recordActivity({
      type: 'db.deleted',
      actor: req.user?.email || req.apiKey?.name || 'api',
      userId: req.user?.id || null,
      message: `Deleted document ${id.slice(0, 8)} from "${collection}"`,
      meta: { collection, id },
    });
    return { ok: true, id };
  });
}

function sanitize(data) {
  const out = {};
  for (const [k, v] of Object.entries(data)) {
    if (k.startsWith('_')) continue;
    out[k] = v;
  }
  return out;
}
