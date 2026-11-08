import { ChannelError, audioUrl, responseJson } from './channel-http.js';

// Public API contract: https://music.op.wiki/docs/api/ (2026-10-20).
const BASE = 'https://music.op.wiki';
export const OP_USER_AGENT = 'CPlayer5-MusicSource/1.0';
const platforms = { 'op-applemusic': 'applemusic', 'op-netease': 'netease', 'op-qq': 'tencent' };
const qualities = { standard: 'standard', exhigh: 'high', lossless: 'lossless', hires: 'hires' };

function validateId(source, id) {
  if (!platforms[source] || !(source === 'op-qq' ? /^[a-zA-Z0-9]{1,128}$/ : /^\d{1,32}$/).test(id)) {
    throw new ChannelError(400, 'OP Music 歌曲 ID 无效，请重新搜索');
  }
}
async function json(client, path, options = {}) {
  const url = new URL(path, BASE);
  const response = await client.fetch(url, {
    ...options, headers: { 'user-agent': OP_USER_AGENT, ...options.headers },
  });
  if (!response.ok) {
    // The live Apple catalog uses 400 for an ordinary search with no matches.
    // Do not swallow other parameter/capability errors as an empty catalog.
    if (response.status === 400 && url.pathname === '/api/v1/search') {
      const error = await responseJson(response);
      if (typeof error.detail === 'string' && error.detail.endsWith('没有找到歌曲')) return [];
      throw new ChannelError(503, 'OP Music 搜索暂时不可用，请切换渠道');
    }
    await response.body?.cancel();
    const status = [401, 402, 403, 404, 429].includes(response.status) ? response.status : 503;
    throw new ChannelError(status, 'OP Music 暂时不可用，请切换渠道', response.headers.get('retry-after'));
  }
  return responseJson(response);
}
function playbackPath(task) {
  if (!/^[A-Za-z0-9_.~-]{1,256}$/.test(task?.id || '') || ['.', '..'].includes(task.id)) {
    throw new ChannelError(502, 'OP Music 任务标识无效');
  }
  return `/api/v1/playbacks/${task.id}`;
}
function checkTask(task, source, id, taskId) {
  playbackPath(task);
  if (task.platform !== platforms[source] || (taskId && task.id !== taskId)
    || [task.track_id, task.selected_id].some(value => value != null && String(value) !== id)) {
    throw new ChannelError(502, 'OP Music 返回了不匹配的歌曲任务');
  }
}
function wait(signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 1000);
    signal.addEventListener('abort', abort, { once: true });
  });
}

export async function searchOp(source, keyword, limit, offset, client) {
  // The API has no pagination: never replay the first page as a later page.
  if (offset >= 20) return [];
  const data = await json(client, `/api/v1/search?${new URLSearchParams({ platform: platforms[source], q: keyword, limit: Math.min(20, limit + offset) })}`);
  if (!Array.isArray(data)) throw new ChannelError(502, 'OP Music 搜索响应无效');
  return data.filter(item => {
    try { validateId(source, String(item?.id || '')); return item.platform === platforms[source] && item.song; } catch { return false; }
  }).slice(offset, offset + limit).map(item => ({
    id: String(item.id), name: item.song, artist: item.singer || '',
    album: item.album || '', duration: Number(item.duration) || 0,
    cover: typeof item.cover === 'string' && /^https?:\/\//.test(item.cover) ? item.cover.replace(/^http:/, 'https:') : '',
  }));
}

