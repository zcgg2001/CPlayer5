// Playwright CLI callback; serve the project at 127.0.0.1:8794.
// A fresh browser context uses local fixture music and no real account/session.
async (originalPage) => {
  const base='http://127.0.0.1:8794';
  const context=await originalPage.context().browser().newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
  const page=await context.newPage();await page.bringToFront();
  const errors=[],checks={};page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.origin!==base)return route.abort();
    if(url.pathname==='/api/account/config')return route.fulfill({json:{enabled:false}});
    if(url.pathname.startsWith('/api/'))return route.fulfill({json:{code:200,data:[],items:[]}});
    return route.continue();
  });
  const home=page.locator('#personalLibraryDialog');const settings=page.locator('#settingsModal');
  const back=()=>page.evaluate(()=>window.cplayerAndroidBack());
  const waitHome=()=>page.waitForFunction(()=>document.querySelector('#personalLibraryDialog')?.open && document.querySelector('#personalLibraryDialog').dataset.profileView==='home');
  const waitSettings=()=>page.waitForFunction(()=>document.querySelector('#settingsModal').getAttribute('aria-hidden')==='false');
  const enter=key=>page.locator(`.android-settings-overview [data-preference="${key}"]`).click();
  const shot=name=>page.screenshot({path:`output/playwright/android-personal-${name}.png`,animations:'disabled'});
  try {
    await page.goto(`${base}/offline.html`);
    await page.evaluate(async()=>{
      const {createPersonalLibraryStore}=await import('/js/personal-library-store.js');
      const store=createPersonalLibraryStore({storage:localStorage});
      const songs=['风经过的地方','落日来信'].map((name,i)=>({id:String(90001+i),sourceId:String(90001+i),provider:'gd',name,artist:'林间回声',album:'慢一点',cover:`${location.origin}/design-preview/source-switch/cover.svg`}));
      songs.forEach(song=>store.toggleSong(song));store.create('留给傍晚的歌',songs);
      songs.forEach((song,i)=>store.record({sessionId:`sample-${i}`,deviceId:'fixture',song,seconds:20,position:20,first:true}));
      store.record({sessionId:'repeat',deviceId:'fixture',song:songs[0],seconds:10,position:10,first:true});
    });
    await page.goto(`${base}/?app=android`);await page.waitForFunction(()=>typeof window.cplayerAndroidBack==='function');
    await page.locator('#entryGuest').click();
    await page.locator('.android-nav [data-open-personal-library]').click();await waitHome();
    await page.waitForFunction(()=>document.querySelector('[data-profile-section=offline]').textContent.includes('还没有保存'));
    if(await page.locator('[data-profile-section=favorites] strong').textContent()!=='2')throw Error('Favorite count not real');
    if(await page.locator('[data-profile-section=history] strong').textContent()!=='今天 2 首')throw Error('Recent tracks not deduplicated');
    await shot('home-dark');checks.realCountsAndHome=true;
    await page.locator('.android-profile-playlist').click();
    if(await home.getAttribute('data-profile-view')!=='detail')throw Error('Playlist kept home grid');
    await back();await waitHome();
    await page.locator('[data-profile-section=favorites]').click();
    await page.getByRole('button',{name:'播放 风经过的地方',exact:true}).waitFor();await back();await waitHome();
    await page.locator('[data-profile-create]').click();
    await home.getByLabel('歌单名称',{exact:true}).fill('未保存的歌单');
    page.once('dialog',d=>d.dismiss());await back();
    if(!await home.getByLabel('歌单名称',{exact:true}).isVisible())throw Error('Discard refusal lost editor');
    page.once('dialog',d=>d.accept());await back();await back();await waitHome();checks.libraryBackAndUnsavedGuard=true;
    await page.getByRole('button',{name:'打开个人中心设置',exact:true}).click();await waitSettings();
    if(await home.isVisible())throw Error('Personal modal remained over settings');
    if(await settings.locator('input:visible, select:visible').count())throw Error('Settings overview still shows long forms');
    await shot('settings-dark');
    await enter('appearance');await page.locator('[data-android-theme=light]').click();await back();
    if(!await page.locator('[data-preference=appearance] [data-preference-summary]').textContent().then(t=>t.includes('浅色')))throw Error('Theme summary stale');
    await shot('settings-light');
    await enter('player');await page.locator('#androidCoverShapes [data-cover-shape=circle]').click();await back();
    if(!await page.locator('[data-preference=player] [data-preference-summary]').textContent().then(t=>t.includes('圆形')))throw Error('Cover summary stale');
    await enter('sources');await page.locator('#androidPlaybackPreference').selectOption('qq');
    if(await page.evaluate(()=>localStorage.getItem('cp_playback_source'))!=='qq')throw Error('Preference not persisted');
    if(await page.locator('#musicSourceSelect').inputValue()!=='gd')throw Error('Playback preference changed search filter');
    await back();await enter('lyrics');
    await page.locator('#lyricFontSize').fill('42');await page.locator('#lyricFontSize').press('Tab');await back();
    if(!await page.locator('[data-preference=lyrics] [data-preference-summary]').textContent().then(t=>t.includes('42')))throw Error('Lyrics summary stale');
    await enter('account');await page.locator('#accountOpenEntry').waitFor({state:'visible'});await back();
    await enter('about');
    if(!await page.locator('.android-settings-about').textContent().then(t=>t.includes('Android 预览界面')))throw Error('Fake installed version');
    await back();await back();await waitHome();checks.settingsPagesPersistenceAndReturn=true;
    await shot('home-light');
    await home.getByRole('button',{name:'账号与同步',exact:true}).click();await waitSettings();
    await page.locator('#accountOpenEntry').click();await page.locator('#entryGuest').click();await waitHome();
    checks.accountEntryAndGuestReturn=true;
    await page.getByRole('button',{name:'打开个人中心设置',exact:true}).click();await waitSettings();
    await enter('offline');await page.getByText('让音乐留在身边',{exact:true}).waitFor();await back();await waitHome();checks.storageEntry=true;
    // A slow storage read must not lock navigation, or append to the next page.
    await page.evaluate(()=>{
      window.__originalStorageEstimate=navigator.storage.estimate.bind(navigator.storage);
      navigator.storage.estimate=()=>new Promise(resolve=>window.__releaseStorageEstimate=resolve);
    });
    await page.locator('[data-profile-section=offline]').click();
    await page.waitForFunction(()=>typeof window.__releaseStorageEstimate==='function');
    await back();await waitHome();
    await page.locator('[data-profile-section=favorites]').click();
    await page.getByRole('button',{name:'播放 风经过的地方',exact:true}).waitFor();
    await page.evaluate(()=>{navigator.storage.estimate=window.__originalStorageEstimate;window.__releaseStorageEstimate({usage:100,quota:1000});});
    if(await home.getByText('浏览器估算站点空间',{exact:false}).count())throw Error('Late storage read changed current page');
    await back();await waitHome();checks.navigationDuringSlowStorageRead=true;
    await page.getByRole('button',{name:'打开个人中心设置',exact:true}).click();await waitSettings();
    await enter('appearance');await page.locator('[data-android-theme=night]').click();await back();
    // Responsive layouts, focus trapping, and enlarged text with reduced motion.
    await page.emulateMedia({reducedMotion:'reduce'});
    for(const viewport of [{width:375,height:812},{width:320,height:640},{width:844,height:390},{width:1024,height:768}]){
      await page.setViewportSize(viewport);
      await page.evaluate(()=>document.documentElement.style.fontSize='22px');
      await enter('player');
      const box=await page.locator('#settingsCard').boundingBox();
      if(box.x<0||box.y<0||box.x+box.width>viewport.width+1||box.y+box.height>viewport.height+1)throw Error('Settings bounds overflow '+JSON.stringify(box));
      const overflow=await page.locator('.settings-scroll').evaluate(el=>el.scrollWidth>el.clientWidth+2);
      if(overflow)throw Error('Settings content overflow '+JSON.stringify(viewport));
      if(viewport.width>=840 && !await page.locator('.android-settings-overview').isVisible())throw Error('Tablet lost two-pane nav');
      await page.locator('#androidSettingsBack').focus();await page.keyboard.press('Shift+Tab');
      if(!await settings.evaluate(el=>el.contains(document.activeElement)))throw Error('Settings focus escaped');
      if(viewport.width===1024)await shot('settings-tablet');
      await back();
    }
    await page.evaluate(()=>document.documentElement.style.fontSize='');await page.setViewportSize({width:390,height:844});
    await page.locator('#closeSettingsBtn').click();await waitHome();
    for(const viewport of [{width:320,height:640},{width:844,height:390}]){
      await page.setViewportSize(viewport);await page.evaluate(()=>document.documentElement.style.fontSize='22px');
      if(await home.locator('.pl-body').evaluate(el=>el.scrollWidth>el.clientWidth+2))throw Error('Profile overflow');
      await home.getByRole('button',{name:'账号与同步',exact:true}).click();await waitSettings();await back();await back();await waitHome();
    }
    checks.responsiveLargeTextReducedMotionAndFocus=true;
    await page.evaluate(()=>document.documentElement.style.fontSize='');await page.setViewportSize({width:390,height:844});
    await page.locator('[data-profile-back]').click();
    await page.locator('.android-nav [data-open-personal-library]').focus();
    if(await home.isVisible())throw Error('Profile home back did not close');
    // Desktop still opens its original library tabs and long-form settings.
    await page.goto(base);await page.waitForFunction(()=>typeof window.insertSongToPlaylist==='function');
    if(await page.locator('#entryGuest').isVisible())await page.locator('#entryGuest').click();
    await page.setViewportSize({width:1440,height:1000});
    await page.locator('.personal-library-entry').click();
    if(!await page.locator('.pl-nav').isVisible())throw Error('Desktop library navigation changed');
    await page.locator('.pl-close').click();
    await page.locator('[data-shell-destination=settings]').click();
    if(!await page.locator('#accountPanel').isVisible())throw Error('Desktop settings hidden');checks.desktopPreserved=true;
    if(errors.length)throw Error(errors.join('; '));
    console.log(JSON.stringify({checks,errors}));return {checks,errors};
  }catch(error){await shot('failure');throw Error(error.message+'\n'+JSON.stringify({checks,errors}));}
  finally{await context.close();}
}
