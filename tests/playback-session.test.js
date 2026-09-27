import test from 'node:test';
import assert from 'node:assert/strict';

import { createPlaybackSession } from '../js/playback-session.js';

test('new playback sessions cancel and invalidate older sessions', () => {
  const playback = createPlaybackSession();
  const first = playback.start();
  const second = playback.start();

  assert.equal(first.signal.aborted, true);
  assert.equal(playback.isCurrent(first), false);
  assert.equal(playback.isCurrent(second), true);

  playback.cancel();
  assert.equal(second.signal.aborted, true);
  assert.equal(playback.isCurrent(second), false);
});

test('the current session remains cancellable while deferred artwork and lyrics load', async () => {
  const playback = createPlaybackSession();
  const first = playback.start();
  await Promise.resolve();
  assert.equal(playback.isCurrent(first), true);

  const second = playback.start();
  assert.equal(first.signal.aborted, true);
  assert.equal(playback.isCurrent(first), false);
  assert.equal(playback.isCurrent(second), true);
});