// Read a small prefix and cancel, even if the upstream ignores Range. Never buffer a song.
async function audioInfo(client, value, source, task) {
  let url = audioUrl(value, '', source);
  for (let hop = 0; hop < 4; hop++) {
    const response = await client.fetch(url.href, { headers: { 'user-agent': OP_USER_AGENT, range: 'bytes=0-63' } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const target = response.headers.get('location');
      await response.body?.cancel();
      if (!target) throw new ChannelError(502, 'OP Music 音频跳转无效');
      url = audioUrl(new URL(target, url).href, '', source);
      if (url.pathname !== `${playbackPath(task)}/audio`) throw new ChannelError(502, 'OP Music 音频任务不匹配');
      continue;
    }
    if (![200, 206].includes(response.status) || /text|json|html|image/i.test(response.headers.get('content-type') || '')) {
      await response.body?.cancel();
      throw new ChannelError([401, 402, 403, 429].includes(response.status) ? response.status : 503, 'OP Music 音频暂时不可用', response.headers.get('retry-after'));
    }
    const bytes = new Uint8Array(64), reader = response.body?.getReader();
    let size = 0;
    try {
      while (reader && size < bytes.length) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = value.subarray(0, bytes.length - size); bytes.set(chunk, size); size += chunk.length;
      }
    } finally { await reader?.cancel(); }
    const text = (a, b) => new TextDecoder().decode(bytes.subarray(a, b));
    if (size >= 42 && text(0, 4) === 'fLaC' && (bytes[4] & 127) === 0) {
      const sampleRate = (bytes[18] << 12) | (bytes[19] << 4) | (bytes[20] >> 4);
      const bitDepth = (((bytes[20] & 1) << 4) | (bytes[21] >> 4)) + 1;
      return { format: 'flac', level: sampleRate > 48000 || bitDepth > 16 ? 'hires' : 'lossless', sampleRate, bitDepth, bitrate: 0 };
    }
    const format = text(4, 8) === 'ftyp' ? 'm4a' : text(0, 3) === 'ID3' || (bytes[0] === 255 && (bytes[1] & 224) === 224) ? 'mp3'
      : text(0, 4) === 'OggS' ? 'ogg' : text(0, 4) === 'RIFF' && text(8, 12) === 'WAVE' ? 'wav' : '';
    if (!format || size < 12) throw new ChannelError(502, 'OP Music 此歌曲音质无法解码，请尝试其他音质');
    const bitrate = Number(task.bitrate) / 1000;
    // The requested tier and native container are not proof of lossless audio.
    return { format, level: bitrate >= 256 && bitrate <= 400 ? 'exhigh' : 'standard', bitrate: bitrate > 0 && bitrate <= 400 ? bitrate : 0 };
  }
  throw new ChannelError(502, 'OP Music 音频跳转次数过多');
}

export async function resolveOp(source, id, level, client) {
  validateId(source, id);
  // Includes POST, sequential status queries and the audio prefix check. Fits
  // inside the automatic router's 12s resolution budget, without background work.
  const signal = AbortSignal.any([client.signal, AbortSignal.timeout(10_000)]);
  const scoped = { ...client, signal, fetch: (url, options = {}) => client.fetch(url, { ...options, signal }) };
  try {
    const created = await json(scoped, '/api/v1/playbacks', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ platform: platforms[source], query: id, selected_id: id, quality: qualities[level], include_cover: false }),
    });
    let task = created.playback;
    checkTask(task, source, id);
    const taskId = task.id, path = playbackPath(task);
    const statusUrl = new URL(created.status_url, BASE);
    if (statusUrl.origin !== BASE || statusUrl.username || statusUrl.password || statusUrl.pathname !== path || statusUrl.search || statusUrl.hash) {
      throw new ChannelError(502, 'OP Music 任务查询地址无效');
    }
    for (let poll = 0; poll <= 7; poll++) {
      signal.throwIfAborted();
      checkTask(task, source, id, taskId);
      if (task.status === 'completed') {
        const url = audioUrl(new URL(task.audio_url, BASE).href, '', source);
        if (url.pathname !== `${path}/audio`) throw new ChannelError(502, 'OP Music 音频任务不匹配');
        return { url: url.href, ...await audioInfo(scoped, url.href, source, task), name: task.title || '', artist: task.artist || '', album: task.album || '', duration: Number(task.duration) || 0 };
      }
      if (task.status === 'failed') throw new ChannelError(502, 'OP Music 此歌曲音质准备失败，请尝试其他音质');
      if (!['queued', 'processing', 'streaming'].includes(task.status)) throw new ChannelError(502, 'OP Music 任务状态无效');
      if (poll === 7) break;
      await wait(signal);
      task = await json(scoped, statusUrl.href);
    }
    throw new ChannelError(503, 'OP Music 音频仍在准备，已切换其他渠道');
  } catch (error) {
    if (client.signal.aborted) throw error;
    if (signal.aborted) throw new ChannelError(503, 'OP Music 准备超时，已切换其他渠道');
    throw error;
  }
}

export async function lyricOp(source, id, client) {
  validateId(source, id);
  const data = await json(client, `/api/v1/lyrics?${new URLSearchParams({ platform: platforms[source], track_id: id })}`);
  return { lrc: data.available && typeof data.plain === 'string' ? data.plain : '', tlyric: data.available && typeof data.translation === 'string' ? data.translation : '' };
}
