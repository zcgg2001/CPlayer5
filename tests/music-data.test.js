import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeLyricsPayload,
  normalizeBilibiliPayload,
  bilibiliVideoUrl,
  normalizePlaylistCollectionPayload,
  normalizePlaylistPayload,
  normalizeSearchPayload,
  normalizeSongPayload,
} from '../js/music-data.js';


test('normalizes supported search response shapes', () => {
  const song = {
    id: 1,
    name: 'Song',
    artists: [{ name: 'Artist A' }, { name: 'Artist B' }],
    album: { name: 'Album', picUrl: 'https://img.example/cover.jpg' },
  };

  for (const payload of [
    { code: 200, data: [song] },
    { code: 200, data: { songs: [song] } },
    { code: 200, result: { songs: [song] } },
  ]) {
    assert.deepEqual(normalizeSearchPayload(payload), [{
      id: 1,
      name: 'Song',
      artist: 'Artist A, Artist B',
      album: 'Album',
      cover: 'https://img.example/cover.jpg',
      source: 'ChKSz',
    }]);
  }
});

test('normalizes Bilibili tracks without trusting supplied external links', () => {
  const [track] = normalizeBilibiliPayload({ code: 200, data: [{
    id: 'bili:BV1C9b76cEks:2', name: 'Music', artist: 'UP',
    externalUrl: 'https://untrusted.example/',
  }] });
  assert.equal(track.provider, 'bilibili');
  assert.equal(track.sourceId, 'bili:BV1C9b76cEks:2');
  assert.equal(track.externalUrl, 'https://www.bilibili.com/video/BV1C9b76cEks/?p=2');
  assert.equal(bilibiliVideoUrl({ id: 'https://untrusted.example/' }), '');
  assert.deepEqual(normalizeBilibiliPayload({ code: 200, data: [{ id: '123' }] }), []);
});

test('falls back to album artwork when the direct cover field is empty', () => {
  assert.equal(
    normalizeSearchPayload({
      code: 200,
      data: [{
        id: 3,
        name: 'Song',
        picUrl: '',
        album: { picUrl: 'https://img.example/fallback.jpg' },
      }],
    })[0].cover,
    'https://img.example/fallback.jpg',
  );
});

test('drops search and playlist entries without an ID', () => {
  assert.deepEqual(
    normalizeSearchPayload({ code: 200, data: [{ name: 'Missing ID' }] }),
    [],
  );
  assert.deepEqual(
    normalizePlaylistPayload({ data: [{ name: 'Missing ID' }] }),
    [],
  );
});

test('normalizes song responses and requires a playable URL', () => {
  assert.deepEqual(
    normalizeSongPayload({
      code: 200,
      data: [{
        id: 9,
        url: 'https://media.example/song.flac',
        name: 'Song',
        artist: 'Artist',
        picUrl: 'https://img.example/cover.jpg',
        level: 'hires',
        br: 900000,
      }],
    }, 'lossless'),
    {
      id: 9,
      url: 'https://media.example/song.flac',
      name: 'Song',
      artist: 'Artist',
      album: '',
      cover: 'https://img.example/cover.jpg',
      source: 'ChKSz',
      level: 'hires',
      br: 900000,
    },
  );

  assert.equal(normalizeSongPayload({ code: 200, data: { id: 9 } }), null);
});

test('keeps Bilibili audio bitrate and format distinct from NetEase quality labels', () => {
  const [song] = normalizeBilibiliPayload({ code: 200, data: {
    id: 'bili:BV1C9b76cEks:1', br: 192000, url: '/api/v1/bilibili/audio?id=test', level: 'lossless',
  } });
  assert.equal(song.br, 192000);
  assert.equal(song.format, 'AAC');
  assert.equal(song.level, 'standard');
  assert.equal(song.url, '/api/v1/bilibili/audio?id=test');
});

test('normalizes lyric responses', () => {
  assert.deepEqual(
    normalizeLyricsPayload({
      code: 200,
      data: { lrc: 'original', tlyric: 'translated' },
    }),
    { lrc: 'original', tlrc: 'translated', yrc: '' },
  );
  assert.equal(normalizeLyricsPayload({ code: 500 }), null);
});

test('preserves timed words and auxiliary tracks supplied as lyric objects', () => {
  assert.deepEqual(normalizeLyricsPayload({code:200,data:{
    lrc:{lyric:'[00:01]你'},yrc:{lyric:'[1000,1000](1000,800,0)你'},
    ytlrc:{lyric:'[00:01]You'},romalrc:{lyric:'[00:01]ni'},ttml:'<tt/>',
  }}),{
    lrc:'[00:01]你',tlrc:'',yrc:'[1000,1000](1000,800,0)你',
    ytlrc:'[00:01]You',romalrc:'[00:01]ni',ttml:'<tt/>',
  });
});

test('normalizes supported playlist response shapes', () => {
  const track = {
    id: 2,
    name: 'Track',
    ar: [{ name: 'Singer' }],
    al: { name: 'Record', picUrl: 'https://img.example/track.jpg' },
  };

  for (const payload of [
    { data: { tracks: [track] } },
    { data: [track] },
    { playlist: { tracks: [track] } },
  ]) {
    assert.deepEqual(normalizePlaylistPayload(payload), [{
      id: 2,
      name: 'Track',
      artist: 'Singer',
      album: 'Record',
      cover: 'https://img.example/track.jpg',
    }]);
  }
});

test('normalizes playlist collection metadata with its playable tracks', () => {
  const payload = {
    data: {
      id: 42,
      name: '编辑精选',
      coverImgUrl: 'https://img.example/playlist.jpg',
      creator: { nickname: 'CPlayer 编辑部' },
      trackCount: 24,
      tracks: [{
        id: 2,
        name: 'Track',
        ar: [{ name: 'Singer' }],
        al: { name: 'Record', picUrl: 'https://img.example/track.jpg' },
      }],
    },
  };

  assert.deepEqual(normalizePlaylistCollectionPayload(payload), {
    id: 42,
    name: '编辑精选',
    cover: 'https://img.example/playlist.jpg',
    creator: 'CPlayer 编辑部',
    trackCount: 24,
    tracks: [{
      id: 2,
      name: 'Track',
      artist: 'Singer',
      album: 'Record',
      cover: 'https://img.example/track.jpg',
    }],
  });
  assert.equal(normalizePlaylistCollectionPayload({ data: [] }), null);
});
