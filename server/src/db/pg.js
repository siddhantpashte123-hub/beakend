// ─────────────────────────────────────────────────────────────
// BlueBeakend — PostgreSQL database adapter (production)
// Same interface as the in-memory adapter.
// ─────────────────────────────────────────────────────────────
import pg from 'pg';
import { uuid } from '../utils/ids.js';

const META_FIELDS = {
  _id: 'id',
  _createdAt: 'created_at',
  _updatedAt: 'updated_at',
};

function mapUser(r) {
  if (!r) return null;
  return {
    id: r.id,
    email: r.email,
    passwordHash: r.password_hash,
    name: r.name,
    role: r.role,
    status: r.status,
    emailVerified: r.email_verified,
    provider: r.provider,
    metadata: r.metadata || {},
    lastLoginAt: r.last_login_at ? r.last_login_at.toISOString() : null,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

function mapSession(r) {
  if (!r) return null;
  return {
    id: r.id,
    tokenHash: r.token_hash,
    userId: r.user_id,
    userAgent: r.user_agent,
    ip: r.ip,
    expiresAt: r.expires_at.toISOString(),
    revokedAt: r.revoked_at ? r.revoked_at.toISOString() : null,
    createdAt: r.created_at.toISOString(),
  };
}

function mapApiKey(r) {
  if (!r) return null;
  return {
    id: r.id,
    key: r.key,
    name: r.name,
    live: r.live,
    status: r.status,
    rateLimit: r.rate_limit,
    requestsCount: Number(r.requests_count || 0),
    createdBy: r.created_by,
    lastUsedAt: r.last_used_at ? r.last_used_at.toISOString() : null,
    createdAt: r.created_at.toISOString(),
  };
}

function mapFile(r) {
  if (!r) return null;
  return {
    id: r.id,
    userId: r.user_id,
    storageKey: r.storage_key,
    name: r.name,
    folder: r.folder || '',
    mime: r.mime,
    size: Number(r.size),
    isPublic: r.is_public,
    createdAt: r.created_at.toISOString(),
  };
}

function mapDoc(r) {
  if (!r) return null;
  return {
    ...r.data,
    _id: r.id,
    _createdAt: r.created_at.toISOString(),
    _updatedAt: r.updated_at.toISOString(),
  };
}

function mapActivity(r) {
  if (!r) return null;
  return {
    id: r.id,
    type: r.type,
    actor: r.actor,
    userId: r.user_id,
    message: r.message,
    meta: r.meta || {},
    createdAt: r.created_at.toISOString(),
  };
}

function sqlTextLiteral(str) {
  return `'${String(str).replace(/'/g, "''")}'`;
}

function docExpr(field) {
  if (META_FIELDS[field]) return META_FIELDS[field];
  return `data->${sqlTextLiteral(field)}`;
}

/** Build SQL WHERE from a where-clause array, parameterized. */
export function buildWhere(where = [], params = [], exprFor = docExpr) {
  const parts = [];
  for (const [field, op, value] of where) {
    const isMeta = Boolean(META_FIELDS[field]);
    const expr = exprFor(field);
    const p = (v) => {
      params.push(v);
      return `$${params.length}`;
    };

    if (isMeta) {
      // Native UUID / TIMESTAMPTZ columns
      switch (op) {
        case '==': parts.push(value === null ? `(${expr} IS NULL)` : `(${expr}::text = ${p(String(value))})`); break;
        case '!=': parts.push(value === null ? `(${expr} IS NOT NULL)` : `(${expr}::text <> ${p(String(value))})`); break;
        case '>': parts.push(`(${expr} > ${p(value)})`); break;
        case '<': parts.push(`(${expr} < ${p(value)})`); break;
        case '>=': parts.push(`(${expr} >= ${p(value)})`); break;
        case '<=': parts.push(`(${expr} <= ${p(value)})`); break;
        case 'in': parts.push(`(${expr}::text = ANY(${p((value || []).map(String))}::text[]))`); break;
        case 'exists': parts.push(value === false ? `(${expr} IS NULL)` : `(${expr} IS NOT NULL)`); break;
        default: throw new Error(`unsupported operator: ${op}`);
      }
      continue;
    }

    switch (op) {
      case '==':
        parts.push(value === null ? `(${expr} IS NULL OR ${expr} = 'null'::jsonb)` : `(${expr} = ${p(JSON.stringify(value))}::jsonb)`);
        break;
      case '!=':
        parts.push(value === null ? `(${expr} IS NOT NULL AND ${expr} <> 'null'::jsonb)` : `(${expr} IS NULL OR ${expr} <> ${p(JSON.stringify(value))}::jsonb)`);
        break;
      case '>': parts.push(`(${expr} IS NOT NULL AND ${expr} <> 'null'::jsonb AND ${expr} > ${p(JSON.stringify(value))}::jsonb)`); break;
      case '<': parts.push(`(${expr} IS NOT NULL AND ${expr} <> 'null'::jsonb AND ${expr} < ${p(JSON.stringify(value))}::jsonb)`); break;
      case '>=': parts.push(`(${expr} IS NOT NULL AND ${expr} <> 'null'::jsonb AND ${expr} >= ${p(JSON.stringify(value))}::jsonb)`); break;
      case '<=': parts.push(`(${expr} IS NOT NULL AND ${expr} <> 'null'::jsonb AND ${expr} <= ${p(JSON.stringify(value))}::jsonb)`); break;
      case 'in':
        parts.push(`(${expr} = ANY(ARRAY(SELECT jsonb_array_elements(${p(JSON.stringify(value || []))}::jsonb))))`);
        break;
      case 'contains': {
        const vp = p(JSON.stringify(value));
        parts.push(`((jsonb_typeof(${expr}) = 'array' AND ${expr} @> jsonb_build_array(${vp}::jsonb)) OR (jsonb_typeof(${expr}) = 'string' AND (${expr} #>> '{}') LIKE ('%' || (${vp}::jsonb #>> '{}') || '%')))`);
        break;
      }
      case 'exists':
        parts.push(value === false ? `(${expr} IS NULL OR ${expr} = 'null'::jsonb)` : `(${expr} IS NOT NULL AND ${expr} <> 'null'::jsonb)`);
        break;
      default:
        throw new Error(`unsupported operator: ${op}`);
    }
  }
  if (!parts.length) return '';
  return ' WHERE ' + parts.join(' AND ');
}

function projectDoc(doc, select) {
  if (!select || !select.length) return doc;
  const out = { _id: doc._id, _createdAt: doc._createdAt, _updatedAt: doc._updatedAt };
  for (const f of select) if (f in doc) out[f] = doc[f];
  return out;
}

export class PgDb {
  constructor(databaseUrl) {
    this.kind = 'postgres';
    this.pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
  }

  async query(text, params) {
    return this.pool.query(text, params);
  }

  async init() {
    const { runMigrations } = await import('./migrate.js');
    await runMigrations(this);
  }

  async close() { await this.pool.end(); }
  async ping() {
    try { await this.query('SELECT 1'); return true; } catch { return false; }
  }

  // ── users ────────────────────────────────────────────────
  async createUser({ email, passwordHash, name = '', role = 'user', status = 'active', emailVerified = false, provider = 'password', metadata = {} }) {
    try {
      const { rows } = await this.query(
        `INSERT INTO users (id, email, password_hash, name, role, status, email_verified, provider, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [uuid(), String(email).toLowerCase(), passwordHash, name, role, status, emailVerified, provider, JSON.stringify(metadata)]
      );
      return mapUser(rows[0]);
    } catch (err) {
      if (err.code === '23505') {
        const e = new Error('email already registered');
        e.code = 'UNIQUE_VIOLATION';
        throw e;
      }
      throw err;
    }
  }

  async findUserByEmail(email) {
    const { rows } = await this.query('SELECT * FROM users WHERE email = $1', [String(email).toLowerCase()]);
    return mapUser(rows[0]);
  }

  async findUserById(id) {
    const { rows } = await this.query('SELECT * FROM users WHERE id = $1', [id]);
    return mapUser(rows[0]);
  }

  async listUsers({ page = 1, limit = 20, q, status, provider } = {}) {
    const params = [];
    const clauses = [];
    if (status && status !== 'all') { params.push(status); clauses.push(`status = $${params.length}`); }
    if (provider && provider !== 'all') { params.push(provider); clauses.push(`provider = $${params.length}`); }
    if (q) {
      params.push(`%${q}%`);
      clauses.push(`(email ILIKE $${params.length} OR name ILIKE $${params.length})`);
    }
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
    const countRes = await this.query(`SELECT count(*)::int AS n FROM users${where}`, params);
    params.push(limit, (page - 1) * limit);
    const { rows } = await this.query(
      `SELECT * FROM users${where} ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return { users: rows.map(mapUser), total: countRes.rows[0].n };
  }

  async updateUser(id, patch) {
    const map = {
      passwordHash: 'password_hash', name: 'name', role: 'role', status: 'status',
      emailVerified: 'email_verified', provider: 'provider', metadata: 'metadata',
      lastLoginAt: 'last_login_at', email: 'email',
    };
    const sets = [];
    const params = [];
    for (const [k, col] of Object.entries(map)) {
      if (k in patch) {
        params.push(k === 'email' ? String(patch[k]).toLowerCase() : k === 'metadata' ? JSON.stringify(patch[k]) : patch[k]);
        sets.push(`${col} = $${params.length}`);
      }
    }
    if (!sets.length) return this.findUserById(id);
    params.push(id);
    try {
      const { rows } = await this.query(
        `UPDATE users SET ${sets.join(', ')}, updated_at = now() WHERE id = $${params.length} RETURNING *`,
        params
      );
      return mapUser(rows[0]);
    } catch (err) {
      if (err.code === '23505') {
        const e = new Error('email already registered');
        e.code = 'UNIQUE_VIOLATION';
        throw e;
      }
      throw err;
    }
  }

  async deleteUser(id) {
    const { rowCount } = await this.query('DELETE FROM users WHERE id = $1', [id]);
    return rowCount > 0;
  }

  async countUsers() {
    const { rows } = await this.query('SELECT count(*)::int AS n FROM users');
    return rows[0].n;
  }

  // ── sessions ─────────────────────────────────────────────
  async createSession({ tokenHash, userId, expiresAt, userAgent = '', ip = '' }) {
    const { rows } = await this.query(
      `INSERT INTO sessions (id, token_hash, user_id, user_agent, ip, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [uuid(), tokenHash, userId, userAgent, ip, expiresAt]
    );
    return mapSession(rows[0]);
  }

  async findSessionByTokenHash(tokenHash) {
    const { rows } = await this.query('SELECT * FROM sessions WHERE token_hash = $1', [tokenHash]);
    return mapSession(rows[0]);
  }

  async revokeSession(id, userId) {
    const params = [id];
    let sql = 'UPDATE sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL';
    if (userId) { params.push(userId); sql += ` AND user_id = $${params.length}`; }
    const { rowCount } = await this.query(sql, params);
    return rowCount > 0;
  }

  async listSessions(userId) {
    const { rows } = await this.query(
      'SELECT * FROM sessions WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now() ORDER BY created_at DESC',
      [userId]
    );
    return rows.map(mapSession);
  }

  async revokeAllSessions(userId) {
    const { rowCount } = await this.query(
      'UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
      [userId]
    );
    return rowCount;
  }

  // ── auth tokens ──────────────────────────────────────────
  async createToken({ tokenHash, userId, type, expiresAt }) {
    await this.query(
      'INSERT INTO auth_tokens (token_hash, user_id, type, expires_at) VALUES ($1,$2,$3,$4)',
      [tokenHash, userId, type, expiresAt]
    );
    return true;
  }

  async findToken(tokenHash, type) {
    const { rows } = await this.query(
      'SELECT * FROM auth_tokens WHERE token_hash = $1 AND type = $2 AND expires_at > now()',
      [tokenHash, type]
    );
    if (!rows[0]) return null;
    const r = rows[0];
    return { tokenHash: r.token_hash, userId: r.user_id, type: r.type, expiresAt: r.expires_at.toISOString(), createdAt: r.created_at.toISOString() };
  }

  async consumeToken(tokenHash) {
    const { rowCount } = await this.query('DELETE FROM auth_tokens WHERE token_hash = $1', [tokenHash]);
    return rowCount > 0;
  }

  // ── api keys ─────────────────────────────────────────────
  async createApiKey({ key, name = 'default', live = true, createdBy = null, rateLimit = null }) {
    const { rows } = await this.query(
      `INSERT INTO api_keys (id, key, name, live, created_by, rate_limit)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [uuid(), key, name, live, createdBy, rateLimit]
    );
    return mapApiKey(rows[0]);
  }

  async listApiKeys() {
    const { rows } = await this.query('SELECT * FROM api_keys ORDER BY created_at DESC');
    return rows.map(mapApiKey);
  }

  async findApiKey(key) {
    const { rows } = await this.query('SELECT * FROM api_keys WHERE key = $1', [key]);
    return mapApiKey(rows[0]);
  }

  async touchApiKey(id) {
    await this.query('UPDATE api_keys SET last_used_at = now(), requests_count = requests_count + 1 WHERE id = $1', [id]);
  }

  async revokeApiKey(id) {
    const { rowCount } = await this.query("UPDATE api_keys SET status = 'revoked' WHERE id = $1", [id]);
    return rowCount > 0;
  }

  async countApiKeys() {
    const { rows } = await this.query("SELECT count(*)::int AS n FROM api_keys WHERE status = 'active'");
    return rows[0].n;
  }

  // ── files ────────────────────────────────────────────────
  async createFile({ id = uuid(), userId = null, storageKey, name, folder = '', mime = 'application/octet-stream', size = 0, isPublic = false }) {
    const cleanFolder = String(folder || '').replace(/^\/+|\/+$/g, '');
    const { rows } = await this.query(
      `INSERT INTO files (id, user_id, storage_key, name, folder, mime, size, is_public)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [id, userId, storageKey, name, cleanFolder, mime, size, isPublic]
    );
    return mapFile(rows[0]);
  }

  async getFile(id) {
    const { rows } = await this.query('SELECT * FROM files WHERE id = $1', [id]);
    return mapFile(rows[0]);
  }

  async listFiles({ userId = null, folder = null, q = null, limit = 50, offset = 0 } = {}) {
    const params = [];
    const clauses = [];
    if (userId) { params.push(userId); clauses.push(`user_id = $${params.length}`); }
    if (folder !== null && folder !== undefined && folder !== 'all') {
      const clean = String(folder).replace(/^\/+|\/+$/g, '');
      params.push(clean);
      clauses.push(`folder = $${params.length}`);
    }
    if (q) {
      params.push(`%${q}%`);
      clauses.push(`(name ILIKE $${params.length} OR folder ILIKE $${params.length})`);
    }
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
    const countRes = await this.query(`SELECT count(*)::int AS n FROM files${where}`, params);
    params.push(limit, offset);
    const { rows } = await this.query(
      `SELECT * FROM files${where} ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return { files: rows.map(mapFile), total: countRes.rows[0].n };
  }

  async listFolders(userId = null) {
    if (userId) {
      const { rows } = await this.query(
        "SELECT folder AS name, count(*)::int AS count FROM files WHERE user_id = $1 AND folder <> '' GROUP BY folder ORDER BY folder",
        [userId]
      );
      return rows;
    }
    const { rows } = await this.query(
      "SELECT folder AS name, count(*)::int AS count FROM files WHERE folder <> '' GROUP BY folder ORDER BY folder"
    );
    return rows;
  }

  async deleteFile(id) {
    const { rowCount } = await this.query('DELETE FROM files WHERE id = $1', [id]);
    return rowCount > 0;
  }

  async totalStorageUsed(userId = null) {
    if (userId) {
      const { rows } = await this.query('SELECT COALESCE(SUM(size),0)::bigint AS n FROM files WHERE user_id = $1', [userId]);
      return Number(rows[0].n);
    }
    const { rows } = await this.query('SELECT COALESCE(SUM(size),0)::bigint AS n FROM files');
    return Number(rows[0].n);
  }

  // ── documents & collections ──────────────────────────────
  async ensureCollection(name) {
    await this.query('INSERT INTO collections_meta (name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [name]);
    const count = await this.countDocs(name);
    return { name, count };
  }

  async listCollections() {
    const { rows } = await this.query(`
      SELECT name, SUM(cnt)::int AS count FROM (
        SELECT collection AS name, count(*)::int AS cnt FROM documents GROUP BY collection
        UNION ALL
        SELECT name, 0 AS cnt FROM collections_meta
      ) t GROUP BY name ORDER BY name
    `);
    return rows;
  }

  async dropCollection(name) {
    const r1 = await this.query('DELETE FROM documents WHERE collection = $1', [name]);
    const r2 = await this.query('DELETE FROM collections_meta WHERE name = $1', [name]);
    return r1.rowCount > 0 || r2.rowCount > 0;
  }

  async insertDoc(collection, data) {
    await this.query('INSERT INTO collections_meta (name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [collection]);
    const { rows } = await this.query(
      `INSERT INTO documents (id, collection, data) VALUES ($1,$2,$3) RETURNING *`,
      [uuid(), collection, JSON.stringify(data)]
    );
    return mapDoc(rows[0]);
  }

  async getDoc(collection, id) {
    const { rows } = await this.query('SELECT * FROM documents WHERE collection = $1 AND id = $2', [collection, id]);
    return mapDoc(rows[0]);
  }

  async listDocs(collection, { where = [], orderBy = [], limit = 50, offset = 0, select = null } = {}) {
    const params = [collection];
    const whereSql = buildWhere(where, params, docExpr);
    const whereClause = whereSql ? ` AND ${whereSql.replace(/^ WHERE /, '')}` : '';
    const orderSql = orderBy.length
      ? ' ORDER BY ' + orderBy.map(([f, dir]) => `${docExpr(f)} ${dir === 'desc' ? 'DESC' : 'ASC'} NULLS LAST`).join(', ')
      : ' ORDER BY created_at DESC';
    const countRes = await this.query(
      `SELECT count(*)::int AS n FROM documents WHERE collection = $1${whereClause}`,
      params
    );
    params.push(limit, offset);
    const { rows } = await this.query(
      `SELECT * FROM documents WHERE collection = $1${whereClause}${orderSql} LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return { docs: rows.map((r) => projectDoc(mapDoc(r), select)), total: countRes.rows[0].n };
  }

  async updateDoc(collection, id, patch) {
    const { rows: existing } = await this.query('SELECT * FROM documents WHERE collection = $1 AND id = $2', [collection, id]);
    if (!existing[0]) return null;
    const current = existing[0].data || {};
    for (const [k, v] of Object.entries(patch)) {
      if (k.startsWith('_')) continue;
      if (v === null) delete current[k];
      else current[k] = v;
    }
    const { rows } = await this.query(
      'UPDATE documents SET data = $3, updated_at = now() WHERE collection = $1 AND id = $2 RETURNING *',
      [collection, id, JSON.stringify(current)]
    );
    return mapDoc(rows[0]);
  }

  async replaceDoc(collection, id, data) {
    const { rows } = await this.query(
      'UPDATE documents SET data = $3, updated_at = now() WHERE collection = $1 AND id = $2 RETURNING *',
      [collection, id, JSON.stringify(data)]
    );
    return rows[0] ? mapDoc(rows[0]) : null;
  }

  async deleteDoc(collection, id) {
    const { rowCount } = await this.query('DELETE FROM documents WHERE collection = $1 AND id = $2', [collection, id]);
    return rowCount > 0;
  }

  async countDocs(collection, where = []) {
    const params = [collection];
    const whereSql = buildWhere(where, params, docExpr);
    const whereClause = whereSql ? ` AND ${whereSql.replace(/^ WHERE /, '')}` : '';
    const { rows } = await this.query(
      `SELECT count(*)::int AS n FROM documents WHERE collection = $1${whereClause}`,
      params
    );
    return rows[0].n;
  }

  async batchWrite(collection, ops) {
    await this.query('INSERT INTO collections_meta (name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [collection]);
    const results = [];
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const op of ops) {
        if (op.op === 'create') {
          const { rows } = await client.query(
            'INSERT INTO documents (id, collection, data) VALUES ($1,$2,$3) RETURNING *',
            [uuid(), collection, JSON.stringify(op.data || {})]
          );
          results.push({ op: 'create', ok: true, doc: mapDoc(rows[0]) });
        } else if (op.op === 'update') {
          const { rows: ex } = await client.query('SELECT * FROM documents WHERE collection = $1 AND id = $2 FOR UPDATE', [collection, op.id]);
          if (!ex[0]) { results.push({ op: 'update', ok: false, id: op.id }); continue; }
          const current = ex[0].data || {};
          for (const [k, v] of Object.entries(op.data || {})) {
            if (k.startsWith('_')) continue;
            if (v === null) delete current[k];
            else current[k] = v;
          }
          const { rows } = await client.query(
            'UPDATE documents SET data = $3, updated_at = now() WHERE collection = $1 AND id = $2 RETURNING *',
            [collection, op.id, JSON.stringify(current)]
          );
          results.push({ op: 'update', ok: true, doc: mapDoc(rows[0]), id: op.id });
        } else if (op.op === 'replace') {
          const { rows } = await client.query(
            'UPDATE documents SET data = $3, updated_at = now() WHERE collection = $1 AND id = $2 RETURNING *',
            [collection, op.id, JSON.stringify(op.data || {})]
          );
          results.push({ op: 'replace', ok: !!rows[0], doc: rows[0] ? mapDoc(rows[0]) : null, id: op.id });
        } else if (op.op === 'delete') {
          const { rowCount } = await client.query('DELETE FROM documents WHERE collection = $1 AND id = $2', [collection, op.id]);
          results.push({ op: 'delete', ok: rowCount > 0, id: op.id });
        } else {
          results.push({ op: op.op, ok: false, error: 'unknown op' });
        }
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    return results;
  }

  async totalDocs() {
    const { rows } = await this.query('SELECT count(*)::int AS n FROM documents');
    return rows[0].n;
  }

  // ── activity feed ────────────────────────────────────────
  async recordActivity({ type, actor = 'system', userId = null, message, meta = {} }) {
    const { rows } = await this.query(
      `INSERT INTO activity_events (id, type, actor, user_id, message, meta)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [uuid(), type, actor, userId, message, JSON.stringify(meta)]
    );
    return mapActivity(rows[0]);
  }

  async listActivity({ userId = null, limit = 10 } = {}) {
    if (userId) {
      const { rows } = await this.query(
        'SELECT * FROM activity_events WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
        [userId, limit]
      );
      return rows.map(mapActivity);
    }
    const { rows } = await this.query(
      'SELECT * FROM activity_events ORDER BY created_at DESC LIMIT $1',
      [limit]
    );
    return rows.map(mapActivity);
  }

  // ── settings ─────────────────────────────────────────────
  async getSetting(key, dflt = null) {
    const { rows } = await this.query('SELECT value FROM settings WHERE key = $1', [key]);
    return rows[0] ? rows[0].value : dflt;
  }

  async setSetting(key, value) {
    await this.query(
      `INSERT INTO settings (key, value, updated_at) VALUES ($1,$2,now())
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()`,
      [key, JSON.stringify(value)]
    );
    return true;
  }

  // ── snapshot export / import ─────────────────────────────
  async exportSnapshot() {
    const collections = {};
    const cols = await this.listCollections();
    for (const c of cols) {
      const { rows } = await this.query('SELECT * FROM documents WHERE collection = $1 ORDER BY created_at ASC', [c.name]);
      collections[c.name] = rows.map(mapDoc);
    }
    const { rows: users } = await this.query('SELECT * FROM users');
    const { rows: keys } = await this.query('SELECT * FROM api_keys');
    const { rows: files } = await this.query('SELECT * FROM files');
    const { rows: settingsRows } = await this.query('SELECT key, value FROM settings');
    return {
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      users: users.map(mapUser),
      apiKeys: keys.map(mapApiKey),
      files: files.map(mapFile),
      collections,
      settings: Object.fromEntries(settingsRows.map((r) => [r.key, r.value])),
    };
  }

  async importSnapshot(snap) {
    if (snap.collections && typeof snap.collections === 'object') {
      for (const [name, docs] of Object.entries(snap.collections)) {
        await this.ensureCollection(name);
        for (const d of docs) {
          const id = d._id || uuid();
          const { _id, _createdAt, _updatedAt, ...data } = d;
          await this.query(
            `INSERT INTO documents (id, collection, data) VALUES ($1,$2,$3)
             ON CONFLICT (id) DO UPDATE SET data = $3, updated_at = now()`,
            [id, name, JSON.stringify(data)]
          );
        }
      }
    }
    if (snap.settings && typeof snap.settings === 'object') {
      for (const [k, v] of Object.entries(snap.settings)) await this.setSetting(k, v);
    }
    return true;
  }
}
