import test from 'node:test';
import assert from 'node:assert/strict';
import { artworkUrl, artworkCandidates, directArtworkUrl, fallbackArtwork, createArtworkResolver, createArtworkPresenter, loadArtworkImage, bindArtwork, retryArtworkBindings } from '../js/artwork.js';
import { cleanSong, imageURL } from '../js/library-data.js';
import { createPersonalLibraryStore } from '../js/personal-library-store.js';
import { createAccountLibrary } from '../js/account-library.js';
import { aggregateSongs } from '../js/music-catalog.js';

const song = { id:'167876', provider:'xinghai-netease', name:'有何不可', artist:'许嵩', album:'自定义' };
const native = 'https://p1.music.126.net/album.jpg';
const baseUrl = 'https://player.test/';
const metadata = (cover = native) => Response.json({code:200,data:{id:song.id,cover}});

test('cover sizing unwraps our proxy, preserves signatures and never accepts active URLs', () => {
  const proxied = artworkUrl(`/api/cover?url=${encodeURIComponent(native)}`,160,baseUrl);
  assert.equal(new URL(new URL(proxied,baseUrl).searchParams.get('url')).searchParams.get('param'),'160y160');
  const signed = `${native}?token=keep&param=900y900`;
  assert.equal(new URL(artworkUrl(signed,160,baseUrl),baseUrl).searchParams.get('url'),signed);
  assert.equal(artworkUrl('javascript:alert(1)',160,baseUrl),'');
  assert.equal(artworkUrl('data:image/svg+xml,<svg onload="alert(1)"/>',160,baseUrl),'');
  assert.equal(artworkUrl('https://user:pass@p1.music.126.net/a',160,baseUrl),'');
  const picture = '/api/v1/music/cover?source=gd&id=109951169829246225';
  assert.deepEqual(artworkCandidates({cover:picture},80,baseUrl),[new URL(picture,baseUrl).href]);
});

test('fallback is stable per album and never embeds untrusted titles', () => {
  const first=fallbackArtwork(song);
  assert.equal(first.url,fallbackArtwork({...song,name:'另一首'}).url);
  assert.notEqual(first.url,fallbackArtwork({...song,album:'另一张专辑'}).url);
  assert.equal(first.colors.length,4);
  assert.doesNotMatch(decodeURIComponent(fallbackArtwork({name:'<script>alert(1)</script>'}).url),/script|alert/);
});

test('cross-source art requires the same release, artist and version; QQ mids remain distinct from numeric IDs', () => {
  const sources=[{...song,cover:native},{...song,album:'精选集',cover:'https://p1.music.126.net/wrong.jpg'},{...song,name:'有何不可 (Live)',cover:'https://p1.music.126.net/live.jpg'}];
  assert.deepEqual(artworkCandidates({...song,sources},640,baseUrl), [artworkUrl(native,640,baseUrl),artworkUrl(native,0,baseUrl)]);
  assert.equal(artworkCandidates({albumEntity:{id:'12345678901234'}},640,baseUrl).length,0);
  const qq=artworkCandidates({albumEntity:{mid:'003RMaRI1iFoYd'}},640,baseUrl);
  assert.equal(qq.length,2);assert.ok(qq.every(url => url.includes('003RMaRI1iFoYd')));
  const recording = {id:'0039MnYb0qxYhV',provider:'qq',name:'晴天',artist:'周杰伦',album:'叶惠美',isrc:'TWABC0300001'};
  const [group] = aggregateSongs([recording,{...recording,id:'123',provider:'netease',album:'精选集',cover:native}]);
  assert.equal(group.sources.length,2);assert.deepEqual(artworkCandidates(group,80,baseUrl),[]);
});

test('working supplied artwork does not trigger metadata calls', async () => {
  const resolver=createArtworkResolver({baseUrl,loadImage:async()=>{},fetchImpl:async()=>{assert.fail('unnecessary metadata request');}});
  const result=await resolver.resolve({...song,cover:native});
  assert.equal(result.status,'ready');
  assert.match(result.url,/album.jpg/);
});

