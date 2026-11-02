// ─────────────────────────────────────────────────────────────
// BlueBeakend — in-memory database adapter (dev / test mode)
// Implements the exact same interface as the Postgres adapter.
// ─────────────────────────────────────────────────────────────
import { uuid } from '../utils/ids.js';

const now = () => new Date().toISOString();

function fieldValue(doc, field) {
  if (field === '_id') return doc._id;
  if (field === '_createdAt') return doc._createdAt;
  if (field === '_updatedAt') return doc._updatedAt;
  return doc[field];
}

export function matchWhere(doc, where = []) {
  return where.every(([field, op, value]) => {
    const actual = fieldValue(doc, field);
    switch (op) {
      case '==': return value === null ? actual === null || actual === undefined : actual === value;
      case '!=': return value === null ? actual !== null && actual !== undefined : actual !== value;
      case '>': return actual !== undefined && actual !== null && actual > value;
      case '<': return actual !== undefined && actual !== null && actual < value;
      case '>=': return actual !== undefined && actual !== null && actual >= value;
      case '<=': return actual !== undefined && actual !== null && actual <= value;
      case 'in': return Array.isArray(value) && value.includes(actual);
      case 'contains':
        if (Array.isArray(actual)) return actual.includes(value);
        if (typeof actual === 'string') return actual.includes(String(value));
        return false;
      case 'exists':
        return value === false
          ? actual === undefined || actual === null
          : actual !== undefined && actual !== null;
      default: return false;
    }
  });
}

function sortDocs(docs, orderBy = []) {
  if (!orderBy.length) return docs;
  return [...docs].sort((a, b) => {
    for (const [field, dir] of orderBy) {
      const av = fieldValue(a, field);
      const bv = fieldValue(b, field);
      if (av === bv) continue;
      if (av === undefined || av === null) return 1;
      if (bv === undefined || bv === null) return -1;
      const cmp = av < bv ? -1 : 1;
      return dir === 'desc' ? -cmp : cmp;
    }
    return 0;
  });
}

function projectDoc(doc, select) {
  if (!select || !select.length) return { ...doc };
  const out = { _id: doc._id, _createdAt: doc._createdAt, _updatedAt: doc._updatedAt };
  for (const f of select) if (f in doc) out[f] = doc[f];
  return out;
}

export class MemoryDb {
  constructor() {
    this.kind = 'memory';
    this.users = new Map();
    this.usersByEmail = new Map();
    this.sessions = new Map();       // tokenHash -> session
    this.authTokens = new Map();     // tokenHash -> token
    this.apiKeys = new Map();        // id -> record
    this.apiKeysByKey = new Map();   // key -> id
    this.files = new Map();
    this.collections = new Map();    // name -> Map(id -> doc)
    this.activity = [];
    this.settings = new Map();
  }

  async init() {}
  async close() {}
  async ping() { return true; }

  // ── users ────────────────────────────────────────────────
  async createUser({ email, passwordHash, name = '', role = 'user', status = 'active', emailVerified = false, provider = 'password', metadata = {} }) {
    const id = uuid();
    const user = {
      id,
      email: String(email).toLowerCase(),
      passwordHash,
      name,
      role,
      status,
      emailVerified,
      provider,
      metadata,
      lastLoginAt: null,
      createdAt: now(),
      updatedAt: now(),
    };
    if (this.usersByEmail.has(user.email)) {
      const err = new Error('email already registered');
      err.code = 'UNIQUE_VIOLATION';
      throw err;
    }
    this.users.set(id, user);
    this.usersByEmail.set(user.email, id);
    return { ...user };
  }

  async findUserByEmail(email) {
    const id = this.usersByEmail.get(String(email).toLowerCase());
    return id ? { ...this.users.get(id) } : null;
  }

  async findUserById(id) {
    const u = this.users.get(id);
    return u ? { ...u } : null;
  }

