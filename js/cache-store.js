import { normalizeMediaUrl } from './security.js';

// Optional, best-effort storage. A blocked database or quota failure must not block music.
export function createCacheStore({
    getIndexedDB = () => globalThis.indexedDB,
    baseUrl = globalThis.location?.href,
    createImage = () => new Image(),
    createCanvas = () => document.createElement('canvas'),
    setTimer = setTimeout, clearTimer = clearTimeout, timeoutMs = 10_000,
} = {}) {
    let db = null;
    let opening = null;
    const pendingImages = new Map();

    function bounded(work, fallback) {
        return new Promise(resolve => {
            let settled = false;
            const timer = setTimer(() => finish(fallback), timeoutMs);
            function finish(value) {
                if (settled) return;
                settled = true;
                clearTimer(timer);
                resolve(value);
            }
            try { work(finish, () => settled); } catch { finish(fallback); }
        });
    }

    function init() {
        if (db) return Promise.resolve(db);
        if (opening) return opening;
        opening = bounded((finish, settled) => {
            const request = getIndexedDB().open('CPlayer5DB', 2);
            request.onerror = request.onblocked = () => finish(null);
            request.onupgradeneeded = () => {
                const database = request.result;
                if (!database.objectStoreNames.contains('playlists')) {
                    database.createObjectStore('playlists', { keyPath: 'id' }).createIndex('timestamp', 'timestamp');
                }
                if (!database.objectStoreNames.contains('lyrics')) database.createObjectStore('lyrics', { keyPath: 'songId' });
                if (!database.objectStoreNames.contains('images')) database.createObjectStore('images', { keyPath: 'url' });
            };
            request.onsuccess = () => {
                if (settled()) { request.result.close(); return; }
                db = request.result;
                const connection = db;
                connection.onversionchange = () => { connection.close(); if (db === connection) db = null; };
                connection.onclose = () => { if (db === connection) db = null; };
                finish(db);
            };
        }, null).finally(() => { opening = null; });
        return opening;
    }

    function savePlaylist(id, songs) {
        if (!db) return Promise.resolve(false);
        return bounded(finish => {
            const tx = db.transaction('playlists', 'readwrite');
            tx.oncomplete = () => finish(true);
            tx.onerror = tx.onabort = () => finish(false);
            tx.objectStore('playlists').put({ id, songs, timestamp: Date.now() });
        }, false);
    }

    function getPlaylist(id) {
        if (!db) return Promise.resolve(null);
        return bounded(finish => {
            const tx = db.transaction('playlists', 'readonly');
            const request = tx.objectStore('playlists').get(id);
            let result = null;
            request.onsuccess = () => { result = request.result || null; };
            request.onerror = tx.onerror = tx.onabort = () => finish(null);
            tx.oncomplete = () => finish(result);
        }, null);
    }

    function getImage(url) {
        const secureUrl = normalizeMediaUrl(url, { allowDataImage: true, baseUrl });
        if (!secureUrl || !db || !db.objectStoreNames.contains('images')) return Promise.resolve(secureUrl);
        if (pendingImages.has(secureUrl)) return pendingImages.get(secureUrl);
        const pending = bounded((finish, settled) => {
            const tx = db.transaction('images', 'readonly');
            const cacheKey = `v2:${secureUrl}`;
            const request = tx.objectStore('images').get(cacheKey);
            request.onerror = tx.onerror = tx.onabort = () => finish(secureUrl);
            request.onsuccess = () => {
                if (settled()) return;
                if (request.result?.data) { finish(request.result.data); return; }
                const image = createImage();
                image.crossOrigin = 'Anonymous';
                image.referrerPolicy = 'no-referrer';
                image.onerror = () => finish(secureUrl);
                image.onload = () => {
                    if (settled()) return;
                    try {
                        const size = new URL(secureUrl).searchParams.get('param')?.match(/^(\d+)y(\d+)$/i);
                        const canvas = createCanvas();
                        canvas.width = Math.max(80, Math.min(192, Number(size?.[1]) || 80));
                        canvas.height = Math.max(80, Math.min(192, Number(size?.[2]) || canvas.width));
                        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
                        const data = canvas.toDataURL('image/jpeg', 0.84);
                        const write = db.transaction('images', 'readwrite');
                        write.onerror = write.onabort = () => finish(secureUrl);
                        write.oncomplete = () => finish(data);
                        write.objectStore('images').put({ url: cacheKey, data, timestamp: Date.now() });
                    } catch { finish(secureUrl); }
                };
                image.src = secureUrl;
            };
        }, secureUrl).finally(() => pendingImages.delete(secureUrl));
        pendingImages.set(secureUrl, pending);
        return pending;
    }

    return { init, savePlaylist, getPlaylist, getImage };
}
