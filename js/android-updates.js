import { t } from './i18n.js';

const REPO = 'zcgg2001/CPlayer5';
const RELEASES = `https://github.com/${REPO}/releases`;
const API = `https://api.github.com/repos/${REPO}/releases`;
const APK = /^CPlayer5-android-preview-([1-9]\d*)\.apk$/;
const CACHE_KEY = 'cp_android_release';
const DISMISSED_KEY = 'cp_android_dismissed_build';
const CHECK_INTERVAL = 15 * 60 * 1000;
const RETRY_INTERVAL = 2 * 60 * 1000;

function previewRelease(tag, code, name) {
  if (typeof tag !== 'string' || !tag || tag === '.' || tag === '..' || !Number.isSafeInteger(code) || code <= 0 || code > 2100000000) return null;
  const path = encodeURIComponent(tag);
  return { tag, code, name: typeof name === 'string' && name !== tag ? name.slice(0, 160) : '',
    notes: `${RELEASES}/tag/${path}`, download: `${RELEASES}/download/${path}/CPlayer5-android-preview-${code}.apk` };
}

// A website-only release or a more recently edited old tag can appear first.
// Android's versionCode orders packages across both regular and pre-releases.
export async function latestAndroidRelease(fetcher, signal) {
  let latest = null;
  for (let page = 1; ; page++) {
    const response = await fetcher(`${API}?per_page=100&page=${page}`, {
      signal, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store',
    });
    if (!response.ok) {
      const error = new Error(`GitHub returned ${response.status}`);
      if (response.status === 429 || response.status === 403) {
        const delay = Number(response.headers.get('Retry-After')) * 1000;
        const reset = Number(response.headers.get('X-RateLimit-Reset')) * 1000;
        error.retryAt = delay > 0 ? Date.now() + delay : Math.max(Date.now() + RETRY_INTERVAL, reset || 0);
      }
      throw error;
    }
    const releases = await response.json();
    if (!Array.isArray(releases)) throw new Error('Invalid GitHub releases response');
    for (const release of releases) {
      if (release.draft || !release.published_at || !Array.isArray(release.assets)) continue;
      for (const asset of release.assets) {
        const match = APK.exec(asset.name);
        if (!match || asset.state !== 'uploaded' || !(asset.size > 0)) continue;
        const candidate = previewRelease(release.tag_name, Number(match[1]), release.name);
        if (candidate && candidate.download === asset.browser_download_url && candidate.code > (latest?.code ?? 0)) latest = candidate;
      }
    }
    if (!response.headers.get('Link')?.includes('rel="next"')) return latest;
  }
}

function readPreference(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}

function savePreference(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* The current session still works. */ }
}

export function initAndroidUpdates(dom) {
  const build = /\bCPlayerAndroid\/(\S+) CPlayerPreview\/(\d+)\b/.exec(navigator.userAgent);
  if (!build || !window.CPlayerNative?.postMessage) return;
  const [, version, code] = build;
  const cached = readPreference(CACHE_KEY);
  let latest = previewRelease(cached?.tag, cached?.code, cached?.name);
  let dismissed = readPreference(DISMISSED_KEY);
  let nextCheck = Math.min(Number(cached?.checked) || 0, Date.now()) + CHECK_INTERVAL;
  let retryAfter = 0, timer, checking = false, failed = false, foreground = true;
  dom.androidUpdateSettings.hidden = false;

  function render() {
    const available = latest && latest.code > Number(code);
    const announcement = available ? t('updateAvailable', { tag: latest.tag }) : '';
    dom.androidInstalledVersion.textContent = t('updateInstalled', { version });
    dom.androidUpdateTitle.textContent = announcement;
    dom.androidUpdateBanner.hidden = !available || latest.code === dismissed;
    dom.androidUpdateStatus.textContent = checking ? t('updateChecking') : failed ? t('updateFailed') : announcement || t('updateCurrent');
    dom.androidReleaseName.textContent = available ? latest.name : '';
    dom.androidUpdateCheck.disabled = checking;
    dom.androidUpdateLinks.hidden = !available;
    if (available) {
      dom.androidUpdateDownload.href = latest.download;
      dom.androidSettingsDownload.href = latest.download;
      dom.androidReleaseNotes.href = latest.notes;
    }
  }

  function schedule() {
    clearTimeout(timer);
    if (foreground && !document.hidden && !checking) timer = setTimeout(check, Math.max(0, nextCheck - Date.now()));
  }

  async function check(manual = false) {
    if (!foreground || document.hidden || checking) return;
    if (Date.now() < (manual ? retryAfter : nextCheck)) { schedule(); return; }
    checking = true;
    render();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      latest = await latestAndroidRelease(fetch, controller.signal);
      failed = false;
      const checked = Date.now();
      savePreference(CACHE_KEY, { checked, tag: latest?.tag, code: latest?.code, name: latest?.name });
      nextCheck = checked + CHECK_INTERVAL;
      retryAfter = 0;
    } catch (error) {
      failed = true;
      retryAfter = error.retryAt || 0;
      nextCheck = Math.max(Date.now() + RETRY_INTERVAL, retryAfter);
    } finally {
      clearTimeout(timeout);
      checking = false;
      render();
      schedule();
    }
  }

  dom.androidUpdateCheck.addEventListener('click', () => check(true));
  dom.androidUpdateDismiss.addEventListener('click', () => {
    if (!latest) return;
    dismissed = latest.code;
    savePreference(DISMISSED_KEY, dismissed);
    render();
    const settings = dom.mobileChartsSheet.inert ? dom.mobileSettingsBtn : dom.mobileChartsSheet.querySelector('[data-android-action="settings"]');
    settings?.focus({ preventScroll: true });
  });
  window.addEventListener('cplayer:locale', render);
  window.addEventListener('cplayer:pause', () => { foreground = false; clearTimeout(timer); });
  window.addEventListener('cplayer:resume', () => { foreground = true; void check(); });
  window.addEventListener('online', () => check(failed));
  document.addEventListener('visibilitychange', () => { if (document.hidden) clearTimeout(timer); else void check(); });
  render();
  void check();
}
