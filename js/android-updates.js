import { t } from './i18n.js';
import { createUpdateTransport, updateSource, updateDownloadUrl } from './update-transport.js';

const REPO = 'zcgg2001/CPlayer5';
const RELEASES = `https://github.com/${REPO}/releases`;
const API = `https://api.github.com/repos/${REPO}/releases`;
const APK = /^(?:ZPlayer|CPlayer5)-android-preview-([1-9]\d*)\.apk$/;
const CACHE_KEY = 'cp_android_release';
const DISMISSED_KEY = 'cp_android_dismissed_build';
const SOURCE_KEY = 'zp_update_source';
const CHECK_INTERVAL = 15 * 60 * 1000;
const RETRY_INTERVAL = 2 * 60 * 1000;

function previewRelease(tag, code, name, asset = `CPlayer5-android-preview-${code}.apk`) {
  if (typeof tag !== 'string' || !tag || tag === '.' || tag === '..' || !Number.isSafeInteger(code) || code <= 0 || code > 2100000000) return null;
  const match = typeof asset === 'string' && APK.exec(asset);
  if (!match || Number(match[1]) !== code) return null;
  const path = encodeURIComponent(tag);
  return { tag, code, name: typeof name === 'string' && name !== tag ? name.slice(0, 160) : '',
    notes: `${RELEASES}/tag/${path}`, download: `${RELEASES}/download/${path}/${asset}` };
}

// A website-only release or a more recently edited old tag can appear first.
// Android's versionCode orders packages across both regular and pre-releases.
export async function latestAndroidRelease(fetcher, signal) {
  let latest = null;
  for (let page = 1; page <= 20; page++) {
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
        const candidate = previewRelease(release.tag_name, Number(match[1]), release.name, asset.name);
        if (candidate && candidate.download === asset.browser_download_url
          && (candidate.code > (latest?.code ?? 0) || (candidate.code === latest?.code && asset.name.startsWith('ZPlayer-')))) {
          latest = { ...candidate, size: Number(asset.size), sha256: /^sha256:[a-f0-9]{64}$/i.test(asset.digest || '') ? asset.digest.slice(7).toLowerCase() : '',
            description: typeof release.body === 'string' ? release.body.slice(0, 5000) : '' };
        }
      }
    }
    if (!response.headers.get('Link')?.includes('rel="next"')) return latest;
  }
  throw new Error('GitHub release pagination exceeded its limit');
}

function readPreference(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}

function savePreference(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* The current session still works. */ }
}