test('broken artwork falls back to native-ID metadata and reuses the successful result', async () => {
  const requests=[],images=[];
  const resolver=createArtworkResolver({baseUrl,loadImage:async url=>{images.push(url);if(url.includes('broken'))throw new Error('broken');},fetchImpl:async url=>{requests.push(url);return metadata();}});
  const track={...song,cover:'https://p1.music.126.net/broken.jpg'};
  assert.equal((await resolver.resolve(track)).status,'ready');
  assert.equal(requests.length,1);assert.match(requests[0],/artwork=1/);
  assert.deepEqual(images,[artworkUrl(track.cover,640,baseUrl),track.cover+'?param=640y640',artworkUrl(track.cover,0,baseUrl),track.cover,artworkUrl(native,640,baseUrl)]);
  await resolver.resolve(track);
  assert.equal(requests.length,1);assert.equal(images.length,5);
});

test('audio source switching retains the original artwork ID, not the new provider namespace', async () => {
  const requests=[];
  const resolver=createArtworkResolver({baseUrl,loadImage:async()=>{},fetchImpl:async url=>{requests.push(url);return metadata();}});
  const result=await resolver.resolve({...song,provider:'qq',cover:'https://y.gtimg.cn/other.jpg',artworkSource:song});
  assert.equal(result.status,'ready');assert.match(requests[0],new RegExp(`id=${song.id}`));
  requests.length=0;
  await resolver.resolve({...song,provider:'netease',artworkSource:{...song,provider:'gequke'},sources:[{...song,album:'另一张专辑'}]});
  assert.equal(requests.length,0);
});

test('transient image/metadata failures expire quickly, while genuine misses are cached longer', async () => {
  let now=1000,calls=0;
  const resolver=createArtworkResolver({baseUrl,now:()=>now,fetchImpl:async()=>{calls++;return new Response(null,{status:calls===1?502:404});}});
  assert.equal((await resolver.resolve(song)).status,'fallback');
  await resolver.resolve(song);assert.equal(calls,1);
  now+=31000;await resolver.resolve(song);assert.equal(calls,2);
  now+=31000;await resolver.resolve(song);assert.equal(calls,2);
  now+=300000;await resolver.resolve(song);assert.equal(calls,3);
});

test('wrong metadata IDs never produce artwork and external aborts do not poison the cache', async () => {
  let calls=0;
  const resolver=createArtworkResolver({baseUrl,fetchImpl:async()=>Response.json({code:200,data:{id:'99',cover:native}}),loadImage:async()=>{calls++;}});
  assert.equal((await resolver.resolve(song)).status,'fallback');assert.equal(calls,0);
  const controller=new AbortController();controller.abort();
  await assert.rejects(resolver.resolve(song,{signal:controller.signal}));
});

test('image requests have a deadline and detach listeners on cancellation', async () => {
  let img;
  class PendingImage {constructor(){img=this;} removeAttribute(){this.src='';}}
  await assert.rejects(loadArtworkImage(native,{ImageClass:PendingImage,timeoutMs:5}),/timed out/);
  assert.equal(img.onload,null);assert.equal(img.onerror,null);assert.equal(img.src,'');
  const controller=new AbortController();const pending=loadArtworkImage(native,{ImageClass:PendingImage,signal:controller.signal});
  controller.abort();await assert.rejects(pending);assert.equal(img.onload,null);
});

function imageNode() {return {dataset:{},style:{},classList:{add(){}},removeAttribute(){}};}
test('a rebound list row ignores late probes and falls back once on display failure', async () => {
  const pending = [], image = imageNode();
  const resolver = {resolve: () => new Promise(resolve => pending.push(resolve))};
  bindArtwork(image, song, {resolver});
  await Promise.resolve();
  bindArtwork(image, {...song,id:'2'}, {resolver});
  await Promise.resolve();
  pending[1]({url:native,status:'ready'});
  await new Promise(resolve => setImmediate(resolve));
  pending[0]({url:'https://p1.music.126.net/stale.jpg',status:'ready'});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(image.dataset.artworkState,'ready');assert.equal(image.src,native);
  image.onerror();assert.equal(image.dataset.artworkState,'fallback');assert.match(image.src,/^data:image\/svg/);assert.equal(image.onerror,null);
});

test('missing thumbnail tries the original rendition before any metadata lookup', async () => {
  const attempts = [];
  const resolver = createArtworkResolver({ baseUrl, fetchImpl: assert.fail, loadImage: async url => {
    attempts.push(url);
    if (url.includes('param')) throw Error('Thumbnail missing');
  } });
  assert.equal((await resolver.resolve({...song,cover:native},{size:80})).url, artworkUrl(native,0,baseUrl));
  assert.equal(attempts.length,3);
});

