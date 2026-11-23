import assert from 'node:assert/strict';
import test from 'node:test';
import { initAndroidUpdates, latestAndroidRelease } from '../js/android-updates.js';

const repo = 'https://github.com/zcgg2001/CPlayer5/releases';
function release(tag, code, properties = {}) {
  const name = `CPlayer5-android-preview-${code}.apk`;
  return { tag_name: tag, name: `Android ${tag}`, published_at: '2026-11-18T12:00:00Z', assets: [
    { name, size: 7000000, state: 'uploaded', browser_download_url: `${repo}/download/${encodeURIComponent(tag)}/${name}` },
  ], ...properties };
}

test('checks every release page and orders Android previews by versionCode', async () => {
  const first = [release('v2.0.0', 10, { assets: [] }), release('v1.9.1', 4), release('v1.9.2', 12, { draft: true }), release('test', 11, { published_at: null })];
  const second = [release('android-v1.9.3-rc1', 10, { prerelease: true }), release('v1.9.0', 3)];
  let requests = 0;
  const result = await latestAndroidRelease(async (url, options) => {
    requests++;
    assert.equal(url, `https://api.github.com/repos/zcgg2001/CPlayer5/releases?per_page=100&page=${requests}`);
    assert.equal(options.credentials, 'omit');
    return requests === 1 ? Response.json(first, { headers: { Link: '<ignored>; rel="next"' } }) : Response.json(second);
  });
  assert.equal(requests, 2);
  assert.deepEqual(result, { tag: 'android-v1.9.3-rc1', code: 10, name: 'Android android-v1.9.3-rc1',
    size: 7000000, sha256: '', description: '',
    notes: `${repo}/tag/android-v1.9.3-rc1`, download: `${repo}/download/android-v1.9.3-rc1/CPlayer5-android-preview-10.apk` });
});

test('only offers complete preview APKs from this repository', async () => {
  const invalid = [
    { name: 'CPlayer5-android-preview.apk' }, { name: 'CPlayer5-android-preview-3.apk.zip' },
    { name: 'CPlayer5-android-preview-0.apk' }, { name: 'CPlayer5-android-preview-3100000000.apk' },
    { size: 0 }, { state: 'starter' }, { browser_download_url: 'https://example.org/app.apk' },
  ].map(asset => { const item = release('v1.9.0', 3); Object.assign(item.assets[0], asset); return item; });
  assert.equal(await latestAndroidRelease(() => Response.json(invalid)), null);
});

test('recognizes ZPlayer updates and prefers the new name when a legacy alias is also published', async () => {
  const current = release('v1.11.1', 8);
  const asset = { ...current.assets[0], name: 'ZPlayer-android-preview-8.apk',
    browser_download_url: `${repo}/download/v1.11.1/ZPlayer-android-preview-8.apk` };
  for (const assets of [[asset], [current.assets[0], asset], [asset, current.assets[0]]]) {
    const result = await latestAndroidRelease(() => Response.json([release('v1.11.0', 7), { ...current, assets }]));
    assert.equal(result.code, 8);
    assert.equal(result.download, asset.browser_download_url);
  }
  const invalid = [
    { ...asset, browser_download_url: 'https://example.org/ZPlayer-android-preview-8.apk' },
    { ...asset, name: 'ZPlayer-android-preview-8.apk.zip' },
    { ...asset, name: '../ZPlayer-android-preview-8.apk' },
    { ...asset, name: 'ZPlayer-android-preview-9.apk' },
  ];
  assert.equal(await latestAndroidRelease(() => Response.json([{ ...current, assets: invalid }])), null);
});

test('cached update links retain the published filename after restarting, including legacy caches', () => {
  const saved = Object.fromEntries(['navigator', 'window', 'document', 'localStorage'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let cached;
  try {
    for (const [key, value] of Object.entries({
      navigator: { userAgent: 'CPlayerAndroid/1.11.0-preview CPlayerPreview/7' },
      window: { CPlayerNative: { postMessage() {} }, addEventListener() {} },
      document: { hidden: true, addEventListener() {} },
      localStorage: { getItem: key => key === 'cp_android_release' ? JSON.stringify(cached) : null },
    })) Object.defineProperty(globalThis, key, { configurable: true, value });
    for (const asset of [undefined, 'CPlayer5-android-preview-8.apk', 'ZPlayer-android-preview-8.apk', '../ZPlayer-android-preview-8.apk', 'ZPlayer-android-preview-9.apk']) {
      cached = { tag: 'v1.11.1', code: 8, name: 'ZPlayer 1.11.1', checked: Date.now(), ...(asset && { asset }) };
      const dom = Object.fromEntries(['androidUpdateSettings', 'androidInstalledVersion', 'androidUpdateTitle', 'androidUpdateBanner', 'androidUpdateStatus', 'androidReleaseName', 'androidUpdateCheck', 'androidUpdateLinks', 'androidUpdateDownload', 'androidSettingsDownload', 'androidReleaseNotes', 'androidUpdateDismiss'].map(key => [key, { addEventListener() {} }]));
      initAndroidUpdates(dom);
      if (asset?.startsWith('../') || asset?.endsWith('-9.apk')) {
        assert.equal(dom.androidUpdateLinks.hidden, true);
        assert.equal(dom.androidUpdateDownload.href, undefined);
      } else {
        assert.equal(dom.androidUpdateLinks.hidden, false);
        assert.equal(dom.androidUpdateDownload.href, `https://gh-proxy.com/${repo}/download/v1.11.1/${asset || 'CPlayer5-android-preview-8.apk'}`);
      }
    }
  } finally {
    for (const [key, descriptor] of Object.entries(saved)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});

test('distinguishes an unavailable feed and a rate limit from an empty feed', async () => {
  assert.equal(await latestAndroidRelease(() => Response.json([])), null);
  await assert.rejects(latestAndroidRelease(() => Response.json({ message: 'error' })), /Invalid GitHub/);
  await assert.rejects(latestAndroidRelease(() => new Response(null, { status: 503 })), /503/);
  const time = Date.now();
  await assert.rejects(latestAndroidRelease(() => new Response(null, { status: 429, headers: { 'Retry-After': '60' } })),
    error => error.retryAt >= time + 60_000);
});
