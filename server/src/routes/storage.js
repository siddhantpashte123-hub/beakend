// ─────────────────────────────────────────────────────────────
// BlueBeakend — object storage API (/api/v1/storage)
// Upload, metadata, folders, signed download URLs, direct-to-storage
// uploads, listing and deletion.
// ─────────────────────────────────────────────────────────────
import { z } from 'zod';
import { parse, publicFile } from '../utils/validate.js';
import { badRequest, notFound, forbidden, unauthorized } from '../errors.js';
import { verifyUrlToken, signUrlToken, verifyAccessToken } from '../utils/tokens.js';
import { uuid } from '../utils/ids.js';
import { config } from '../config.js';
import { createLogger } from '../logger.js';

const log = createLogger('storage');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function originFromReq(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  if (!host) return config.publicUrl();
  const proto = req.headers['x-forwarded-proto'] || config.protocol || 'http';
  return `${String(proto).split(',')[0].trim()}://${String(host).split(',')[0].trim()}`;
}

export async function storageRoutes(app, ctx) {
  const { db, storage, hub } = ctx;

  // Optional user resolver: populates req.user when Bearer token is present,
  // while still allowing SDK server-side / API-key-authenticated storage ops.
  async function attachOptionalUser(req) {
    if (req.user) return req.user;
    const header = req.headers.authorization || '';
    if (header.startsWith('Bearer ')) {
      try {
        const payload = verifyAccessToken(header.slice(7));
        const user = await db.findUserById(payload.sub);
        if (!user || user.status !== 'active') throw unauthorized('User not found or banned');
        req.user = user;
        return user;
      } catch (err) {
        if (err.status) throw err;
        throw unauthorized('Invalid or expired token');
      }
    }
    return null;
  }

  function checkId(id) {
    if (!UUID_RE.test(id)) throw badRequest('fileId must be a UUID');
    return id;
  }

  function makeSignedDownloadUrl(req, fileId, expiresInSeconds = 3600, inline = false) {
    const exp = new Date(Date.now() + expiresInSeconds * 1000);
    const qs = signUrlToken(fileId, exp);
    return `${originFromReq(req)}/api/v1/storage/${fileId}/download?${qs}${inline ? '&inline=1' : ''}`;
  }

  async function loadFile(req, { write = false } = {}) {
    await attachOptionalUser(req);
    const id = checkId(req.params.fileId);
    const file = await db.getFile(id);
    if (!file) throw notFound('File not found');
    const isAdmin = req.user?.role === 'admin';
    const isOwner = !file.userId || (req.user && file.userId === req.user.id);
    if (write && !isOwner && !isAdmin) throw forbidden('You do not own this file');
    return file;
  }

  // ── POST /upload — multipart upload ───────────────────────
  app.post('/upload', async (req, reply) => {
    await attachOptionalUser(req);
    if (!req.isMultipart()) throw badRequest('Expected multipart/form-data with a "file" field');

    let folder = String(req.query.folder || '').replace(/^\/+|\/+$/g, '');
    let isPublic = req.query.public === 'true' || req.query.public === '1';
    let uploadedPart = null;
    let buffer = null;

    for await (const part of req.parts()) {
      if (part.type === 'file') {
        if (!uploadedPart) {
          uploadedPart = part;
          buffer = await part.toBuffer();
        } else {
          await part.toBuffer(); // drain extra parts
        }
      } else if (part.fieldname === 'folder') {
        folder = String(part.value || '').replace(/^\/+|\/+$/g, '');
      } else if (part.fieldname === 'public') {
        isPublic = String(part.value) === 'true' || String(part.value) === '1';
      }
    }

    if (!uploadedPart || !buffer) throw badRequest('Missing "file" field in multipart body');
    if (buffer.length > config.maxUploadMb * 1024 * 1024) {
      throw badRequest(`File exceeds ${config.maxUploadMb}MB upload limit`);
    }

    // Enforce per-user storage quota if configured
    if (req.user) {
      const maxBytes = Number(await db.getSetting('maxStorageBytes', 10 * 1024 * 1024 * 1024));
      const used = await db.totalStorageUsed(req.user.id);
      if (maxBytes > 0 && used + buffer.length > maxBytes) {
        throw badRequest('Storage quota exceeded');
      }
    }

    const fileId = uuid();
    const ownerPrefix = req.user ? req.user.id : 'project';
    const storageKey = folder ? `${ownerPrefix}/${folder}/${fileId}` : `${ownerPrefix}/${fileId}`;
    await storage.put(storageKey, buffer, { mime: uploadedPart.mimetype });

    const file = await db.createFile({
      id: fileId,
      userId: req.user?.id || null,
      storageKey,
      name: uploadedPart.filename || 'upload.bin',
      folder,
      mime: uploadedPart.mimetype || 'application/octet-stream',
      size: buffer.length,
      isPublic,
    });

    const signedUrl = makeSignedDownloadUrl(req, file.id, 3600, file.mime.startsWith('image/'));
    if (req.user) {
      await hub.publish(`user:${req.user.id}`, 'storage.uploaded', { fileId, name: file.name, size: file.size });
    }
    await db.recordActivity({
      type: 'storage.uploaded',
      actor: req.user?.email || req.apiKey?.name || 'api',
      userId: req.user?.id || null,
      message: `Uploaded file "${file.name}" (${file.size} bytes)`,
      meta: { fileId: file.id, folder },
    });
    log.info(`uploaded ${file.name} (${buffer.length}b)`);

    return reply.code(201).send({
      file: publicFile(file, signedUrl),
      fileId: file.id,
      id: file.id,
      url: signedUrl,
    });
  });

  // ── GET /list — list files + folders ──────────────────────
  app.get('/list', async (req) => {
    await attachOptionalUser(req);
    const limit = Math.min(parseInt(req.query.limit ?? '50', 10) || 50, 200);
    const offset = Math.max(parseInt(req.query.offset ?? '0', 10) || 0, 0);
    const userId = req.user?.role === 'admin' && req.query.all === '1' ? null : (req.user?.id || null);
    const { files, total } = await db.listFiles({
      userId,
      folder: req.query.folder,
      q: req.query.q,
      limit,
      offset,
    });
    const folders = await db.listFolders(userId);
    const usedBytes = await db.totalStorageUsed(userId);
    const quotaBytes = Number(await db.getSetting('maxStorageBytes', 10 * 1024 * 1024 * 1024));
    return {
      files: files.map((f) => publicFile(f, makeSignedDownloadUrl(req, f.id, 3600, f.mime.startsWith('image/')))),
      folders,
      usedBytes,
      quotaBytes,
      total,
      limit,
      offset,
    };
  });

  // ── POST /signed-url — direct upload URL ──────────────────
  app.post('/signed-url', async (req) => {
    await attachOptionalUser(req);
    const schema = z.object({
      name: z.string().min(1).max(300),
      folder: z.string().max(200).optional(),
      mime: z.string().max(150).optional(),
      size: z.number().int().min(0).optional(),
    });
    const body = parse(schema, req.body ?? {});
    if (body.size && body.size > config.maxUploadMb * 1024 * 1024) {
      throw badRequest(`File exceeds ${config.maxUploadMb}MB upload limit`);
    }
    const fileId = uuid();
    const folder = String(body.folder || '').replace(/^\/+|\/+$/g, '');
    const storageKey = `${req.user?.id || 'signed'}/${fileId}`;
    const exp = new Date(Date.now() + 3600_000);
    const qs = signUrlToken(fileId, exp);
    return {
      fileId,
      method: 'PUT',
      uploadUrl: `${originFromReq(req)}/api/v1/storage/signed-upload?fileId=${fileId}&name=${encodeURIComponent(body.name)}&folder=${encodeURIComponent(folder)}&mime=${encodeURIComponent(body.mime || 'application/octet-stream')}&${qs}`,
      headers: { 'Content-Type': body.mime || 'application/octet-stream' },
      expiresIn: 3600,
      storageKey,
    };
  });

  // ── PUT /signed-upload — receives a direct upload ─────────
  app.put('/signed-upload', async (req, reply) => {
    const { fileId, name, folder = '', mime, exp, sig } = req.query;
    if (!fileId || !verifyUrlToken(fileId, exp, sig)) throw unauthorized('Signed upload URL is invalid or expired');
    if (!UUID_RE.test(fileId)) throw badRequest('fileId must be a UUID');
    const raw = req.body;
    const buffer = Buffer.isBuffer(raw)
      ? raw
      : typeof raw === 'string'
        ? Buffer.from(raw)
        : Buffer.from(JSON.stringify(raw ?? {}));
    if (buffer.length > config.maxUploadMb * 1024 * 1024) throw badRequest(`File exceeds ${config.maxUploadMb}MB limit`);
    const storageKey = `signed/${fileId}`;
    const cleanMime = decodeURIComponent(mime || 'application/octet-stream');
    await storage.put(storageKey, buffer, { mime: cleanMime });
    const file = await db.createFile({
      id: fileId,
      userId: null,
      storageKey,
      name: decodeURIComponent(name || 'upload.bin'),
      folder: decodeURIComponent(folder || ''),
      mime: cleanMime,
      size: buffer.length,
    });
    log.info(`direct upload ${file.name} (${buffer.length}b)`);
    return reply.code(201).send({
      file: publicFile(file, makeSignedDownloadUrl(req, file.id)),
      fileId: file.id,
      id: file.id,
    });
  });

  // ── GET /:fileId — metadata ───────────────────────────────
  app.get('/:fileId', async (req) => {
    const file = await loadFile(req);
    return { file: publicFile(file, makeSignedDownloadUrl(req, file.id, 3600, file.mime.startsWith('image/'))) };
  });

  // ── GET /:fileId/download — signed URL or file stream ─────
  app.get('/:fileId/download', async (req, reply) => {
    const { exp, sig, inline } = req.query;
    const id = checkId(req.params.fileId);
    const file = await db.getFile(id);
    if (!file) throw notFound('File not found');

    if (exp && sig) {
      if (!verifyUrlToken(id, exp, sig)) throw unauthorized('Signed URL is invalid or expired');
      const buf = await storage.get(file.storageKey);
      if (!buf) throw notFound('File content missing from storage');
      const disposition = inline === '1' || inline === 'true' ? 'inline' : 'attachment';
      return reply
        .header('Content-Type', file.mime)
        .header('Content-Disposition', `${disposition}; filename="${encodeURIComponent(file.name)}"`)
        .header('Content-Length', String(buf.length))
        .header('Cache-Control', 'private, max-age=300')
        .send(buf);
    }

    await attachOptionalUser(req);
    const isAdmin = req.user?.role === 'admin';
    const isOwner = !file.userId || (req.user && file.userId === req.user.id);
    if (!file.isPublic && !isOwner && !isAdmin) throw forbidden('You do not own this file');

    let url;
    if (storage.kind === 'minio') {
      url = await storage.signedUrl(file.storageKey, id, 3600);
    } else {
      url = makeSignedDownloadUrl(req, id, 3600, inline === '1');
    }
    return { url, expiresIn: 3600, file: publicFile(file, url) };
  });

  // ── DELETE /:fileId ───────────────────────────────────────
  app.delete('/:fileId', async (req) => {
    const file = await loadFile(req, { write: true });
    await storage.delete(file.storageKey).catch(() => {});
    await db.deleteFile(file.id);
    if (file.userId) await hub.publish(`user:${file.userId}`, 'storage.deleted', { fileId: file.id, name: file.name });
    await db.recordActivity({
      type: 'storage.deleted',
      actor: req.user?.email || req.apiKey?.name || 'api',
      userId: req.user?.id || null,
      message: `Deleted file "${file.name}"`,
      meta: { fileId: file.id },
    });
    return { ok: true, id: file.id };
  });
}
