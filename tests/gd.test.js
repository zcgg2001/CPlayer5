import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../sites/worker.js';
import { MusicService } from '../js/music-service.js';

const call = (path, env) => worker.fetch(new Request(`https://player.example/api/v1/music/${path}`), env);

test('GD searches without credentials and retains metadata for playback, cover and lyrics', async () => {
  const requests = [];
  const env = { CHKSZ_API_KEY: 'private-unused-key', GD_FETCH: async url => {
    const u = new URL(url);
    requests.push(u);
    assert.equal(u.origin, 'https://music-api.gdstudio.xyz');
    assert.equal(u.searchParams.get('apikey'), null);
    assert.equal(u.searchParams.get('source'), 'netease');
    return Response.json({
      search: [{ id: '65766', name: '富士山下', artist: ['陈奕迅'], album: '专辑', pic_id: '123' }],
      url: { url: 'http://m1.music.126.net/song.mp3', br: 320 },
      lyric: { lyric: '[00:01]歌词', tlyric: '译文' },
      pic: { url: 'https://p1.music.126.net/cover.jpg' },
    }[u.searchParams.get('types')]);
  } };
  const search = await (await call('search?source=gd&keyword=陈奕迅&limit=10', env)).json();
  assert.equal(search.data[0].cover, '/api/v1/music/cover?source=gd&id=123');
  const song = await (await call('song?source=gd&id=65766&level=hires', env)).json();
  assert.equal(song.data.name, '富士山下');
  assert.equal(song.data.url, 'https://m1.music.126.net/song.mp3');
  assert.equal(song.data.level, 'exhigh');
  assert.equal(song.data.br, 320000);
  assert.equal(requests[1].searchParams.get('br'), '999');
  assert.equal((await (await call('lyric?source=gd&id=65766', env)).json()).data.lrc, '[00:01]歌词');
  const cover = await call('cover?source=gd&id=123', env);
  assert.equal(cover.status, 302);
  assert.equal(cover.headers.get('location'), 'https://p1.music.126.net/cover.jpg');
  await call('search?source=gd&keyword=陈奕迅&limit=10', env);
  assert.equal(requests.length, 4, 'repeat search uses cache');
});

test('GD rejects invalid parameters and unsupported collections without upstream calls', async () => {
  const env = { GD_FETCH: async () => { assert.fail('unexpected upstream'); } };
  for (const path of ['song?source=gd&id=https://bad.test', 'song?source=gd&id=1&level=bad', 'search?source=gd&keyword=x&limit=0']) {
    assert.equal((await call(path, env)).status, 400);
  }
  assert.equal((await call('playlist?source=gd&id=1', env)).status, 422);
});

test('GD falls back from unavailable lossless to 320K and reports the returned quality', async () => {
  const qualities = [];
  const env = { GD_FETCH: async url => {
    const br = new URL(url).searchParams.get('br');
    qualities.push(br);
    return Response.json(br === '740' ? { url: '', br: 0 } : { url: 'https://example.com/song.mp3', br: 320 });
  } };
  const result = await (await call('song?source=gd&id=1&level=lossless', env)).json();
  assert.deepEqual(qualities, ['740', '320']);
  assert.equal(result.data.level, 'exhigh');
});

test('GD rate budget counts uncached upstream requests, not cache hits', async () => {
  let count = 0;
  const env = { GD_FETCH: async () => { count++; return Response.json({ lyric: '歌词' }); } };
  for (let id = 1; id <= 50; id++) assert.equal((await call(`lyric?source=gd&id=${id}`, env)).status, 200);
  assert.equal((await call('lyric?source=gd&id=1', env)).status, 200);
  const limited = await call('lyric?source=gd&id=51', env);
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('retry-after')) > 0);
  assert.equal(count, 50);
});

for (const status of [401, 403, 429, 503]) {
  test(`GD preserves ${status} without retries or a ChKSz fallback`, async () => {
    let requests = 0;
    const env = {
      MUSIC_FETCH: async () => assert.fail('unexpected ChKSz call'),
      GD_FETCH: async () => { requests++; return Response.json({ msg: '上游说明' }, { status, headers: { 'retry-after': '42' } }); },
    };
    const response = await call('song?source=gd&id=1', env);
    assert.equal(response.status, status);
    assert.equal((await response.json()).error.message, '上游说明');
    assert.equal(response.headers.get('retry-after'), '42');
    assert.equal(requests, 1);
    if (status === 429) {
      assert.equal((await call('song?source=gd&id=2', env)).status, 429);
      assert.equal(requests, 1, 'honors upstream cooldown');
    }
  });
}

test('GD rejects challenge HTML, empty audio and unsafe URLs', async () => {
  for (const body of ['<html>challenge</html>', JSON.stringify({ url: '' }), JSON.stringify({ url: 'javascript:alert(1)' })]) {
    const response = await call('song?source=gd&id=1', { GD_FETCH: async () => new Response(body) });
    assert.ok(response.status >= 400);
  }
});

test('switching NetEase providers reuses queue metadata and keeps an in-flight request on its provider', async () => {
  const service = new MusicService({ storage: null, location: { search: '?source=gd' } });
  const queued = { id: '1', name: '歌曲', artist: '歌手', provider: 'chksz', cover: 'https://example.com/cover.jpg' };
  assert.equal(service.sourceForSong(queued).provider, 'gd');
  assert.equal(service.sourceForSong({ provider: 'bilibili' }).provider, 'bilibili');
  let requests = 0;
  const song = await service.getSong('1', { song: queued, fetchImpl: async url => {
    requests++;
    assert.match(url, /source=gd/);
    service.saveSettings('source', 'chksz');
    return Response.json({ code: 200, data: { id: '1', url: 'https://example.com/song.mp3', level: 'standard', br: 128000 } });
  } });
  assert.equal(song.name, '歌曲');
  assert.equal(song.provider, 'gd');
  assert.equal(song.level, 'standard');
  assert.equal(song.downloadAllowed, false);
  assert.equal(requests, 1);
  await service.getLyric('1', { song, fetchImpl: async url => {
    assert.match(url, /source=gd/);
    return Response.json({ code: 200, data: { lrc: '歌词' } });
  } });
  assert.equal(service.sourceForSong(song).provider, 'chksz');
});

test('GD exact-quality requests do not spend quota on hidden lower-tier retries', async () => {
  const qualities=[];
  const env={GD_FETCH:async url=>{qualities.push(new URL(url).searchParams.get('br'));return Response.json({url:''});}};
  assert.equal((await call('song?source=gd&id=123&level=hires&exact=1',env)).status,404);
  assert.deepEqual(qualities,['999']);
});
test('GD legacy highest-quality fallback includes lossless before lossy tiers', async () => {
  const qualities=[];
  const env={GD_FETCH:async url=>{const br=new URL(url).searchParams.get('br');qualities.push(br);return Response.json(br==='740'?{url:'https://media.example/song.flac',br:740}:{url:''});}};
  const body=await (await call('song?source=gd&id=123&level=hires',env)).json();
  assert.deepEqual(qualities,['999','740']);assert.equal(body.data.level,'lossless');
});