  async listUsers({ page = 1, limit = 20, q, status, provider } = {}) {
    let items = [...this.users.values()];
    if (status && status !== 'all') items = items.filter((u) => u.status === status);
    if (provider && provider !== 'all') items = items.filter((u) => u.provider === provider);
    if (q) {
      const needle = q.toLowerCase();
      items = items.filter((u) => u.email.includes(needle) || (u.name || '').toLowerCase().includes(needle));
    }
    items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    const total = items.length;
    const start = (page - 1) * limit;
    return { users: items.slice(start, start + limit).map((u) => ({ ...u })), total };
  }

  async updateUser(id, patch) {
    const u = this.users.get(id);
    if (!u) return null;
    if (patch.email) {
      const newEmail = String(patch.email).toLowerCase();
      if (newEmail !== u.email) {
        if (this.usersByEmail.has(newEmail)) {
          const err = new Error('email already registered');
          err.code = 'UNIQUE_VIOLATION';
          throw err;
        }
        this.usersByEmail.delete(u.email);
        u.email = newEmail;
        this.usersByEmail.set(newEmail, id);
      }
    }
    const allowed = ['passwordHash', 'name', 'role', 'status', 'emailVerified', 'provider', 'metadata', 'lastLoginAt'];
    for (const k of allowed) if (k in patch) u[k] = patch[k];
    u.updatedAt = now();
    return { ...u };
  }

  async deleteUser(id) {
    const u = this.users.get(id);
    if (!u) return false;
    this.users.delete(id);
    this.usersByEmail.delete(u.email);
    for (const [h, s] of this.sessions) if (s.userId === id) this.sessions.delete(h);
    return true;
  }

  async countUsers() { return this.users.size; }

  // ── sessions (refresh tokens) ────────────────────────────
  async createSession({ tokenHash, userId, expiresAt, userAgent = '', ip = '' }) {
    const id = uuid();
    const session = { id, tokenHash, userId, userAgent, ip, expiresAt: expiresAt.toISOString(), revokedAt: null, createdAt: now() };
    this.sessions.set(tokenHash, session);
    return { ...session };
  }

  async findSessionByTokenHash(tokenHash) {
    const s = this.sessions.get(tokenHash);
    return s ? { ...s } : null;
  }

  async revokeSession(id, userId) {
    for (const s of this.sessions.values()) {
      if (s.id === id && (!userId || s.userId === userId)) {
        s.revokedAt = now();
        return true;
      }
    }
    return false;
  }

  async listSessions(userId) {
    return [...this.sessions.values()]
      .filter((s) => s.userId === userId && !s.revokedAt && new Date(s.expiresAt) > new Date())
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .map((s) => ({ ...s }));
  }

  async revokeAllSessions(userId) {
    let n = 0;
    for (const s of this.sessions.values()) {
      if (s.userId === userId && !s.revokedAt) { s.revokedAt = now(); n++; }
    }
    return n;
  }

  // ── auth tokens (reset / verify) ─────────────────────────
  async createToken({ tokenHash, userId, type, expiresAt }) {
    this.authTokens.set(tokenHash, { tokenHash, userId, type, expiresAt: expiresAt.toISOString(), createdAt: now() });
    return true;
  }

  async findToken(tokenHash, type) {
    const t = this.authTokens.get(tokenHash);
    if (!t || t.type !== type) return null;
    if (new Date(t.expiresAt) < new Date()) return null;
    return { ...t };
  }

  async consumeToken(tokenHash) {
    return this.authTokens.delete(tokenHash);
  }

  // ── api keys ─────────────────────────────────────────────
  async createApiKey({ key, name = 'default', live = true, createdBy = null, rateLimit = null }) {
    const id = uuid();
    const rec = {
      id, key, name, live, status: 'active', rateLimit,
      requestsCount: 0,
      createdBy, lastUsedAt: null, createdAt: now(),
    };
    this.apiKeys.set(id, rec);
    this.apiKeysByKey.set(key, id);
    return { ...rec };
  }

