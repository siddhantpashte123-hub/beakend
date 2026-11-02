// ─────────────────────────────────────────────────────────────
// BlueBeakend — cache & pub/sub facade
// Redis when REDIS_URL is set, otherwise in-process memory store.
// Used for: rate limiting, request counters, realtime fan-out.
// ─────────────────────────────────────────────────────────────
import { EventEmitter } from 'node:events';
import { config } from '../config.js';

class MemoryCache {
  constructor() {
    this.kind = 'memory';
    this.store = new Map(); // key -> { value, expiresAt|null }
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(0);
  }

  _entry(key) {
    const e = this.store.get(key);
    if (!e) return null;
    if (e.expiresAt && e.expiresAt < Date.now()) {
      this.store.delete(key);
      return null;
    }
    return e;
  }

  async get(key) {
    const e = this._entry(key);
    return e ? e.value : null;
  }

  async set(key, value, ttlSeconds = 0) {
    this.store.set(key, {
      value,
      expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null,
    });
  }

  async del(key) { this.store.delete(key); }

  async incr(key, ttlSeconds = 0) {
    const e = this._entry(key);
    const next = e ? Number(e.value) + 1 : 1;
    this.store.set(key, {
      value: next,
      expiresAt: e && e.expiresAt ? e.expiresAt : ttlSeconds ? Date.now() + ttlSeconds * 1000 : null,
    });
    return next;
  }

  async publish(channel, message) {
    // deliver asynchronously to mimic redis
    queueMicrotask(() => this.emitter.emit(channel, message));
  }

  async subscribe(channel, handler) {
    this.emitter.on(channel, handler);
    return () => this.emitter.off(channel, handler);
  }

  async close() { this.store.clear(); }
}

class RedisCache {
  constructor(redisUrl) {
    this.kind = 'redis';
    this.url = redisUrl;
    this.client = null;
    this.subscriber = null;
  }

  async init() {
    const { default: Redis } = await import('ioredis');
    this.client = new Redis(this.url, { maxRetriesPerRequest: 3, lazyConnect: true });
    this.subscriber = new Redis(this.url, { maxRetriesPerRequest: 3, lazyConnect: true });
    await this.client.connect();
    await this.subscriber.connect();
  }

  async get(key) {
    const v = await this.client.get(key);
    if (v === null) return null;
    try { return JSON.parse(v); } catch { return v; }
  }

  async set(key, value, ttlSeconds = 0) {
    const s = JSON.stringify(value);
    if (ttlSeconds) await this.client.set(key, s, 'EX', ttlSeconds);
    else await this.client.set(key, s);
  }

  async del(key) { await this.client.del(key); }

  async incr(key, ttlSeconds = 0) {
    const n = await this.client.incr(key);
    if (n === 1 && ttlSeconds) await this.client.expire(key, ttlSeconds);
    return n;
  }

  async publish(channel, message) {
    await this.client.publish(channel, JSON.stringify(message));
  }

  async subscribe(channel, handler) {
    await this.subscriber.subscribe(channel);
    const listener = (ch, raw) => {
      if (ch !== channel) return;
      try { handler(JSON.parse(raw)); } catch { handler(raw); }
    };
    this.subscriber.on('message', listener);
    return async () => {
      this.subscriber.off('message', listener);
      await this.subscriber.unsubscribe(channel).catch(() => {});
    };
  }

  async close() {
    await this.client?.quit().catch(() => {});
    await this.subscriber?.quit().catch(() => {});
  }
}

export async function createCache({ redisUrl = config.redisUrl, forceMemory = false } = {}) {
  if (!forceMemory && redisUrl) {
    const cache = new RedisCache(redisUrl);
    await cache.init();
    return cache;
  }
  return new MemoryCache();
}

export { MemoryCache, RedisCache };
