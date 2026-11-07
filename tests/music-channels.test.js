import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../sites/worker.js';
import { MusicService, MUSIC_SOURCE_OPTIONS } from '../js/music-service.js';
import { MUSIC_CHANNELS, channelTrackId } from '../js/music-channels.js';

const request = (source, action, params = {}, headers = {}) => new Request(`https://player.example/api/v1/music/${action}?${new URLSearchParams({source,...params})}`,{headers});
const payload = (data, init) => Response.json(data, init);

for (const [source, channel] of Object.entries(MUSIC_CHANNELS)) {
  test(`${source} retains its identity through search, queue, playback and lyrics`, async () => {
    const service = new MusicService({storage:null,location:{search:`?source=${source}`}});
    const id = source.startsWith('jianbin-') ? 'https://www.jbsou.cn/api.php?get=url&type=qq&id=123&sign=fixture&t=1' : '123';
    const songs = await service.search('same name', { fetchImpl: async () => payload({code:200,data:[{id,name:'Track',artist:'Artist'}]}) });
    assert.equal(songs[0].id, channelTrackId(source,id));
    assert.equal(songs[0].sourceId,id);
    assert.equal(songs[0].provider,source);
    service.config.source = 'gd';
    const urls=[];
    const fetchImpl=async url=>{
      urls.push(new URL(url,'https://player.example'));
      return payload(url.includes('/lyric?') ? {code:200,data:{lrc:'[00:01]hello'}} : {code:200,data:{id,url:'/api/v1/music/audio?source=fixture',format:'mp3',level:'standard',br:0}});
    };
    const resolved=await service.getSong(songs[0].id,{song:songs[0],fetchImpl});
    assert.equal(resolved.id,songs[0].id);
    assert.equal(resolved.format,'mp3');
    assert.equal(resolved.level,'standard');
    assert.equal((await service.getLyric(songs[0].id,{song:resolved,fetchImpl})).lrc,'[00:01]hello');
    for(const url of urls){assert.equal(url.searchParams.get('source'),source);assert.equal(url.searchParams.get('id'),id);}
    assert.equal(MUSIC_SOURCE_OPTIONS[source].platform, channel.platform);
  });
}

test('different platforms and channels cannot collide in the queue', () => {
  const ids=Object.keys(MUSIC_CHANNELS).map(source=>channelTrackId(source,'123'));
  assert.equal(new Set(ids).size,ids.length);
});

test('each added channel discovers music without invoking ChKSz',async()=>{
  for (const source of Object.keys(MUSIC_CHANNELS)) {
    const service=new MusicService({storage:null,location:{search:`?source=${source}`}});
    await service.getNewSongs({fetchImpl:async url=>{
      assert.match(url,/\/search\?/);assert.equal(new URL(url,'https://p').searchParams.get('source'),source);
      return payload({code:200,data:[]});
    }});
  }
});

test('Meting exposes actual FLAC and streams HTTPS ranges without leaking upstream cookies',async()=>{
  const calls=[];
  const env={CHANNEL_FETCH:async (input,options)=>{
    const url=new URL(input);calls.push(url);
    if(url.hostname==='api.qijieya.cn')return new Response(null,{status:302,headers:{location:'https://m701.music.126.net/track.flac'}});
    assert.equal(url.hostname,'m701.music.126.net');
    assert.equal(options.headers.range,'bytes=0-3');assert.equal(options.headers.cookie,undefined);
    return new Response('fLaC',{status:206,headers:{'content-type':'audio/flac','content-range':'bytes 0-3/100','set-cookie':'upstream=private'}});
  }};
  const song=await (await worker.fetch(request('netease','song',{id:'123',level:'lossless'}),env)).json();
  assert.equal(song.data.format,'flac');assert.equal(song.data.level,'lossless');assert.equal(song.data.br,0);
  assert.match(song.data.url,/^\/api\/v1\/music\/audio/);
  const response=await worker.fetch(new Request(new URL(song.data.url,'https://player.example'),{headers:{range:'bytes=0-3',cookie:'user=private'}}),env);
  assert.equal(response.status,206);assert.equal(await response.text(),'fLaC');
  assert.equal(response.headers.get('set-cookie'),null);assert.equal(response.headers.get('content-range'),'bytes 0-3/100');
  assert.equal(calls.filter(url=>url.hostname==='api.qijieya.cn').length,1);
});

