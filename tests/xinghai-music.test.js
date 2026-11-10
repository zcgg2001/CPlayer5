import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../sites/worker.js';
import { resolveXinghai } from '../sites/xinghai-music.js';
import { createChannelClient } from '../sites/channel-http.js';
const origin = 'https://player.example';
const request = (action = 'song', params = {}, init) => new Request(`${origin}/api/v1/music/${action}?${new URLSearchParams({ source:'xinghai-netease', id:'259138', level:'hires', ...params })}`, init);
const mp3 = new TextEncoder().encode('ID3 compressed audio fixture for testing');
function flac(rate, depth) {
  const bytes = new Uint8Array(64);bytes.set(new TextEncoder().encode('fLaC'));bytes[7]=34;
  new DataView(bytes.buffer).setBigUint64(18,(BigInt(rate)<<44n)|(BigInt(depth-1)<<36n));return bytes;
}
function fixture({ payload = {}, bytes = mp3, resolve, audio, token } = {}) {
  const calls = [], devices = [], tokens = [];let tokenCount=0;
  const fetch = async (input, options) => {
    const url=new URL(input);calls.push({url,options});assert.equal(options.redirect,'manual');
    assert.equal(options.headers.cookie,undefined);assert.equal(options.headers.authorization,undefined);
    assert.match(options.headers['user-agent'],/^CPlayer5/);
    if(url.hostname==='yy.zddyr.top') {
      assert.equal(url.protocol,'https:');
      if(url.pathname.endsWith('/token.php')) {
        assert.equal(options.headers['x-token'],undefined);assert.equal(options.headers['x-license'],undefined);
        devices.push(url.searchParams.get('device_id'));const value=`server-token-${++tokenCount}`;tokens.push(value);
        return token ? token() : Response.json({code:0,data:{token:value}});
      }
      assert.equal(url.pathname,'/lx/api/');assert.ok(tokens.includes(options.headers['x-token']));
      return resolve ? resolve(url,options) : Response.json({code:200,url:`http://${url.searchParams.get('source')==='qq'?'aqqmusic.tc.qq.com':'m801.music.126.net'}/song.mp3?signed=private`,br:128000,quality:'hires',auth:{private:'never-return'},...payload});
    }
    assert.equal(url.protocol,'https:');assert.equal(options.headers['x-token'],undefined);assert.equal(options.headers['x-license'],undefined);assert.equal(options.headers['x-client'],undefined);
    return audio ? audio(url,options) : new Response(bytes,{status:206,headers:{'content-type':'audio/mpeg'}});
  };
  return {fetch,calls,devices,tokens};
}

test('Xinghai maps native IDs/qualities, scopes credentials and reports actual compressed quality',async()=>{
  for(const [source,id,platform] of [['xinghai-netease','259138','wy'],['xinghai-qq','mid123','qq']]) for(const [level,quality] of [['standard','128k'],['exhigh','320k'],['lossless','flac'],['hires','hires']]) {
    const f=fixture();const response=await worker.fetch(request('song',{source,id,level}),{CHANNEL_FETCH:f.fetch,XINGHAI_LICENSE:'private-license'});
    assert.equal(response.status,200);const text=await response.text(),{data}=JSON.parse(text);
    assert.equal(data.format,'mp3');assert.equal(data.level,'standard');assert.equal(data.br,128000);assert.equal(data.downloadAllowed,false);
    assert.doesNotMatch(text,/server-token|private-license|signed|never-return|yy\.zddyr|music\.126/);
    const api=f.calls[1];assert.equal(api.url.searchParams.get('source'),platform);assert.equal(api.url.searchParams.get('songmid'),id);assert.equal(api.url.searchParams.get('quality'),quality);assert.equal(api.options.headers['x-license'],'private-license');
    assert.equal(f.calls.length,3);assert.equal(f.calls[2].options.headers.range,'bytes=0-63');
  }
});

