import test from 'node:test';
import assert from 'node:assert/strict';
import {
  downloadFallbackLevels, downloadFilename, resolveDownloadSong, saveAudioBlob,
} from '../js/music-download.js';

test('starts fallback at the selected quality and only descends', () => {
  assert.deepEqual(downloadFallbackLevels('jymaster'), ['jymaster', 'hires', 'lossless', 'exhigh', 'standard']);
  assert.deepEqual(downloadFallbackLevels('lossless'), ['lossless', 'exhigh', 'standard']);
});

test('resolves the first safe URL from the selected fallback chain', async () => {
  const seen = [];
  const song = await resolveDownloadSong({
    id: 7, level: 'lossless', baseUrl: 'https://player.example/',
    requestSong: async (_id, level) => {
      seen.push(level);
      return level === 'exhigh' ? { id: 7, name: 'A', artist: 'B', url: 'https://media.example/a.mp3' } : null;
    },
  });
  assert.deepEqual(seen, ['lossless', 'exhigh']);
  assert.equal(song.resolvedLevel, 'exhigh');
});

test('rejects unsafe URLs and keeps download filenames safe', async () => {
  await assert.rejects(() => resolveDownloadSong({
    id: 7, level: 'standard', baseUrl: 'https://player.example/',
    requestSong: async () => ({ url: 'javascript:alert(1)' }),
  }), /No downloadable audio/);
  assert.equal(downloadFilename({ name: 'A/B', artist: 'C:D', url: 'https://media.example/a.flac' }, 'lossless'), 'A B - C D - 无损.flac');
});

test('saves a fetched non-empty Blob through an object URL', async () => {
  const clicked = [];
  const revoked = [];
  const anchor = { click: () => clicked.push(true) };
  await saveAudioBlob({
    url: 'https://media.example/a.mp3', filename: 'a.mp3',
    fetchImpl: async () => ({ ok: true, blob: async () => new Blob(['music']) }),
    documentRef: { createElement: () => anchor, body: { append: () => {}, removeChild: () => {} } },
    urlApi: { createObjectURL: () => 'blob:test', revokeObjectURL: value => revoked.push(value) },
  });
  assert.deepEqual(clicked, [true]);
  assert.deepEqual(revoked, ['blob:test']);
});
