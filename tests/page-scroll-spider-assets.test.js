import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const serviceWorker = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

test('loads the page scroll spider styles and module', () => {
  assert.match(index, /css\/page-scroll-spider\.css\?v=26/);
  assert.match(index, /js\/page-scroll-spider\.js\?v=26/);
});

test('precaches the page scroll spider runtime and artwork', () => {
  assert.match(serviceWorker, /\.\/css\/page-scroll-spider\.css/);
  assert.match(serviceWorker, /\.\/js\/page-scroll-spider\.js/);
  assert.match(serviceWorker, /\.\/img\/key-spider-scroll\.png/);
});