test('same QQ song uses one exact MID lookup across rows; other recordings and collections stay separate', async () => {
  const qq = {id:'op-qq:0039MnYb0qxYhV',provider:'op-qq',name:'晴天',artist:'周杰伦'};
  const requests = [];
  const resolver = createArtworkResolver({ baseUrl, loadImage: async () => {}, fetchImpl: async url => {
    requests.push(url);
    return Response.json({code:200,data:{id:'0039MnYb0qxYhV',albumMid:'000MkMni19ClKG'}});
  } });
  const results = await Promise.all([80,320].map(size => resolver.resolve(qq,{size})));
  assert.ok(results.every(result => result.status === 'ready' && result.url.includes('000MkMni19ClKG')));
  assert.equal(resolver.knownCover({...qq,sourceId:qq.id}),resolver.knownCover(qq));
  assert.equal(resolver.knownCover({...qq,id:'97773',mid:'0039MnYb0qxYhV'}),resolver.knownCover(qq));
  assert.deepEqual(requests,['/api/v1/music/metadata?source=qq&id=0039MnYb0qxYhV&artwork=1']);
  const other = {...qq,id:'op-qq:004Fs2FP1EvZYc'};
  assert.equal((await resolver.resolve(other)).status,'fallback');
  assert.equal(resolver.knownCover(other),'');
  for (const item of [{...qq,type:'playlist'},{...qq,id:'op-qq:%xx'},{...qq,id:'op-qq:123'},{...qq,id:'12345678901234'}]) {
    assert.equal((await resolver.resolve(item)).status,'fallback');
  }
  assert.equal(requests.length,2);
});

test('canceling one view releases it immediately while the same MID still resolves for another', async () => {
  let complete;
  const response = new Promise(resolve => {complete = resolve;});
  const resolver = createArtworkResolver({baseUrl,loadImage:async()=>{},fetchImpl:()=>response});
  const controller = new AbortController();
  const first = resolver.resolve(song,{signal:controller.signal}),second = resolver.resolve(song);
  controller.abort();
  await assert.rejects(first,{name:'AbortError'});
  complete(metadata());
  assert.equal((await second).status,'ready');
});

test('GD and QQ cover references survive queue, favorites and a cold start, including an old favorite without art', async () => {
  const db = new Map();
  const storage = {getItem: key => db.get(key), setItem: (key,value) => db.set(key,value)};
  const gd = {id:'167827',provider:'gd',name:'素颜',artist:'许嵩, 何曼婷',cover:'/api/v1/music/cover?source=gd&id=109951169829246225'};
  const qq = {id:'op-qq:0039MnYb0qxYhV',provider:'op-qq',name:'晴天',artist:'周杰伦'};
  let queue = [gd,qq];
  const player = {queue:()=>queue,setQueue:songs=>{queue=songs;}};
  const resolver = createArtworkResolver({baseUrl,storage,loadImage:async()=>{}, fetchImpl:async()=>Response.json({code:200,data:{id:'0039MnYb0qxYhV',albumMid:'000MkMni19ClKG'}})});
  const store = createPersonalLibraryStore({storage,coverForSong:song => resolver.knownCover(song) || song.cover});
  for (const track of queue) {
    assert.equal((await resolver.resolve(track,{size:80})).status,'ready');
    assert.equal(store.toggleSong(track),true);
  }
  createAccountLibrary({storage,player}).saveGuestQueue();
  queue = [];
  createAccountLibrary({storage,player}).restoreGuestQueue();
  const restored = createArtworkResolver({baseUrl,storage,loadImage:async()=>{},fetchImpl:assert.fail});
  const favorites = createPersonalLibraryStore({storage}).favorites();
  assert.equal(favorites[0].cover,gd.cover);
  assert.match(favorites[1].cover,/000MkMni19ClKG\.jpg$/);
  assert.deepEqual(queue.map(track => track.id),[gd.id,qq.id]);
  for (const track of [...favorites,...queue,cleanSong(qq)]) {
    const result = await restored.resolve(track,{size:160});
    assert.equal(result.status,'ready');assert.match(result.url,track.provider==='gd'?/id=109951169829246225$/:/000MkMni19ClKG\.jpg/);
  }
  queue = [];createAccountLibrary({storage,player}).saveGuestQueue();
  queue = [gd];createAccountLibrary({storage,player}).restoreGuestQueue();assert.deepEqual(queue,[]);
});

