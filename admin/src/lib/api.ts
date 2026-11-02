// ─────────────────────────────────────────────────────────────
// BlueBeakend Admin — API client (strictly relative URLs so it
// works behind Nginx, custom domains, and proxy preview URLs)
// ─────────────────────────────────────────────────────────────

const TOKEN_KEY = 'bb_admin_token';
const USER_KEY = 'bb_admin_user';

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: string;
  status: string;
}

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function getSavedUser(): AdminUser | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setAuthSession(token: string, user: AdminUser) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearAuthSession() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export async function apiFetch<T = any>(
  path: string,
  options: { method?: string; body?: any; rawBody?: BodyInit; headers?: Record<string, string> } = {}
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = { ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;

  let payload: BodyInit | undefined = options.rawBody;
  if (options.body !== undefined && options.rawBody === undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(options.body);
  }

  const res = await fetch(path, {
    method: options.method || 'GET',
    headers,
    body: payload,
  });

  if (res.status === 401 && !path.includes('/admin/login')) {
    clearAuthSession();
    if (typeof window !== 'undefined' && !window.location.pathname.includes('/admin/login')) {
      window.location.href = '/admin/login/';
    }
  }

  const text = await res.text();
  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    throw new Error(data?.error?.message || `Request failed (${res.status})`);
  }
  return data as T;
}

export function getRealtimeWsUrl(): string {
  if (typeof window === 'undefined') return '';
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const token = getToken();
  return `${proto}//${window.location.host}/realtime${token ? `?token=${encodeURIComponent(token)}` : ''}`;
}
