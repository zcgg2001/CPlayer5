import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const serviceWorker = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

test('the studio shell loads the restored pet and page scroll controls', () => {
  assert.match(index, /href="\.\/css\/page-scroll-spider\.css\?v=/);
  assert.match(index, /href="\.\/css\/oneko-butterfly\.css\?v=/);
  assert.match(index, /src="\.\/js\/page-scroll-spider\.js\?v=/);
  assert.match(index, /src="\.\/js\/oneko-butterfly\.js\?v=/);
});

test('precaches the restored accessories for offline use', () => {
  assert.match(serviceWorker, /\.\/css\/studio\.css/);
  for (const asset of [
    './css/oneko-butterfly.css',
    './css/page-scroll-spider.css',
    './js/oneko-butterfly.js',
    './js/page-scroll-spider.js',
    './js/scroll-spider/index.js',
    './js/scroll-spider/appearance.js',
    './js/scroll-spider/editor.js',
    './img/oneko-tora.gif',
    './img/scroll-spider-mascot.png',
    './img/scroll-spider-anime.svg',
  ]) {
    assert.ok(serviceWorker.includes(`'${asset}'`), `${asset} should be precached`);
  }
});
