// Playwright CLI run-code callback; serve the repository on 127.0.0.1:8793.
async (originalPage) => {
  const base = 'http://127.0.0.1:8793';
  const context = await originalPage.context().browser().newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
  const page = await context.newPage(); await page.bringToFront();
  const errors = [], queries = [], failed = [], consoleErrors = []; page.on('pageerror', error => errors.push(error.message));
  page.on('requestfailed', request => failed.push({ url: request.url(), error: request.failure()?.errorText }));
  page.on('console', item => { if (item.type() === 'error') consoleErrors.push(item.text()); });
  const gates = new Map(), requested = new Set();
  const gate = () => { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; };
  const row = (id, album, title = '封面验收', artist = '测试歌手') => ({ kind: 'song', trackId: Number(id) + 1,
    collectionId: Number(id), trackName: title, artistName: artist, collectionName: album, trackTimeMillis: 45000,
    artworkUrl100: `https://is1-ssl.mzstatic.com/image/thumb/Music/v4/${id}/100x100bb.jpg` });
  // Generated, local PNGs: distinct colours identify the selected release without real album art.
  await page.goto(`${base}/offline.html`);
  const images = await page.evaluate(() => ['#7651a8', '#2f8c86', '#c9854d'].map(color => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 160;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = color; ctx.fillRect(0, 0, 160, 160);
    ctx.strokeStyle = 'white'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(80, 80, 50, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = 'white'; ctx.font = '48px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('♪', 80, 97);
    return canvas.toDataURL('image/png').split(',')[1];
  }));
  const wav = Buffer.alloc(44 + 45 * 8000 * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'itunes.apple.com') {
      const term = url.searchParams.get('term'); queries.push(term); requested.add(term);
      if (gates.has(term)) await gates.get(term).promise;
      return route.fulfill({ json: { results: [row('201', '原创测试'), row('202', '精选集'),
        row('203', '现场专辑', '封面验收 (Live)'), row('204', '原创测试', '封面验收', '另一位歌手')] } }).catch(() => {});
    }
    if (url.origin !== base) return route.abort();
    if (url.pathname === '/api/cover') {
      const target = url.searchParams.get('url') || '';
      const colour = target.includes('/201/') ? 0 : target.includes('/202/') ? 1 : target.includes('working.jpg') ? 2 : -1;
      if (colour < 0) return route.fulfill({ status: 404, body: '' });
      return route.fulfill({ contentType: 'image/png', body: Buffer.from(images[colour], 'base64') });
    }
    if (url.pathname === '/__cover-test.wav' || url.pathname === '/api/v1/music/audio') {
      const match = route.request().headers().range?.match(/bytes=(\d+)-(\d*)/);
      const start = Number(match?.[1] || 0), end = Math.min(Number(match?.[2] || wav.length - 1), wav.length - 1);
      return route.fulfill({ status: match ? 206 : 200, contentType: 'audio/wav', body: wav.subarray(start, end + 1),
        headers: { 'Accept-Ranges': 'bytes', 'Content-Length': String(end - start + 1), ...(match ? { 'Content-Range': `bytes ${start}-${end}/${wav.length}` } : {}) } });
    }
    if (url.pathname === '/api/v1/music/song') return route.fulfill({ json: { code: 200, data: {
      id: url.searchParams.get('id'), name: '封面验收', artist: '测试歌手', album: '原创测试', duration: 45, cover: '', level: 'standard', url: `${base}/__cover-test.wav`,
    } } });
    if (url.pathname === '/api/v1/music/lyric') return route.fulfill({ json: { code: 200, data: { lrc: '[00:01]封面独立加载\n[00:12]歌词继续播放' } } });
    if (url.pathname === '/api/v1/music/metadata') return route.fulfill({ status: 404, json: { code: 404 } });
    if (url.pathname === '/api/account/config') return route.fulfill({ json: { enabled: false } });
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { code: 200, data: [], items: [] } });
    return route.continue();
  });
  await page.addInitScript(() => {
    window.__coverAudio = [];
    window.Audio = new Proxy(window.Audio, { construct(Target, args) { const audio = Reflect.construct(Target, args); window.__coverAudio.push(audio); return audio; } });
  });
  const load = async () => {
    await page.goto(`${base}/?app=android`); await page.locator('#entryGuest').click();
    await page.waitForFunction(() => document.querySelector('#mobileLyricsScroller')?.dataset.lyricRuntime === 'true');
  };
  const play = async (id, extra = {}) => page.evaluate(({ id, extra }) => {
    let index = window.playlist.findIndex(song => song.id === id);
    if (index < 0) index = window.insertSongToPlaylist({ id, sourceId: id, provider: 'gd', name: '封面验收', artist: '测试歌手', album: '原创测试', duration: 45, ...extra });
    return window.playSongAtIndex(index);
  }, { id, extra });
  const settings = async () => {
    const discovery = page.locator('#mobileChartsSheet [data-android-action=settings]');
    if (await discovery.isVisible()) await discovery.click();
    else await page.locator('#mobileSettingsBtn').click();
    await page.waitForFunction(() => document.getElementById('settingsModal').getAttribute('aria-hidden') === 'false');
    await page.locator('.android-settings-overview [data-preference="player"]').click();
    const details = page.locator('.cover-recovery-details');
    if (!await details.evaluate(node => node.open)) await details.locator('summary').click();
  };
  const coverIs = value => page.waitForFunction(value => ['albumArt', 'mobileCoverImg', 'mobileBrowseCover'].every(id =>
    decodeURIComponent(document.getElementById(id)?.getAttribute('src') || '').includes(value)), value);
  const checks = {};
  try {
    await load();
    gates.set('封面验收 测试歌手', gate());
    await play('90101');
    await page.waitForFunction(() => document.querySelector('#mobileLyricsScroller').textContent.includes('封面独立加载'));
    if (!await page.evaluate(() => window.__coverAudio.some(audio => audio.readyState >= 2 && !audio.paused))) throw Error('Art lookup blocked audio');
    for (let i = 0; i < 100 && !requested.has('封面验收 测试歌手'); i++) await page.waitForTimeout(50);
    if (!requested.has('封面验收 测试歌手')) throw Error('Missing-cover lookup never started');
    gates.get('封面验收 测试歌手').release();
    await coverIs('/201/');
    checks.autoRecoveryWithoutBlockingPlayback = true;
    await settings();
    await page.getByRole('button', { name: '查找封面', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.cover-choice').length === 2);
    await page.locator('[data-cover-results]').scrollIntoViewIfNeeded();
    await page.waitForFunction(() => [...document.querySelectorAll('.cover-choice img')].every(image => image.complete && image.naturalWidth > 0));
    await page.screenshot({ path: 'output/playwright/android-cover-candidates.png', animations: 'disabled' });
    await page.getByRole('button', { name: '使用《精选集》封面', exact: true }).click();
    await coverIs('/202/');
    await page.waitForFunction(() => document.querySelector('[data-cover-status]').textContent.includes('已记住'));
    if (queries.length !== 1) throw Error('Same-song catalogue request was not reused');
    checks.manualChoiceAndSharedSurfaces = true;
    await page.getByRole('button', { name: '关闭设置', exact: true }).click();
    await load(); await play('90101'); await coverIs('/202/');
    if (queries.length !== 1) throw Error('Saved manual choice triggered a new search');
    checks.manualChoiceSurvivesReload = true;
    await settings(); await page.getByRole('button', { name: '恢复原封面', exact: true }).click();
    await coverIs('data:image/svg');
    await page.waitForFunction(() => document.querySelector('[data-cover-status]').textContent.includes('不再自动补图'));
    await page.getByRole('button', { name: '关闭设置', exact: true }).click();
    await play('90102', { cover: 'https://p1.music.126.net/working.jpg' }); await coverIs('working.jpg');
    await play('90101'); await coverIs('data:image/svg');
    if (queries.length !== 1) throw Error('Restored original should suppress auto recovery');
    checks.restoreAndWorkingCoverAvoidLookup = true;
    await settings(); await page.locator('[data-cover-auto]').uncheck();
    await page.getByRole('button', { name: '关闭设置', exact: true }).click();
    await play('90103', { name: '另一首歌曲' });
    await page.waitForFunction(() => document.querySelector('#mobileLyricsScroller').textContent.includes('封面独立加载'));
    if (queries.length !== 1) throw Error('Disabled automatic lookup still made requests');
    checks.autoLookupSwitch = true;
    await settings();
    await page.setViewportSize({ width: 320, height: 740 });
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw Error('Narrow settings overflow');
    if (errors.length) throw Error('Browser errors: ' + errors.join('; '));
    return { checks, searches: queries.length, errors };
  } catch (error) {
    await page.screenshot({ path: 'output/playwright/android-cover-recovery-failure.png' });
    throw Error(error.message + '\n' + JSON.stringify({ checks, queries, errors, failed, consoleErrors,
      state: await page.evaluate(() => ({ status: document.querySelector('[data-cover-status]')?.textContent, cover: document.getElementById('albumArt')?.getAttribute('src'), stored: localStorage.getItem('zp_artwork_choices_v1') })) }));
  } finally {
    for (const item of gates.values()) item.release();
    await context.close();
  }
}
