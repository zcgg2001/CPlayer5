// Run through Tabbit's browser-owned runtime; see docs/DEVELOPMENT.md.
// These fixtures test UI behavior without depending on live music providers.
const origin = 'http://127.0.0.1:8808';
const errors = [];
const recordError = error => errors.push(error.message);
page.on('pageerror', recordError);
let resolveHot, resolveNews, resolveSong, resolveAudio;
const hotGate = new Promise(resolve => { resolveHot = resolve; });
const newsGate = new Promise(resolve => { resolveNews = resolve; });
let songGate = new Promise(resolve => { resolveSong = resolve; });
let audioGate = new Promise(resolve => { resolveAudio = resolve; });
let rejectSong = true;
const track = { id: '771', sourceId: '771', name: '回归测试曲', artist: '测试艺人', album: '本地测试', provider: 'gd', duration: 30, cover: '', downloadAllowed: false };
const wav = Buffer.alloc(44 + 8000 * 2 * 30);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);

try {
await page.unrouteAll({ behavior: 'ignoreErrors' });
await page.goto(origin, { waitUntil: 'domcontentloaded' });
await page.evaluate(async () => {
  for (const registration of await navigator.serviceWorker.getRegistrations()) await registration.unregister();
  localStorage.clear();
});
await page.goto('about:blank');
await page.addInitScript(() => {
  if (location.search.includes('experience-test=1')) localStorage.clear();
});
await page.route(`${origin}/sw.js`, route => route.fulfill({ contentType: 'text/javascript', body: '' }));
await page.route(`${origin}/api/**`, async route => {
  const url = new URL(route.request().url());
  if (url.pathname === '/api/v1/discovery/playlist') {
    if (url.searchParams.get('id') === '3778678') await hotGate; else await newsGate;
    return route.fulfill({ json: { code: 200, tracks: [track], collection: { name: '测试榜单', trackCount: 1 } } });
  }
  if (url.pathname.endsWith('/song')) {
    await songGate;
    return rejectSong ? route.fulfill({ status: 502, json: { error: { code: 'gd_error', message: '测试音源暂时不可用' } } })
      : route.fulfill({ json: { code: 200, data: { ...track, url: `${origin}/experience-fixture.wav`, br: 128000, level: 'standard' } } });
  }
  if (url.pathname.endsWith('/lyric')) return route.fulfill({ json: { code: 200, data: { lrc: '[00:00.00]本地测试音频' } } });
  return route.fulfill({ json: { code: 200, data: [], items: [], editable: false, configured: false } });
});
await page.route(`${origin}/experience-fixture.wav`, async route => {
  await audioGate;
  await route.fulfill({ contentType: 'audio/wav', body: wav });
});
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${origin}/?experience-test=1`, { waitUntil: 'domcontentloaded' });
await expect(page.getByRole('heading', { name: '从一首喜欢的歌开始' })).toBeVisible();
await expect(page.locator('#mobileMetaContainer')).toBeHidden();
await page.getByRole('button', { name: '搜索歌曲', exact: true }).click();
await expect(page.locator('#mobileSearchInput')).toBeFocused();
await page.getByRole('button', { name: '关闭播放列表', exact: true }).click();
const chooserPending = page.waitForEvent('filechooser');
await page.getByRole('button', { name: '导入歌单', exact: true }).click();
const chooser = await chooserPending;
await chooser.setFiles({ name: 'experience.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify([track])) });
await expect(page.locator('#mobilePlaylistSheet')).toHaveAttribute('aria-hidden', 'false');
await expect(page.locator('#mobilePlaylistContainer')).toContainText('回归测试曲');
await page.getByRole('button', { name: '关闭播放列表', exact: true }).click();
await page.getByRole('button', { name: '浏览推荐', exact: true }).click();
await expect(page.locator('.discover-daily-count')).toHaveText('—');
await expect(page.locator('.discover-daily-card')).toContainText('正在整理今日推荐');
await expect(page.getByRole('heading', { name: '继续播放', exact: true })).toBeHidden();
assert.equal(await page.locator('.discover-skeleton').count(), 8);
resolveNews();
await expect(page.locator('.discover-daily-count')).toHaveText('1');
await expect(page.locator('.discover-home-status')).toContainText('正在更新推荐');
await expect(page.getByRole('button', { name: '播放今日推荐', exact: true })).toBeEnabled();
resolveHot();
await expect(page.locator('.discover-home-status')).not.toContainText('正在更新推荐');
await page.getByRole('button', { name: '播放 回归测试曲 · 测试艺人', exact: true }).first().click();
const feedback = page.locator('#mobileBrowsePlayer [data-player-feedback]');
await expect(feedback).toContainText('正在解析播放地址');
await expect(page.getByRole('status').filter({ hasText: '已添加并播放' })).toHaveCount(0);
resolveSong();
await expect(feedback).toContainText('测试音源暂时不可用');
await expect(feedback.getByRole('button', { name: '重试', exact: true })).toBeVisible();
rejectSong = false;
songGate = Promise.resolve();
await feedback.getByRole('button', { name: '重试', exact: true }).click();
await expect(feedback).toContainText('正在缓冲音频');
await expect(page.locator('#mobileBrowsePlay')).toBeDisabled();
resolveAudio();
await expect(feedback).toBeHidden({ timeout: 15000 });
await expect(page.locator('#mobileBrowsePlay')).toHaveAttribute('aria-label', '暂停');
await page.locator('#mobileBrowsePlay').click();
await expect(page.locator('#mobileBrowsePlay')).toHaveAttribute('aria-label', '播放');
// Simulate a browser declining autoplay once, then exercise the explicit resume action.
await page.evaluate(() => {
  const original = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    HTMLMediaElement.prototype.play = original;
    return Promise.reject(new DOMException('Gesture required', 'NotAllowedError'));
  };
});
await page.getByRole('button', { name: '播放 回归测试曲 · 测试艺人', exact: true }).first().click();
await expect(feedback).toContainText('歌曲已就绪');
await feedback.getByRole('button', { name: '开始播放', exact: true }).click();
await expect(page.locator('#mobileBrowsePlay')).toHaveAttribute('aria-label', '暂停');
await expect(feedback).toBeHidden();
await page.locator('#mobileBrowsePlay').click();
await page.getByRole('button', { name: '关闭排行榜', exact: true }).click();
await expect(page.locator('#mobileWelcome')).toBeHidden();
await expect(page.locator('#mobileMetaContainer')).toBeVisible();
assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
await page.setViewportSize({ width: 1440, height: 1000 });
await expect(page.locator('#desktopPlayerBar')).toBeVisible();
assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
assert.deepEqual(errors, []);
await page.unrouteAll({ behavior: 'wait' });
return { passed: true, checks: ['mobile entry, search and import', 'loading skeletons', 'independent chart results', 'playback resolution and buffering', 'failure and retry', 'actual audio playback', 'autoplay refusal and manual resume', 'desktop and mobile overflow'], errors };
} finally {
  resolveHot(); resolveNews(); resolveSong(); resolveAudio();
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  page.off('pageerror', recordError);
}
