import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createCipheriv } from 'node:crypto';
import { Miniflare, Response } from 'miniflare';

// Exercise the actual deploy bundle in workerd, not Node's fetch implementation.
const output = new URL('../.cloudflare/output/v0/workers/default/', import.meta.url);
const code = await readFile(new URL('bundle/index.js', output), 'utf8');
const { compatibilityDate } = JSON.parse(await readFile(new URL('worker.config.json', output), 'utf8'));
const video = { bvid: 'BV1C9b76cEks', title: 'Runtime fixture', owner: { name: 'Test' }, rights: {}, pages: [{ cid: 123 }] };

function runtime(t, handler = upstream) {
  const mf = new Miniflare({ workers: [{
    config: {
      name: 'cplayer-runtime-test', compatibilityDate,
      env: { CHKSZ_API_KEY: { type: 'json', value: 'fixture-key' } },
      manifest: { mainModule: 'index.js', modules: { 'index.js': { type: 'esm', contents: code } } },
    },
    dev: { outboundService: { type: 'fetcher', handler } },
  }] });
  t.after(() => mf.dispose());
  return mf;
}

async function upstream(request) {
  const url = new URL(request.url);
  // Enough delay to overlap separate Worker invocations and exercise cached I/O.
  await new Promise(resolve => setTimeout(resolve, 80));
  if (url.hostname === 'api.chksz.com') return Response.json({ code: 200, data: [{ id: 1, name: 'Test' }] });
  if (url.hostname === 'music-api.gdstudio.xyz') return Response.json([{ id: '1', name: 'Test', artist: ['Test'] }]);
  if (url.pathname.endsWith('/view')) return Response.json({ code: 0, data: video });
  if (url.pathname.endsWith('/playurl')) return Response.json({ code: 0, data: { dash: { audio: [{
    mimeType: 'audio/mp4', codecs: 'mp4a.40.2', bandwidth: 128000, baseUrl: 'https://fixture.bilivideo.com/audio.m4s',
  }] } } });
  if (url.hostname === 'fixture.bilivideo.com') {
    assert.equal(request.headers.get('range'), 'bytes=0-3');
    return new Response(new Uint8Array([0, 1, 2, 3]), { status: 206, headers: { 'content-range': 'bytes 0-3/100', 'content-length': '4' } });
  }
  return Response.json({ code: 0, data: { result: [video] } });
}

for (const provider of ['chksz', 'gd', 'bilibili']) {
  test(`workerd: ${provider} search and overlapping requests complete`, { timeout: 10000 }, async t => {
    const mf = runtime(t);
    const target = `https://player.example/api/v1/music/search?source=${provider}&keyword=test`;
    const results = await Promise.all([0, 1].map(async () => {
      const response = await mf.dispatchFetch(target);
      const body = await response.text();
      assert.equal(response.status, 200, body);
      assert.doesNotMatch(body, /fixture-key/);
      return JSON.parse(body);
    }));
    assert.equal(results[0].data.length, 1);
    assert.deepEqual(results[0], results[1]);
  });
}

test('workerd: upstream redirects fail without following the destination', async t => {
  let calls = 0;
  const mf = runtime(t, async request => {
    assert.notEqual(new URL(request.url).hostname, 'unexpected.example');
    calls++;
    return new Response(null, { status: 302, headers: { location: 'https://unexpected.example/' } });
  });
  for (const provider of ['chksz', 'gd', 'bilibili']) {
    const response = await mf.dispatchFetch(`https://player.example/api/v1/music/search?source=${provider}&keyword=test`);
    assert.equal(response.status, 502);
    assert.ok((await response.json()).error);
  }
  assert.equal(calls, 3);
});

test('workerd: Bilibili audio preserves range bytes and streams the response', async t => {
  const mf = runtime(t);
  const response = await mf.dispatchFetch(`https://player.example/api/v1/bilibili/audio?id=${video.bvid}`, { headers: { range: 'bytes=0-3' } });
  assert.equal(response.status, 206, await (response.status === 206 ? Promise.resolve('') : response.text()));
  assert.equal(response.headers.get('content-range'), 'bytes 0-3/100');
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array([0, 1, 2, 3]));
});

test('workerd: new channels run crypto, parse HTML, and stream HTTP audio with ranges', async t => {
  const mf = runtime(t, async request => {
    const url = new URL(request.url);
    if (url.hostname === 'interface.music.163.com') {
      assert.equal(request.method,'POST');
      assert.match(await request.text(),/^params=[A-F0-9]+$/);
      const cipher = createCipheriv('aes-128-ecb',Buffer.from('e82ckenh8dichen8'),null);
      return new Response(Buffer.concat([cipher.update(JSON.stringify({code:200,result:{songs:[{id:123,name:'Meting fixture',ar:[{name:'Artist'}]}]}}),'utf8'),cipher.final()]));
    }
    if (url.hostname === 'www.at38.cn') {
      if(url.searchParams.has('keyword'))return new Response('<div class="music-card" data-id="mid123" data-type="qq"><div class="music-info"><h3>QQ fixture</h3><p>歌手：Artist | 专辑：Album | 来源：QQ</p></div></div>');
      if(url.searchParams.has('action')){
        assert.match(request.headers.get('cookie'),/sid=fixture/);
        return Response.json({code:1,url:'http://aqqmusic.tc.qq.com/fixture.mp3'});
      }
      return new Response('Home',{headers:{'set-cookie':'sid=fixture; HttpOnly'}});
    }
    if (url.hostname === 'aqqmusic.tc.qq.com') {
      assert.equal(request.headers.get('range'),'bytes=0-3');
      assert.equal(request.headers.get('cookie'),null);
      return new Response('ID3!',{status:206,headers:{'content-range':'bytes 0-3/100','content-type':'audio/mpeg'}});
    }
    throw new Error(`Unexpected host ${url.hostname}`);
  });
  for(const source of ['netease','at38-qq']) {
    const response=await mf.dispatchFetch(`https://player.example/api/v1/music/search?source=${source}&keyword=test`);
    assert.equal(response.status,200,await response.clone().text());
    assert.equal((await response.json()).data.length,1);
  }
  const response=await mf.dispatchFetch('https://player.example/api/v1/music/audio?source=at38-qq&id=mid123',{headers:{range:'bytes=0-3'}});
  assert.equal(response.status,206,await response.clone().text());
  assert.equal(await response.text(),'ID3!');
});

test('workerd: public metadata enrichment and overlapping requests retain no request I/O', async t => {
  const mf=runtime(t,async request=>{
    const url=new URL(request.url);assert.equal(url.hostname,'music.163.com');
    await new Promise(resolve=>setTimeout(resolve,40));
    if(url.pathname.includes('/song/detail'))return Response.json({code:200,songs:[{id:1,name:'曲目',duration:200000,artists:[{id:2,name:'艺人'}],album:{id:3,name:'专辑'}}]});
    if(url.pathname==='/api/album/3')return Response.json({code:200,album:{id:3,name:'专辑',description:'专辑介绍',company:'厂牌'}});
    return Response.json({code:200,artist:{id:2,name:'艺人',briefDesc:'艺人介绍'}});
  });
  const responses=await Promise.all([1,2].map(()=>mf.dispatchFetch('https://player.example/api/v1/music/metadata?source=netease&id=1')));
  for(const response of responses){assert.equal(response.status,200);const body=await response.json();assert.equal(body.data.duration,200);assert.equal(body.data.albumEntity.description,'专辑介绍');assert.equal(body.data.artistEntities[0].description,'艺人介绍');}
});