  async listApiKeys() {
    return [...this.apiKeys.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).map((r) => ({ ...r }));
  }

  async findApiKey(key) {
    const id = this.apiKeysByKey.get(key);
    return id ? { ...this.apiKeys.get(id) } : null;
  }

  async touchApiKey(id) {
    const rec = this.apiKeys.get(id);
    if (rec) {
      rec.lastUsedAt = now();
      rec.requestsCount = (rec.requestsCount || 0) + 1;
    }
  }

  async revokeApiKey(id) {
    const rec = this.apiKeys.get(id);
    if (!rec) return false;
    rec.status = 'revoked';
    return true;
  }

  async countApiKeys() {
    return [...this.apiKeys.values()].filter((k) => k.status === 'active').length;
  }

  // ── files ────────────────────────────────────────────────
  async createFile({ id = uuid(), userId = null, storageKey, name, folder = '', mime = 'application/octet-stream', size = 0, isPublic = false }) {
    const cleanFolder = String(folder || '').replace(/^\/+|\/+$/g, '');
    const rec = { id, userId, storageKey, name, folder: cleanFolder, mime, size, isPublic, createdAt: now() };
    this.files.set(id, rec);
    return { ...rec };
  }

  async getFile(id) {
    const f = this.files.get(id);
    return f ? { ...f } : null;
  }

  async listFiles({ userId = null, folder = null, q = null, limit = 50, offset = 0 } = {}) {
    let items = [...this.files.values()];
    if (userId) items = items.filter((f) => f.userId === userId);
    if (folder !== null && folder !== undefined && folder !== 'all') {
      const clean = String(folder).replace(/^\/+|\/+$/g, '');
      items = items.filter((f) => (f.folder || '') === clean);
    }
    if (q) {
      const needle = q.toLowerCase();
      items = items.filter((f) => f.name.toLowerCase().includes(needle) || (f.folder || '').toLowerCase().includes(needle));
    }
    items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return { files: items.slice(offset, offset + limit).map((f) => ({ ...f })), total: items.length };
  }

