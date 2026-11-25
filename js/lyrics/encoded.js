import { MAX_LYRIC_BYTES } from './document.js';

const MAX_ENCODED = 256 * 1024;
const utf8 = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes);

async function inflate(bytes) {
  if (!globalThis.DecompressionStream) throw new Error('当前 WebView 不支持压缩歌词');
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > MAX_LYRIC_BYTES) throw new RangeError('解压后的歌词超过 2 MB');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  return utf8(new Uint8Array(await new Blob(chunks).arrayBuffer()));
}

function base64(value) {
  if (typeof value !== 'string' || !value.length || value.length > MAX_ENCODED || !/^[A-Za-z0-9+/]*={0,2}$/.test(value))
    throw new Error('歌词编码无效');
  return Uint8Array.from(atob(value), c => c.charCodeAt(0));
}

export async function decodeQrc(value) {
  if (typeof value !== 'string' || !value.length || value.length > MAX_ENCODED || value.length % 16 || !/^[a-f0-9]+$/i.test(value))
    throw new Error('QRC 编码无效');
  const { decryptQrcBytes } = await import('../vendor/qrc/qrc-codec.js');
  const bytes = Uint8Array.from(value.match(/../g), pair => parseInt(pair, 16));
  const compressed = decryptQrcBytes(bytes);
  // QRC pads its final 8-byte block with zeros. Strict WebViews reject those
  // after zlib EOF. Try exact lengths so a checksum ending in zero stays intact.
  for (let padding = 0; padding < 8; padding++) {
    try { return await inflate(compressed.subarray(0, compressed.length - padding)); }
    catch (error) {
      if (error instanceof RangeError || padding === 7 || compressed[compressed.length - padding - 1] !== 0) throw error;
    }
  }
}

export async function decodeOnlineLyrics(data) {
  if (data?.encoding === 'netease-json' && data.provider === 'netease') {
    const fields = ['lrc', 'yrc', 'tlrc', 'romalrc', 'ytlrc', 'yromalrc'];
    const payload = Object.fromEntries(fields.map(key => [key, typeof data[key] === 'string' ? data[key] : '']));
    if (fields.reduce((total, key) => total + payload[key].length, 0) > MAX_LYRIC_BYTES) throw new Error('在线歌词结果过大');
    return { ...payload, source: '网易云音乐' };
  }
  if (data?.encoding === 'qrc-hex') {
    const qrc = await decodeQrc(data.lyric);
    // A broken optional layer cannot discard a valid main timeline.
    const aux = value => value ? decodeQrc(value).catch(() => '') : '';
    const [tlrc, romalrc] = await Promise.all([aux(data.translation), aux(data.romanization)]);
    return { qrc, lrc: qrc, tlrc, romalrc, source: 'QQ 音乐' };
  }
  if (data?.encoding === 'lrc-base64') return { lrc: utf8(base64(data.lyric)), source: '酷狗音乐' };
  if (data?.encoding === 'krc-base64') {
    const bytes = base64(data.lyric);
    if (utf8(bytes.slice(0, 4)) !== 'krc1') throw new Error('KRC 文件头无效');
    const key = [64, 71, 97, 119, 94, 50, 116, 71, 81, 54, 49, 45, 206, 210, 110, 105];
    return { krc: await inflate(bytes.slice(4).map((byte, i) => byte ^ key[i % 16])), source: '酷狗音乐' };
  }
  throw new Error('不支持的在线歌词格式');
}
