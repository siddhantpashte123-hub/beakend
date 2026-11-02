// ─────────────────────────────────────────────────────────────
// BlueBeakend — admin JWT authentication
// Admin endpoints accept Authorization: Bearer <access token>
// where the token subject has role=admin and status=active.
// ─────────────────────────────────────────────────────────────
import { unauthorized, forbidden } from '../errors.js';
import { verifyAccessToken } from '../utils/tokens.js';

export function makeAdminGuard({ db, requireAdmin = true }) {
  return async function adminGuard(req) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw unauthorized('Missing Bearer token');
    let payload;
    try {
      payload = verifyAccessToken(token);
    } catch {
      throw unauthorized('Invalid or expired token');
    }
    const user = await db.findUserById(payload.sub);
    if (!user || user.status !== 'active') throw unauthorized('User not found or banned');
    if (requireAdmin && user.role !== 'admin') throw forbidden('Admin access required');
    req.user = user;
  };
}

/** Same as above but any authenticated user. */
export function makeUserGuard({ db }) {
  return makeAdminGuard({ db, requireAdmin: false });
}
