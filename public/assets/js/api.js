/**
 * KALEA — client HTTP (JSON, CSRF, gestion d'erreurs unifiée).
 */

export class ApiError extends Error {
  constructor(message, { status = 0, code = 'error', details = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function cookie(name) {
  const match = document.cookie.split('; ').find((c) => c.startsWith(`${name}=`));
  if (!match) return null;
  try { return decodeURIComponent(match.split('=')[1]); } catch { return null; }
}

export async function api(path, { method = 'GET', body = null, headers = {} } = {}) {
  const csrf = cookie('kalea_csrf');
  const requestHeaders = { Accept: 'application/json', ...headers };
  if (body !== null && body !== undefined) requestHeaders['Content-Type'] = 'application/json';
  if (csrf && method !== 'GET') requestHeaders['X-CSRF-Token'] = csrf;

  let response;
  try {
    response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: requestHeaders,
      body: body !== null && body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('Impossible de joindre le serveur. Vérifiez votre connexion.', { status: 0, code: 'network' });
  }

  const isJson = (response.headers.get('content-type') ?? '').includes('application/json');
  const payload = isJson ? await response.json().catch(() => null) : await response.text();

  if (!response.ok) {
    const error = payload?.error ?? {};
    throw new ApiError(error.message ?? `Erreur ${response.status}`, {
      status: response.status,
      code: error.code ?? 'error',
      details: error.details ?? null,
    });
  }
  return payload;
}

export const get = (path, opts = {}) => api(path, { ...opts, method: 'GET' });
export const post = (path, body, opts = {}) => api(path, { ...opts, method: 'POST', body });
export const put = (path, body, opts = {}) => api(path, { ...opts, method: 'PUT', body });
export const patch = (path, body, opts = {}) => api(path, { ...opts, method: 'PATCH', body });
export const del = (path, body, opts = {}) => api(path, { ...opts, method: 'DELETE', body });
