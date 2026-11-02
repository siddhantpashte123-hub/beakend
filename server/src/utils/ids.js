// ─────────────────────────────────────────────────────────────
// BlueBeakend — id & random helpers
// ─────────────────────────────────────────────────────────────
import { randomUUID, randomBytes, createHash, timingSafeEqual } from 'node:crypto';

export const uuid = () => randomUUID();
export const randomHex = (bytes = 32) => randomBytes(bytes).toString('hex');
export const randomBase64 = (bytes = 16) => randomBytes(bytes).toString('base64url');
export const sha256 = (s) => createHash('sha256').update(String(s)).digest('hex');

export function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** Generate a BlueBeakend API key: bb_live_<40 hex> or bb_test_<40 hex> */
export const newApiKey = (live = true) => `bb_${live ? 'live' : 'test'}_${randomHex(20)}`;
