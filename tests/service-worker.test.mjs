import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';


function loadServiceWorker() {
  const listeners = new Map();
  const context = {
    URL,
    console,
    fetch: async () => {
      throw new Error('fetch should not run while loading policy');
    },
    caches: {},
    self: {
      addEventListener(type, handler) {
        listeners.set(type, handler);
      },
      skipWaiting() {},
      clients: { claim() {} },
      location: { origin: 'https://player.example' },
    },
  };
  vm.createContext(context);
  vm.runInContext(readFileSync(new URL('../sw.js', import.meta.url), 'utf8'), context);
  return context;
}


test('classifies covers before generic NetEase media', () => {
  const { classifyRequest } = loadServiceWorker();

  assert.equal(classifyRequest({
    method: 'GET',
    url: 'https://p1.music.126.net/cover.jpg',
    destination: 'image',
    mode: 'cors',
  }), 'cover');
  assert.equal(classifyRequest({
    method: 'GET',
    url: 'https://m7.music.126.net/song?id=1',
    destination: 'audio',
    mode: 'cors',
  }), 'audio');
});

test('classifies API, navigation and local asset requests', () => {
  const { classifyRequest } = loadServiceWorker();

  assert.equal(classifyRequest({
    method: 'GET',
    url: 'https://api.chksz.top/api/163_search',
    destination: '',
    mode: 'cors',
  }), 'api');
  assert.equal(classifyRequest({
    method: 'GET',
    url: 'https://player.example/app/',
    destination: 'document',
    mode: 'navigate',
  }), 'navigate');
  assert.equal(classifyRequest({
    method: 'GET',
    url: 'https://player.example/app/css/all.min.css',
    destination: 'style',
    mode: 'same-origin',
  }), 'asset');
  assert.equal(classifyRequest({
    method: 'POST',
    url: 'https://player.example/api',
    destination: '',
    mode: 'cors',
  }), 'ignore');
});

test('selects obsolete cache names for deletion', () => {
  const { cacheNamesToDelete } = loadServiceWorker();

  assert.deepEqual(
    Array.from(cacheNamesToDelete([
      'cplayer5-v1',
      'cplayer5-shell-v2',
      'cplayer5-covers-v1',
      'unrelated-cache',
    ])),
    ['cplayer5-v1'],
  );
});
