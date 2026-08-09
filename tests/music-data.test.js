import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeLyricsPayload,
  normalizeOrsLyricsPayload,
  normalizeOrsSearchPayload,
  normalizeOrsSongPayload,
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

test('normalizes ORS search results with platform metadata', () => {
  assert.deepEqual(
    normalizeOrsSearchPayload([
      {
        id: '0039MnYb0qxYhV',
        name: '晴天',
        singer: '周杰伦',
        albumName: '叶惠美',
        interval: 269,
        albumId: '123',
        mainHash: 'abc',
      },
    ], 'qq'),
    [{
      id: '0039MnYb0qxYhV',
      sourceId: '0039MnYb0qxYhV',
      name: '晴天',
      artist: '周杰伦',
      album: '叶惠美',
      cover: '',
      source: 'ORS · QQ',
      provider: 'ors',
      platform: 'qq',
      interval: '269',
      albumId: '123',
      mainHash: 'abc',
    }],
  );
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

test('normalizes ORS parse responses and keeps inline lyrics', () => {
  assert.deepEqual(
    normalizeOrsSongPayload({
      url: 'https://music.ors.de5.net/play/qq/song',
      picture: 'data:image/png;base64,AAAA',
      lrc: '[00:01.00]晴天',
      ext: 'flac',
    }, 'lossless', 'qq', '0039MnYb0qxYhV'),
    {
      id: '0039MnYb0qxYhV',
      sourceId: '0039MnYb0qxYhV',
      url: 'https://music.ors.de5.net/play/qq/song',
      name: '未知歌曲',
      artist: '未知艺术家',
      album: '',
      cover: 'data:image/png;base64,AAAA',
      lrc: '[00:01.00]晴天',
      source: 'ORS · QQ',
      provider: 'ors',
      platform: 'qq',
      level: 'lossless',
      ext: 'flac',
    },
  );
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

test('normalizes ORS plain-text lyrics', () => {
  assert.deepEqual(
    normalizeOrsLyricsPayload({ lrc: '[00:01.00]晴天' }),
    { lrc: '[00:01.00]晴天', tlrc: '', yrc: '' },
  );
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
