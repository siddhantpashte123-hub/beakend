// ─────────────────────────────────────────────────────────────
// BlueBeakend — request validation helpers (zod)
// ─────────────────────────────────────────────────────────────
import { badRequest } from '../errors.js';

export function parse(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    const details = result.error.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
    }));
    throw badRequest('Validation failed', details);
  }
  return result.data;
}

/** Strip private fields from a user record. */
export function publicUser(user) {
  if (!user) return null;
  const { passwordHash, ...rest } = user;
  return rest;
}

export function publicFile(file, url = null) {
  if (!file) return null;
  return {
    id: file.id,
    name: file.name,
    folder: file.folder || '',
    mime: file.mime,
    size: file.size,
    isPublic: file.isPublic,
    createdAt: file.createdAt,
    userId: file.userId,
    url,
  };
}