test('portable provider art permits only the expected public picture routes', () => {
  const route = (source,id) => `/api/v1/music/cover?${new URLSearchParams({source,id})}`;
  const picture = 'https://www.jbsou.cn/api.php?get=pic&type=qq&id=abc';
  assert.equal(imageURL(route('jianbin-qq',picture)),route('jianbin-qq',picture));
  for (const input of [route('gd','1?param=80y80'),route('gd','12')+'&key=secret',route('jianbin-netease',picture),route('jianbin-qq',picture.replace('get=pic','get=url')),route('jianbin-qq',picture+'&token=secret'),'/private/cover.png']) assert.equal(imageURL(input),'');
});

test('rapid track changes repaint all surfaces together and ignore late artwork from the old track', async () => {
  const pending=[],images=[imageNode(),imageNode(),imageNode()],changes=[];
  const resolver={resolve(track,{signal}){return new Promise(resolve=>pending.push({track,signal,resolve}));}};
  const presenter=createArtworkPresenter({resolver,images:()=>images,onChange:(result,track)=>changes.push([result.status,track.id])});
  const first=presenter.show(song);const second=presenter.show({...song,id:'2',album:'另一张'});
  assert.equal(pending[0].signal.aborted,true);
  pending[1].resolve({url:'https://image.test/new.jpg',status:'ready'});await second;
  pending[0].resolve({url:'https://image.test/old.jpg',status:'ready'});await first;
  assert.ok(images.every(image=>image.src==='https://image.test/new.jpg'));
  assert.deepEqual(changes.at(-1),['ready','2']);
  images[0].onerror();assert.ok(images.every(image=>image.dataset.artworkState==='fallback'));
  assert.ok(images.every(image=>image.src===images[0].src));
});


test('concurrent album covers share one image load; a canceled row cannot cancel another', async () => {
  let complete, calls = 0, sharedSignal;
  const pending = new Promise(resolve => { complete = resolve; });
  const resolver = createArtworkResolver({ baseUrl, loadImage: async (url, { signal }) => { calls++; sharedSignal = signal; await pending; } });
  const abort = new AbortController();
  const a = resolver.resolve({ ...song, cover: native }, { signal: abort.signal, size: 300 });
  const b = resolver.resolve({ ...song, id: '2', cover: native }, { size: 300 });
  await Promise.resolve(); abort.abort(); await assert.rejects(a, { name: 'AbortError' });
  assert.equal(sharedSignal.aborted, false); complete();
  assert.equal((await b).status, 'ready'); assert.equal(calls, 1);
  await resolver.resolve({ ...song, id: '3', cover: native }, { size: 300 });
  assert.equal(calls, 1);
});

test('cached covers paint immediately; display failures invalidate the URL and recover', async () => {
  const attempts = [], track = { ...song, cover: native }, image = imageNode();
  const resolver = createArtworkResolver({ baseUrl, fetchImpl: assert.fail, loadImage: async url => attempts.push(url) });
  await resolver.resolve(track, { size: 300 });
  bindArtwork(image, track, { resolver, size: 300 });
  assert.equal(image.dataset.artworkState, 'ready');
  assert.equal(attempts.length, 1);
  image.onerror();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(image.dataset.artworkState, 'ready');
  assert.equal(image.src, native + '?param=300y300');
  assert.equal(attempts.length, 2);
});

test('changed cover references and rendition sizes do not reuse obsolete artwork', async () => {
  const resolver = createArtworkResolver({ baseUrl, loadImage: async () => {} });
  const track = { ...song, cover: native };
  await resolver.resolve(track, { size: 150 });
  assert.equal(resolver.peek(track, { size: 300 }), null);
  assert.equal(resolver.peek(track, { size: 300, anySize: true }).status, 'ready');
  assert.equal(resolver.peek({ ...track, cover: 'https://p1.music.126.net/new.jpg' }, { size: 150 }), null);
});

