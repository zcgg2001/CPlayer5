const ALLOWED_PROTOCOLS = new Set(['https:', 'http:', 'blob:']);
const SAFE_DATA_IMAGE = /^data:image\/(?:avif|gif|jpeg|png|webp);/i;


export function normalizeMediaUrl(
  value,
  { allowDataImage = false, baseUrl = globalThis.location?.href } = {},
) {
  if (typeof value !== 'string') return null;

  const candidate = value.trim();
  if (!candidate) return null;

  if (candidate.startsWith('data:')) {
    return allowDataImage && SAFE_DATA_IMAGE.test(candidate) ? candidate : null;
  }

  try {
    const url = new URL(candidate, baseUrl);
    if (!ALLOWED_PROTOCOLS.has(url.protocol)) return null;
    if (url.username || url.password) return null;
    if (url.protocol === 'http:') url.protocol = 'https:';
    return url.href;
  } catch {
    return null;
  }
}