  async listFolders(userId = null) {
    const map = new Map();
    for (const f of this.files.values()) {
      if (userId && f.userId !== userId) continue;
      const folder = f.folder || '';
      if (!folder) continue;
      map.set(folder, (map.get(folder) || 0) + 1);
    }
    return [...map.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name));
  }

  async deleteFile(id) { return this.files.delete(id); }

  async totalStorageUsed(userId = null) {
    let sum = 0;
    for (const f of this.files.values()) {
      if (!userId || f.userId === userId) sum += Number(f.size) || 0;
    }
    return sum;
  }

  // ── documents & collections ──────────────────────────────
  _col(name) {
    if (!this.collections.has(name)) this.collections.set(name, new Map());
    return this.collections.get(name);
  }

  async ensureCollection(name) {
    this._col(name);
    return { name, count: this.collections.get(name).size };
  }

  async listCollections() {
    return [...this.collections.entries()]
      .map(([name, docs]) => ({ name, count: docs.size }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async dropCollection(name) { return this.collections.delete(name); }

  async insertDoc(collection, data) {
    const id = uuid();
    const doc = { ...data, _id: id, _createdAt: now(), _updatedAt: now() };
    this._col(collection).set(id, doc);
    return { ...doc };
  }

  async getDoc(collection, id) {
    if (!this.collections.has(collection)) return null;
    const doc = this.collections.get(collection).get(id);
    return doc ? { ...doc } : null;
  }

  async listDocs(collection, { where = [], orderBy = [], limit = 50, offset = 0, select = null } = {}) {
    const colMap = this.collections.get(collection);
    if (!colMap) return { docs: [], total: 0 };
    let items = [...colMap.values()].filter((d) => matchWhere(d, where));
    items = sortDocs(items, orderBy.length ? orderBy : [['_createdAt', 'desc']]);
    const total = items.length;
    return {
      docs: items.slice(offset, offset + limit).map((d) => projectDoc(d, select)),
      total,
    };
  }

  async updateDoc(collection, id, patch) {
    const colMap = this.collections.get(collection);
    if (!colMap) return null;
    const doc = colMap.get(id);
    if (!doc) return null;
    for (const [k, v] of Object.entries(patch)) {
      if (k.startsWith('_')) continue;
      if (v === null) delete doc[k];
      else doc[k] = v;
    }
    doc._updatedAt = now();
    return { ...doc };
  }

  async replaceDoc(collection, id, data) {
    const colMap = this.collections.get(collection);
    if (!colMap) return null;
    const existing = colMap.get(id);
    if (!existing) return null;
    const doc = { ...data, _id: id, _createdAt: existing._createdAt, _updatedAt: now() };
    colMap.set(id, doc);
    return { ...doc };
  }

  async deleteDoc(collection, id) {
    const colMap = this.collections.get(collection);
    if (!colMap) return false;
    return colMap.delete(id);
  }

  async countDocs(collection, where = []) {
    const colMap = this.collections.get(collection);
    if (!colMap) return 0;
    return [...colMap.values()].filter((d) => matchWhere(d, where)).length;
  }

  async batchWrite(collection, ops) {
    const results = [];
    for (const op of ops) {
      if (op.op === 'create') {
        results.push({ op: 'create', ok: true, doc: await this.insertDoc(collection, op.data || {}) });
      } else if (op.op === 'update') {
        const doc = await this.updateDoc(collection, op.id, op.data || {});
        results.push({ op: 'update', ok: !!doc, doc, id: op.id });
      } else if (op.op === 'replace') {
        const doc = await this.replaceDoc(collection, op.id, op.data || {});
        results.push({ op: 'replace', ok: !!doc, doc, id: op.id });
      } else if (op.op === 'delete') {
        const ok = await this.deleteDoc(collection, op.id);
        results.push({ op: 'delete', ok, id: op.id });
      } else {
        results.push({ op: op.op, ok: false, error: 'unknown op' });
      }
    }
    return results;
  }

  async totalDocs() {
    let n = 0;
    for (const docs of this.collections.values()) n += docs.size;
    return n;
  }

  // ── activity feed ────────────────────────────────────────
  async recordActivity({ type, actor = 'system', userId = null, message, meta = {} }) {
    const ev = { id: uuid(), type, actor, userId, message, meta, createdAt: now() };
    this.activity.unshift(ev);
    if (this.activity.length > 500) this.activity.length = 500;
    return ev;
  }

  async listActivity({ userId = null, limit = 10 } = {}) {
    let items = this.activity;
    if (userId) items = items.filter((e) => e.userId === userId);
    return items.slice(0, limit).map((e) => ({ ...e }));
  }

  // ── settings ─────────────────────────────────────────────
  async getSetting(key, dflt = null) {
    return this.settings.has(key) ? structuredClone(this.settings.get(key)) : dflt;
  }

  async setSetting(key, value) {
    this.settings.set(key, structuredClone(value));
    return true;
  }

  // ── snapshot export / import (backups) ───────────────────
  async exportSnapshot() {
    const collections = {};
    for (const [name, docs] of this.collections.entries()) {
      collections[name] = [...docs.values()];
    }
    return {
      version: '1.0.0',
      exportedAt: now(),
      users: [...this.users.values()],
      apiKeys: [...this.apiKeys.values()],
      files: [...this.files.values()],
      collections,
      settings: Object.fromEntries(this.settings.entries()),
    };
  }

  async importSnapshot(snap) {
    if (snap.collections && typeof snap.collections === 'object') {
      for (const [name, docs] of Object.entries(snap.collections)) {
        const map = new Map();
        for (const doc of docs) map.set(doc._id || uuid(), doc);
        this.collections.set(name, map);
      }
    }
    if (snap.settings && typeof snap.settings === 'object') {
      for (const [k, v] of Object.entries(snap.settings)) this.settings.set(k, v);
    }
    return true;
  }
}