export function initAndroidUpdates(dom, { transport = createUpdateTransport() } = {}) {
  const build = /\bCPlayerAndroid\/(\S+) CPlayerPreview\/(\d+)\b/.exec(navigator.userAgent);
  if (!build || !window.CPlayerNative?.postMessage) return;
  const [, version, code] = build;
  const cached = readPreference(CACHE_KEY);
  let latest = previewRelease(cached?.tag, cached?.code, cached?.name, cached?.asset);
  if (latest) Object.assign(latest, { size: cached.size, sha256: /^[a-f0-9]{64}$/i.test(cached.sha256 || '') ? cached.sha256 : '', description: typeof cached.description === 'string' ? cached.description.slice(0,5000) : '' });
  let source = updateSource(readPreference(SOURCE_KEY)).id;
  let dismissed = readPreference(DISMISSED_KEY);
  let nextCheck = Math.min(Number(cached?.checked) || 0, Date.now()) + CHECK_INTERVAL;
  let retryAfter = 0, timer, checking = false, failed = false, foreground = true;
  let hasChecked = Boolean(cached?.checked), phase = 'idle', downloadController, received = 0, total = 0, route = '', downloadMessage = '';
  dom.androidUpdateSettings.hidden = false;
  if (dom.androidUpdateSource) dom.androidUpdateSource.value = source;
  const busy = () => ['downloading', 'verifying', 'installing'].includes(phase);
  const sizeText = bytes => `${(Number(bytes || 0) / 1048576).toFixed(1)} MB`;

  function render() {
    const available = latest && latest.code > Number(code);
    const announcement = available ? t('updateAvailable', { tag: latest.tag }) : '';
    dom.androidInstalledVersion.textContent = t('updateInstalled', { version });
    const progress = phase === 'downloading' ? t('updateDownloading', { route, percent: total ? Math.min(100,Math.floor(received/total*100)) : 0 }) : phase === 'verifying' ? t('updateVerifying') : '';
    dom.androidUpdateTitle.textContent = progress || announcement;
    dom.androidUpdateBanner.hidden = !available || (latest.code === dismissed && !busy());
    dom.androidUpdateStatus.textContent = progress || downloadMessage || (checking ? t('updateChecking') : failed ? t('updateFailed') : announcement || t(hasChecked ? 'updateCurrent' : 'updateNotChecked'));
    dom.androidReleaseName.textContent = available ? latest.name : '';
    dom.androidUpdateCheck.disabled = checking || busy();
    dom.androidUpdateDismiss.disabled = busy();
    dom.androidUpdateLinks.hidden = !available;
    if (dom.androidUpdateSource) dom.androidUpdateSource.disabled = checking || busy();
    if (dom.androidUpdateProgress) {
      dom.androidUpdateProgress.hidden = !['downloading','verifying'].includes(phase);
      dom.androidUpdateMeter.value = total ? Math.min(1,received / total) : 0;
      dom.androidUpdateTransfer.textContent = `${sizeText(received)} / ${sizeText(total)}`;
      dom.androidUpdateCancel.hidden = !['downloading','verifying'].includes(phase);
      dom.androidUpdateInstall.hidden = phase !== 'ready' && phase !== 'installing';
      dom.androidUpdateInstall.disabled = phase === 'installing';
      dom.androidUpdateDescription.hidden = !available || !latest.description;
      dom.androidUpdateDescription.textContent = available ? latest.description || '' : '';
    }
    if (available) {
      dom.androidUpdateDownload.href = updateDownloadUrl(latest.download, source);
      dom.androidSettingsDownload.href = updateDownloadUrl(latest.download, source);
      dom.androidReleaseNotes.href = latest.notes;
      const unavailable = busy() || (transport && (!latest.sha256 || !(latest.size > 0)));
      [dom.androidUpdateDownload,dom.androidSettingsDownload].forEach(link => { link.setAttribute?.('aria-disabled', String(Boolean(unavailable))); link.tabIndex = unavailable ? -1 : 0; });
      if (transport && !latest.sha256 && !checking && !failed && !downloadMessage) dom.androidUpdateStatus.textContent = t('updateMissingDigest');
    }
  }

  function schedule() {
    clearTimeout(timer);
    if (foreground && !document.hidden && !checking) timer = setTimeout(check, Math.max(0, nextCheck - Date.now()));
  }

  async function check(manual = false) {
    if (!foreground || document.hidden || checking || busy()) return;
    if (Date.now() < (manual ? retryAfter : nextCheck)) { schedule(); return; }
    checking = true;
    render();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), transport ? 45000 : 15000);
    try {
      const candidate = await latestAndroidRelease(transport ? (url, options) => transport.fetch(url, options, source) : fetch, controller.signal);
      if (latest?.code !== candidate?.code) { phase = 'idle'; downloadMessage = ''; }
      latest = candidate;
      hasChecked = true;
      failed = false;
      const checked = Date.now();
      savePreference(CACHE_KEY, { ...latest, checked, asset: latest?.download.split('/').pop() });
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

  async function download(event) {
    if (!transport) return;
    event.preventDefault();
    if (!latest || latest.code <= Number(code) || busy() || !latest.sha256 || !(latest.size > 0)) return;
    if (event.currentTarget === dom.androidUpdateDownload) {
      const settings = dom.mobileChartsSheet?.inert ? dom.mobileSettingsBtn : dom.mobileChartsSheet?.querySelector('[data-android-action="settings"]');
      settings?.click();
    }
    clearTimeout(timer); downloadController = new AbortController();
    const controller = downloadController;
    phase = 'downloading'; received = 0; total = latest.size; route = updateSource(source).label; downloadMessage = ''; render();
    try {
      await transport.download(latest, source, { signal: controller.signal, progress: state => {
        if (controller.signal.aborted) return;
        phase = state.phase === 'verifying' ? 'verifying' : 'downloading';
        received = Math.max(0,Number(state.received) || 0); total = Number(state.total) || latest.size; route = state.route || route; render();
      } });
      phase = 'ready'; downloadMessage = t('updateReady');
    } catch (error) {
      phase = 'idle'; downloadMessage = controller.signal.aborted ? t('updateCancelled') : error.message || t('updateDownloadFailed');
    } finally { downloadController = null; render(); schedule(); }
  }
  dom.androidUpdateDownload.addEventListener('click', download);
  dom.androidSettingsDownload.addEventListener('click', download);
  dom.androidUpdateCancel?.addEventListener('click', () => downloadController?.abort());
  dom.androidUpdateSource?.addEventListener('change', () => {
    source = updateSource(dom.androidUpdateSource.value).id; savePreference(SOURCE_KEY, source); render();
  });
  dom.androidUpdateInstall?.addEventListener('click', async () => {
    if (!transport || phase !== 'ready') return;
    phase = 'installing'; render();
    try {
      const result = await transport.install();
      downloadMessage = t(result.status === 'permission' ? 'updateInstallPermission' : 'updateInstallerOpened');
    } catch (error) { downloadMessage = error.message || t('updateDownloadFailed'); }
    finally { phase = 'ready'; render(); }
  });

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
