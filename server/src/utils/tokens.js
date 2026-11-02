// ─────────────────────────────────────────────────────────────
// BlueBeakend — JWT access tokens + opaque refresh tokens
// ─────────────────────────────────────────────────────────────
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { randomHex, sha256 } from './ids.js';

export function signAccessToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      role: user.role || 'user',
      typ: 'access',
    },
    config.jwtSecret,
    {
      issuer: config.jwtIssuer,
      expiresIn: config.accessTtl,
    }
  );
}

export function verifyAccessToken(token) {
  const payload = jwt.verify(token, config.jwtSecret, { issuer: config.jwtIssuer });
  if (payload.typ !== 'access') throw new Error('wrong token type');
  return payload;
}

/** Opaque refresh token — only its SHA-256 hash is persisted. */
export function newRefreshToken() {
  const token = `bb_rt_${randomHex(32)}`;
  return { token, tokenHash: sha256(token) };
}

export const hashRefreshToken = (token) => sha256(token);

/** HMAC-signed download URL token (local storage signed URLs). */
export function signUrlToken(fileId, expiresAt) {
  const exp = Math.floor(expiresAt.getTime() / 1000);
  const sig = sha256(`${fileId}:${exp}:${config.jwtSecret}`);
  return `exp=${exp}&sig=${sig}`;
}

export function verifyUrlToken(fileId, exp, sig) {
  const now = Math.floor(Date.now() / 1000);
  if (!exp || Number(exp) < now) return false;
  const expected = sha256(`${fileId}:${exp}:${config.jwtSecret}`);
  return expected === sig;
}
