import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeLyricsPayload,
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
