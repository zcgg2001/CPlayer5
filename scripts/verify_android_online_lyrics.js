// Playwright CLI callback; run with the project served on 127.0.0.1:8793.
async (originalPage) => {
  const base = 'http://127.0.0.1:8793';
  const fixture = await (await originalPage.request.get(`${base}/tests/fixtures/online-lyrics.json`)).json();
  const context = await originalPage.context().browser().newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
  const page = await context.newPage(); await page.bringToFront();
  const errors = [], requests = [], primaryRequests = [], gates = new Map(), primaryGates = new Map();
  const gate = () => { let release; const ready = new Promise(resolve => { release = resolve; }); return { ready, release }; };
  for (const id of ['97773', '97774', '97775']) gates.set(id, gate());
  primaryGates.set('97773', gate());
  const lrc = '[00:01]风吹来\n[00:10]听见你\n[00:20]云散开';
  const wav = Buffer.alloc(44 + 45 * 8000 * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
  page.on('pageerror', error => errors.push(error.message));
  try {
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'lrclib.net') return route.fulfill({ json: [] });
    if (url.origin !== base) return route.abort();
    if (url.pathname === '/android-player/online-lyrics') {
      const id = url.searchParams.get('id'); requests.push(id); await gates.get(id)?.ready;
      if (url.searchParams.get('provider') === 'kugou') return route.fulfill({ json: { provider: 'kugou', id, encoding: 'krc-base64', lyric: fixture.krc } });
      if (id === '97776') return route.fulfill({ status: 502, json: {} });
      return route.fulfill({ json: { provider: 'qq', id, encoding: 'qrc-hex', lyric: fixture.qrc,
        translation: fixture.qrcTranslation, romanization: fixture.qrcRomanization } }).catch(() => {});
    }
    if (url.pathname === '/__lyrics-test.wav' || url.pathname === '/api/v1/music/audio') {
      const match = route.request().headers().range?.match(/bytes=(\d+)-(\d*)/);
      const start = Number(match?.[1] || 0), end = Math.min(Number(match?.[2] || wav.length - 1), wav.length - 1);
      return route.fulfill({ status: match ? 206 : 200, body: wav.subarray(start, end + 1), contentType: 'audio/wav',
        headers: { 'Accept-Ranges': 'bytes', 'Content-Length': String(end - start + 1), ...(match ? { 'Content-Range': `bytes ${start}-${end}/${wav.length}` } : {}) } });
    }
    if (url.pathname === '/api/v1/music/song') {
      const id = url.searchParams.get('id');
      return route.fulfill({ json: { code: 200, data: { id, name: `逐字验收 ${id}`, artist: '测试歌手', album: '原创测试', duration: 45,
        url: `${base}/__lyrics-test.wav`, cover: '', level: 'standard' } } });
    }
    if (url.pathname === '/api/v1/music/lyric') {
      const id = url.searchParams.get('id'); primaryRequests.push(id); await primaryGates.get(id)?.ready;
      return route.fulfill({ json: { code: 200, data: { lrc, tlrc: fixture.translation } } }).catch(() => {});
    }
    if (url.pathname === '/api/account/config') return route.fulfill({ json: { enabled: false } });
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { code: 200, data: [], items: [] } });
    return route.continue();
  });
  await page.addInitScript(() => {
    window.__lyricAudio = [];
    window.Audio = new Proxy(window.Audio, { construct(Target, args) {
      const audio = Reflect.construct(Target, args); window.__lyricAudio.push(audio); return audio;
    } });
  });
  await page.goto(`${base}/offline.html`);
  await page.evaluate(() => localStorage.setItem('cp_lyricAppearance', JSON.stringify({ effect: 'amll', fontSize: 30 })));
  await page.goto(`${base}/?app=android`);
  await page.waitForFunction(() => typeof window.insertSongToPlaylist === 'function');
  await page.locator('#entryGuest').click();
  await page.waitForFunction(() => document.querySelector('#mobileLyricsScroller')?.dataset.lyricRuntime === 'true');
  const play = id => page.evaluate(id => {
    let index = window.playlist.findIndex(song => song.id === id);
    if (index < 0) index = window.insertSongToPlaylist({ id, sourceId: id, provider: 'qq', name: `逐字验收 ${id}`, artist: '测试歌手', album: '原创测试', duration: 45 });
    void window.playSongAtIndex(index);
  }, id);
  const state = () => page.evaluate(() => ({ text: document.querySelector('#mobileLyricsScroller').textContent,
    words: document.querySelectorAll('#mobileLyricsScroller .lyric-timed-word').length,
    hasWords: document.querySelector('#mobileLyricsScroller').parentElement.querySelector('.lyric-source-badge').textContent.includes('逐字同步'),
    offset: document.querySelector('[data-lyric-setting=offset]').value,
    source: document.querySelector('.lyric-source-status').textContent, feedback: document.querySelector('#lyricEffectFeedback').textContent }));
  const waitText = value => page.waitForFunction(value => document.querySelector('#mobileLyricsScroller').textContent.includes(value), value);
  const waitWords = () => page.waitForFunction(() => document.querySelectorAll('#mobileLyricsScroller .lyric-timed-word').length === 9);
  const waitRequest = async (items, id) => {
    for (let i = 0; i < 100 && !items.includes(id); i++) await page.waitForTimeout(50);
    if (!items.includes(id)) throw Error('Missing request ' + id);
  };
  const checks = {};
  try {
    await play('97773'); await waitRequest(requests, '97773'); await waitRequest(primaryRequests, '97773');
    gates.get('97773').release(); await waitWords(); checks.independentOfSlowPrimary = true;
    primaryGates.get('97773').release();
    await page.waitForTimeout(200);
    if ((await state()).words !== 9) throw Error('LRC downgraded QRC'); checks.primaryCannotDowngrade = true;
    await page.evaluate(() => window.__lyricAudio.forEach(audio => audio.pause()));
    if (await page.locator('#mobileBrowseOpen').isVisible()) await page.locator('#mobileBrowseOpen').click();
    const cover = page.locator('.cover-carousel-card[aria-current=true]');
    if (await cover.isVisible()) await cover.click();
    else if (await page.locator('#mobileViewToggle').isVisible()) await page.locator('#mobileViewToggle').click();
    await page.waitForFunction(() => !document.getElementById('mobileLyricsPage').inert);
    await page.evaluate(() => { window.__lyricAudio.find(audio => audio.currentSrc.includes('__lyrics-test.wav')).currentTime = 2.3; });
    await page.waitForFunction(() => [...document.querySelectorAll('#mobileLyricsScroller .lyric-timed-word')]
      .some(word => word.textContent === '吹' && word.style.getPropertyValue('--word-progress') === '50.00%'));
    await page.screenshot({ path: 'output/playwright/android-online-word-lyrics.png', animations: 'disabled' });
    checks.realWordProgressAndPausedSeek = true;

    await play('97774'); await waitText('风吹来'); await waitRequest(requests, '97774');
    if ((await state()).hasWords) throw Error('LRC fabricated word timing'); checks.primaryDisplaysDuringSupplement = true;
    await page.locator('button[aria-label="打开设置"]').filter({ visible: true }).first().click();
    await page.locator('.android-settings-overview [data-preference="lyrics"]').click();
    await page.getByText('歌词与时间校正', { exact: true }).click();
    await page.locator('input[type=file][accept=".lrc,.yrc,.ttml,.qrc,.krc,.vtt,.txt"]').setInputFiles({
      name: 'manual.lrc', mimeType: 'text/plain', buffer: Buffer.from('[00:01]保留手动歌词\n[00:10]这是我的版本'),
    });
    await waitText('保留手动歌词');
    await page.locator('[data-lyric-setting=offset]').fill('650'); await page.locator('[data-lyric-setting=offset]').press('Tab');
    gates.get('97774').release();
    await page.waitForFunction(() => document.querySelector('#lyricEffectFeedback').textContent.includes('保留你选择'));
    if (!(await state()).text.includes('保留手动歌词') || (await state()).offset !== '650') throw Error('Supplement overwrote manual choices');
    checks.manualAndOffsetPreserved = true;
    await page.getByRole('button', { name: '恢复在线歌词', exact: true }).click(); await waitWords();
    if ((await state()).offset !== '650') throw Error('Restore reset calibration'); checks.restoreUsesLatestOnline = true;
    await page.getByRole('button', { name: '关闭设置', exact: true }).click();

    await play('97775'); await waitRequest(requests, '97775');
    await play('97776'); await waitRequest(requests, '97776'); await waitText('风吹来');
    gates.get('97775').release(); await page.waitForTimeout(250);
    if ((await state()).hasWords || (await state()).offset !== '0') throw Error('Old song contaminated new song');
    checks.fastSwitchAndFailureFallback = true;
    const before = requests.filter(id => id === '97773').length;
    primaryGates.set('97773', gate()); await play('97773'); await waitWords();
    if (requests.filter(id => id === '97773').length !== before) throw Error('Cached QRC was refetched');
    checks.cachedWordLyricsBeforeNetwork = true;
    await page.evaluate(async () => {
      const { channelTrackId } = await import('/js/music-channels.js?v=1');
      const sourceId = 'https://www.jbsou.cn/api.php?get=url&type=kg&id=0123456789abcdef0123456789abcdef';
      const index = window.insertSongToPlaylist({ id: channelTrackId('jianbin-kugou', sourceId), sourceId, provider: 'jianbin-kugou', name: '酷狗逐字验收', artist: '测试歌手', album: '原创测试', duration: 45 });
      void window.playSongAtIndex(index);
    });
    await page.waitForFunction(() => document.querySelector('.lyric-source-status').textContent.includes('KRC'));
    await waitWords();
    if (!(await state()).hasWords || !(await state()).source.includes('酷狗')) throw Error('KRC did not render as real words');
    checks.kugouNativeRouteAndDecode = true;
    const final = await state();
    if (errors.length) throw Error(errors.join('; '));
    return { checks, requests, errors, final };
  } catch (error) {
    await page.screenshot({ path: 'output/playwright/android-online-lyrics-failure.png' });
    throw Error(error.message + '\n' + JSON.stringify({ checks, requests, primaryRequests, errors, state: await state() }));
  } finally {
    for (const item of [...gates.values(), ...primaryGates.values()]) item.release();
    await context.close();
  }
  } catch (error) {
    const startup = page.isClosed() ? null : await page.evaluate(() => ({
      ready: document.readyState, player: typeof window.insertSongToPlaylist,
      runtime: document.querySelector('#mobileLyricsScroller')?.dataset.lyricRuntime,
    }));
    await context.close();
    throw Error(error.message + '\n' + JSON.stringify({ errors, startup }));
  }
}