test('Xinghai measures FLAC sample rate/bit depth independently of requested tier or suffix',async()=>{
  for(const [rate,depth,level] of [[44100,16,'lossless'],[96000,24,'hires']]) {
    const f=fixture({bytes:flac(rate,depth)});
    const response=await worker.fetch(request('song',{level:'standard'}),{CHANNEL_FETCH:f.fetch});const {data}=await response.json();
    assert.equal(data.level,level);assert.equal(data.format,'flac');assert.equal(data.sampleRate,rate);assert.equal(data.bitDepth,depth);
  }
});

test('Xinghai refreshes explicit expired-token errors only once with the same device ID',async()=>{
  for(const auth of [{tk_mismatch:true},{device_id:'untrusted-token'},{tk_error:'expired'}]) {
    let resolutions=0;
    const f=fixture({resolve:()=>++resolutions===1?Response.json({code:403,auth},{status:403}):Response.json({code:200,url:'https://m801.music.126.net/song.mp3'})});
    const response=await worker.fetch(request(),{CHANNEL_FETCH:f.fetch});assert.equal(response.status,200);assert.equal(f.tokens.length,2);assert.equal(new Set(f.devices).size,1);
  }
  const f=fixture({resolve:()=>Response.json({code:403,auth:{tk_mismatch:true}},{status:403})});
  const response=await worker.fetch(request(),{CHANNEL_FETCH:f.fetch});assert.equal(response.status,401);assert.equal(f.tokens.length,2);
});

test('Xinghai preserves ordinary refusals and rate limits without refresh loops or error leaks',async()=>{
  for(const status of [401,402,403,429,503]) {
    const f=fixture({resolve:()=>Response.json({code:status,msg:'secret upstream diagnostics'},{status,headers:{'retry-after':'600'}})});
    const response=await worker.fetch(request(),{CHANNEL_FETCH:f.fetch});assert.equal(response.status,status===503?502:status);assert.equal(response.headers.get('retry-after'),'600');assert.equal(f.tokens.length,1);assert.doesNotMatch(await response.text(),/secret upstream/);
  }
  const f=fixture({resolve:()=>Response.json({code:403,msg:'private-license'})});assert.equal((await worker.fetch(request(),{CHANNEL_FETCH:f.fetch})).status,403);assert.equal(f.tokens.length,1);
  const noToken=fixture({token:()=>Response.json({code:0,data:{}})});assert.equal((await worker.fetch(request(),{CHANNEL_FETCH:noToken.fetch})).status,502);assert.equal(noToken.calls.length,1);
});

test('Xinghai blocks unexpected/encrypted audio and API redirects before sending credentials elsewhere',async()=>{
  for(const payload of [
    {url:'http://127.0.0.1/a.mp3'}, {url:'https://m801.music.126.net.evil/a.mp3'},
    {url:'https://user:pass@m801.music.126.net/a.mp3'}, {url:'https://m801.music.126.net:444/a.mp3'},
    {url:'https://m801.music.126.net/admin'}, {encrypted:true}, {ekey:'secret'}, {key:'secret'},
    {url:'https://m801.music.126.net/a.mp3?ekey=secret'},
  ]) {
    const f=fixture({payload});assert.equal((await worker.fetch(request(),{CHANNEL_FETCH:f.fetch})).status,502);assert.equal(f.calls.length,2);
  }
  const f=fixture({resolve:()=>new Response(null,{status:302,headers:{location:'https://evil.example'}})});
  assert.equal((await worker.fetch(request(),{CHANNEL_FETCH:f.fetch})).status,502);assert.equal(f.calls.length,2);
  const redirected=fixture({audio:()=>new Response(null,{status:302,headers:{location:'https://evil.example/a.mp3'}})});
  assert.equal((await worker.fetch(request(),{CHANNEL_FETCH:redirected.fetch})).status,502);assert.equal(redirected.calls.length,3);
});

