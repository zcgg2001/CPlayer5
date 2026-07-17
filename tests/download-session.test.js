import test from 'node:test';
import assert from 'node:assert/strict';
import { createDownloadSession } from '../js/download-session.js';

test('a stale download cannot finish a newer dialog session', () => {
  const sessions = createDownloadSession();
  const first = sessions.open();
  assert.equal(sessions.start(first), true);

  const second = sessions.open();
  assert.equal(sessions.isCurrent(first), false);
  assert.equal(sessions.start(second), true);
  assert.equal(sessions.finish(first), false);
  assert.equal(sessions.isPending(second), true);
});

test('a newly opened session starts enabled even when an older request is pending', () => {
  const sessions = createDownloadSession();
  const first = sessions.open();
  sessions.start(first);

  const second = sessions.open();
  assert.equal(sessions.canSubmit(second), true);
  assert.equal(sessions.isPending(second), false);
});
