// ─────────────────────────────────────────────────────────────
// BlueBeakend — query-string parsing for the document API
//
//   ?where=done==false,priority>=2        compact form
//   ?where=[["done","==",false]]          JSON form
//   ?orderBy=createdAt:desc,_id:asc
//   ?limit=50&offset=0&select=title,done
// ─────────────────────────────────────────────────────────────
import { badRequest } from '../errors.js';

const OPS = ['==', '!=', '>=', '<=', '>', '<', 'in', 'contains', 'exists'];

function coerce(raw) {
  if (raw === 'null') return null;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw !== '' && !Number.isNaN(Number(raw))) return Number(raw);
  if ((raw.startsWith('[') && raw.endsWith(']')) || (raw.startsWith('{') && raw.endsWith('}'))) {
    try { return JSON.parse(raw); } catch { /* keep string */ }
  }
  return raw;
}

export function parseWhere(input) {
  if (!input) return [];
  const str = String(input).trim();
  if (str.startsWith('[')) {
    let arr;
    try { arr = JSON.parse(str); } catch { throw badRequest('where: invalid JSON'); }
    if (!Array.isArray(arr)) throw badRequest('where: expected array of [field, op, value]');
    return arr.map((clause) => {
      if (!Array.isArray(clause) || clause.length < 2) throw badRequest('where: each clause must be [field, op, value]');
      const [field, op, value] = clause;
      if (!OPS.includes(op)) throw badRequest(`where: unsupported operator "${op}"`);
      return [String(field), op, value === undefined ? null : value];
    });
  }
  // compact form: field op value [, field op value ...]
  return str.split(',').map((part) => {
    const m = part.trim().match(/^([A-Za-z0-9_.-]+)\s*(==|!=|>=|<=|>|<|in|contains|exists)\s*(.*)$/);
    if (!m) throw badRequest(`where: cannot parse "${part}"`);
    const [, field, op, rawValue] = m;
    return [field, op, rawValue === '' ? null : coerce(rawValue.trim())];
  });
}

export function parseOrderBy(input) {
  if (!input) return [];
  return String(input).split(',').map((part) => {
    const [field, dir] = part.trim().split(':');
    if (!field) throw badRequest('orderBy: empty field');
    return [field, (dir || 'asc').toLowerCase() === 'desc' ? 'desc' : 'asc'];
  });
}

export function parseSelect(input) {
  if (!input) return null;
  return String(input).split(',').map((s) => s.trim()).filter(Boolean);
}

export function parsePagination(query) {
  const limit = Math.min(Math.max(parseInt(query.limit ?? '50', 10) || 50, 1), 500);
  const offset = Math.max(parseInt(query.offset ?? '0', 10) || 0, 0);
  return { limit, offset };
}
