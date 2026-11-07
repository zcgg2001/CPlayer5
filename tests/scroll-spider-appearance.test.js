import test from 'node:test';
import assert from 'node:assert/strict';
import { createSpiderAppearance, MAX_IMAGE_BYTES, validateMascotFile } from '../js/scroll-spider/appearance.js';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function harness({ read = async () => null, write = async () => {}, clear = async () => {}, prepare } = {}) {
  const released = [];
  const model = createSpiderAppearance({
    defaultImage: '/default.svg', store: { read, write, clear },
    prepare: prepare || (async file => ({ url: `blob:${file.name}`, release: () => released.push(file.name) })),
  });
  return { model, released };
}

test('uploads accept supported images and reject empty, oversized, or non-image files', () => {
  for (const type of ['image/svg+xml', 'image/png', 'image/jpeg', 'image/webp', 'image/gif']) {
    assert.doesNotThrow(() => validateMascotFile({ size: 100, type }));
  }
  assert.throws(() => validateMascotFile({ size: 0, type: 'image/png' }), /非空/);
  assert.throws(() => validateMascotFile({ size: MAX_IMAGE_BYTES + 1, type: 'image/png' }), /5 MB/);
  assert.throws(() => validateMascotFile({ size: 100, type: 'text/html' }), /支持/);
});

test('a slow initial restore cannot overwrite a newly uploaded image', async () => {
  const reading = deferred();
  const { model } = harness({ read: () => reading.promise });
  await model.upload({ name: 'new.png' });
  reading.resolve({ file: { name: 'old.png' }, name: 'old.png' });
  await model.ready;
  assert.equal(model.state.src, 'blob:new.png');
});

test('late image decoding cannot undo a reset or leak its object URL', async () => {
  const decoding = deferred();
  let released = false;
  let writes = 0;
  const { model } = harness({ prepare: () => decoding.promise, write: async () => { writes += 1; } });
  const pending = model.upload({ name: 'slow.svg' });
  await model.reset();
  decoding.resolve({ url: 'blob:slow', release: () => { released = true; } });
  assert.equal((await pending).stale, true);
  assert.equal(released, true);
  assert.equal(writes, 0);
  assert.equal(model.state.src, '/default.svg');
});

test('persistence runs in order so a pending upload cannot return after reset', async () => {
  const writing = deferred();
  const operations = [];
  const { model } = harness({
    write: async () => { operations.push('write'); await writing.promise; },
    clear: async () => { operations.push('clear'); },
  });
  const upload = model.upload({ name: 'first.png' });
  await Promise.resolve(); await Promise.resolve();
  const reset = model.reset();
  writing.resolve();
  await Promise.all([upload, reset]);
  assert.deepEqual(operations, ['write', 'clear']);
  assert.equal(model.state.custom, false);
});

test('storage failures report an unsaved image without blocking the in-memory replacement', async () => {
  const { model } = harness({ read: async () => { throw new Error('blocked'); }, write: async () => { throw new Error('quota'); } });
  await model.ready;
  const result = await model.upload({ name: 'custom.webp' });
  assert.equal(result.persisted, false);
  assert.equal(model.state.src, 'blob:custom.webp');
});

test('invalid image decoding preserves the current mascot and replacement releases old URLs', async () => {
  const { model, released } = harness();
  await model.upload({ name: 'first.gif' });
  await model.upload({ name: 'second.svg' });
  assert.deepEqual(released, ['first.gif']);
  model.destroy();
  assert.deepEqual(released, ['first.gif', 'second.svg']);
  const invalid = harness({ prepare: async () => { throw new Error('broken image'); } });
  await assert.rejects(invalid.model.upload({ name: 'bad.png' }), /broken/);
  assert.equal(invalid.model.state.src, '/default.svg');
});
