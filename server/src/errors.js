// ─────────────────────────────────────────────────────────────
// BlueBeakend — typed HTTP errors
// ─────────────────────────────────────────────────────────────
export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (msg, details) => new ApiError(400, 'BAD_REQUEST', msg, details);
export const unauthorized = (msg = 'Unauthorized') => new ApiError(401, 'UNAUTHORIZED', msg);
export const forbidden = (msg = 'Forbidden') => new ApiError(403, 'FORBIDDEN', msg);
export const notFound = (msg = 'Not found') => new ApiError(404, 'NOT_FOUND', msg);
export const conflict = (msg) => new ApiError(409, 'CONFLICT', msg);
export const tooMany = (msg = 'Rate limit exceeded') => new ApiError(429, 'RATE_LIMITED', msg);
export const notImplemented = (msg) => new ApiError(501, 'NOT_IMPLEMENTED', msg);
