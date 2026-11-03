// ─────────────────────────────────────────────────────────────
// BlueBeakend — structured logger + in-memory log ring buffer
// (admin "Logs" page & CLI `bb logs` read from the ring buffer,
//  and live listeners broadcast new entries over WebSocket)
// ─────────────────────────────────────────────────────────────
import { config } from './config.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const RING_MAX = 2000;

export const logRing = [];
const listeners = new Set();
let seq = 0;

export function onLogEntry(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function push(level, service, msg, meta) {
  const entry = {
    id: ++seq,
    ts: new Date().toISOString(),
    level,
    service,
    msg: String(msg),
    ...(meta && Object.keys(meta).length ? { meta } : {}),
  };
  logRing.push(entry);
  if (logRing.length > RING_MAX) logRing.shift();
  for (const fn of listeners) {
    try { fn(entry); } catch { /* ignore listener failure */ }
  }
  return entry;
}

function write(level, service, msg, meta) {
  if (config.env === 'test') return;
  const min = LEVELS[config.env === 'development' ? 'debug' : 'info'] ?? 20;
  if (LEVELS[level] < min) return;
  const line = `[${new Date().toISOString()}] ${level.toUpperCase().padEnd(5)} [${service}] ${msg}`;
  const out = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  if (meta && Object.keys(meta).length) out(line, meta);
  else out(line);
}

export function createLogger(service) {
  return {
    debug: (msg, meta) => { push('debug', service, msg, meta); write('debug', service, msg, meta); },
    info: (msg, meta) => { push('info', service, msg, meta); write('info', service, msg, meta); },
    warn: (msg, meta) => { push('warn', service, msg, meta); write('warn', service, msg, meta); },
    error: (msg, meta) => { push('error', service, msg, meta); write('error', service, msg, meta); },
  };
}

export function listLogs({ level, service, q, limit = 200, since } = {}) {
  let items = logRing;
  if (level && level !== 'all') items = items.filter((e) => e.level === level);
  if (service && service !== 'all') items = items.filter((e) => e.service === service);
  if (since) items = items.filter((e) => e.ts >= since);
  if (q) {
    const needle = q.toLowerCase();
    items = items.filter(
      (e) => e.msg.toLowerCase().includes(needle) || e.service.toLowerCase().includes(needle)
    );
  }
  return items.slice(-limit).reverse();
}

export const logger = createLogger('core');
