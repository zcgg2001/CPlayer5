import test from 'node:test';
import assert from 'node:assert/strict';
import { createCacheStore } from '../js/cache-store.js';

function fakeDb() {
    const records = new Map();
    const db = {
        objectStoreNames: { contains: () => true },
        createObjectStore() { return { createIndex() {} }; },
        transaction(name) {
            const tx = { objectStore() {
                return {
                    put(value) { records.set(`${name}:${value.id ?? value.url}`, value); },
                    get(key) {
                        const request = {};
                        queueMicrotask(() => { request.result = records.get(`${name}:${key}`); request.onsuccess?.(); });
                        return request;
                    },
                };
            } };
            queueMicrotask(() => queueMicrotask(() => tx.oncomplete?.()));
            return tx;
        },
    };
    return { db, records };
}

test('cache store creates the v2 schema and safely reads/writes playlists', async () => {
    const { db, records } = fakeDb();
    let upgrade;
    const store = createCacheStore({
        getIndexedDB: () => ({ open() {
            const request = { result: db, objectStoreNames: { contains: () => false } };
            queueMicrotask(() => { upgrade?.({ target: request }); request.onsuccess?.(); });
            request.onupgradeneeded = handler => { upgrade = handler; };
            return request;
        } }),
        timeoutMs: 100,
    });
    assert.equal(await store.init(), db);
    assert.equal(await store.savePlaylist('one', [{ id: 'a' }]), true);
    assert.deepEqual(await store.getPlaylist('one'), { id: 'one', songs: [{ id: 'a' }], timestamp: records.get('playlists:one').timestamp });
});

test('cache image reads coalesce and fall back when storage is unavailable', async () => {
    const store = createCacheStore({ getIndexedDB: () => ({ open() { throw new Error('blocked'); } }) });
    assert.equal(await store.init(), null);
    assert.equal(await store.getImage('https://img.example/a.jpg'), 'https://img.example/a.jpg');
});
