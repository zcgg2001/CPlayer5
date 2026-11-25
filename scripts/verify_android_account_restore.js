// Playwright CLI callback. Requires an isolated real account server at :8808.
// Only music responses are fixtures; login, cookies, revocation and sync are real.
async (originalPage) => {
  const base='http://127.0.0.1:8808', browser=originalPage.context().browser();
  const username=`restore_${Date.now().toString(36)}`, password='local-fixture-password-42';
  const checks={}, errors=[];
  let context, page, failure=false, holdSession=false, releaseSession, sessionSeen;
  let sessionGate, onSession;
  const create=async(storageState,version=31)=>{
    context=await browser.newContext({storageState,viewport:{width:390,height:844},serviceWorkers:'block',userAgent:`Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36 CPlayerAndroid/1.18.${version-24} CPlayerPreview/${version}`});
    page=await context.newPage();await page.bringToFront();page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',async route=>{
      const url=new URL(route.request().url());
      if(url.origin!==base)return route.abort();
      const account=/^\/api\/(auth\/|account\/|sync$|library\/)/.test(url.pathname);
      if(account&&failure)return route.abort('internetdisconnected');
      if(url.pathname==='/api/auth/get-session'&&holdSession){onSession?.();await sessionGate;}
      if(account)return route.continue();
      if(url.pathname==='/api/v1/discovery/playlist')return route.fulfill({json:{collection:{id:url.searchParams.get('id'),name:'测试歌单'},tracks:[]}});
      if(url.pathname==='/api/v1/videos')return route.fulfill({json:{items:[{id:'local-video',name:'本地测试视频',poster:'https://i0.hdslb.com/bfs/archive/fixture.jpg',externalUrl:'https://www.bilibili.com/video/fixture'}]}});
      if(url.pathname.startsWith('/api/'))return route.fulfill({json:{code:200,data:[],items:[]}});
      return route.continue();
    });
  };
  const navigate=()=>page.goto(`${base}/?app=android`);
  const ready=()=>page.waitForFunction(()=>typeof window.cplayerAndroidBack==='function');
  const entered=()=>page.waitForFunction(()=>!document.querySelector('#accountEntryDialog').open);
  const synced=()=>page.waitForFunction(()=>document.querySelector('#accountSyncStatus').textContent==='已与云端同步');
  const profile=async()=>{await page.locator('.android-nav [data-open-personal-library]').click();await page.locator('.android-profile-copy').waitFor();return page.locator('.android-profile-copy').textContent();};
  const back=()=>page.evaluate(()=>window.cplayerAndroidBack());
  const login=async()=>{await page.locator('#entryUsername').fill(username);await page.locator('#entryPassword').fill(password);await page.locator('#entrySubmit').click();await entered();await synced();};
  const assert=(condition,message)=>{if(!condition)throw Error(message);};
  const shot=name=>page.screenshot({path:`output/playwright/android-home-${name}.png`,animations:'disabled'});
  try {
    await create();await navigate();await ready();
    await page.locator('[data-entry-mode=register]').click();
    await page.locator('#entryUsername').fill(username);await page.locator('#entryPassword').fill(password);await page.locator('#entryConfirm').fill(password);
    await page.locator('#entrySubmit').click();await entered();await synced();
    let cookie=(await context.cookies()).find(c=>c.name.endsWith('session_token'));
    assert(cookie?.httpOnly&&cookie.expires>Date.now()/1000+29*86400,'Registration did not retain a persistent HttpOnly session');
    checks.registrationPersistentCookie=true;
    // Let the application synchronize its own edits before simulating an update.
    const song={id:'91001',sourceId:'91001',provider:'gd',name:'恢复验证歌曲',artist:'本地测试',album:'会话恢复'};
    const uploaded=page.waitForResponse(response=>response.url().endsWith('/api/sync')&&response.request().method()==='PUT'&&response.request().postDataJSON()?.records['favorite:gd:91001']);
    await page.evaluate(async song=>{
      const {createPersonalLibraryStore}=await import('/js/personal-library-store.js');
      createPersonalLibraryStore({storage:localStorage}).toggleSong(song);
      window.insertSongToPlaylist(song);
      window.dispatchEvent(new Event('cplayer:library-changed'));
    },song);
    assert((await uploaded).ok(),'Could not synchronize fixture library');await synced();
    await page.reload();await entered();await synced();
    assert((await profile()).includes(username),'Reload lost the account');
    assert(await page.locator('[data-profile-section=favorites] strong').textContent()==='1','Reload lost cloud favorite');
    await back();checks.restoreAccountAndLibrary=true;
    // Simulate a restart using a new context, persisted cookies and changed APK UA.
    let state=await context.storageState();state.cookies=state.cookies.filter(c=>c.expires>0);
    await context.close();await create(state,32);await navigate();await entered();await synced();
    assert((await profile()).includes('已登录'),'Simulated APK upgrade did not authenticate');await back();
    checks.newContextAndVersionRestore=true;
    assert(await page.locator('#mobileChartsPageTitle').textContent()==='ZPlayer','Discovery header is not ZPlayer');
    assert(await page.locator('.mobile-charts-header .android-wordmark').count()===0,'Duplicate brand remains');
    for(const view of ['charts','artists','videos']){
      await page.locator(`[data-mobile-explore=${view}]`).click();
      assert(await page.locator('#mobileChartsPageTitle').textContent()!=='ZPlayer','Subpage lost its own title');
    }
    await page.locator('[data-mobile-explore=discovery]').click();
    assert(await page.locator('#mobileChartsPageTitle').textContent()==='ZPlayer','Returning home lost brand');
    checks.headerAndNavigation=true;
    await page.emulateMedia({reducedMotion:'reduce'});
    for(const font of ['', '22px', '32px']) for(const viewport of [{width:320,height:640},{width:375,height:812},{width:390,height:844},{width:844,height:390},{width:1024,height:768}]){
      await page.setViewportSize(viewport);await page.evaluate(font=>document.documentElement.style.fontSize=font,font);
      const layout=await page.locator('.mobile-charts-header').evaluate(el=>{
        const title=el.querySelector('#mobileChartsPageTitle').getBoundingClientRect();
        const buttons=[...el.querySelectorAll('.android-app-actions button')].map(b=>{const r=b.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};});
        return {overflow:el.scrollWidth>el.clientWidth+1,title:{x:title.x,right:title.right,bottom:title.bottom},buttons};
      });
      assert(!layout.overflow&&layout.title.x>=0&&layout.title.right<=viewport.width+1,'Header overflow at '+JSON.stringify({font,viewport,layout}));
      assert(layout.buttons.length===3&&layout.buttons.every(b=>b.x>=0&&b.right<=viewport.width+1&&b.width>=48&&b.height>=48),'Clipped or undersized actions');
      assert(layout.buttons.every(b=>b.x>=layout.title.right-1||b.y>=layout.title.bottom-1),'Header title overlaps controls');
      if(!font&&viewport.width===320)await shot('320');
      if(font==='32px'&&viewport.width===390)await shot('large-text');
    }
    await page.evaluate(()=>document.documentElement.style.fontSize='');await page.setViewportSize({width:390,height:844});
    await shot('dark');await page.locator('.android-app-actions [data-android-action=theme]').click();await shot('light');
    checks.responsiveHeaderAndLargeText=true;
    failure=true;await page.reload();await entered();
    assert((await profile()).includes('离线账号'),'Network failure pretended to authenticate or lost cached account');
    assert(await page.locator('[data-profile-section=favorites] strong').textContent()==='1','Offline restore lost library');await back();
    failure=false;await page.evaluate(()=>window.dispatchEvent(new Event('online')));await synced();
    assert((await profile()).includes('已登录'),'Reconnection did not validate account');await back();
    checks.offlineAndReconnect=true;
    state=await context.storageState();const owner=await page.evaluate(()=>localStorage.getItem('cp_account_owner'));
    await context.clearCookies();await page.reload();await ready();await page.locator('#entryUsername').waitFor({state:'visible'});
    assert(await page.locator('#entryStatus').textContent().then(t=>t.includes('登录已过期')),'Expired cookie was not rejected');
    assert(await page.evaluate(id=>JSON.parse(localStorage.getItem(`cp_cloud_v1:${id}`)).local['favorite:gd:91001']?.name,owner)==='恢复验证歌曲','Expired login erased local library');
    checks.invalidSessionCannotAuthenticateFromCache=true;
    let signInPayload;page.on('request',r=>{if(r.url().endsWith('/api/auth/sign-in/username'))signInPayload=r.postDataJSON();});
    await login();assert(signInPayload?.rememberMe===true,'Login still creates temporary cookies');
    cookie=(await context.cookies()).find(c=>c.name.endsWith('session_token'));assert(cookie?.expires>Date.now()/1000+29*86400,'Login cookie is temporary');
    assert(await page.evaluate(()=>Object.values(localStorage).every(value=>!value.includes('local-fixture-password-42'))),'Password leaked into localStorage');
    checks.loginRemembersWithoutStoredPassword=true;
    // Explicit sign-out remains signed out on a fresh launch.
    await profile();await page.locator('[data-profile-account]').click();await page.locator('#accountSignOut').click();
    await page.locator('#entryUsername').waitFor({state:'visible'});
    assert(await (await context.request.get(`${base}/api/auth/get-session`)).json()===null,'Sign-out did not revoke session');
    await page.reload();await ready();await page.locator('#entryUsername').waitFor({state:'visible'});
    assert(await page.evaluate(()=>localStorage.getItem('cp_account_entry_mode'))==='signed-out','Sign-out preference not preserved');
    checks.explicitSignOutAcrossLaunch=true;
    await login();
    holdSession=true;sessionGate=new Promise(resolve=>releaseSession=resolve);sessionSeen=new Promise(resolve=>onSession=resolve);
    await page.reload({waitUntil:'domcontentloaded'});await sessionSeen;
    await page.locator('#entryResumeGuest').waitFor({state:'visible'});
    assert(!await page.locator('#entryUsername').isVisible(),'Login form flashed during restoration');
    await page.locator('#entryResumeGuest').click();await entered();releaseSession();holdSession=false;
    // Capabilities enable these fields only after the delayed session settles.
    // Verify the late response before navigating away (which would cancel it).
    await page.waitForFunction(()=>!document.querySelector('#entryFields').disabled);
    assert(await page.locator('#accountBadge').textContent()==='本地模式','Late session response authenticated the guest');
    assert(await page.evaluate(()=>localStorage.getItem('cp_account_owner'))===null,'Late session restored the previous owner');
    await page.reload();await ready();await page.locator('#entryUsername').waitFor({state:'visible'});
    assert(await page.evaluate(()=>localStorage.getItem('cp_account_entry_mode'))==='guest','Late session response overrode guest mode');
    await page.locator('#entryGuest').click();await entered();
    assert((await profile()).includes('游客模式'),'Guest startup restored previous account');await back();
    checks.guestDuringRestoreAndAcrossLaunch=true;
    // Browser-only use retains its explicit login/guest entry.
    await page.goto(base);await ready();await page.locator('#entryUsername').waitFor({state:'visible'});
    assert(!await page.locator('.entry-resume').isVisible(),'Browser unexpectedly auto-restores');checks.webEntryPreserved=true;
    assert(errors.length===0,errors.join('; '));
    console.log(JSON.stringify({checks,errors}));return {checks,errors};
  } catch(error){const account=await page.evaluate(()=>({notice:document.querySelector('#accountNotice')?.textContent,sync:document.querySelector('#accountSyncStatus')?.textContent,entry:document.querySelector('#accountEntryDialog')?.open,conflicts:document.querySelector('#accountConflicts')?.textContent}));await shot('verification-failure');throw Error(`${error.message}\n${JSON.stringify({checks,errors,account})}`);}
  finally{releaseSession?.();await context?.close();}
}
