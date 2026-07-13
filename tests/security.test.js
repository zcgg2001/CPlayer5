import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeMediaUrl } from '../js/security.js';


const BASE_URL = 'https://player.example/app/';

test('keeps secure media URLs', () => {
  assert.equal(
    normalizeMediaUrl('https://media.example/song.flac', { baseUrl: BASE_URL }),
    'https://media.example/song.flac',
  );
});

test('upgrades insecure HTTP media URLs', () => {
  assert.equal(
    normalizeMediaUrl('http://media.example/cover.jpg', { baseUrl: BASE_URL }),
    'https://media.example/cover.jpg',
  );
});

test('allows blob URLs and resolves local media paths', () => {
  assert.equal(
    normalizeMediaUrl('blob:https://player.example/1234', { baseUrl: BASE_URL }),
    'blob:https://player.example/1234',
  );
  assert.equal(
    normalizeMediaUrl('./img/icon.png', { baseUrl: BASE_URL }),
    'https://player.example/app/img/icon.png',
  );
});

test('allows data images only when explicitly enabled', () => {
  const image = 'data:image/png;base64,AAAA';

  assert.equal(normalizeMediaUrl(image, { baseUrl: BASE_URL }), null);
  assert.equal(
    normalizeMediaUrl(image, { baseUrl: BASE_URL, allowDataImage: true }),
    image,
  );
  assert.equal(
    normalizeMediaUrl('data:text/html,<script>alert(1)</script>', {
      baseUrl: BASE_URL,
      allowDataImage: true,
    }),
    null,
  );
});

test('rejects executable, credentialed and malformed values', () => {
  assert.equal(normalizeMediaUrl('javascript:alert(1)', { baseUrl: BASE_URL }), null);
  assert.equal(
    normalizeMediaUrl('https://user:secret@media.example/song.mp3', {
      baseUrl: BASE_URL,
    }),
    null,
  );
  assert.equal(normalizeMediaUrl('', { baseUrl: BASE_URL }), null);
  assert.equal(normalizeMediaUrl(null, { baseUrl: BASE_URL }), null);
});
