// Playwright CLI callback. Serve the repository on 127.0.0.1:8793 first.
async (originalPage) => {
  const base = 'http://127.0.0.1:8793';
  const context = await originalPage.context().browser().newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await context.newPage(); await page.bringToFront();
  const errors = [], checks = {}; page.on('pageerror', error => errors.push(error.message));
  let maximumTiles = 0;
  try {
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== base) return route.abort();
      if (url.pathname === '/api/account/config') return route.fulfill({ json: { enabled: false } });
      if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { code: 200, data: [], items: [] } });
      return route.continue();
    });
    await page.goto(`${base}/offline.html`);
    await page.evaluate(() => localStorage.setItem('zp_music_wall_v1', JSON.stringify({ source: 'queue' })));
    await page.goto(`${base}/?app=android`);
    await page.waitForFunction(() => typeof window.insertSongToPlaylist === 'function');
    await page.locator('#entryGuest').click();
    await page.waitForFunction(() => document.querySelector('.wall-viewport'));
    // Original abstract test covers. They never become product seed content.
    await page.evaluate(() => {
      const titles = ['风吹过的海', '蓝色时刻', '晚风来信', '城市漫游', '在路上', '日光倾城', '慢慢喜欢你', '月亮与海', '独白', '山间回声', '雨后', '自由生长'];
      window.__wallTestSongs = Array.from({ length: 120 }, (_, index) => {
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 300;
        const c = canvas.getContext('2d'), hue = (index * 73) % 360;
        const g = c.createLinearGradient(0, 0, 260, 300); g.addColorStop(0, `hsl(${hue} 45% 70%)`); g.addColorStop(1, `hsl(${hue + 55} 55% 22%)`);
        c.fillStyle = g; c.fillRect(0, 0, 300, 300);
        c.globalAlpha = .65; c.fillStyle = index % 2 ? '#eddbbe' : '#152c4a';
        c.beginPath(); c.arc(80 + index % 3 * 60, 135, 100, 0, 2 * Math.PI); c.fill();
        c.globalAlpha = .7; c.strokeStyle = '#ffffff'; c.lineWidth = index % 3 + 1;
        for (let j = 0; j < 6; j++) { c.beginPath(); c.arc(150, 155, 50 + j * 18, 0, Math.PI * (1.2 + index % 3 * .25)); c.stroke(); }
        c.globalAlpha = 1; c.fillStyle = '#fff'; c.font = '700 25px sans-serif'; c.fillText(titles[index % titles.length], 20, 42);
        c.font = '12px sans-serif'; c.fillText('ZPLAYER  /  ORIGINAL TEST ART', 20, 276);
        return { id: `wall-${index}`, provider: 'local', name: titles[index % titles.length] + ` ${index + 1}`, artist: '独立音乐人', cover: canvas.toDataURL('image/jpeg', .8), duration: 180 };
      });
      for (const song of window.__wallTestSongs) window.insertSongToPlaylist(song);
    });
    await page.locator('#mobileChartsSheet [data-android-action=wall]').click();
    const root = page.locator('#mobileExploreWallPane'), viewport = root.locator('.wall-viewport');
    await page.waitForFunction(() => document.querySelectorAll('.wall-tile').length > 10);
    const snapshot = () => root.evaluate(node => ({ x: +node.dataset.wallX, y: +node.dataset.wallY, zoom: +node.dataset.wallZoom,
      tiles: node.querySelectorAll('.wall-tile').length, focused: !node.querySelector('.wall-focus').hidden,
      keys: [...node.querySelectorAll('.wall-tile')].map(t => t.dataset.wallCell).sort() }));
    const coverage = async () => {
      const result = await viewport.evaluate(node => {
        const v = node.getBoundingClientRect(), tiles = [...node.querySelectorAll('.wall-tile')].map(n => n.getBoundingClientRect());
        let holes = 0;
        for (let y = 0; y <= v.height; y += v.height / 8) for (let x = 0; x <= v.width; x += v.width / 8)
          if (!tiles.some(t => x + v.left >= t.left - 7 && x + v.left <= t.right + 7 && y + v.top >= t.top - 7 && y + v.top <= t.bottom + 7)) holes++;
        return { holes, count: tiles.length, height: v.height, width: v.width, scrollWidth: node.scrollWidth };
      });
      maximumTiles = Math.max(maximumTiles, result.count);
      if (result.holes || result.count > 240 || result.height < 100) throw Error('Wall coverage failed: ' + JSON.stringify(result));
    };
    await coverage();
    if (await page.locator('.wall-pager').count()) throw Error('Wall still has pagination');
    checks.edgeToEdgeMosaic = true;
    await page.screenshot({ path: 'output/playwright/android-infinite-wall.png', animations: 'disabled' });
    const initial = await snapshot();
    const wheel = async (dx, dy) => {
      const b = await viewport.boundingBox(); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await page.mouse.wheel(dx, dy); await page.waitForTimeout(40);
    };
    for (let i = 0; i < 20; i++) { await wheel(780, 940); await coverage(); }
    const distant = await snapshot();
    if (distant.x < initial.x + 100 || distant.y < initial.y + 100) throw Error('Camera stopped at an edge');
    for (let i = 0; i < 20; i++) await wheel(-780, -940);
    const returned = await snapshot();
    if (Math.abs(returned.x - initial.x) > .02 || JSON.stringify(returned.keys) !== JSON.stringify(initial.keys)) throw Error('Returning camera lost its covers');
    for (let i = 0; i < 8; i++) { await wheel(-900, -900); await coverage(); }
    checks.unboundedFourWayAndStableReturn = true;
    const b = await viewport.boundingBox();
    const beforeDrag = await snapshot();
    await page.mouse.move(b.x + b.width * .7, b.y + b.height * .55); await page.mouse.down();
    for (let i = 1; i <= 5; i++) { await page.mouse.move(b.x + b.width * (.7 - i * .08), b.y + b.height * (.55 - i * .03)); await page.waitForTimeout(16); }
    await page.mouse.up(); const released = await snapshot(); await page.waitForTimeout(160); const coasting = await snapshot();
    if (coasting.x <= released.x || coasting.x <= beforeDrag.x || coasting.focused) throw Error('Drag/inertia or click suppression failed');
    await page.waitForTimeout(1200); await coverage(); checks.inertiaAndNoAccidentalSelection = true;
    const cdp = await context.newCDPSession(page);
    const beforeTouch = await snapshot();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x + b.width * .8, y: b.y + b.height * .6, id: 1 }] });
    for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: b.x + b.width * (.8 - i * .08), y: b.y + b.height * .6, id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }); await page.waitForTimeout(60);
    const canceled = await snapshot(); await page.waitForTimeout(180);
    if (canceled.x <= beforeTouch.x || canceled.focused || (await snapshot()).x !== canceled.x) throw Error('Touch drag/cancel failed');
    checks.touchDragAndCancel = true;
    const middle = { x: b.x + b.width / 2, y: b.y + b.height * .45 }, zoomBefore = (await snapshot()).zoom;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: middle.x - 30, y: middle.y, id: 1 }, { x: middle.x + 30, y: middle.y, id: 2 }] });
    for (let i = 0; i < 6; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: middle.x - 35 - i * 5, y: middle.y, id: 1 }, { x: middle.x + 35 + i * 5, y: middle.y, id: 2 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await page.waitForTimeout(550);
    if ((await snapshot()).zoom <= zoomBefore) throw Error('Real touch pinch did not zoom'); await coverage(); checks.touchPinch = true;
    await root.getByRole('button', { name: '缩小封面', exact: true }).click(); await page.waitForTimeout(40);
    await root.getByRole('button', { name: '移动音乐墙', exact: true }).click();
    const beforeButton = await snapshot(); await root.getByRole('button', { name: '向右浏览', exact: true }).click(); await page.waitForTimeout(40);
    if ((await snapshot()).x <= beforeButton.x) throw Error('Non-drag navigation failed');
    await page.evaluate(() => window.cplayerAndroidBack());
    await viewport.focus(); await page.keyboard.press('ArrowDown'); await page.waitForTimeout(40);
    await page.keyboard.press('Enter'); await page.waitForTimeout(50);
    if (!(await snapshot()).focused) throw Error('Keyboard cannot select central cover');
    await page.keyboard.press('Escape'); await page.waitForTimeout(40);
    await page.keyboard.press('Tab');
    if (!(await root.getByRole('button', { name: '推荐', exact: true }).evaluate(n => n === document.activeElement))) throw Error('Tab trapped among repeating covers');
    checks.keyboardAndButtonAlternatives = true;
    const tile = await root.locator('.wall-tile[aria-hidden=false]').evaluateAll(nodes => {
      const v = document.querySelector('.wall-viewport').getBoundingClientRect();
      const n = nodes.find(n => { const r = n.getBoundingClientRect(); return r.left > v.left + 8 && r.right < v.right - 8 && r.top > v.top + 80 && r.bottom < v.bottom - 80; });
      if (!n) return null; const r = n.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, name: n.getAttribute('aria-label') };
    });
    if (!tile) throw Error('No selectable visible tile');
    await page.mouse.click(tile.x, tile.y); await page.waitForTimeout(260);
    if (!(await snapshot()).focused) throw Error('Cover did not expand');
    await page.screenshot({ path: 'output/playwright/android-infinite-wall-focus.png', animations: 'disabled' });
    await root.getByRole('button', { name: '加入队列', exact: true }).click();
    await page.evaluate(() => window.cplayerAndroidBack());
    if ((await snapshot()).focused || !(await root.isVisible())) throw Error('Android back did not dismiss only the cover');
    checks.selectionAndAndroidBack = true;
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.mouse.move(b.x + b.width * .65, b.y + b.height * .5); await page.mouse.down();
    await page.mouse.move(b.x + b.width * .25, b.y + b.height * .4, { steps: 8 }); await page.mouse.up();
    await page.waitForTimeout(40); const stopped = await snapshot(); await page.waitForTimeout(250);
    if (Math.abs((await snapshot()).x - stopped.x) > .001) throw Error('Reduced motion kept coasting'); checks.reducedMotion = true;
    await root.getByRole('button', { name: '收藏', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.wall-empty').hidden);
    if (!(await root.getByRole('button', { name: '去搜索', exact: true }).isVisible())) throw Error('Empty library has no recovery');
    await root.getByRole('button', { name: '队列', exact: true }).click(); await page.waitForTimeout(80); await coverage(); checks.emptySourceRecovery = true;
    await page.locator('#mobileChartsSheet [data-android-action=home]').click();
    const paused = await snapshot(); await page.waitForTimeout(150); if ((await snapshot()).x !== paused.x) throw Error('Hidden wall moved');
    await page.locator('#mobileChartsSheet [data-android-action=wall]').click(); await page.waitForTimeout(80); checks.navigationKeepsPosition = true;
    await page.evaluate(() => {
      window.playlist.splice(0, window.playlist.length, { id: 'missing-cover', provider: 'local', name: '只有一首歌也没有尽头', artist: '测试歌曲' });
      window.dispatchEvent(new Event('cplayer:library-changed'));
    });
    await page.waitForTimeout(120); await coverage(); await wheel(-2000, 2100); await coverage();
    if (!(await root.locator('.wall-tile img').evaluateAll(nodes => nodes.every(n => n.src.startsWith('data:image/svg+xml'))))) throw Error('Missing artwork has no fallback');
    await page.evaluate(() => { window.playlist.splice(0); window.dispatchEvent(new Event('cplayer:library-changed')); });
    await page.waitForTimeout(80);
    if (!(await root.locator('.wall-empty').isVisible()) || await root.locator('.wall-tile').count()) throw Error('Empty queue retained old tiles');
    await page.evaluate(() => { for (const song of window.__wallTestSongs) window.insertSongToPlaylist(song); window.dispatchEvent(new Event('cplayer:library-changed')); });
    await page.waitForTimeout(100); await coverage(); checks.singleSongMissingCoverAndQueueMutation = true;
    await page.waitForTimeout(2200);
    for (const size of [{ width: 375, height: 812 }, { width: 844, height: 390 }, { width: 1024, height: 768 }]) {
      await page.setViewportSize(size); await page.waitForTimeout(120); await coverage();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      if (overflow) throw Error('Page overflow at ' + JSON.stringify(size));
      await page.screenshot({ path: `output/playwright/android-infinite-wall-${size.width}.png`, animations: 'disabled' });
      if (size.width === 844) {
        await viewport.focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(80);
        const play = root.locator('.wall-focus').getByRole('button', { name: '播放', exact: true });
        await play.scrollIntoViewIfNeeded();
        const accessible = await play.evaluate(node => { const r = node.getBoundingClientRect(); return node.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)); });
        if (!accessible) throw Error('Landscape focus actions obscured');
        await page.screenshot({ path: 'output/playwright/android-infinite-wall-landscape-focus.png', animations: 'disabled' });
        await page.keyboard.press('Escape');
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#mobileChartsSheet [data-android-action=theme]').click(); await page.waitForTimeout(2400); await coverage();
    await page.screenshot({ path: 'output/playwright/android-infinite-wall-light.png', animations: 'disabled' });
    await page.evaluate(() => document.documentElement.style.fontSize = '32px'); await page.waitForTimeout(80); await coverage();
    const targets = await root.locator('.wall-toolbar button').evaluateAll(nodes => nodes.map(n => { const r = n.getBoundingClientRect(); return { text: n.getAttribute('aria-label'), width: r.width, height: r.height, accessible: n.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)) }; }));
    if (targets.some(t => t.width < 48 || t.height < 48)) throw Error('Touch target too small: ' + JSON.stringify(targets));
    if (targets.some(t => !t.accessible)) throw Error('Large-text controls obscured: ' + JSON.stringify(targets));
    await page.screenshot({ path: 'output/playwright/android-infinite-wall-large-text.png', animations: 'disabled' });
    checks.responsiveThemesAndLargeText = true;
    if (errors.length) throw Error(errors.join('; '));
    return { checks, maximumTiles, errors };
  } catch (error) {
    await page.screenshot({ path: 'output/playwright/android-infinite-wall-failure.png' });
    throw Error(error.message + '\n' + JSON.stringify({ checks, errors, state: await page.locator('#mobileExploreWallPane').evaluate(n => ({html: n.outerHTML.slice(0,1200), width:n.clientWidth,height:n.clientHeight})) }));
  } finally { await context.close(); }
}
