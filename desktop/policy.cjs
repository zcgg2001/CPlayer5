const DEFAULT_ORIGIN = 'https://music.505zc.tech';
function appOrigin(value = DEFAULT_ORIGIN, development = false) {
  const url = new URL(value);
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Desktop URL must be an origin');
  if (url.origin !== DEFAULT_ORIGIN && !(development && url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))) throw new Error('Untrusted desktop origin');
  return url.origin;
}
function trusted(url, origin) { try { return new URL(url).origin === origin; } catch { return false; } }
function tokenRoute(url, origin) {
  if (!trusted(url, origin)) return false;
  const path = new URL(url).pathname;
  return /^\/api\/account\/(me|sessions|revoke|export|delete)$/.test(path) || path === '/api/sync' || path === '/api/auth/sign-out';
}
module.exports = { appOrigin, trusted, tokenRoute };