test('VKeys HTTP audio remains behind the same-origin HTTPS endpoint and does not claim lossless',async()=>{
  const env={CHANNEL_FETCH:async (input,options)=>{
    const url=new URL(input);
    if(url.hostname==='api.vkeys.cn')return payload({code:200,data:{url:'http://ws.stream.qqmusic.qq.com/song.mp3',kbps:'319'}});
    assert.equal(url.protocol,'http:');assert.equal(options.headers.range,'bytes=0-3');
    return new Response('ID3!',{status:206,headers:{'content-type':'audio/mpeg'}});
  }};
  const song=await (await worker.fetch(request('qq','song',{id:'mid123',level:'lossless'}),env)).json();
  assert.equal(song.data.format,'mp3');assert.equal(song.data.level,'exhigh');assert.equal(song.data.br,319000);
  const response=await worker.fetch(new Request(new URL(song.data.url,'https://player.example'),{headers:{range:'bytes=0-3'}}),env);
  assert.equal(response.status,206);assert.equal(await response.text(),'ID3!');
});

test('51ape bootstraps a new session before resolving a saved queue entry',async()=>{
  let calls=0;
  const env={CHANNEL_FETCH:async(input,options)=>{
    calls++;const url=new URL(input);
    if(!url.search)return new Response('<html>Home</html>',{headers:{'set-cookie':'sid=fixture; HttpOnly'}});
    assert.equal(url.searchParams.get('action'),'geturl');assert.equal(options.headers.cookie,'sid=fixture');
    return payload({code:1,url:'https://aqqmusic.tc.qq.com/song.mp3'});
  }};
  const response=await worker.fetch(request('at38-qq','song',{id:'mid123'}),env);
  assert.equal(response.status,200);assert.equal(calls,2);
});

test('channel inputs and redirects cannot turn audio or image routes into an open proxy',async()=>{
  let calls=0;
  const env={CHANNEL_FETCH:async()=>{calls++;throw new Error('Must not fetch');}};
  for (const id of ['http://127.0.0.1/','https://www.jbsou.cn.evil/api.php?get=url&type=qq&id=1','https://www.jbsou.cn/admin?get=url&type=qq&id=1','https://www.jbsou.cn/api.php?get=pic&type=qq&id=1','https://www.jbsou.cn/api.php?get=url&type=wy&id=1']) {
    assert.equal((await worker.fetch(request('jianbin-qq','song',{id}),env)).status,400);
  }
  assert.equal(calls,0);
  for (const target of ['http://127.0.0.1/track.mp3','https://ws.stream.qqmusic.qq.com.evil/track.mp3','https://user:pass@ws.stream.qqmusic.qq.com/track.mp3','https://ws.stream.qqmusic.qq.com:8443/track.mp3']){
    let count=0;
    const response=await worker.fetch(request('netease','audio',{id:'1'}),{CHANNEL_FETCH:async()=>{count++;return new Response(null,{status:302,headers:{location:target}});}});
    assert.equal(response.status,502);assert.equal(count,1);
  }
});

test('audio HTML errors and unsafe secondary redirects become isolated JSON failures',async()=>{
  for(const second of [new Response('<html>denied</html>',{headers:{'content-type':'text/html'}}),new Response(null,{status:302,headers:{location:'http://169.254.169.254/private.mp3'}})]){
    let calls=0;
    const env={CHANNEL_FETCH:async()=>++calls===1?new Response(null,{status:302,headers:{location:'https://m701.music.126.net/audio.flac'}}):second};
    const response=await worker.fetch(request('netease','audio',{id:'1'}),env);
    assert.equal(response.status,502);assert.equal((await response.json()).error.code,'channel_error');assert.equal(calls,2);
  }
});

test('VKeys keeps QQ mids when official search falls back to the 51ape catalog',async()=>{
  const hosts=[];
  const response=await worker.fetch(request('qq','search',{keyword:'test',limit:'10'}),{CHANNEL_FETCH:async input=>{
    const url=new URL(input);hosts.push(url.hostname);
    if(url.hostname==='u.y.qq.com')return payload({code:1000});
    return new Response('<div class="music-card" data-id="mid123" data-type="qq"><div class="music-info"><h3>Track</h3><p>歌手：Artist | 专辑：Album | 来源：QQ</p></div></div>');
  }});
  assert.equal(response.status,200);
  assert.equal((await response.json()).data[0].id,'mid123');
  assert.deepEqual(hosts,['u.y.qq.com','www.at38.cn']);
});
