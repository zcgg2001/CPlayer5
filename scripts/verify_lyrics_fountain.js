// Playwright CLI run-code callback. Run after verify_lyrics_browser.js in the same session.
async (original) => {
  const page = original.context().browser().contexts().at(-1).pages()[0];
  await page.evaluate(()=>{try{window.__testNoise?.stop();}catch{} window.__lyricTestAudio[0].pause();});
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.setViewportSize({width:1440,height:1000});
  await page.getByRole('button',{name:'歌词外观',exact:true}).click();
  await page.getByLabel('底部音乐喷泉',{exact:true}).check();
  const timing=page.getByText('歌词与时间校正',{exact:true});
  if (!(await timing.evaluate(n=>n.parentElement.open))) await timing.click();
  await page.getByLabel('歌词校正（毫秒，正值提前）').fill('0');
  await page.getByLabel('歌词校正（毫秒，正值提前）').press('Tab');
  await page.getByRole('button',{name:'恢复在线歌词',exact:true}).click();
  await page.getByRole('button',{name:'关闭设置',exact:true}).click();
  await page.waitForFunction(()=>document.getElementById('settingsModal').classList.contains('hidden'));
  await page.evaluate(()=>{window.__lyricTestAudio[0].pause();window.__lyricTestAudio[0].currentTime=8.8;});
  await page.evaluate(() => {
    const get = AnalyserNode.prototype.getByteFrequencyData;
    AnalyserNode.prototype.getByteFrequencyData = function(data) { window.__testMeter = this; return get.call(this,data); };
    window.__lyricTestAudio[0].play();
  });
  await page.waitForFunction(() => window.__testMeter);
  await page.evaluate(async () => {
    const meter=window.__testMeter, ctx=meter.context;
    meter.disconnect(); const silent=ctx.createGain(); silent.gain.value=0; meter.connect(silent); silent.connect(ctx.destination);
    const buffer=ctx.createBuffer(1,ctx.sampleRate*2,ctx.sampleRate), data=buffer.getChannelData(0);
    let seed=41;
    for(let i=0;i<data.length;i++){seed=(seed*1664525+1013904223)>>>0;data[i]=(seed/4294967296-.5)*.45;}
    const source=ctx.createBufferSource(); source.buffer=buffer; source.loop=true; source.connect(meter); source.start(); window.__testNoise=source;
    await ctx.resume();
  });
  const visibleInk = () => {const c=document.querySelector('#desktopLayout > .lyric-music-fountain');return c&&!c.hidden&&c.width>0&&c.getContext('2d').getImageData(0,0,c.width,c.height).data.some((v,i)=>i%4===3&&v>10);};
  await page.waitForFunction(visibleInk);
  const playing=await page.evaluate(()=>{const c=document.querySelector('#desktopLayout > .lyric-music-fountain'),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;return {pixels:d.filter((v,i)=>i%4===3&&v>10).length,width:c.width,height:c.height,canClickThrough:getComputedStyle(c).pointerEvents==='none'};});
  await page.screenshot({animations:'disabled',path:'output/playwright/folia-fountain-desktop.png',scale:'css'});
  await page.evaluate(()=>window.__lyricTestAudio[0].pause());
  await page.waitForFunction(()=>{const c=document.querySelector('#desktopLayout > .lyric-music-fountain');return c.getContext('2d').getImageData(0,0,c.width,c.height).data.every((v,i)=>i%4!==3||v===0);});
  await page.evaluate(()=>window.__lyricTestAudio[0].play());
  await page.setViewportSize({width:390,height:844});
  if (await page.locator('#mobileLyricsPage').evaluate(n=>n.inert)) await page.locator('#mobileViewToggle').click();
  await page.waitForFunction(()=>{const c=document.querySelector('#mobileMainView > .lyric-music-fountain');return !c.hidden&&c.width>0&&c.getContext('2d').getImageData(0,0,c.width,c.height).data.some((v,i)=>i%4===3&&v>10);});
  await page.waitForFunction(()=>Math.abs(document.getElementById('mobileLyricsPage').getBoundingClientRect().left-document.getElementById('mobileMainView').getBoundingClientRect().left)<30);
  await page.screenshot({animations:'disabled',path:'output/playwright/folia-fountain-mobile.png',scale:'css'});
  await page.locator('#mobileViewToggle').click();
  await page.waitForFunction(()=>document.querySelector('#mobileMainView > .lyric-music-fountain').hidden);
  await page.locator('#mobileViewToggle').click();
  await page.evaluate(()=>window.__testNoise.stop());
  await page.waitForFunction(()=>{const c=document.querySelector('#mobileMainView > .lyric-music-fountain');return c.width>0&&c.getContext('2d').getImageData(0,0,c.width,c.height).data.every((v,i)=>i%4!==3||v===0);});
  await page.evaluate(()=>window.__lyricTestAudio[0].pause());
  return {playing,pauseClears:true,mobileResponds:true,hiddenStops:true,silenceClears:true,input:'Web Audio buffer → existing app AnalyserNode → zero gain → destination'};
}
