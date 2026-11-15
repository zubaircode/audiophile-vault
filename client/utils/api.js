/**
 * Resolves the backend base URL dynamically.
 * In Electron, window.electronAPI.apiBaseUrl provides the sidecar Express URL (http://127.0.0.1:<port>).
 * In standalone browser dev mode, falls back to http://localhost:3001.
 */
export const API_BASE =
  (typeof window !== 'undefined' && window.electronAPI?.apiBaseUrl) ||
  'http://localhost:3001';

export function apiUrl(path = '') {
  if (!path) return API_BASE;
  if (/^https?:\/\//i.test(path)) return path;
  const cleanBase = API_BASE.replace(/\/+$/, '');
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${cleanBase}${cleanPath}`;
}

export default API_BASE;
