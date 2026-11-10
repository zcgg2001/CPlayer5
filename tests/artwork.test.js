import test from 'node:test';
import assert from 'node:assert/strict';
import { artworkUrl, artworkCandidates, fallbackArtwork, createArtworkResolver, createArtworkPresenter, loadArtworkImage, bindArtwork } from '../js/artwork.js';

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
  assert.equal(artworkCandidates({...song,sources},640,baseUrl).length,1);
  assert.equal(artworkCandidates({albumEntity:{id:'12345678901234'}},640,baseUrl).length,0);
  assert.equal(artworkCandidates({albumEntity:{mid:'003RMaRI1iFoYd'}},640,baseUrl).length,1);
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
  assert.equal(requests.length,1);assert.match(requests[0],/artwork=1/);assert.equal(images.length,2);
  await resolver.resolve(track);
  assert.equal(requests.length,1);assert.equal(images.length,3);
});

test('audio source switching retains the original artwork ID, not the new provider namespace', async () => {
  const requests=[];
  const resolver=createArtworkResolver({baseUrl,loadImage:async()=>{},fetchImpl:async url=>{requests.push(url);return metadata();}});
  const result=await resolver.resolve({...song,provider:'qq',artworkSource:song});
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
test('list images fall back exactly once after an invalid remote image', () => {
  const image=imageNode();bindArtwork(image,{...song,cover:native},{baseUrl});
  image.onerror();assert.equal(image.dataset.artworkState,'fallback');assert.match(image.src,/^data:image\/svg/);assert.equal(image.onerror,null);
  image.onload();assert.equal(image.dataset.artworkState,'fallback');
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
