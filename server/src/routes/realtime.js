// ─────────────────────────────────────────────────────────────
// BlueBeakend — WebSocket realtime routes (/realtime)
// Connect:  ws(s)://host/realtime?token=<JWT>
//       or  ws(s)://host/realtime?apiKey=bb_live_...
//
// Client → Server frames (JSON):
//   { "action": "subscribe",   "channel": "db:todos" }
//   { "action": "unsubscribe", "channel": "db:todos" }
//   { "action": "publish",     "channel": "custom:chat", "event": "msg", "payload": {...} }
//   { "action": "ping" }
//
// Server → Client frames (JSON):
//   { "event": "connected",   "channels": [...], "user": {...} }
//   { "event": "subscribed",  "channel": "db:todos" }
//   { "event": "doc.created", "channel": "db:todos", "payload": {...}, "ts": "..." }
// ─────────────────────────────────────────────────────────────
import { verifyAccessToken } from '../utils/tokens.js';
import { createLogger } from '../logger.js';

const log = createLogger('realtime');

function resolveSocket(connection) {
  // @fastify/websocket v10 passes WebSocket directly (or SocketStream in older versions)
  return connection?.socket || connection;
}

function safeSend(sock, obj) {
  try {
    if (sock.readyState === 1 || sock.readyState === undefined) {
      sock.send(JSON.stringify(obj));
    }
  } catch { /* closed */ }
}

export async function attachRealtimeSocket(connection, req, ctx, initialChannels = []) {
  const sock = resolveSocket(connection);
  const { db, hub } = ctx;

  // Authenticate via ?token=<JWT>, Authorization header, or ?apiKey=bb_live_...
  let user = req.user || null;
  let apiKey = req.apiKey || null;

  const qToken = req.query?.token || (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null);
  const qApiKey = req.query?.apiKey || req.headers['x-api-key'];

  if (!user && qToken) {
    try {
      const payload = verifyAccessToken(qToken);
      const found = await db.findUserById(payload.sub);
      if (found && found.status === 'active') user = found;
    } catch { /* checked below */ }
  }

  if (!apiKey && qApiKey) {
    const found = await db.findApiKey(qApiKey);
    if (found && found.status === 'active') apiKey = found;
  }

  if (!user && !apiKey) {
    safeSend(sock, { event: 'error', message: 'Authentication required (?token=JWT or ?apiKey=bb_live_...)' });
    try { sock.close(4001, 'Unauthorized'); } catch { /* ignore */ }
    return;
  }

  hub.addSocket(sock, user ? { id: user.id, email: user.email, role: user.role } : null);

  const subscribed = [];
  for (const ch of initialChannels) {
    hub.subscribe(sock, ch);
    subscribed.push(ch);
  }
  if (user) {
    hub.subscribe(sock, `user:${user.id}`);
    subscribed.push(`user:${user.id}`);
  }

  safeSend(sock, {
    event: 'connected',
    channels: subscribed,
    user: user ? { id: user.id, email: user.email, role: user.role } : null,
    ts: new Date().toISOString(),
  });

  sock.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      safeSend(sock, { event: 'error', message: 'Invalid JSON frame' });
      return;
    }

    const action = msg.action || msg.event || msg.type;
    const channel = String(msg.channel || '');

    if (action === 'ping') {
      safeSend(sock, { event: 'pong', ts: new Date().toISOString() });
      return;
    }

    if (action === 'subscribe') {
      if (!channel) {
        safeSend(sock, { event: 'error', message: 'channel is required' });
        return;
      }
      if (channel === 'admin:logs' && user?.role !== 'admin') {
        safeSend(sock, { event: 'error', message: 'Admin privileges required for admin:logs' });
        return;
      }
      if (channel.startsWith('user:') && user?.role !== 'admin' && channel !== `user:${user?.id}`) {
        safeSend(sock, { event: 'error', message: 'Cannot subscribe to another user channel' });
        return;
      }
      hub.subscribe(sock, channel);
      safeSend(sock, { event: 'subscribed', channel, ts: new Date().toISOString() });
      return;
    }

    if (action === 'unsubscribe') {
      if (channel) hub.unsubscribe(sock, channel);
      safeSend(sock, { event: 'unsubscribed', channel, ts: new Date().toISOString() });
      return;
    }

    if (action === 'publish') {
      if (!channel.startsWith('custom:') && user?.role !== 'admin') {
        safeSend(sock, { event: 'error', message: 'Client publish only allowed on custom:* channels' });
        return;
      }
      await hub.publish(channel, msg.eventName || 'custom.message', msg.payload ?? {});
      safeSend(sock, { event: 'published', channel, ts: new Date().toISOString() });
      return;
    }

    safeSend(sock, { event: 'error', message: `Unknown action "${action}"` });
  });

  sock.on('close', () => hub.removeSocket(sock));
  sock.on('error', () => hub.removeSocket(sock));
  log.debug(`ws client connected (${user?.email || apiKey?.name || 'key'})`);
}

export async function realtimeRoutes(app, ctx) {
  app.get('/realtime', { websocket: true }, (connection, req) => {
    const initial = req.query?.channel ? String(req.query.channel).split(',').filter(Boolean) : [];
    attachRealtimeSocket(connection, req, ctx, initial);
  });
}
