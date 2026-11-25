// Playwright CLI callback, with CPlayer5 served at 127.0.0.1:8795.
// Real HTML audio is used; only provider responses and the WAV transport are fixtures.
async (originalPage) => {
  const base = 'http://127.0.0.1:8795';
  const context = await originalPage.context().browser().newContext({serviceWorkers:'block',viewport:{width:390,height:844}});
  const page = await context.newPage(); await page.bringToFront();
  const requests=[], errors=[], checks={};
  const gates = new Map();
  const gate = () => {let release;const promise=new Promise(r=>release=r);return {promise,release};};
  const modes = new Map();
  const customOrigin = 'https://sources.example.org';
  const scriptFor = slot => `/**\n * @name ${slot === 'primary' ? '晨光音源' : '晚风音源'}\n */
    lx.on(lx.EVENT_NAMES.request, query => new Promise((resolve, reject) => {
      lx.request('${customOrigin}/resolve/${slot}?id=' + query.info.musicInfo.id, {}, (error, response) => error ? reject(error) : resolve(response.body));
    }));
    lx.send(lx.EVENT_NAMES.inited, { sources: { wy: { actions: ['musicUrl'], qualitys: ['128k'] } } });`;
  const wav = Buffer.alloc(44 + 180 * 8000 * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length-8,4); wav.write('WAVEfmt ',8);
  wav.writeUInt32LE(16,16); wav.writeUInt16LE(1,20); wav.writeUInt16LE(1,22);
  wav.writeUInt32LE(8000,24); wav.writeUInt32LE(16000,28); wav.writeUInt16LE(2,32); wav.writeUInt16LE(16,34);
  wav.write('data',36); wav.writeUInt32LE(wav.length-44,40);
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(() => {
    window.__sourceAudio=[];
    window.Audio=new Proxy(window.Audio,{construct(Target,args){const audio=Reflect.construct(Target,args);window.__sourceAudio.push(audio);return audio;}});
  });
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.origin===customOrigin && url.pathname.endsWith('.js')) {
      requests.push({kind:'script',slot:url.pathname});
      return route.fulfill({body:scriptFor(url.pathname.includes('backup')?'backup':'primary'),contentType:'application/javascript',headers:{'Access-Control-Allow-Origin':'*'}});
    }
    if(url.origin===customOrigin && url.pathname.startsWith('/resolve/')) {
      const slot=url.pathname.split('/').at(-1);requests.push({kind:'custom-resolve',slot,id:url.searchParams.get('id')});
      return route.fulfill({body:`${customOrigin}/__source/lx-${slot}/${modes.get(slot)==='broken'?'broken':'song'}.wav`,headers:{'Access-Control-Allow-Origin':'*'}});
    }
    if(url.origin!==base && url.origin!==customOrigin)return route.abort();
    if(url.pathname.startsWith('/__source/')) {
      if(url.pathname.includes('broken'))return route.fulfill({body:'broken audio',contentType:'audio/mpeg'});
      const match=route.request().headers().range?.match(/bytes=(\d+)-(\d*)/);
      const start=Number(match?.[1]||0),end=Math.min(Number(match?.[2]||wav.length-1),wav.length-1);
      return route.fulfill({status:match?206:200,body:wav.subarray(start,end+1),contentType:'audio/wav',headers:{'Accept-Ranges':'bytes',...(match?{'Content-Range':`bytes ${start}-${end}/${wav.length}`}:{})}});
    }
    if(url.pathname==='/api/v1/music/song'){
      const provider=url.searchParams.get('source'), id=url.searchParams.get('id');requests.push({kind:'song',provider,id});
      await gates.get(provider)?.promise;
      if(modes.get(provider)==='quota')return route.fulfill({status:402,json:{error:{code:'chksz_error',message:'今日额度已用尽'}}});
      if(modes.get(provider)==='fail')return route.fulfill({status:503,json:{error:{message:'fixture unavailable'}}}).catch(()=>{});
      return route.fulfill({json:{code:200,data:{id,name:'风经过的地方',artist:'林间来信',album:'慢一点',duration:180,
        url:`${base}/__source/${provider}/${modes.get(provider)==='broken'?'broken':'song'}.wav`,cover:`${base}/design-preview/source-switch/cover.svg`,level:'standard'}}}).catch(()=>{});
    }
    if(url.pathname==='/api/v1/music/search'){
      const provider=url.searchParams.get('source');requests.push({kind:'search',provider});
      return route.fulfill({json:{code:200,data:[{id:'matched-456',sourceId:'matched-456',provider,name:'风经过的地方',artist:'林间来信',album:'慢一点',duration:180}]}});
    }
    if(url.pathname==='/api/v1/music/lyric')return route.fulfill({json:{code:200,data:{lrc:'[00:01]风经过的地方\n[00:20]慢一点 再慢一点\n[00:60]把时间留给喜欢的歌'}}});
    if(url.pathname==='/api/account/config')return route.fulfill({json:{enabled:false}});
    if(url.pathname==='/api/runtime')return route.fulfill({json:{sources:{'op-netease':{enabled:false}}}});
    if(url.pathname.startsWith('/api/'))return route.fulfill({json:{code:200,data:[],items:[]}});
    return route.continue();
  });
  const audioState=()=>page.evaluate(()=>{const audio=window.__sourceAudio.find(a=>a.currentSrc.includes('/__source/'));return {src:audio?.currentSrc,paused:audio?.paused,time:audio?.currentTime,label:document.querySelector('[data-source-label]').textContent,phase:document.querySelector('#mobile-control-deck [data-player-feedback]')?.dataset.phase};});
  const seek=(position,paused=false)=>page.evaluate(({position,paused})=>{const a=window.__sourceAudio.find(a=>a.currentSrc.includes('/__source/'));a.currentTime=position;if(paused)a.pause();},{position,paused});
  const waitSource=source=>page.waitForFunction(source=>window.__sourceAudio.some(a=>a.currentSrc.includes(`/__source/${source}/`)&&a.readyState>=2),source);
  const waitIdle=()=>page.waitForFunction(()=>!document.querySelector('#playerSourceButton').classList.contains('is-switching'));
  const waitToast=()=>page.waitForFunction(()=>getComputedStyle(document.getElementById('copyToast')).opacity==='0');
  const open=async()=>{if(!await page.locator('#playerSourceDialog').isVisible())await page.locator('#playerSourceButton').click();};
  const all=async()=>{await open();if(await page.locator('.player-source-more').isVisible())await page.locator('.player-source-more').click();};
  const choose=provider=>page.locator(`[data-player-source="${provider}"]`).click();
  const play=async(id='123',source='gd')=>{
    await page.evaluate(async id=>{const i=window.insertSongToPlaylist({id,sourceId:id,provider:'gd',preferredProvider:'gd',name:'风经过的地方',artist:'林间来信',album:'慢一点',duration:180,cover:`${location.origin}/design-preview/source-switch/cover.svg`});await window.playSongAtIndex(i);},id);
    await waitSource(source);await waitIdle();
    if(await page.locator('#mobileBrowseOpen').isVisible())await page.locator('#mobileBrowseOpen').click();
  };
  try {
    await page.goto(`${base}/?app=android`);
    await page.waitForFunction(()=>typeof window.insertSongToPlaylist==='function');
    await page.locator('#entryGuest').click(); await play();
    await page.locator('.cover-carousel-card[aria-current=true] img').evaluate(img=>img.decode());
    await waitToast();
    await page.waitForFunction(()=>document.getElementById('mobileTitle').textContent==='风经过的地方'&&getComputedStyle(document.getElementById('mobileTitle')).opacity==='1');
    await page.screenshot({path:'output/playwright/android-source-c-player.png',animations:'disabled'});
    await open();
    await page.screenshot({path:'output/playwright/android-source-c-menu.png',animations:'disabled'});
    if(await page.locator('[data-player-source]').count()!==5)throw Error('Compact menu should show two custom slots and three platform choices');
    if(await page.locator('[data-player-source]').nth(2).getAttribute('data-player-source')!=='chksz')throw Error('ChKSz must lead platform choices');
    checks.compactMenu=true;
    await page.keyboard.press('Escape');
    if(await page.locator('#playerSourceDialog').isVisible())throw Error('Escape did not close');
    if(await page.locator('#playerSourceButton').evaluate(el=>el!==document.activeElement))throw Error('Focus did not return');
    await open();await page.mouse.click(5,500);
    if(await page.locator('#playerSourceDialog').isVisible())throw Error('Outside tap did not close');
    await open();await page.evaluate(()=>window.cplayerAndroidBack());
    if(await page.locator('#playerSourceDialog').isVisible())throw Error('Android Back did not close');checks.closeAndFocus=true;
    const pending=gate();gates.set('netease',pending);
    await seek(45);await open();await choose('netease');
    await page.waitForFunction(()=>document.querySelector('.player-source-status').textContent.includes('保留当前播放'));
    let state=await audioState();if(!state.src.includes('/gd/')||state.paused||!state.label.includes('GD'))throw Error('Resolution interrupted old audio');
    await seek(54,true);pending.release();gates.delete('netease');await waitSource('netease');await waitIdle();
    state=await audioState();if(!state.paused||Math.abs(state.time-54)>1||!state.label.includes('Meting'))throw Error('Pause/progress/source lost '+JSON.stringify(state));
    if(await page.evaluate(()=>localStorage.getItem('cp_playback_source'))!=='netease')throw Error('Compact switch did not automatically persist');
    checks.keepOldAudioAndPausedProgress=true;
    // Reuse the shared header while the lyrics surface is active.
    await page.locator('.cover-carousel-card[aria-current=true]').click();
    await page.waitForFunction(()=>!document.getElementById('mobileLyricsPage').inert);
    await all();await choose('xinghai-netease');await waitSource('xinghai-netease');await waitIdle();
    if(await page.locator('#mobileLyricsPage').evaluate(el=>el.inert))throw Error('Switch left lyrics view');
    await open();await page.screenshot({path:'output/playwright/android-source-c-lyrics.png',animations:'disabled'});
    await page.keyboard.press('Escape');checks.lyricsViewPreserved=true;
    // A decode failure must restore media, controls and the previous source label.
    modes.set('at38-netease','broken');await all();await choose('at38-netease');await waitIdle();
    state=await audioState();
    if(!state.src.includes('/xinghai-netease/')||!state.label.includes('星海')||Math.abs(state.time-54)>1)throw Error('Rollback failed '+JSON.stringify(state));
    if(!await page.locator('.player-source-status').textContent().then(s=>s.includes('保留原音源')))throw Error('Missing rollback feedback');
    checks.decodeRollback=true;
    modes.delete('at38-netease');await page.keyboard.press('Escape');
    await all();
    if(!await page.locator('[data-player-source="op-netease"]').isDisabled())throw Error('Policy disabled source enabled');
    if(await page.evaluate(()=>localStorage.getItem('cp_playback_source'))!=='xinghai-netease')throw Error('Failed switch replaced preference');
    await page.locator('[role=tab][data-platform=qq]').click();
    await waitToast();
    await page.screenshot({path:'output/playwright/android-source-c-all.png',animations:'disabled'});
    await choose('qq');await waitSource('qq');await waitIdle();
    state=await audioState();
    if(!requests.some(r=>r.kind==='search'&&r.provider==='qq')||!requests.some(r=>r.kind==='song'&&r.provider==='qq'&&r.id==='matched-456'))throw Error('Wrong cross-platform ID');
    const settings=await page.evaluate(()=>({preference:localStorage.getItem('cp_playback_source'),source:localStorage.getItem('cp_source')}));
    if(settings.preference!=='qq')throw Error('Preference not saved');checks.crossPlatformAndPreference=true;
    // Responsive, large text, light appearance, focus loop and reset preference.
    await all();await page.locator('[data-source-reset]').click();
    if(await page.evaluate(()=>Boolean(localStorage.getItem('cp_playback_source'))))throw Error('Preference not reset');
    for(const size of [{width:320,height:640},{width:844,height:390}]){
      await page.setViewportSize(size);await page.evaluate(()=>document.documentElement.style.fontSize='20px');
      const bounds=await page.locator('#playerSourceDialog').boundingBox();
      if(bounds.x<0||bounds.y<0||bounds.x+bounds.width>size.width+1||bounds.y+bounds.height>size.height+1)throw Error('Dialog overflow '+JSON.stringify(bounds));
      await page.locator('.player-source-close').focus();await page.keyboard.press('Shift+Tab');
      if(!await page.locator('#playerSourceDialog').evaluate(el=>el.contains(document.activeElement)))throw Error('Focus escaped dialog');
    }
    await page.setViewportSize({width:390,height:844});
    await page.evaluate(()=>{document.documentElement.style.fontSize='';document.documentElement.dataset.theme='light';});
    await waitToast();
    await page.screenshot({path:'output/playwright/android-source-c-light.png',animations:'disabled'});
    checks.responsiveLightLargeTextAndReset=true;
    await page.keyboard.press('Escape');
    await page.evaluate(()=>document.documentElement.dataset.theme='dark');
    const openSourceSettings=async()=>{
      await page.locator('#androidCollapsePlayer').click();
      await page.locator('.android-nav [data-open-personal-library]').click();
      await page.getByRole('button',{name:'打开个人中心设置',exact:true}).click();
      await page.locator('.android-settings-overview [data-preference=sources]').click();
    };
    const saveImport=async({enabled=true,backup=`${customOrigin}/backup.js`}={})=>{
      await page.locator('[name=lxSourceEnabled]').setChecked(enabled);
      await page.locator('#lxSourcePrimary').fill(`${customOrigin}/primary.js`);
      await page.locator('#lxSourceBackup').fill(backup);
      await page.locator('[name=lxSourceSave]').click();
      await page.waitForFunction(()=>!document.getElementById('lxSourceForm').hasAttribute('aria-busy'));
      if(await page.locator('#lxSourceFeedback').getAttribute('data-error')==='true')throw Error('Import failed');
    };
    const closeSourceSettings=async()=>{
      await page.locator('#closeSettingsBtn').click();
      await page.locator('[data-profile-back]').click();
      await page.locator('#mobileBrowseOpen').click();
    };
    await openSourceSettings();await saveImport();
    if(!await page.locator('#androidPlaybackPreference option[value=lx-backup]').textContent().then(text=>text.includes('晚风音源')))throw Error('Settings did not refresh imported name');
    await page.locator('#androidPlaybackPreference').selectOption('gd');
    await page.screenshot({path:'output/playwright/android-source-custom-settings.png',animations:'disabled'});
    await closeSourceSettings();await play('789');await seek(37,true);await open();
    if(!await page.locator('[data-player-source=lx-backup]').textContent().then(text=>text.includes('晚风音源')))throw Error('Imported source absent from compact menu');
    await page.screenshot({path:'output/playwright/android-source-custom-menu.png',animations:'disabled'});
    await choose('lx-backup');await waitSource('lx-backup');await waitIdle();
    if(await page.evaluate(()=>localStorage.getItem('cp_playback_source'))!=='lx-backup')throw Error('Compact custom switch did not persist automatically');
    state=await audioState();if(!state.paused||Math.abs(state.time-37)>1||state.label!=='晚风音源')throw Error('Custom switch lost pause/progress/name '+JSON.stringify(state));
    await all();
    if(await page.locator('[role=tab][data-platform=custom]').getAttribute('aria-selected')!=='true')throw Error('Current custom tab not selected');
    await choose('lx-backup');
    if(await page.evaluate(()=>localStorage.getItem('cp_playback_source'))!=='lx-backup')throw Error('Custom preference missing');
    await waitToast();await all();await page.screenshot({path:'output/playwright/android-source-custom-all.png',animations:'disabled'});
    for(const size of [{width:320,height:640},{width:844,height:390}]){
      await page.setViewportSize(size);await page.evaluate(()=>document.documentElement.style.fontSize='20px');
      const bounds=await page.locator('#playerSourceDialog').boundingBox();
      if(bounds.x<0||bounds.y<0||bounds.x+bounds.width>size.width+1||bounds.y+bounds.height>size.height+1)throw Error('Custom panel overflow');
    }
    await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.fontSize='');
    await page.keyboard.press('Escape');
    const nextCustomResponse=page.waitForResponse(response=>response.url()===`${customOrigin}/resolve/backup?id=790`);
    await page.evaluate(()=>{const index=window.insertSongToPlaylist({id:'790',sourceId:'790',provider:'gd',name:'下一首歌',artist:'林间来信'});void window.playSongAtIndex(index);});
    await nextCustomResponse;
    await page.waitForFunction(()=>document.getElementById('mobileTitle').textContent==='下一首歌');
    await waitSource('lx-backup');await waitIdle();
    await page.waitForFunction(()=>window.__sourceAudio.some(audio=>audio.currentSrc.includes('/lx-backup/')&&audio.readyState>=2&&!audio.paused&&audio.currentTime<5));
    if(!requests.some(r=>r.kind==='custom-resolve'&&r.slot==='backup'&&r.id==='790'))throw Error('Next song did not honor custom preference');
    checks.importRealWorkerNamesPauseProgressAndPreference=true;
    await seek(26);modes.set('primary','broken');await all();await choose('lx-primary');await waitIdle();
    state=await audioState();if(!state.src.includes('/lx-backup/')||state.label!=='晚风音源'||state.time<25)throw Error('Custom rollback failed');
    if(!await page.locator('.player-source-status').textContent().then(text=>text.includes('保留原音源')))throw Error('No custom rollback message');
    await page.locator('[role=tab][data-platform=netease]').click();await choose('netease');await waitSource('netease');await waitIdle();
    state=await audioState();if(!state.label.includes('Meting'))throw Error('Stale custom source label');
    checks.customDecodeRollbackAndReturnToBuiltin=true;
    await openSourceSettings();
    if(await page.locator('#androidPlaybackPreference').inputValue()!=='netease')throw Error('Settings did not follow successful switch');
    await page.locator('#androidPlaybackPreference').selectOption('lx-backup');
    await saveImport({enabled:false});
    if(await page.locator('#androidPlaybackPreference').inputValue()!=='')throw Error('Disabled preference not cleared');
    if(await page.locator('#androidPlaybackPreference option[value=lx-backup]').count())throw Error('Disabled import still offered as default');
    await closeSourceSettings();await all();await page.locator('[role=tab][data-platform=custom]').click();
    if(!await page.locator('[data-player-source=lx-backup]').isDisabled())throw Error('Disabled custom source selectable');
    await page.keyboard.press('Escape');await openSourceSettings();await saveImport({backup:''});await closeSourceSettings();
    await all();await page.locator('[role=tab][data-platform=custom]').click();
    if(await page.locator('[data-player-source=lx-backup]').count())throw Error('Removed custom source remains');
    if(await page.locator('[data-player-source=lx-primary]').isDisabled())throw Error('Re-enabled import unavailable');
    checks.disableRemovalAndLiveMenuRefresh=true;
    modes.delete('primary'); await page.keyboard.press('Escape');
    await openSourceSettings();
    await page.locator('#androidPlaybackPreference').selectOption('');
    await closeSourceSettings(); await play('792','lx-primary');
    if(!requests.some(r=>r.kind==='custom-resolve'&&r.slot==='primary'&&r.id==='792'))throw Error('Default did not use custom source');
    await open();await choose('chksz');await waitSource('chksz');await waitIdle();
    if(await page.evaluate(()=>localStorage.getItem('cp_playback_source'))!=='chksz')throw Error('ChKSz preference not saved');
    await play('793','chksz');
    modes.set('chksz','quota');await play('794','lx-primary');
    if(await page.evaluate(()=>localStorage.getItem('cp_playback_source'))!=='chksz')throw Error('Fallback replaced chosen preference');
    const quotaCalls=requests.filter(r=>r.kind==='song'&&r.provider==='chksz').length;
    await play('795','lx-primary');
    if(requests.filter(r=>r.kind==='song'&&r.provider==='chksz').length!==quotaCalls)throw Error('Daily quota was retried');
    await all();await page.locator('[role=tab][data-platform=netease]').click();
    const quotaRow=page.locator('[data-player-source=chksz]');
    if(!await quotaRow.isDisabled()||!await quotaRow.textContent().then(text=>text.includes('明日 00:00')))throw Error('Daily quota state missing');
    if(await page.locator('[data-player-source]').first().getAttribute('data-player-source')!=='chksz')throw Error('Expanded channel order wrong');
    await waitToast();await page.screenshot({path:'output/playwright/android-source-daily-quota.png',animations:'disabled'});
    const beforeReload=await page.evaluate(()=>JSON.parse(localStorage.getItem('cp_playback_health_v1')).chksz.until);
    await page.reload();await page.waitForFunction(()=>typeof window.insertSongToPlaylist==='function');
    if(await page.locator('#entryGuest').isVisible())await page.locator('#entryGuest').click();
    await play('796','lx-primary');
    const afterReload=await page.evaluate(()=>JSON.parse(localStorage.getItem('cp_playback_health_v1')).chksz.until);
    if(beforeReload!==afterReload||requests.filter(r=>r.kind==='song'&&r.provider==='chksz').length!==quotaCalls)throw Error('Restart lost daily cooldown');
    checks.defaultCustomAutoRememberFallbackAndDailyQuotaPersist=true;
    if(errors.length)throw Error(errors.join('; '));
    console.log(JSON.stringify({checks,requests,errors,final:await audioState()}));
    return {checks,requests,errors};
  } catch(error) {
    await page.screenshot({path:'output/playwright/android-source-c-failure.png'});
    throw Error(error.message+'\n'+JSON.stringify({checks,requests,errors,state:await audioState()}));
  } finally {for(const item of gates.values())item.release();await context.close();}
}
