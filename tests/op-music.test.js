import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../sites/worker.js';
import { resolveOp } from '../sites/op-music.js';
import { createChannelClient } from '../sites/channel-http.js';

const request = (action, params = {}, init) => new Request(`https://player.example/api/v1/music/${action}?${new URLSearchParams({ source:'op-applemusic', id:'123', ...params })}`, init);
const path = '/api/v1/playbacks/opaque-task';
const task = (changes = {}) => ({ id:'opaque-task', platform:'applemusic', selected_id:'123', track_id:'123', status:'completed', quality:'hires', format:'m4a', title:'Track', artist:'Artist', album:'Album', duration:200, audio_url:`https://music.zr.wiki${path}/audio?rev=current`, ...changes });
const created = value => Response.json({ playback:value, status_url:path, audio_url:`${path}/audio?rev=old` });
function flac(sampleRate = 44100, bitDepth = 16) {
  const bytes = new Uint8Array(64); bytes.set(new TextEncoder().encode('fLaC')); bytes[7] = 34;
  new DataView(bytes.buffer).setBigUint64(18, (BigInt(sampleRate)<<44n) | (BigInt(bitDepth-1)<<36n)); return bytes;
}
const media = (bytes = flac()) => new Response(bytes, {status:206,headers:{'content-type':'audio/flac','content-range':'bytes 0-63/1000','content-length':'64'}});

test('OP search maps three platform namespaces, caps the first page and never repeats it', async () => {
  for (const [source, platform] of [['op-applemusic','applemusic'],['op-netease','netease'],['op-qq','tencent']]) {
    let count=0;
    const env={CHANNEL_FETCH:async(input,options)=>{
      count++;const url=new URL(input);assert.equal(url.origin,'https://music.op.wiki');assert.equal(url.searchParams.get('platform'),platform);assert.equal(url.searchParams.get('limit'),'20');
      assert.equal(options.headers.cookie,undefined);assert.match(options.headers['user-agent'],/^CPlayer5/);
      return Response.json([{platform,id:'123',song:'Track',singer:'Artist',cover:'http://p3.music.126.net/cover.jpg'},{platform:'wrong',id:'456',song:'Other'}]);
    }};
    const response=await worker.fetch(request('search',{source,keyword:'test',limit:30}),env);
    assert.equal(response.status,200);const songs=(await response.json()).data;assert.equal(songs.length,1);assert.equal(songs[0].cover,'https://p3.music.126.net/cover.jpg');
    assert.deepEqual((await (await worker.fetch(request('search',{source,keyword:'test',offset:20}),env)).json()).data,[]);assert.equal(count,1);
  }
});

test('OP no-match search is empty, while other 400 errors remain explicit failures',async()=>{
  for(const [detail,expected] of [['Apple Music 网页搜索没有找到歌曲',200],['平台不支持此参数',503]]){
    const response=await worker.fetch(request('search',{keyword:'华语'}),{CHANNEL_FETCH:async()=>Response.json({detail},{status:400})});
    assert.equal(response.status,expected);
    if(expected===200)assert.deepEqual((await response.json()).data,[]);
  }
});

test('OP polls once per second, uses latest completed URL and detects actual FLAC quality',async()=>{
  const calls=[];let statuses=0;
  const env={CHANNEL_FETCH:async(input,options)=>{
    const url=new URL(input);calls.push({url,method:options.method});
    assert.equal(options.headers.cookie,undefined);assert.equal(options.headers.authorization,undefined);
    if(options.method==='POST'){
      assert.deepEqual(JSON.parse(options.body),{platform:'applemusic',query:'123',selected_id:'123',quality:'hires',include_cover:false});
      return created(task({status:'queued',audio_url:`${path}/audio?rev=old`}));
    }
    if(url.pathname===path){statuses++;return Response.json(task({streaming_mode:'wasm_alac',streaming_url:'https://music.zr.wiki/unsupported'}));}
    assert.equal(url.href,`https://music.zr.wiki${path}/audio?rev=current`);
    assert.equal(options.headers.range,'bytes=0-63');return media();
  }};
  const response=await worker.fetch(request('song'),env);assert.equal(response.status,200);
  const data=(await response.json()).data;assert.equal(data.format,'flac');assert.equal(data.level,'lossless');assert.equal(data.sampleRate,44100);assert.equal(data.bitDepth,16);assert.equal(data.album,'Album');
  assert.equal(statuses,1);assert.equal(calls.filter(x=>x.method==='POST').length,1);assert.match(data.url,/level=hires/);
});

test('OP propagates Range/HEAD and reuses only completed metadata across requests',async()=>{
  let posts=0;
  const env={CHANNEL_FETCH:async(input,options)=>{
    if(options.method==='POST'){posts++;return created(task());}
    assert.equal(options.headers.cookie,undefined);
    if(options.headers.range==='bytes=0-63')return media(flac(96000,24));
    assert.equal(options.headers.range,'bytes=100-103');
    return new Response(options.method==='HEAD'?null:'data',{status:206,headers:{'content-type':'audio/flac','content-range':'bytes 100-103/1000','set-cookie':'secret=x'}});
  }};
  const data=(await (await worker.fetch(request('song',{level:'hires'}),env)).json()).data;
  assert.equal(data.level,'hires');assert.equal(data.sampleRate,96000);assert.equal(data.bitDepth,24);
  for(const method of ['GET','HEAD']){
    const response=await worker.fetch(new Request(new URL(data.url,'https://player.example'),{method,headers:{range:'bytes=100-103',cookie:'private=x'}}),env);
    assert.equal(response.status,206);assert.equal(response.headers.get('content-type'),'audio/flac');assert.equal(response.headers.get('content-range'),'bytes 100-103/1000');assert.equal(response.headers.get('set-cookie'),null);assert.equal(await response.text(),method==='GET'?'data':'');
  }
  assert.equal(posts,1);
});

