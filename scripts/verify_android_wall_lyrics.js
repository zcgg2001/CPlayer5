// Playwright CLI callback; serve the project at 127.0.0.1:8794.
// Real wall taps and HTML audio; public/native responses use original test lyrics.
async originalPage => {
  const base = 'http://127.0.0.1:8794';
  const context = await originalPage.context().browser().newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await context.newPage(); await page.bringToFront();
  const checks = {}, requests = [], errors = [], modes = new Map(), audioGates = new Map(), lyricGates = new Map();
  const gate = () => { let release; const promise = new Promise(resolve => release = resolve); return { promise, release }; };
  const songs = Object.fromEntries(['900001', '900002', '900003', '900004', '900005', '900006'].map(id => [id, {
    id, sourceId: id, provider: 'gd', name: `墙上歌曲 ${id}`, artist: '测试歌手', album: '原创验收', duration: 60,
    cover: `${base}/design-preview/source-switch/cover.svg`,
  }]));
  const lrc = id => `[00:01]来自音乐墙 ${id}\n[00:10]跟随同一首歌曲\n[00:20]每一句都能找到`;
  const wav = Buffer.alloc(44 + 60 * 8000 * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('cp_lx_sources_v1', JSON.stringify({ enabled: false, primary: '', backup: '' }));
    localStorage.setItem('cp_playback_source', 'gd');
    localStorage.setItem('cp_lyricAppearance', JSON.stringify({ effect: 'plain', fontSize: 30 }));
    window.__wallLyricAudio = [];
    window.Audio = new Proxy(window.Audio, { construct(Target, args) {
      const audio = Reflect.construct(Target, args); window.__wallLyricAudio.push(audio); return audio;
    } });
  });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'lrclib.net') {
      requests.push({ kind: 'lookup', query: url.search });
      if (url.search.includes('900006')) {
        if (url.searchParams.has('track_name')) return route.fulfill({ status: 503, json: {} });
        return route.fulfill({ json: [{ trackName: songs['900006'].name, artistName: '测试歌手', albumName: '原创验收', duration: 60, syncedLyrics: lrc('900006') }] });
      }
      return route.fulfill({ json: [] });
    }
    if (url.origin !== base) return route.abort();
    const id = url.searchParams.get('id'), mode = modes.get(id);
    if (url.pathname === '/android-player/online-lyrics') {
      requests.push({ kind: 'native', id, provider: url.searchParams.get('provider') });
      await lyricGates.get(id)?.promise;
      if (['fallback', 'missing', 'community'].includes(mode)) return route.fulfill({ status: 502, json: {} }).catch(() => {});
      return route.fulfill({ json: { provider: 'netease', id, encoding: 'netease-json', lrc: lrc(id) } }).catch(() => {});
    }
    if (url.pathname === '/api/v1/music/lyric') {
      const provider = url.searchParams.get('source'); requests.push({ kind: 'primary', id, provider });
      await lyricGates.get(id)?.promise;
      return route.fulfill({ json: { code: 200, data: { lrc: mode === 'fallback' && provider === 'netease' ? lrc(id) : '' } } }).catch(() => {});
    }
    if (url.pathname === '/api/v1/music/song') {
      requests.push({ kind: 'song', id }); await audioGates.get(id)?.promise;
      return route.fulfill({ json: { code: 200, data: { ...songs[id], url: `${base}/__wall-lyrics/${id}.wav`, level: 'standard' } } }).catch(() => {});
    }
    if (url.pathname.startsWith('/__wall-lyrics/')) {
      const match = route.request().headers().range?.match(/bytes=(\d+)-(\d*)/);
      const start = Number(match?.[1] || 0), end = Math.min(Number(match?.[2] || wav.length - 1), wav.length - 1);
      return route.fulfill({ status: match ? 206 : 200, body: wav.subarray(start, end + 1), contentType: 'audio/wav',
        headers: { 'Accept-Ranges': 'bytes', ...(match ? { 'Content-Range': `bytes ${start}-${end}/${wav.length}` } : {}) } });
    }
    if (url.pathname === '/api/v1/discovery/playlist') return route.fulfill({ json: { code: 200, tracks: [songs['900001']], collection: { id, name: '音乐墙推荐验收' } } });
    if (url.pathname === '/api/account/config') return route.fulfill({ json: { enabled: false } });
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { code: 200, data: [], items: [] } });
    return route.continue();
  });
  const text = () => page.locator('#mobileLyricsScroller').textContent();
  const waitText = value => page.waitForFunction(value => document.getElementById('mobileLyricsScroller').textContent.includes(value), value);
  const waitAudio = id => page.waitForFunction(id => window.__wallLyricAudio.some(audio => audio.currentSrc.includes(`/${id}.wav`) && audio.readyState >= 2), id);
  async function playWall(id, mode, recommendation = false) {
    modes.set(id, mode);
    if (await page.locator('#mobileChartsSheet').getAttribute('aria-hidden') === 'true') await page.locator('#androidCollapsePlayer').click();
    await page.locator('#mobileChartsSheet [data-android-action=wall]').click();
    const root = page.locator('#mobileExploreWallPane');
    if (await root.locator('.wall-focus').isVisible()) await root.getByRole('button', { name: '收起封面', exact: true }).click();
    if (!recommendation) {
      await page.evaluate(song => { window.playlist.splice(0); window.insertSongToPlaylist(song); window.dispatchEvent(new Event('cplayer:library-changed')); }, songs[id]);
      await root.getByRole('button', { name: '队列', exact: true }).click();
    }
    await page.waitForFunction(id => [...document.querySelectorAll('.wall-tile[aria-hidden=false]')].some(node => node.textContent.includes(id)), id);
    await root.locator('.wall-viewport').focus(); await page.keyboard.press('Enter');
    if (!await page.locator('#musicWallSelectedTitle').textContent().then(value => value.includes(id))) throw Error('Wrong wall selection');
    await root.locator('.wall-focus').getByRole('button', { name: '播放', exact: true }).click();
  }
  try {
    await page.goto(`${base}/?app=android`); await page.waitForFunction(() => typeof window.insertSongToPlaylist === 'function');
    await page.locator('#entryGuest').click();
    audioGates.set('900001', gate());
    await playWall('900001', 'native', true);
    await waitText('来自音乐墙 900001');
    if (await page.evaluate(() => window.__wallLyricAudio.some(audio => audio.currentSrc.includes('900001')))) throw Error('Audio should still be preparing');
    audioGates.get('900001').release(); await waitAudio('900001');
    checks.recommendationWallNativeLyricsBeforeAudio = true;

    await playWall('900002', 'fallback'); await waitText('来自音乐墙 900002'); await waitAudio('900002');
    if (!requests.some(request => request.kind === 'primary' && request.id === '900002' && request.provider === 'netease')) throw Error('No same-ID lyric fallback');
    checks.emptyPrimaryRecoversFromSamePlatform = true;

    lyricGates.set('900003', gate()); await playWall('900003', 'native'); await waitAudio('900003');
    if ((await text()).includes('暂无歌词')) throw Error('Pending lyrics were incorrectly declared missing');
    await playWall('900004', 'native'); await waitText('来自音乐墙 900004');
    lyricGates.get('900003').release(); await page.waitForTimeout(100);
    if ((await text()).includes('900003')) throw Error('Late lyrics overwrote current song');
    checks.pendingStatusAndFastWallSelection = true;

    await playWall('900005', 'missing'); await waitText('暂未找到歌词，可重试补全'); await waitAudio('900005');
    if (await page.locator('#mobileBrowseOpen').isVisible()) await page.locator('#mobileBrowseOpen').click();
    await page.locator('.cover-carousel-card[aria-current=true]').click();
    await page.waitForFunction(() => !document.getElementById('mobileLyricsPage').inert);
    modes.set('900005', 'native');
    await page.locator('[data-lyric-lookup]:visible').first().click();
    await waitText('来自音乐墙 900005'); checks.missingResultCanRetryWithoutChangingSong = true;
    await page.waitForFunction(() => document.getElementById('copyToast').classList.contains('opacity-0'));
    await page.screenshot({ path: 'output/playwright/android-wall-lyrics-recovered.png', animations: 'disabled' });

    await playWall('900006', 'community'); await waitText('来自音乐墙 900006');
    checks.communityFallbackAfterFirstQueryFails = true;
    await playWall('900002', 'missing'); await waitText('来自音乐墙 900002');
    await page.waitForFunction(() => document.getElementById('lyricEffectFeedback').textContent.includes('继续显示已有歌词'));
    if (!(await text()).includes('来自音乐墙 900002')) throw Error('Empty refresh erased cached lyrics');
    checks.cachedLyricsSurviveEmptyRefresh = true;
    if (errors.length) throw Error(errors.join('; '));
    return { checks, requests, errors };
  } catch (error) {
    await page.screenshot({ path: 'output/playwright/android-wall-lyrics-failure.png' });
    throw Error(error.message + '\n' + JSON.stringify({ checks, requests, errors, text: await text() }));
  } finally {
    for (const entry of [...audioGates.values(), ...lyricGates.values()]) entry.release();
    await context.close();
  }
}
