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
const attempts = [];
const track = { id: '771', sourceId: '771', name: '回归测试曲', artist: '测试艺人', album: '本地测试', provider: 'gd', duration: 30, cover: '', downloadAllowed: false };
const wav = Buffer.alloc(44 + 8000 * 2 * 30);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);

try {
await page.unrouteAll({ behavior: 'ignoreErrors' });
await page.goto(`${origin}/offline.html`, { waitUntil: 'domcontentloaded' });
await page.evaluate(async () => {
  for (const registration of await navigator.serviceWorker.getRegistrations()) await registration.unregister();
  localStorage.clear();
});
await page.goto('about:blank');
await page.addInitScript(() => {
  if (location.search.includes('experience-test=1')) {
    localStorage.clear();
    navigator.serviceWorker.register = () => Promise.reject(new Error('Service worker disabled for fixture'));
    const NativeAudio = window.__NativeAudio || window.Audio; window.__NativeAudio = NativeAudio; window.__testAudio = [];
    window.Audio = class extends NativeAudio { constructor(...args) { super(...args); window.__testAudio.push(this); } };
  }
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
    const source = url.searchParams.get('source'), level = url.searchParams.get('level');
    attempts.push({source,level});
    if (rejectSong && source === 'chksz') return route.fulfill({status:503,json:{error:{code:'channel_error',message:'测试音源暂时不可用'}}});
    if (rejectSong && source === 'netease' && level === 'exhigh') return route.fulfill({json:{code:200,data:{id:track.id}}});
    const broken = rejectSong && source === 'netease' && level === 'lossless';
    return route.fulfill({json:{code:200,data:{...track, url:`${origin}/${broken?'broken':'experience'}-fixture.wav?source=${source}`,level,br:128000}}});
  }
  if (url.pathname.endsWith('/lyric')) return route.fulfill({ json: { code: 200, data: { lrc: '[00:00.00]本地测试音频' } } });
  if (url.pathname.endsWith('/search') && url.searchParams.get('keyword') === '选定音源测试') return route.fulfill({json:{code:200,data:[{...track,id:'772',name:'选定音源测试'}]}});
  return route.fulfill({ json: { code: 200, data: [], items: [], editable: false, configured: false } });
});
await page.route(`${origin}/broken-fixture.wav*`, route => route.fulfill({contentType:'audio/wav',body:Buffer.from('invalid audio data')}));
await page.route(`${origin}/experience-fixture.wav*`, async route => {
  await audioGate;
  const range=route.request().headers()['range']?.match(/^bytes=(\d+)-(\d*)$/);
  const start=range?Number(range[1]):0, end=range?.[2]?Math.min(Number(range[2]),wav.length-1):wav.length-1;
  await route.fulfill({ status:range?206:200,contentType:'audio/wav',headers:{'accept-ranges':'bytes',...(range?{'content-range':`bytes ${start}-${end}/${wav.length}`}:{})},body:wav.subarray(start,end+1) });
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
await expect(feedback).toContainText('正在尝试');
await expect(page.getByRole('status').filter({ hasText: '已添加并播放' })).toHaveCount(0);
resolveSong();
await expect.poll(() => attempts.length).toBeGreaterThanOrEqual(4);
assert.deepEqual(attempts.slice(0,4),[{source:'chksz',level:'jymaster'},{source:'netease',level:'lossless'},{source:'netease',level:'exhigh'},{source:'netease',level:'standard'}]);
await expect(feedback).toContainText('正在缓冲音频');
await expect(page.locator('#mobileBrowsePlay')).toBeDisabled();
resolveAudio();
await expect(feedback).toBeHidden({ timeout: 15000 });
await expect(page.locator('#mobileBrowsePlay')).toHaveAttribute('aria-label', '暂停');
// A real audio element has started. Simulate a dropped connection after seeking.
await page.evaluate(() => {
  const audio=window.__testAudio[0]; audio.currentTime=10;
  Object.defineProperty(audio,'error',{configurable:true,value:{code:2}});
  audio.dispatchEvent(new Event('error')); delete audio.error;
});
await expect.poll(() => attempts.some(x=>x.source==='gd')).toBe(true);
await expect(feedback).toBeHidden({timeout:15000});
await expect.poll(() => page.evaluate(()=>window.__testAudio[0].currentTime)).toBeGreaterThanOrEqual(10);
rejectSong=false;
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
// Search selections must survive the click-to-queue path on both layouts.
await page.getByRole('button',{name:'搜索音乐',exact:true}).click();
await page.getByRole('radio',{name:'QQ 音乐',exact:true}).filter({visible:true}).click();
await page.getByRole('radio',{name:'OP Music · QQ 音乐',exact:true}).filter({visible:true}).click();
await page.locator('#searchInput').fill('选定音源测试');await page.locator('#searchInput').press('Enter');
await expect(page.getByRole('button',{name:'加入并播放 选定音源测试',exact:true})).toBeVisible();
const desktopAttempt=attempts.length;
await page.getByRole('button',{name:'加入并播放 选定音源测试',exact:true}).click();
await expect.poll(()=>page.evaluate(()=>window.__testAudio[0].currentSrc)).toContain('source=op-qq');
assert.deepEqual(attempts.slice(desktopAttempt),[{source:'op-qq',level:'hires'}]);
await expect.poll(()=>page.evaluate(()=>window.__testAudio[0].currentTime)).toBeGreaterThan(0.1);
await page.evaluate(()=>window.__testAudio[0].pause());
await page.setViewportSize({width:390,height:844});
await page.getByRole('button',{name:'打开播放列表',exact:true}).click();
await page.getByRole('tab',{name:'搜索添加',exact:true}).click();
await page.getByRole('radio',{name:'网易云',exact:true}).filter({visible:true}).click();
await page.getByRole('radio',{name:'OP Music · 网易云',exact:true}).filter({visible:true}).click();
await page.locator('#mobileSearchInput').fill('选定音源测试');await page.locator('#mobileSearchInput').press('Enter');
await expect(page.locator('#mobileSearchResults')).toContainText('选定音源测试');
const mobileAttempt=attempts.length;
await page.locator('#mobileSearchResults').getByRole('button',{name:'添加并播放歌曲',exact:true}).click();
await expect.poll(()=>page.evaluate(()=>window.__testAudio[0].currentSrc)).toContain('source=op-netease');
assert.deepEqual(attempts.slice(mobileAttempt),[{source:'op-netease',level:'hires'}]);
await expect.poll(()=>page.evaluate(()=>window.__testAudio[0].currentTime)).toBeGreaterThan(0.1);
assert.deepEqual(errors, []);
await page.unrouteAll({ behavior: 'wait' });
return { passed: true, checks: ['mobile entry, search and import', 'loading skeletons', 'independent chart results', 'playback resolution and buffering', '503 automatic source switch', 'invalid media and quality downgrade', 'mid-playback recovery with position', 'actual audio playback', 'autoplay refusal and manual resume', 'desktop and mobile overflow', 'desktop search plays selected OP QQ', 'mobile search plays selected OP NetEase'], errors };
} finally {
  resolveHot(); resolveNews(); resolveSong(); resolveAudio();
  await page.evaluate(()=>{ for(const audio of window.__testAudio||[]) { audio.pause();audio.removeAttribute('src');audio.load(); } }).catch(()=>{});
  await page.goto('about:blank');
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  page.off('pageerror', recordError);
}