test('wall thumbnail sizes use supported CDN variants without altering signed requests', () => {
  const qq = 'https://y.gtimg.cn/music/photo_new/T002R300x300M000000MkMni19ClKG.jpg';
  assert.match(artworkUrl(qq, 500, baseUrl), /T002R500x500/);
  const kg = 'https://imge.kugou.com/stdmusic/800/20230920/abc.jpg';
  assert.match(decodeURIComponent(artworkUrl(kg, 240, baseUrl)), /stdmusic\/240\//);
  assert.match(decodeURIComponent(artworkUrl(kg + '?token=keep', 240, baseUrl)), /stdmusic\/800\/.*token=keep/);
});

test('a failed proxy falls back to the exact public thumbnail without guessing another album', async () => {
  const attempts = [];
  const resolver = createArtworkResolver({ baseUrl, fetchImpl: assert.fail, loadImage: async url => {
    attempts.push(url); if (url.startsWith('/api/cover')) throw Error('502');
  } });
  const result = await resolver.resolve({ ...song, cover: native }, { size: 150 });
  assert.equal(result.url, native + '?param=150y150'); assert.equal(result.status, 'ready');
  assert.deepEqual(attempts, [artworkUrl(native,150,baseUrl), result.url]);
});

test('a stalled proxy cannot block a healthy CDN and the losing request releases its slot', async () => {
  let proxySignal;
  const attempts = [];
  const resolver = createArtworkResolver({ baseUrl, proxyGraceMs: 5, fetchImpl: assert.fail, loadImage: async (url, { signal }) => {
    attempts.push(url);
    if (url.startsWith('/api/cover')) {
      proxySignal = signal;
      await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    }
  } });
  const track = { ...song, cover: native };
  assert.equal((await resolver.resolve(track, { size: 150 })).url, native + '?param=150y150');
  assert.equal(proxySignal.aborted, true);
  const count = attempts.length;
  assert.equal((await resolver.resolve(track, { size: 150 })).status, 'ready');
  assert.equal(attempts.length, count);
});

test('direct artwork fallback excludes signed resources, non-cover routes and untrusted hosts', () => {
  const route = value => '/api/cover?url=' + encodeURIComponent(value);
  assert.equal(directArtworkUrl(route(native + '?param=150y150'), baseUrl), native + '?param=150y150');
  assert.equal(directArtworkUrl(route('https://imgessl.kgimg.com/stdmusic/20240101/album.jpg'), baseUrl), 'https://imgessl.kgimg.com/stdmusic/20240101/album.jpg');
  for (const value of [native + '?token=secret', native + '#fragment', 'http://p1.music.126.net/a.jpg', 'https://p1.music.126.net:444/a.jpg', 'https://user:pass@p1.music.126.net/a.jpg', 'https://p1.music.126.net.evil.test/a.jpg', 'https://127.0.0.1/a.jpg']) {
    assert.equal(directArtworkUrl(route(value),baseUrl), '');
  }
  for (const value of ['/api/account?url='+encodeURIComponent(native), route(native)+'&token=secret', 'https://elsewhere.test'+route(native)]) assert.equal(directArtworkUrl(value,baseUrl),'');
});

test('online or explicit retry recovers an existing fallback without replacing the song or waiting for cooldown', async () => {
  let available = false, calls = 0;
  const track = { ...song, cover: native }, image = imageNode();
  const resolver = createArtworkResolver({ baseUrl, loadImage: async () => { calls++; if (!available) throw Error('offline'); }, fetchImpl: async () => new Response(null,{status:502}) });
  bindArtwork(image,track,{resolver,size:150});
  await new Promise(resolve => setTimeout(resolve,10));
  assert.equal(image.dataset.artworkState,'fallback');
  const first = calls; available = true;
  retryArtworkBindings({querySelectorAll:()=>[image]},false);
  await new Promise(resolve => setTimeout(resolve,10));
  assert.equal(image.dataset.artworkState,'ready'); assert.ok(calls > first);
  assert.equal(image.src,artworkUrl(native,150,baseUrl));
});

test('a visible failed cover retries automatically with a bounded budget, and rebinding cancels old retries', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  const image = { ...imageNode(), ownerDocument: {}, isConnected: true };
  const resolver = { resolve: async track => { calls++; return fallbackArtwork(track); } };
  const flush = () => new Promise(resolve => setImmediate(resolve));
  bindArtwork(image,song,{resolver}); await flush(); assert.equal(calls,1);
  t.mock.timers.tick(32000); await flush(); assert.equal(calls,2);
  t.mock.timers.tick(64000); await flush(); assert.equal(calls,3);
  t.mock.timers.tick(300000); await flush(); assert.equal(calls,3);
  bindArtwork(image,{...song,id:'new'},{resolver}); await flush(); assert.equal(calls,4);
  bindArtwork(image,{...song,id:'ready'},{resolver:{resolve:async()=>({url:native,status:'ready'})}}); await flush();
  t.mock.timers.tick(300000); await flush(); assert.equal(calls,4); assert.equal(image.dataset.artworkState,'ready');
});
