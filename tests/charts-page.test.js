import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computeRankMovement,
  normalizeDirectChartPayload,
} from '../js/charts-page.js';


test('normalizes direct playlist responses for local fallback', () => {
  const payload = normalizeDirectChartPayload({
    data: {
      id: 19723756,
      name: '飙升榜',
      trackCount: 1,
      creator: { nickname: '网易云音乐' },
      tracks: [{
        id: 201,
        name: '上升中的歌',
        ar: [{ name: '歌手' }],
        al: { name: '专辑', picUrl: 'https://p1.music.126.net/cover.jpg' },
      }],
    },
  }, 'soaring');

  assert.equal(payload.chart.key, 'soaring');
  assert.equal(payload.chart.name, '飙升榜');
  assert.equal(payload.items[0].playbackId, '201');
  assert.equal(payload.items[0].artist, '歌手');
});


test('computes rank movement against the previous snapshot', () => {
  const current = [
    { id: 'a', rank: 1 },
    { id: 'b', rank: 3 },
    { id: 'c', rank: 5 },
  ];
  const previous = [
    { id: 'a', rank: 4 },
    { id: 'b', rank: 2 },
  ];

  assert.deepEqual(
    computeRankMovement(current, previous).map(item => item.movement),
    [3, -1, null],
  );
});


test('does not label the entire first snapshot as newly charted', () => {
  assert.deepEqual(
    computeRankMovement([{ id: 'a', rank: 1 }], null).map(item => item.movement),
    [0],
  );
});
