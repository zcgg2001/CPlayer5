// Playwright CLI callback: actual NetEase catalog/CDN bytes, simulated proxy outage.
// Serve this repository on 127.0.0.1:8793. No remote music is played or saved.
async (originalPage) => {
  const base = 'http://127.0.0.1:8793';
  const context = await originalPage.context().browser().newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await context.newPage(), errors = [], requests = [], checks = {};
  let offline = false;
  page.on('pageerror', error => errors.push(error.message));
  try {
    const response = await context.request.get('https://music.163.com/api/playlist/detail?id=3778678', { timeout: 20000 });
    if (!response.ok()) throw Error('Real catalog unavailable: ' + response.status());
    const catalog = await response.json();
    const songs = catalog.result.tracks.filter(s => s.album?.picUrl).slice(0, 26).map(s => ({
      id: String(s.id), provider: 'gd', name: s.name, artist: s.artists.map(a => a.name).join(' / '),
      album: s.album.name, cover: s.album.picUrl.replace(/^http:/, 'https:'), duration: s.duration / 1000,
    }));
    if (songs.length < 26) throw Error('Real catalog sample too small');
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname.endsWith('.music.126.net')) {
        requests.push({ route: 'cdn', url: url.href, offline });
        return offline ? route.abort() : route.continue();
      }
      if (url.origin !== base) return route.abort();
      if (url.pathname === '/api/cover') { requests.push({ route: 'proxy', url: url.href, offline }); return route.fulfill({ status: 502, json: { error: 'Simulated proxy outage' } }); }
      if (url.pathname === '/api/account/config') return route.fulfill({ json: { enabled: false } });
      if (url.pathname === '/api/v1/discovery/playlist') return route.fulfill({ json: { code: 200, tracks: songs.slice(0, 24), collection: { id: url.searchParams.get('id'), name: '真实榜单封面验收' } } });
      if (url.pathname === '/api/v1/music/metadata') return route.fulfill({ status: 404, json: {} });
      if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { code: 200, data: [], items: [] } });
      return route.continue();
    });
    await page.goto(base + '/?app=android');
    await page.waitForFunction(() => typeof window.insertSongToPlaylist === 'function');
    await page.locator('#entryGuest').click();
    await page.locator('#mobileChartsSheet [data-android-action=wall]').click();
    const root = page.locator('#mobileExploreWallPane');
    const status = () => root.evaluate(n => {
      const images = [...n.querySelectorAll('.wall-tile[aria-hidden=false] img')];
      return { total: images.length, ready: images.filter(i => i.dataset.artworkState === 'ready' && i.complete && i.naturalWidth > 0 && !i.src.startsWith('data:')).length,
        fallback: images.filter(i => i.dataset.artworkState === 'fallback').length, loading: images.filter(i => i.dataset.artworkState === 'loading').length };
    });
    const waitState = async state => {
      await page.waitForFunction(state => {
        const images = [...document.querySelectorAll('#mobileExploreWallPane .wall-tile[aria-hidden=false] img')];
        return images.length > 8 && images.every(i => i.dataset.artworkState === state && i.complete && i.naturalWidth > 0 && (state !== 'ready' || !i.src.startsWith('data:')));
      }, state, { timeout: 30000 });
    };
    await waitState('ready'); checks.realRecommendationCoversWithProxyDown = await status();
    await page.screenshot({ path: 'output/playwright/android-infinite-wall-real-covers.png' });
    const viewport = root.locator('.wall-viewport'), b = await viewport.boundingBox();
    await page.mouse.move(b.x + b.width / 2,b.y + b.height / 2); await page.mouse.wheel(2100,2500);
    await waitState('ready'); checks.realCoversAfterLongPan = await status();
    await viewport.focus(); await page.keyboard.press('Enter');
    await root.locator('.wall-focus img').evaluate(i => i.decode());
    await page.waitForFunction(() => document.querySelector('.wall-focus img')?.dataset.artworkState === 'ready');
    await page.screenshot({ path: 'output/playwright/android-infinite-wall-real-focus.png' });
    await page.keyboard.press('Escape');
    const setQueue = async song => {
      await page.evaluate(song => { window.playlist.splice(0); window.insertSongToPlaylist(song); window.dispatchEvent(new Event('cplayer:library-changed')); }, song);
    };
    offline = true; await setQueue(songs[24]);
    await root.getByRole('button', { name: '队列', exact: true }).click();
    await waitState('fallback');
    offline = false; await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await waitState('ready'); checks.offlineToOnlineRecovery = await status();
    offline = true; await setQueue(songs[25]); await waitState('fallback');
    offline = false; await root.getByRole('button', { name: '重新加载封面', exact: true }).click();
    await waitState('ready'); checks.manualRetryRecovery = await status();
    if (errors.length) throw Error(errors.join('; '));
    return { checks, requests: { proxy: requests.filter(r => r.route === 'proxy').length, cdn: requests.filter(r => r.route === 'cdn').length }, errors };
  } catch (error) {
    await page.screenshot({ path: 'output/playwright/android-infinite-wall-real-covers-failure.png' });
    const state = await page.locator('#mobileExploreWallPane').evaluate(n => [...n.querySelectorAll('img')].slice(0,60).map(i => ({ state:i.dataset.artworkState,src:i.src.startsWith('data:')?'fallback':i.src }))).catch(()=>[]);
    throw Error(error.message + '\n' + JSON.stringify({ checks, state, errors, requests:requests.slice(-10) }));
  } finally { await context.close(); }
}
