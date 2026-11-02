// ─────────────────────────────────────────────────────────────
// BlueBeakend — rate limiting (per API key and per IP) +
// daily request counters for the 7-day dashboard chart.
// ─────────────────────────────────────────────────────────────
import { tooMany, forbidden } from '../errors.js';
import { config } from '../config.js';

export function makeRateLimiter({ cache, db }) {
  return async function rateLimit(req) {
    // Optional IP whitelist enforcement (configured in Admin -> Settings -> Security)
    const whitelist = await db.getSetting('ipWhitelist', '');
    if (whitelist && String(whitelist).trim()) {
      const allowed = String(whitelist).split(',').map((s) => s.trim()).filter(Boolean);
      if (allowed.length && !allowed.includes('*') && !allowed.includes(req.ip) && req.ip !== '127.0.0.1' && req.ip !== '::1') {
        throw forbidden('IP address is not in the allowlist');
      }
    }

    const minute = Math.floor(Date.now() / 60000);
    const isAuth = req.url.includes('/auth/') || req.url.includes('/admin/login');
    if (isAuth) {
      const ipKey = `rl:ip:${req.ip}:${minute}`;
      const n = await cache.incr(ipKey, 120);
      const authCap = config.env === 'test' ? 500 : 60;
      if (n > authCap) throw tooMany('Too many requests from this IP — slow down');
    }
    if (req.apiKey) {
      const globalRpm = await db.getSetting('rateLimitRpm', config.rateLimitRpm);
      const limit = req.apiKey.rateLimit || Number(globalRpm) || config.rateLimitRpm;
      const key = `rl:key:${req.apiKey.id}:${minute}`;
      const n = await cache.incr(key, 120);
      if (n > limit) throw tooMany(`Rate limit exceeded (${limit}/min) for this API key`);
    }
  };
}

/** Daily request counter for dashboard stats. */
export function makeRequestCounter({ cache }) {
  return async function countRequest(req) {
    if (req.url === '/healthz') return;
    const day = new Date().toISOString().slice(0, 10);
    await cache.incr(`req:day:${day}`, 86400 * 14);
  };
}

export async function requestsToday(cache) {
  const day = new Date().toISOString().slice(0, 10);
  return Number((await cache.get(`req:day:${day}`)) || 0);
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export async function requestsLastNDays(cache, days = 7) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400_000);
    const date = d.toISOString().slice(0, 10);
    const requests = Number((await cache.get(`req:day:${date}`)) || 0);
    out.push({
      date,
      label: `${WEEKDAYS[d.getUTCDay()]} ${date.slice(5)}`,
      requests,
    });
  }
  return out;
}
