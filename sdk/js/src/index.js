// ─────────────────────────────────────────────────────────────
// @bluebeakend/js — Official JavaScript / TypeScript Client SDK
// Zero external dependencies. Runs in Browser, Node.js 20+, Edge.
// ─────────────────────────────────────────────────────────────

export class BluebeakendError extends Error {
  constructor(message, { status = 0, code = 'UNKNOWN_ERROR', details = null } = {}) {
    super(message);
    this.name = 'BluebeakendError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function normalizeBaseUrl({ baseUrl, authDomain, secure }) {
  if (baseUrl) return String(baseUrl).replace(/\/+$/, '');
  if (!authDomain) throw new Error('Bluebeakend requires either "authDomain" or "baseUrl"');
  const raw = String(authDomain).replace(/\/+$/, '');
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
  const isLocal = raw.startsWith('localhost') || raw.startsWith('127.0.0.1') || raw.startsWith('0.0.0.0');
  const proto = secure === true ? 'https' : secure === false ? 'http' : isLocal ? 'http' : 'https';
  return `${proto}://${raw}`;
}

function normalizeWsUrl(baseUrl, realtimeUrl) {
  const pageHttps = typeof window !== 'undefined' && window.location?.protocol === 'https:';
  if (realtimeUrl) {
    const raw = String(realtimeUrl);
    return pageHttps ? raw.replace(/^ws:\/\//i, 'wss://') : raw;
  }
  const u = new URL(baseUrl);
  const proto = u.protocol === 'https:' || pageHttps ? 'wss:' : 'ws:';
  return `${proto}//${u.host}/realtime`;
}

function enrichDoc(doc) {
  if (!doc || typeof doc !== 'object') return doc;
  return { id: doc._id, ...doc };
}

class QuerySnapshot {
  constructor({ docs = [], total = 0, limit = 50, offset = 0 }) {
    this.docs = docs.map(enrichDoc);
    this.total = total;
    this.limit = limit;
    this.offset = offset;
    this.size = this.docs.length;
    this.empty = this.docs.length === 0;
  }

  forEach(cb) { this.docs.forEach(cb); }
  map(cb) { return this.docs.map(cb); }
  [Symbol.iterator]() { return this.docs[Symbol.iterator](); }
}

class Query {
  constructor(client, collectionName, state = {}) {
    this._client = client;
    this._collection = collectionName;
    this._where = state.where || [];
    this._orderBy = state.orderBy || [];
    this._limit = state.limit;
    this._offset = state.offset;
    this._select = state.select || null;
  }

  _clone(patch) {
    return new Query(this._client, this._collection, {
      where: this._where,
      orderBy: this._orderBy,
      limit: this._limit,
      offset: this._offset,
      select: this._select,
      ...patch,
    });
  }

  where(field, op, value) {
    return this._clone({ where: [...this._where, [field, op, value]] });
  }

  orderBy(field, direction = 'asc') {
    return this._clone({ orderBy: [...this._orderBy, [field, direction]] });
  }

  limit(n) { return this._clone({ limit: n }); }
  offset(n) { return this._clone({ offset: n }); }
  select(...fields) { return this._clone({ select: fields.flat() }); }

  async get() {
    const body = {};
    if (this._where.length) body.where = this._where;
    if (this._orderBy.length) body.orderBy = this._orderBy;
    if (this._limit !== undefined) body.limit = this._limit;
    if (this._offset !== undefined) body.offset = this._offset;
    if (this._select) body.select = this._select;

    const res = await this._client._request(`/api/v1/db/${encodeURIComponent(this._collection)}/query`, {
      method: 'POST',
      body,
    });
    return new QuerySnapshot(res);
  }

  async count() {
    const qs = this._where.length ? `?where=${encodeURIComponent(JSON.stringify(this._where))}` : '';
    const res = await this._client._request(`/api/v1/db/${encodeURIComponent(this._collection)}/count${qs}`);
    return res.count;
  }
}

class DocumentRef {
  constructor(client, collectionName, id) {
    this._client = client;
    this._collection = collectionName;
    this.id = id;
  }

  async get() {
    const res = await this._client._request(
      `/api/v1/db/${encodeURIComponent(this._collection)}/${encodeURIComponent(this.id)}`
    );
    return enrichDoc(res.doc);
  }

  async update(patch) {
    const res = await this._client._request(
      `/api/v1/db/${encodeURIComponent(this._collection)}/${encodeURIComponent(this.id)}`,
      { method: 'PATCH', body: patch }
    );
    return enrichDoc(res.doc);
  }

  async set(data) {
    const res = await this._client._request(
      `/api/v1/db/${encodeURIComponent(this._collection)}/${encodeURIComponent(this.id)}`,
      { method: 'PUT', body: data }
    );
    return enrichDoc(res.doc);
  }

  async delete() {
    return this._client._request(
      `/api/v1/db/${encodeURIComponent(this._collection)}/${encodeURIComponent(this.id)}`,
      { method: 'DELETE' }
    );
  }

  onSnapshot(callback) {
    return this._client.realtime.subscribe(`db:${this._collection}`, (frame) => {
      const targetId = frame.payload?.doc?._id || frame.payload?.id;
      if (targetId === this.id) {
        callback({
          type: frame.event,
          id: this.id,
          doc: frame.payload?.doc ? enrichDoc(frame.payload.doc) : null,
          ts: frame.ts,
        });
      }
    });
  }
}

class CollectionRef extends Query {
  async add(data) {
    const res = await this._client._request(`/api/v1/db/${encodeURIComponent(this._collection)}`, {
      method: 'POST',
      body: data,
    });
    return enrichDoc(res.doc);
  }

  doc(id) {
    return new DocumentRef(this._client, this._collection, id);
  }

  async batch(ops) {
    return this._client._request(`/api/v1/db/${encodeURIComponent(this._collection)}/batch`, {
      method: 'POST',
      body: { ops },
    });
  }

  onSnapshot(callback, { includeInitial = false } = {}) {
    if (includeInitial) {
      this.get()
        .then((snap) => callback({ type: 'initial', docs: snap.docs, total: snap.total }))
        .catch(() => {});
    }
    return this._client.realtime.subscribe(`db:${this._collection}`, (frame) => {
      callback({
        type: frame.event,
        collection: this._collection,
        doc: frame.payload?.doc ? enrichDoc(frame.payload.doc) : null,
        id: frame.payload?.doc?._id || frame.payload?.id || null,
        ts: frame.ts,
      });
    });
  }
}

class AuthClient {
  constructor(client) {
    this._client = client;
    this.currentUser = null;
    this._listeners = new Set();
  }

  _setSession({ user, accessToken, refreshToken }) {
    this.currentUser = user || null;
    if (accessToken !== undefined) this._client._accessToken = accessToken;
    if (refreshToken !== undefined) this._client._refreshToken = refreshToken;
    this._client._savePersisted();
    for (const fn of this._listeners) {
      try { fn(this.currentUser); } catch { /* ignore */ }
    }
  }

  onAuthStateChanged(listener) {
    this._listeners.add(listener);
    queueMicrotask(() => listener(this.currentUser));
    return () => this._listeners.delete(listener);
  }

  async signup(email, password, name) {
    const res = await this._client._request('/api/v1/auth/register', {
      method: 'POST',
      body: { email, password, ...(name ? { name } : {}) },
    });
    this._setSession(res);
    return res;
  }

  register(email, password, name) { return this.signup(email, password, name); }

  async login(email, password) {
    const res = await this._client._request('/api/v1/auth/login', {
      method: 'POST',
      body: { email, password },
    });
    this._setSession(res);
    return res;
  }

  async logout() {
    const refreshToken = this._client._refreshToken;
    this._setSession({ user: null, accessToken: null, refreshToken: null });
    if (refreshToken) {
      await this._client._request('/api/v1/auth/logout', { method: 'POST', body: { refreshToken } }).catch(() => {});
    }
    return { ok: true };
  }

  async refresh() {
    if (!this._client._refreshToken) throw new BluebeakendError('No refresh token available', { status: 401, code: 'NO_REFRESH_TOKEN' });
    const res = await this._client._request('/api/v1/auth/refresh', {
      method: 'POST',
      body: { refreshToken: this._client._refreshToken },
      skipAutoRefresh: true,
    });
    this._setSession(res);
    return res;
  }

  async me() {
    const res = await this._client._request('/api/v1/auth/me');
    this.currentUser = res.user;
    return res.user;
  }

  async updateProfile(patch) {
    const res = await this._client._request('/api/v1/auth/me', { method: 'PATCH', body: patch });
    this.currentUser = res.user;
    return res.user;
  }

  forgotPassword(email) {
    return this._client._request('/api/v1/auth/password/forgot', { method: 'POST', body: { email } });
  }

  resetPassword(token, newPassword) {
    return this._client._request('/api/v1/auth/password/reset', { method: 'POST', body: { token, newPassword } });
  }

  verifyEmail(token) {
    return this._client._request('/api/v1/auth/verify-email', { method: 'POST', body: { token } });
  }

  async sessions() {
    const res = await this._client._request('/api/v1/auth/sessions');
    return res.sessions;
  }

  revokeSession(id) {
    return this._client._request(`/api/v1/auth/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }
}

class DatabaseClient {
  constructor(client) { this._client = client; }

  collection(name) {
    return new CollectionRef(this._client, name);
  }

  async collections() {
    const res = await this._client._request('/api/v1/db');
    return res.collections;
  }
}

class StorageClient {
  constructor(client) { this._client = client; }

  async upload(fileInput, options = {}) {
    const form = new FormData();
    const folder = options.folder || fileInput?.folder || '';
    if (folder) form.append('folder', folder);
    if (options.isPublic) form.append('public', 'true');

    if (typeof Blob !== 'undefined' && fileInput instanceof Blob) {
      const filename = options.name || fileInput.name || 'upload.bin';
      form.append('file', fileInput, filename);
    } else if (fileInput && (Buffer.isBuffer?.(fileInput) || fileInput instanceof Uint8Array)) {
      const blob = new Blob([fileInput], { type: options.mime || 'application/octet-stream' });
      form.append('file', blob, options.name || 'upload.bin');
    } else if (typeof fileInput === 'string') {
      const blob = new Blob([fileInput], { type: options.mime || 'text/plain' });
      form.append('file', blob, options.name || 'upload.txt');
    } else if (fileInput && typeof fileInput === 'object' && fileInput.buffer) {
      const blob = new Blob([fileInput.buffer], { type: fileInput.mime || options.mime || 'application/octet-stream' });
      form.append('file', blob, fileInput.name || options.name || 'upload.bin');
    } else {
      throw new BluebeakendError('Unsupported file input passed to storage.upload()');
    }

    const res = await this._client._request('/api/v1/storage/upload', {
      method: 'POST',
      rawBody: form,
    });
    return {
      id: res.fileId || res.file?.id,
      fileId: res.fileId || res.file?.id,
      url: res.url,
      ...(res.file || {}),
    };
  }

  async getUrl(fileId) {
    const res = await this._client._request(`/api/v1/storage/${encodeURIComponent(fileId)}/download`);
    return res.url;
  }

  async getMetadata(fileId) {
    const res = await this._client._request(`/api/v1/storage/${encodeURIComponent(fileId)}`);
    return res.file;
  }

  list({ folder, limit = 50, offset = 0 } = {}) {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (folder !== undefined) params.set('folder', folder);
    return this._client._request(`/api/v1/storage/list?${params}`);
  }

  delete(fileId) {
    return this._client._request(`/api/v1/storage/${encodeURIComponent(fileId)}`, { method: 'DELETE' });
  }

  createSignedUploadUrl({ name, folder, mime, size }) {
    return this._client._request('/api/v1/storage/signed-url', {
      method: 'POST',
      body: { name, folder, mime, size },
    });
  }
}

class RealtimeClient {
  constructor(client) {
    this._client = client;
    this._ws = null;
    this._connecting = null;
    this._channels = new Map(); // channel -> Set<cb>
    this._WebSocket = client._WebSocket || globalThis.WebSocket;
  }

  async connect() {
    if (this._ws && this._ws.readyState === 1) return this._ws;
    if (this._connecting) return this._connecting;

    if (!this._WebSocket) {
      throw new BluebeakendError('WebSocket is not available in this runtime');
    }

    this._connecting = new Promise((resolve, reject) => {
      const u = new URL(this._client.realtimeUrl);
      if (this._client._accessToken) u.searchParams.set('token', this._client._accessToken);
      if (this._client.apiKey) u.searchParams.set('apiKey', this._client.apiKey);

      const ws = new this._WebSocket(u.toString());
      this._ws = ws;

      const onOpen = () => {
        this._connecting = null;
        for (const ch of this._channels.keys()) {
          ws.send(JSON.stringify({ action: 'subscribe', channel: ch }));
        }
        resolve(ws);
      };

      const onMessage = (ev) => {
        const raw = typeof ev.data === 'string' ? ev.data : ev.data?.toString?.() ?? String(ev);
        let frame;
        try { frame = JSON.parse(raw); } catch { return; }
        if (frame.channel && this._channels.has(frame.channel)) {
          for (const cb of this._channels.get(frame.channel)) {
            try { cb(frame); } catch { /* ignore */ }
          }
        }
      };

      const onError = (err) => {
        if (this._connecting) {
          this._connecting = null;
          reject(err instanceof Error ? err : new Error('WebSocket connection failed'));
        }
      };

      const onClose = () => {
        this._ws = null;
        this._connecting = null;
      };

      if (typeof ws.addEventListener === 'function') {
        ws.addEventListener('open', onOpen);
        ws.addEventListener('message', onMessage);
        ws.addEventListener('error', onError);
        ws.addEventListener('close', onClose);
      } else if (typeof ws.on === 'function') {
        ws.on('open', onOpen);
        ws.on('message', (data) => onMessage({ data }));
        ws.on('error', onError);
        ws.on('close', onClose);
      }
    });

    return this._connecting;
  }

  subscribe(channel, callback) {
    if (!this._channels.has(channel)) this._channels.set(channel, new Set());
    const subs = this._channels.get(channel);
    const wasEmpty = subs.size === 0;
    subs.add(callback);

    this.connect()
      .then((ws) => {
        if (wasEmpty && ws.readyState === 1) {
          ws.send(JSON.stringify({ action: 'subscribe', channel }));
        }
      })
      .catch(() => {});

    return () => {
      const set = this._channels.get(channel);
      if (!set) return;
      set.delete(callback);
      if (set.size === 0) {
        this._channels.delete(channel);
        if (this._ws && this._ws.readyState === 1) {
          this._ws.send(JSON.stringify({ action: 'unsubscribe', channel }));
        }
        if (this._channels.size === 0) this.disconnect();
      }
    };
  }

  async publish(channel, eventName, payload = {}) {
    const ws = await this.connect();
    ws.send(JSON.stringify({ action: 'publish', channel, eventName, payload }));
  }

  disconnect() {
    if (this._ws) {
      try { this._ws.close(); } catch { /* ignore */ }
      this._ws = null;
    }
    this._connecting = null;
  }
}

export class Bluebeakend {
  constructor(options = {}) {
    if (!options.apiKey) throw new Error('Bluebeakend: "apiKey" is required');
    this.apiKey = options.apiKey;
    this.projectId = options.projectId || 'default';
    this.baseUrl = normalizeBaseUrl(options);
    this.realtimeUrl = normalizeWsUrl(this.baseUrl, options.realtimeUrl);
    this._fetch = options.fetch || globalThis.fetch.bind(globalThis);
    this._WebSocket = options.WebSocket || globalThis.WebSocket;
    this._storageKey = `bb_session_${this.projectId}`;
    this._accessToken = options.accessToken || null;
    this._refreshToken = options.refreshToken || null;

    this.auth = new AuthClient(this);
    this.db = new DatabaseClient(this);
    this.storage = new StorageClient(this);
    this.realtime = new RealtimeClient(this);

    this._loadPersisted();
  }

  _loadPersisted() {
    try {
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(this._storageKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          this._accessToken = parsed.accessToken || null;
          this._refreshToken = parsed.refreshToken || null;
          this.auth.currentUser = parsed.user || null;
        }
      }
    } catch { /* non-browser or blocked storage */ }
  }

  _savePersisted() {
    try {
      if (typeof localStorage !== 'undefined') {
        if (!this._accessToken && !this._refreshToken) {
          localStorage.removeItem(this._storageKey);
        } else {
          localStorage.setItem(
            this._storageKey,
            JSON.stringify({
              accessToken: this._accessToken,
              refreshToken: this._refreshToken,
              user: this.auth.currentUser,
            })
          );
        }
      }
    } catch { /* ignore */ }
  }

  async _request(path, { method = 'GET', body, rawBody, headers = {}, skipAutoRefresh = false } = {}) {
    const reqHeaders = {
      'X-API-Key': this.apiKey,
      ...headers,
    };
    if (/(\.app\.github\.dev|\.devtunnels\.ms)(:|\/|$)/i.test(this.baseUrl)) {
      reqHeaders['X-Tunnel-Skip-AntiPhishing-Page'] = '1';
    }
    if (this._accessToken && !reqHeaders.Authorization) {
      reqHeaders.Authorization = `Bearer ${this._accessToken}`;
    }

    let payload = rawBody;
    if (body !== undefined && rawBody === undefined) {
      reqHeaders['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }

    const res = await this._fetch(`${this.baseUrl}${path}`, {
      method,
      headers: reqHeaders,
      body: payload,
    });

    if (res.status === 401 && !skipAutoRefresh && this._refreshToken && !path.includes('/auth/login')) {
      try {
        await this.auth.refresh();
        return this._request(path, { method, body, rawBody, headers, skipAutoRefresh: true });
      } catch { /* surface original 401 below */ }
    }

    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }

    if (!res.ok) {
      const errObj = json?.error || {};
      throw new BluebeakendError(errObj.message || `HTTP ${res.status}`, {
        status: res.status,
        code: errObj.code || 'HTTP_ERROR',
        details: errObj.details || null,
      });
    }

    return json;
  }
}

export const BlueBeakend = Bluebeakend;
export default Bluebeakend;