test('Xinghai isolates concurrent tokens and license changes; streams Range/HEAD without auth headers',async()=>{
  const licenses=[];
  const f=fixture({resolve:(_url,options)=>{licenses.push(options.headers['x-license']);return Response.json({code:200,url:'http://m801.music.126.net/song.mp3'});},audio:(_url,options)=>{
    if(options.headers.range==='bytes=0-63')return new Response(mp3,{status:206});
    assert.equal(options.headers.range,'bytes=100-103');
    return new Response(options.method==='HEAD'?null:'data',{status:206,headers:{'content-type':'audio/mpeg','content-range':'bytes 100-103/1000','set-cookie':'private=x'}});
  }});
  const responses=await Promise.all(['license-a','license-b'].map(XINGHAI_LICENSE=>worker.fetch(request(),{CHANNEL_FETCH:f.fetch,XINGHAI_LICENSE})));
  for(const r of responses)assert.equal(r.status,200);assert.equal(new Set(f.devices).size,2);assert.deepEqual(new Set(licenses),new Set(['license-a','license-b']));
  for(const method of ['GET','HEAD']) {
    const r=await worker.fetch(request('audio',{}, {method,headers:{range:'bytes=100-103',cookie:'session=private'}}),{CHANNEL_FETCH:f.fetch});
    assert.equal(r.status,206);assert.equal(r.headers.get('content-range'),'bytes 100-103/1000');assert.equal(r.headers.get('set-cookie'),null);assert.equal(await r.text(),method==='HEAD'?'':'data');
  }
  assert.equal(f.tokens.length,4);assert.equal(licenses.at(-1),undefined);
});

test('Xinghai cancels oversized JSON and prefix streams even when upstream ignores Range',async()=>{
  let canceled=false;
  const f=fixture({audio:()=>new Response(new ReadableStream({pull(c){c.enqueue(mp3);},cancel(){canceled=true;}}))});
  assert.equal((await worker.fetch(request(),{CHANNEL_FETCH:f.fetch})).status,200);assert.equal(canceled,true);
  const huge=fixture({token:()=>new Response('x'.repeat(128*1024+1))});assert.equal((await worker.fetch(request(),{CHANNEL_FETCH:huge.fetch})).status,502);assert.equal(huge.calls.length,1);
  const controller=new AbortController();controller.abort();
  const client=createChannelClient(async(_url,options)=>{options.signal.throwIfAborted();},controller.signal);
  await assert.rejects(resolveXinghai('xinghai-netease','1','hires',client),{name:'AbortError'});
});

test('Xinghai search and lyrics reuse public catalogs without contacting the token service',async()=>{
  for(const source of ['xinghai-netease','xinghai-qq']) {
    const fetch=async(input)=>{
      const url=new URL(input);assert.notEqual(url.hostname,'yy.zddyr.top');
      if(url.hostname==='interface.music.163.com')return Response.json({code:200,result:{songs:[{id:1,name:'Track',ar:[{name:'Artist'}]}]}});
      if(url.hostname==='interface3.music.163.com')return Response.json({lrc:{lyric:'[00:00]Netease'}});
      if(url.hostname==='u.y.qq.com')return Response.json({code:0,'music.search.SearchCgiService.DoSearchForQQMusicMobile':{code:0,data:{body:{item_song:[{mid:'mid123',name:'Track'}]}}}});
      return Response.json({lyric:Buffer.from('[00:00]QQ').toString('base64')});
    };
    const env={CHANNEL_FETCH:fetch};const search=await worker.fetch(request('search',{source,keyword:'Track'}),env);assert.equal(search.status,200);assert.equal((await search.json()).data.length,1);
    const lyric=await worker.fetch(request('lyric',{source,id:source.endsWith('qq')?'mid123':'1'}),env);assert.equal(lyric.status,200);assert.match((await lyric.json()).data.lrc,/\[00:00\]/);
  }
});
