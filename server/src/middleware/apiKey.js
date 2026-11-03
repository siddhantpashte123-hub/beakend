// ─────────────────────────────────────────────────────────────
// BlueBeakend — X-API-Key authentication
// All /api/v1/* endpoints require a valid project API key,
// except /health, signed download/upload URLs (?exp=&sig=), and
// admin panel routes (which accept an admin Bearer JWT).
// ─────────────────────────────────────────────────────────────
import { unauthorized, forbidden } from '../errors.js';
import { verifyAccessToken } from '../utils/tokens.js';

const KEY_RE = /^bb_(live|test)_[0-9a-f]{40}$/;

export function makeApiKeyGuard({ db, allowAdminBearer = false, allowSignedQuery = false }) {
  return async function apiKeyGuard(req) {
    // Signed storage URLs (?exp=...&sig=...) carry their own HMAC proof
    if (allowSignedQuery && req.query && req.query.exp && req.query.sig) {
      return;
    }

    const raw = req.headers['x-api-key'];
    if (!raw) {
      // Allow authenticated admin dashboard calls when enabled
      if (allowAdminBearer && req.headers.authorization?.startsWith('Bearer ')) {
        try {
          const payload = verifyAccessToken(req.headers.authorization.slice(7));
          const user = await db.findUserById(payload.sub);
          if (user && user.status === 'active' && user.role === 'admin') {
            req.user = user;
            return;
          }
        } catch {
          // fall through to standard API key error
        }
      }
      throw unauthorized('Missing X-API-Key header');
    }

    if (!KEY_RE.test(raw)) throw unauthorized('Malformed API key (expected bb_live_… / bb_test_…)');
    const key = await db.findApiKey(raw);
    if (!key || key.status !== 'active') throw forbidden('API key is invalid or revoked');
    req.apiKey = key;
    db.touchApiKey(key.id).catch(() => {});
  };
}