test('OP maps every quality request and never labels compressed bytes as lossless',async()=>{
  for(const [level,quality] of [['standard','standard'],['exhigh','high'],['lossless','lossless'],['hires','hires']]){
    const response=await worker.fetch(request('song',{level}),{CHANNEL_FETCH:async(input,options)=>{
      if(options.method==='POST'){assert.equal(JSON.parse(options.body).quality,quality);return created(task({bitrate:320000}));}
      return media(new TextEncoder().encode('ID3 compressed mp3 fixture'));
    }});
    const data=(await response.json()).data;assert.equal(data.format,'mp3');assert.equal(data.level,'exhigh');assert.equal(data.br,320000);
  }
});

test('OP failures stop polling and preserve refusal status with Retry-After',async()=>{
  let calls=0;
  const failed=await worker.fetch(request('song'),{CHANNEL_FETCH:async()=>{calls++;return created(task({status:'failed',error:'upstream failed'}));}});
  assert.equal(failed.status,502);assert.match((await failed.json()).error.message,/此歌曲音质/);assert.equal(calls,1);
  for(const status of [401,402,403,429,503]){
    calls=0;const response=await worker.fetch(request('song'),{CHANNEL_FETCH:async()=>{calls++;return new Response(null,{status,headers:{'retry-after':'600'}});}});
    assert.equal(response.status,status);assert.equal(response.headers.get('retry-after'),'600');assert.equal(calls,1);
  }
});

test('OP cannot follow arbitrary status/media URLs or silently return another recording',async()=>{
  for(const change of [
    {audio_url:'https://music.zr.wiki.evil/api/v1/playbacks/opaque-task/audio'},
    {audio_url:'http://music.zr.wiki/api/v1/playbacks/opaque-task/audio'},
    {audio_url:'https://user:secret@music.zr.wiki/api/v1/playbacks/opaque-task/audio'},
    {audio_url:'https://music.zr.wiki/admin'},
    {audio_url:`https://music.zr.wiki${path}/audio/stream`},
    {audio_url:'https://music.zr.wiki/api/v1/playbacks/other/audio'},
    {track_id:'456'},{platform:'netease'},{status:'unknown'},
  ]){
    let calls=0;const response=await worker.fetch(request('song'),{CHANNEL_FETCH:async()=>{calls++;return created(task(change));}});
    assert.equal(response.status,502);assert.equal(calls,1);
  }
  for(const status_url of ['https://evil.example/task','https://user:secret@music.op.wiki'+path,'https://music.op.wiki/admin']){
    let calls=0;const response=await worker.fetch(request('song'),{CHANNEL_FETCH:async()=>{calls++;return Response.json({playback:task({status:'queued'}),status_url});}});
    assert.equal(response.status,502);assert.equal(calls,1);
  }
  let calls=0;const redirect=await worker.fetch(request('song'),{CHANNEL_FETCH:async()=>++calls===1?created(task()):new Response(null,{status:302,headers:{location:'https://127.0.0.1/private'}})});
  assert.equal(redirect.status,502);assert.equal(calls,2);
});

test('OP honors cancellation during preparation without repeating POST or reading media',async()=>{
  const abort=new AbortController();let calls=0;
  const client=createChannelClient(async()=>{calls++;return created(task({status:'streaming'}));},abort.signal);
  const pending=resolveOp('op-applemusic','123','hires',client);setTimeout(()=>abort.abort(),20);
  await assert.rejects(pending,e=>e.name==='AbortError');assert.equal(calls,1);
});

test('OP preparation has a finite poll limit without returning a premature audio URL',async()=>{
  let posts=0,gets=0;
  const response=await worker.fetch(request('song'),{CHANNEL_FETCH:async(input,options)=>{
    assert.equal(new URL(input).hostname,'music.op.wiki');
    if(options.method==='POST'){posts++;return created(task({status:'queued'}));}
    gets++;return Response.json(task({status:'processing'}));
  }});
  assert.equal(response.status,503);assert.equal(posts,1);assert.equal(gets,7);
});

test('OP cancels an ignored Range after a prefix and rejects HTML disguised as audio',async()=>{
  let cancelled=false;
  const data=(await (await worker.fetch(request('song'),{CHANNEL_FETCH:async(input,options)=>{
    if(options.method==='POST')return created(task());
    return new Response(new ReadableStream({start(c){c.enqueue(flac());},cancel(){cancelled=true;}}),{headers:{'content-type':'audio/flac'}});
  }})).json()).data;
  assert.equal(data.level,'lossless');assert.equal(cancelled,true);
  const response=await worker.fetch(request('song'),{CHANNEL_FETCH:async(input,options)=>options.method==='POST'?created(task()):media(new TextEncoder().encode('<html>Denied</html>'))});
  assert.equal(response.status,502);
});

test('OP lyrics use the song ID and respect unavailable responses',async()=>{
  for(const available of [true,false]){
    const response=await worker.fetch(request('lyric'),{CHANNEL_FETCH:async input=>{
      const url=new URL(input);assert.equal(url.pathname,'/api/v1/lyrics');assert.equal(url.searchParams.get('track_id'),'123');return Response.json({available,plain:'[00:01]hello',translation:'[00:01]你好'});
    }});
    assert.equal((await response.json()).data.lrc,available?'[00:01]hello':'');
  }
});
