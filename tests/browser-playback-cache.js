// Execute via Tabbit against the built local server on port 8808.
// Actual HTMLAudioElement decoding with a controlled 600 ms resolver delay.
const origin='http://127.0.0.1:8808', requests=[];
const wav=Buffer.alloc(44+8000*2*10);
wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);
wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);
wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);
wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
await page.route(`${origin}/api/v1/music/**`,async route=>{
  const url=new URL(route.request().url()), source=url.searchParams.get('source'), id=url.searchParams.get('id'), level=url.searchParams.get('level');
  requests.push({action:url.pathname.split('/').pop(),source,id,level});
  if(url.pathname.endsWith('/lyric'))return route.fulfill({json:{code:200,data:{lrc:'[00:00]测试'}}});
  if(url.pathname.endsWith('/song')){
    await new Promise(r=>setTimeout(r,600));
    return route.fulfill({json:{code:200,data:{id,name:'测试',artist:'测试艺人',url:`${origin}/cache-fixture.wav?id=${id}`,level}}});
  }
  return route.fulfill({json:{code:200,data:[]}});
});
await page.route(`${origin}/cache-fixture.wav*`,async route=>{
  const range=route.request().headers()['range']?.match(/^bytes=(\d+)-(\d*)$/);
  const start=range?Number(range[1]):0,end=range?.[2]?Math.min(Number(range[2]),wav.length-1):wav.length-1;
  await route.fulfill({status:range?206:200,contentType:'audio/wav',headers:{'accept-ranges':'bytes',...(range?{'content-range':`bytes ${start}-${end}/${wav.length}`}:{})},body:wav.subarray(start,end+1)});
});
try {
  await page.goto(`${origin}/offline.html`,{waitUntil:'domcontentloaded'});
  const result=await page.evaluate(async()=>{
    const {MusicService}=await import('/js/music-service.js');
    const {createPlaybackController}=await import('/js/playback-controller.js');
    const {createQueueStore}=await import('/js/queue-store.js');
    const service=new MusicService({storage:null,location:{search:''}});service.getRuntimePolicy=async()=>null;
    const audio=new Audio();audio.muted=true;
    const queue=createQueueStore();queue.state.playMode='order';
    const first={id:'123',provider:'gd',name:'测试一',artist:'测试艺人'},next={id:'op-qq:mid2',sourceId:'mid2',provider:'op-qq',preferredProvider:'op-qq',name:'测试二',artist:'测试艺人'};
    queue.restore({songs:[first,next]},first.id);
    const controller=createPlaybackController({audio,musicService:service,queueStore:queue});
    const errors=[],view={onError:error=>errors.push(String(error))};
    try {
      let began=performance.now();await controller.load(first.id,first,view);const coldMs=performance.now()-began;
      await controller.preloadNext();
      began=performance.now();await controller.load(next.id,next,view);const preparedMs=performance.now()-began;
      const played={provider:controller.state.currentSong.provider,level:controller.state.currentSong.level,cacheHit:controller.state.currentSong.routing.cacheHit};
      await new Promise(r=>setTimeout(r,250));const advanced=audio.currentTime;
      await controller.changeQuality('standard',view);
      return {coldMs,preparedMs,played,advanced,qualityAfterChange:controller.state.currentSong.level,errors};
    } finally {controller.stop();}
  });
  assert.equal(result.errors.length,0);assert.equal(result.played.provider,'op-qq');assert.equal(result.played.level,'hires');assert.equal(result.played.cacheHit,true);
  assert.ok(result.advanced>0);assert.equal(result.qualityAfterChange,'standard');
  const resolutions=requests.filter(r=>r.action==='song');
  assert.equal(resolutions.length,3);assert.equal(resolutions.filter(r=>r.id==='mid2'&&r.level==='hires').length,1);
  assert.equal(requests.some(r=>r.source==='chksz'),false);
  return {...result,resolutions,chkszRequests:0};
} finally {await page.unrouteAll({behavior:'ignoreErrors'});}
