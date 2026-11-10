export function createRequestBudget({ now = Date.now, max = 80, windowMs = 10000 } = {}) {
  let windowStart = 0, count = 0; const cooldowns = new Map();
  const group = url => { try { const u = new URL(url, 'https://local.invalid'); return u.searchParams.get('source') || 'site'; } catch { return 'site'; } };
  return {
    take(url) {
      const time = now(); if (time - windowStart >= windowMs) { windowStart = time; count = 0; }
      const until = Math.max(cooldowns.get('all') || 0, cooldowns.get(group(url)) || 0);
      if (until > time) return Math.ceil((until - time) / 1000);
      if (count >= max) return Math.max(1, Math.ceil((windowStart + windowMs - time) / 1000));
      count++; return 0;
    },
    retry(url, value, siteWide = false) {
      const seconds = Number(value), time = now();
      const delay = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : Math.max(1000, Date.parse(value) - time || 30000);
      cooldowns.set(siteWide ? 'all' : group(url), time + Math.min(3600000, delay));
    },
  };
}
