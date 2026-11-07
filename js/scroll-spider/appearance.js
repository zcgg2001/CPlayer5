export const DEFAULT_SPIDER_IMAGE = new URL('../../img/scroll-spider-anime.svg', import.meta.url).href;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml']);

export function validateMascotFile(file) {
  if (!file || !file.size) throw new Error('请选择一张非空图片。');
  if (file.size > MAX_IMAGE_BYTES) throw new Error('图片不能超过 5 MB，请选择一张较小的图片。');
  if (!IMAGE_TYPES.has(file.type)) throw new Error('支持 PNG、JPG、WebP、GIF 和 SVG 图片。');
}

// A dedicated database keeps uploaded artwork separate from music caches.
export function createAppearanceStore({ getDatabase = () => globalThis.indexedDB } = {}) {
  function transact(operation, value) {
    return new Promise((resolve, reject) => {
      let db;
      let transaction;
      let finished = false;
      const finish = (result, error) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        db?.close();
        if (error) reject(error);
        else resolve(result);
      };
      const timer = setTimeout(() => {
        transaction?.abort();
        finish(null, new Error('图片存储暂时不可用。'));
      }, 2500);
      try {
        const opening = getDatabase().open('cplayer-scroll-spider', 1);
        opening.onupgradeneeded = () => opening.result.createObjectStore('appearance');
        opening.onerror = opening.onblocked = () => finish(null, new Error('无法访问本机图片存储。'));
        opening.onsuccess = () => {
          db = opening.result;
          if (finished) { db.close(); return; }
          try {
            transaction = db.transaction('appearance', operation === 'read' ? 'readonly' : 'readwrite');
            const store = transaction.objectStore('appearance');
            const request = operation === 'read' ? store.get('current')
              : operation === 'write' ? store.put(value, 'current') : store.delete('current');
            transaction.oncomplete = () => finish(request.result);
            transaction.onerror = transaction.onabort = () => finish(null, new Error('图片未能保存到本机。'));
          } catch (error) { finish(null, error); }
        };
      } catch (error) { finish(null, error); }
    });
  }
  return { read: () => transact('read'), write: record => transact('write', record), clear: () => transact('clear') };
}

export function prepareMascotImage(file) {
  validateMascotFile(file);
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    const finish = (error) => {
      clearTimeout(timer);
      image.onload = image.onerror = null;
      if (error) { URL.revokeObjectURL(url); reject(error); }
      else resolve({ url, release: () => URL.revokeObjectURL(url) });
    };
    const timer = setTimeout(() => finish(new Error('图片读取超时，请换一张图片。')), 5000);
    image.onload = () => finish(image.naturalWidth && image.naturalHeight ? null : new Error('这张图片没有有效尺寸。'));
    image.onerror = () => finish(new Error('无法读取这张图片，请检查文件是否损坏。'));
    // SVG is loaded only in an image context, never inserted as markup.
    image.src = url;
  });
}

export function createSpiderAppearance({
  defaultImage = DEFAULT_SPIDER_IMAGE,
  store = createAppearanceStore(),
  prepare = prepareMascotImage,
} = {}) {
  const listeners = new Set();
  let state = { src: defaultImage, name: '小织 · 默认 SVG', custom: false };
  let release;
  let revision = 0;
  let disposed = false;
  let writes = Promise.resolve();
  const publish = next => {
    release?.();
    release = next.release;
    state = { src: next.src, name: next.name, custom: next.custom };
    listeners.forEach(listener => listener(state));
  };
  const persist = operation => {
    const pending = writes.then(operation);
    writes = pending.catch(() => {});
    return pending.then(() => true, () => false);
  };
  const ready = store.read().then(async record => {
    if (!record?.file || revision || disposed) return;
    const image = await prepare(record.file);
    if (revision || disposed) { image.release(); return; }
    publish({ src: image.url, name: record.name || '自定义图片', custom: true, release: image.release });
  }).catch(() => {}); // Blocked storage never prevents the default mascot from loading.

  return {
    ready,
    get state() { return state; },
    subscribe(listener) { listeners.add(listener); listener(state); return () => listeners.delete(listener); },
    async upload(file) {
      const version = ++revision;
      const image = await prepare(file);
      if (version !== revision || disposed) { image.release(); return { stale: true }; }
      const name = file.name || '自定义图片';
      publish({ src: image.url, name, custom: true, release: image.release });
      return { persisted: await persist(() => store.write({ file, name })) };
    },
    async reset() {
      revision += 1;
      publish({ src: defaultImage, name: '小织 · 默认 SVG', custom: false });
      return { persisted: await persist(() => store.clear()) };
    },
    destroy() { disposed = true; revision += 1; release?.(); listeners.clear(); },
  };
}
