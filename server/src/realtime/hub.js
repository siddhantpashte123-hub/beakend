// ─────────────────────────────────────────────────────────────
// BlueBeakend — realtime hub
// Channel fan-out for WebSocket clients. Events flow across
// processes through the cache pub/sub channel "__realtime__".
//
// Channels:  db:{collection}   — document changes
//            user:{userId}     — user-targeted events
//            custom:{name}     — app-defined channels
// ─────────────────────────────────────────────────────────────
import { createLogger } from '../logger.js';

const log = createLogger('realtime');
const PUBSUB_CHANNEL = '__realtime__';

export class RealtimeHub {
  constructor(cache) {
    this.cache = cache;
    this.channels = new Map(); // channel -> Set<socket>
    this.sockets = new Map();  // socket -> { user, channels:Set }
    this.unsub = null;
    this.messageHandlers = new Set();
  }

  async start() {
    this.unsub = await this.cache.subscribe(PUBSUB_CHANNEL, (msg) => {
      if (!msg || typeof msg !== 'object') return;
      const { channel, event, payload, ts } = msg;
      const subs = this.channels.get(channel);
      if (!subs) return;
      const frame = JSON.stringify({ event, channel, payload, ts });
      for (const sock of subs) {
        try { sock.send(frame); } catch { /* socket closed */ }
      }
    });
  }

  async stop() {
    if (this.unsub) await this.unsub();
  }

  /** Publish an event to a channel (all processes). */
  async publish(channel, event, payload = {}) {
    await this.cache.publish(PUBSUB_CHANNEL, {
      channel,
      event,
      payload,
      ts: new Date().toISOString(),
    });
  }

  /** Register a local socket connection. */
  addSocket(sock, user = null) {
    this.sockets.set(sock, { user, channels: new Set() });
  }

  /** Subscribe a socket to a channel. Returns false if socket unknown. */
  subscribe(sock, channel) {
    const meta = this.sockets.get(sock);
    if (!meta) return false;
    if (!this.channels.has(channel)) this.channels.set(channel, new Set());
    this.channels.get(channel).add(sock);
    meta.channels.add(channel);
    return true;
  }

  unsubscribe(sock, channel) {
    const meta = this.sockets.get(sock);
    if (meta) meta.channels.delete(channel);
    const subs = this.channels.get(channel);
    if (subs) {
      subs.delete(sock);
      if (!subs.size) this.channels.delete(channel);
    }
  }

  removeSocket(sock) {
    const meta = this.sockets.get(sock);
    if (meta) {
      for (const ch of meta.channels) this.unsubscribe(sock, ch);
    }
    this.sockets.delete(sock);
  }

  /** Snapshot for admin panel. */
  stats() {
    return {
      connections: this.sockets.size,
      channels: [...this.channels.entries()].map(([name, subs]) => ({
        name,
        subscribers: subs.size,
      })),
    };
  }
}
