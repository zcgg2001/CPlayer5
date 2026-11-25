// Playwright CLI run-code callback; serve the repo on 127.0.0.1:8793 first.
async (originalPage) => {
  const base = 'http://127.0.0.1:8793';
  const context = await originalPage.context().browser().newContext({
    serviceWorkers: 'block', viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  await page.bringToFront();
  const errors = [], songRequests = [], lyricRequests = [];
  let lookupRequests = 0;
  const songGates = new Map(), lyricGates = new Map();
  const gate = () => { let release; const ready = new Promise(resolve => { release = resolve; }); return { ready, release }; };
  songGates.set('123401', gate());
  for (const id of ['123401', '123402', '123403', '123404']) lyricGates.set(id, gate());
  const online = id => ({ lrc: `[00:01]在线更新 ${id}\n[00:10]这是更完整的在线歌词第二句\n[00:20]这是更完整的在线歌词第三句` });
  page.on('pageerror', error => errors.push(error.message));

  // Local silent audio keeps the real player lifecycle without calling music services.
  const wav = Buffer.alloc(44 + 45 * 8000 * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'lrclib.net') { lookupRequests++; return route.fulfill({ json: [] }); }
    if (url.origin !== base) return route.abort();
    if (url.pathname === '/__cache-test.wav' || url.pathname === '/api/v1/music/audio') {
      const match = route.request().headers().range?.match(/bytes=(\d+)-(\d*)/);
      const start = Number(match?.[1] || 0), end = Math.min(Number(match?.[2] || wav.length - 1), wav.length - 1);
      return route.fulfill({ status: match ? 206 : 200, body: wav.subarray(start, end + 1), contentType: 'audio/wav',
        headers: { 'Accept-Ranges': 'bytes', 'Content-Length': String(end - start + 1),
          ...(match ? { 'Content-Range': `bytes ${start}-${end}/${wav.length}` } : {}) } });
    }
    if (url.pathname === '/api/v1/music/song') {
      const id = url.searchParams.get('id'); songRequests.push(id);
      await songGates.get(id)?.ready;
      return route.fulfill({ json: { code: 200, data: { id, name: `缓存验收 ${id}`, artist: '测试歌手',
        album: '原创测试', duration: 45, url: `${base}/__cache-test.wav`, cover: '', level: 'standard' } } });
    }
    if (url.pathname === '/api/v1/music/lyric') {
      const id = url.searchParams.get('id'); lyricRequests.push(id);
      const response = await lyricGates.get(id)?.ready;
      return route.fulfill(response || { json: { code: 200, data: online(id) } }).catch(() => {});
    }
    if (url.pathname === '/api/account/config') return route.fulfill({ json: { enabled: false } });
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { code: 200, data: [], items: [] } });
    return route.continue();
  });
  await page.addInitScript(() => {
    window.__cacheAudio = [];
    window.Audio = new Proxy(window.Audio, { construct(Target, args) {
      const audio = Reflect.construct(Target, args); window.__cacheAudio.push(audio); return audio;
    } });
  });
  await page.goto(`${base}/offline.html`);
  await page.evaluate(async () => {
    const { parseLyricsPayload } = await import('/js/lyrics/document.js');
    localStorage.setItem('cp_lyricAppearance', JSON.stringify({ effect: 'plain', fontSize: 30 }));
    localStorage.setItem('cp_lyricTracks_v1', JSON.stringify(['123401', '123402', '123403'].map(id => ({
      key: `netease:${id}`, offset: id === '123401' ? 300 : 0,
      onlineDocument: parseLyricsPayload({ lrc: `[00:01]本机缓存 ${id}\n[00:10]离线也能读到`, source: '本机验收样本' }),
    }))));
  });
  await page.goto(`${base}/?app=android`);
  await page.waitForFunction(() => typeof window.insertSongToPlaylist === 'function');
  await page.locator('#entryGuest').click();
  await page.waitForFunction(() => document.querySelector('#mobileLyricsScroller')?.dataset.lyricRuntime === 'true');
  const play = id => page.evaluate(id => {
    let index = window.playlist.findIndex(song => song.id === id);
    if (index < 0) index = window.insertSongToPlaylist({ id, sourceId: id, provider: 'gd', name: `缓存验收 ${id}`,
      artist: '测试歌手', album: '原创测试', duration: 45 });
    void window.playSongAtIndex(index);
  }, id);
  const waitText = text => page.waitForFunction(text =>
    document.querySelector('#mobileLyricsScroller')?.textContent.includes(text), text, { timeout: 10000 });
  const snapshot = () => page.evaluate(() => ({
    text: document.querySelector('#mobileLyricsScroller').textContent,
    offset: document.querySelector('[data-lyric-setting=offset]').value,
    feedback: document.getElementById('lyricEffectFeedback').textContent,
    effect: document.documentElement.dataset.lyricEffect,
  }));
  const waitRequest = async (requests, id) => {
    for (let attempt = 0; attempt < 100 && !requests.includes(id); attempt++) await page.waitForTimeout(50);
    if (!requests.includes(id)) throw Error(`Request did not start: ${id}`);
  };
  const checks = {};
  try {
    await play('123401');
    await waitRequest(songRequests, '123401');
    await waitText('本机缓存 123401');
    if (lyricRequests.length || (await snapshot()).offset !== '300') throw Error('Cache must render before song resolution');
    checks.beforeSongResolution = true;
    songGates.get('123401').release();
    await waitRequest(lyricRequests, '123401');
    await waitText('本机缓存 123401');
    if (lookupRequests) throw Error('Supplemental lookup started before the primary response');
    checks.beforeLyricResponse = true;
    lyricGates.get('123401').release();
    await waitText('在线更新 123401');
    if ((await snapshot()).offset !== '300') throw Error('Background refresh reset the saved offset');
    checks.backgroundRefresh = true;

    // Import and adjust while the provider is still pending, with lyric storage unavailable.
    await play('123402');
    await waitRequest(lyricRequests, '123402');
    await waitText('本机缓存 123402');
    await page.locator('button[aria-label="打开设置"]:not([inert] *)').filter({ visible: true }).first().click();
    await page.locator('.android-settings-overview [data-preference="lyrics"]').click();
    await page.getByText('歌词与时间校正', { exact: true }).click();
    await page.evaluate(() => {
      window.__cacheSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === 'cp_lyricTracks_v1') throw new DOMException('Fixture quota full', 'QuotaExceededError');
        return window.__cacheSetItem.call(this, key, value);
      };
    });
    await page.locator('input[type=file][accept=".lrc,.yrc,.ttml,.qrc,.krc,.vtt,.txt"]').setInputFiles({
      name: 'pending-manual.lrc', mimeType: 'text/plain', buffer: Buffer.from('[00:01]请求期间手动导入\n[00:10]保留我的选择'),
    });
    await waitText('请求期间手动导入');
    await page.locator('[data-lyric-setting=offset]').fill('650');
    await page.locator('[data-lyric-setting=offset]').press('Tab');
    await page.getByLabel('歌词效果', { exact: true }).selectOption('monet');
    lyricGates.get('123402').release();
    await page.waitForFunction(() => document.getElementById('lyricEffectFeedback').textContent.includes('保留你选择'));
    const manual = await snapshot();
    if (!manual.text.includes('请求期间手动导入') || manual.offset !== '650' || manual.effect !== 'monet') {
      throw Error('Pending response replaced user choices: ' + JSON.stringify(manual));
    }
    await page.evaluate(() => { Storage.prototype.setItem = window.__cacheSetItem; });
    await page.getByRole('button', { name: '关闭设置', exact: true }).click();
    checks.pendingManualAndSettings = true;

    await play('123403');
    await waitRequest(lyricRequests, '123403');
    await waitText('本机缓存 123403');
    await play('123404');
    await waitRequest(lyricRequests, '123404');
    const empty = await snapshot();
    if (empty.text.includes('123403') || empty.offset !== '0' || lookupRequests) throw Error('New track inherited old lyrics or lookup');
    lyricGates.get('123404').release();
    await waitText('在线更新 123404');
    lyricGates.get('123403').release({ json: { code: 200, data: { lrc: '[00:01]不应出现的旧请求' } } });
    await page.waitForTimeout(150);
    if ((await snapshot()).text.includes('不应出现')) throw Error('Old request replaced the current song');
    checks.fastSwitchAndUncachedSong = true;

    const failure = gate(); failure.release({ status: 503, json: { error: 'fixture unavailable' } });
    lyricGates.set('123401', failure);
    await play('123401');
    await waitText('在线更新 123401');
    await page.waitForFunction(() => document.getElementById('lyricEffectFeedback').textContent.includes('继续显示已有歌词'));
    checks.failedRefreshRetainsCache = true;
    await page.evaluate(() => window.__cacheAudio.forEach(audio => audio.pause()));
    // Open the actual Android lyrics surface for visual inspection.
    const mini = page.locator('#mobileBrowseOpen');
    if (await mini.isVisible()) await mini.click();
    const cover = page.locator('.cover-carousel-card[aria-current=true]');
    if (await cover.isVisible()) await cover.click();
    else if (await page.locator('#mobileViewToggle').isVisible()) await page.locator('#mobileViewToggle').click();
    await page.waitForFunction(() => !document.getElementById('mobileLyricsPage').inert);
    await page.evaluate(() => { window.__cacheAudio.find(audio => audio.currentSrc.includes('__cache-test.wav')).currentTime = 2; });
    await page.waitForFunction(() => [...document.querySelector('#mobileLyricsScroller').parentElement.querySelectorAll('[data-state=active]')]
      .some(node => node.checkVisibility() && node.textContent.includes('在线更新 123401')));
    checks.pausedRevealAndSeek = true;
    await page.screenshot({ path: 'output/playwright/android-lyric-cache.png', animations: 'disabled' });
    if (errors.length) throw Error('Uncaught browser errors: ' + errors.join('; '));
    return { checks, lookupRequests, errors, final: await snapshot() };
  } catch (error) {
    await page.screenshot({ path: 'output/playwright/android-lyric-cache-failure.png' });
    const rendered = await page.evaluate(() => ({
      hidden: document.hidden,
      ancestors: (() => { const nodes = []; let node = document.querySelector('#mobileLyricsScroller').parentElement; while (node) { nodes.push({ id: node.id, cls: node.className, hidden: node.getAttribute('aria-hidden'), inert: node.inert, visible: node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) }); node = node.parentElement; } return nodes; })(),
      audio: window.__cacheAudio.map(audio => ({ time: audio.currentTime, duration: audio.duration, ready: audio.readyState, paused: audio.paused, src: audio.src })),
      stage: [...document.querySelector('#mobileLyricsScroller').parentElement.querySelectorAll('.lyric-stage-line')]
        .map(node => ({ text: node.textContent, state: node.dataset.state })),
    }));
    throw Error(error.message + '\n' + JSON.stringify({ checks, songRequests, lyricRequests, lookupRequests, errors, state: await snapshot(), rendered }));
  } finally {
    for (const item of [...songGates.values(), ...lyricGates.values()]) item.release();
    await context.close();
  }
}
