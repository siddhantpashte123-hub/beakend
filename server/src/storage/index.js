// ─────────────────────────────────────────────────────────────
// BlueBeakend — object storage facade
// MinIO (S3 API) when S3_ENDPOINT is set, otherwise local disk.
// ─────────────────────────────────────────────────────────────
import { mkdir, readFile, writeFile, unlink, stat, readdir, rm } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { join, dirname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { config } from '../config.js';
import { signUrlToken } from '../utils/tokens.js';

class LocalStorage {
  constructor(dir) {
    this.kind = 'local';
    this.dir = dir;
  }

  async init() { await mkdir(this.dir, { recursive: true }); }

  _path(key) {
    const safe = key.replace(/\.\./g, '_').replace(/^\/+/, '');
    return join(this.dir, safe);
  }

  async put(key, buffer, { mime = 'application/octet-stream' } = {}) {
    const p = this._path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, buffer);
    await writeFile(`${p}.meta.json`, JSON.stringify({ mime }));
    return { key, size: buffer.length };
  }

  async get(key) {
    try { return await readFile(this._path(key)); } catch { return null; }
  }

  async stat(key) {
    try {
      const s = await stat(this._path(key));
      return { size: s.size, modifiedAt: s.mtime.toISOString() };
    } catch { return null; }
  }

  async delete(key) {
    try {
      await unlink(this._path(key));
      await unlink(`${this._path(key)}.meta.json`).catch(() => {});
      return true;
    } catch { return false; }
  }

  async list(prefix = '') {
    const out = [];
    const walk = async (dir, rel) => {
      let entries;
      try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const relPath = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) await walk(join(dir, e.name), relPath);
        else if (!e.name.endsWith('.meta.json') && relPath.startsWith(prefix)) out.push(relPath);
      }
    };
    await walk(this.dir, '');
    return out;
  }

  async usedBytes() {
    const keys = await this.list('');
    let total = 0;
    for (const k of keys) {
      const s = await this.stat(k);
      if (s) total += s.size;
    }
    return total;
  }

  /** Local "signed" URL served by the API itself (HMAC token). */
  async signedUrl(key, fileId, expiresInSeconds = 3600) {
    const exp = new Date(Date.now() + expiresInSeconds * 1000);
    const qs = signUrlToken(fileId, exp);
    return `${config.publicUrl()}/api/v1/storage/${fileId}/download?${qs}`;
  }

  createReadStream(key) { return createReadStream(this._path(key)); }
  async close() {}
}

class MinioStorage {
  constructor(s3config) {
    this.kind = 'minio';
    this.cfg = s3config;
    this.client = null;
  }

  async init() {
    const Minio = (await import('minio')).default;
    const url = new URL(this.cfg.endpoint);
    this.client = new Minio.Client({
      endPoint: url.hostname,
      port: Number(url.port) || (url.protocol === 'https:' ? 443 : 80),
      useSSL: url.protocol === 'https:',
      accessKey: this.cfg.accessKey,
      secretKey: this.cfg.secretKey,
      region: this.cfg.region,
    });
    const exists = await this.client.bucketExists(this.cfg.bucket).catch(() => false);
    if (!exists) await this.client.makeBucket(this.cfg.bucket, this.cfg.region);
  }

  async put(key, buffer, { mime = 'application/octet-stream' } = {}) {
    await this.client.putObject(this.cfg.bucket, key, buffer, buffer.length, { 'Content-Type': mime });
    return { key, size: buffer.length };
  }

  async get(key) {
    try {
      const stream = await this.client.getObject(this.cfg.bucket, key);
      const chunks = [];
      for await (const c of stream) chunks.push(c);
      return Buffer.concat(chunks);
    } catch { return null; }
  }

  async stat(key) {
    try {
      const st = await this.client.statObject(this.cfg.bucket, key);
      return { size: st.size, modifiedAt: st.lastModified?.toISOString?.() ?? String(st.lastModified) };
    } catch { return null; }
  }

  async delete(key) {
    try { await this.client.removeObject(this.cfg.bucket, key); return true; } catch { return false; }
  }

  async list(prefix = '') {
    const out = [];
    const stream = this.client.listObjectsV2(this.cfg.bucket, prefix, true);
    for await (const obj of stream) out.push(obj.name);
    return out;
  }

  async usedBytes() {
    const keys = await this.list('');
    let total = 0;
    for (const k of keys) {
      const s = await this.stat(k);
      if (s) total += s.size;
    }
    return total;
  }

  async signedUrl(key, _fileId, expiresInSeconds = 3600) {
    return this.client.presignedGetObject(this.cfg.bucket, key, expiresInSeconds);
  }

  createReadStream(key) { return this.client.getObject(this.cfg.bucket, key); }
  async close() {}
}

export async function createStorage({ s3 = config.s3, storageDir = config.storageDir, forceLocal = false } = {}) {
  if (!forceLocal && s3.endpoint && s3.accessKey) {
    const st = new MinioStorage(s3);
    await st.init();
    return st;
  }
  const st = new LocalStorage(storageDir);
  await st.init();
  return st;
}

export { LocalStorage, MinioStorage };
