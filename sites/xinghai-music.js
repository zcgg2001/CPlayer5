import { ChannelError, audioUrl, boundedBytes } from './channel-http.js';

// Native protocol adapter for the user-supplied LX source v3.2.18. No plugin
// execution, IP reporting, update checks, or credentials sent to other providers.
const BASE = 'https://yy.zddyr.top/lx/api/';
export const XINGHAI_USER_AGENT = 'CPlayer5-MusicSource/1.0';
const platforms = { 'xinghai-netease': 'wy', 'xinghai-qq': 'qq' };
const qualities = { standard: '128k', exhigh: '320k', lossless: 'flac', hires: 'hires' };
const refused = status => [401, 402, 403, 429].includes(status);
const tokenExpired = data => data?.auth?.tk_mismatch === true || data?.auth?.device_id === 'untrusted-token' || Boolean(data?.auth?.tk_error);
function failure(status, retryAfter) {
  return new ChannelError(refused(status) ? status : 502, refused(status)
    ? '星海暂时拒绝访问，请检查服务端授权配置或切换渠道'
    : '星海暂时不可用，请稍后重试或切换渠道', retryAfter);
}
async function api(client, path, headers = {}) {
  // Paths are constructed here, never accepted from upstream/user input. The
  // client uses manual redirects, so authentication cannot follow a redirect.
  const response = await client.fetch(`${BASE}${path}`, {
    headers: { 'user-agent': XINGHAI_USER_AGENT, 'x-client': XINGHAI_USER_AGENT, ...headers },
  });
  if (![200, 401, 403].includes(response.status)) {
    await response.body?.cancel();
    throw failure(response.status, response.headers.get('retry-after'));
  }
  let data;
  try { data = JSON.parse(new TextDecoder().decode(await boundedBytes(response, 128 * 1024))); }
  catch { throw failure(response.status); }
  return { data, status: response.status, retryAfter: response.headers.get('retry-after') };
}

// Inspect at most 64 bytes; cancel even when the CDN ignores Range. A requested
// quality, URL suffix or upstream label alone does not establish lossless audio.
async function inspectAudio(client, value, platform, source, bitrate) {
  let url = audioUrl(value, platform, source);
  for (let hop = 0; hop < 4; hop++) {
    const response = await client.fetch(url.href, { headers: { 'user-agent': XINGHAI_USER_AGENT, range: 'bytes=0-63' } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const target = response.headers.get('location');
      await response.body?.cancel();
      if (!target) throw new ChannelError(502, '星海音频跳转无效');
      url = audioUrl(new URL(target, url).href, platform, source);
      continue;
    }
    if (![200, 206].includes(response.status) || /text|json|html|image/i.test(response.headers.get('content-type') || '')) {
      await response.body?.cancel(); throw failure(response.status, response.headers.get('retry-after'));
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
    if (size >= 42 && text(0, 4) === 'fLaC' && (bytes[4] & 127) === 0 && bytes[5] === 0 && bytes[6] === 0 && bytes[7] === 34) {
      const sampleRate = (bytes[18] << 12) | (bytes[19] << 4) | (bytes[20] >> 4);
      const bitDepth = (((bytes[20] & 1) << 4) | (bytes[21] >> 4)) + 1;
      if (sampleRate < 8000 || sampleRate > 655350 || bitDepth < 4 || bitDepth > 32) throw new ChannelError(502, '星海音频参数无效');
      return { url: url.href, format: 'flac', level: sampleRate > 48000 || bitDepth > 16 ? 'hires' : 'lossless', sampleRate, bitDepth, bitrate: 0 };
    }
    const format = text(4, 8) === 'ftyp' ? 'm4a' : text(0, 3) === 'ID3' || (bytes[0] === 255 && (bytes[1] & 224) === 224) ? 'mp3'
      : text(0, 4) === 'OggS' ? 'ogg' : text(0, 4) === 'RIFF' && text(8, 12) === 'WAVE' ? 'wav' : '';
    if (!format || size < 12) throw new ChannelError(502, '星海此歌曲音频无法识别，请切换渠道');
    const kbps = Number(bitrate) / 1000;
    return { url: url.href, format, level: kbps >= 256 && kbps <= 400 ? 'exhigh' : 'standard', bitrate: kbps > 0 && kbps <= 400 ? kbps : 0 };
  }
  throw new ChannelError(502, '星海音频跳转次数过多');
}

export async function resolveXinghai(source, id, level, client, license = '') {
  if (!platforms[source] || !(source === 'xinghai-netease' ? /^\d{1,32}$/ : /^[a-zA-Z0-9]{1,128}$/).test(id) || !qualities[level]) {
    throw new ChannelError(400, '星海歌曲或音质参数无效');
  }
  // Tokens may be tied to egress IP. Keep both token and pending I/O local to a
  // single request, including one refresh; never reuse a different user's grant.
  const deviceId = crypto.randomUUID();
  const signal = AbortSignal.any([client.signal, AbortSignal.timeout(10_000)]);
  const scoped = { ...client, signal, fetch: (url, options = {}) => client.fetch(url, { ...options, signal }) };
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const tokenReply = await api(scoped, `token.php?${new URLSearchParams({ device_id: deviceId })}`);
      const token = tokenReply.data?.data?.token;
      if (tokenReply.status !== 200 || ![0, 200].includes(tokenReply.data?.code) || typeof token !== 'string' || !token || token.length > 8192 || /[\r\n]/.test(token)) {
        throw failure(refused(tokenReply.status) ? tokenReply.status : Number(tokenReply.data?.code), tokenReply.retryAfter);
      }
      const reply = await api(scoped, `?${new URLSearchParams({ source: platforms[source], songmid: id, quality: qualities[level] })}`, {
        'x-token': token, ...(license.trim() ? { 'x-license': license.trim() } : {}),
      });
      if (tokenExpired(reply.data)) {
        if (attempt === 0) continue;
        throw failure(401);
      }
      if (reply.status !== 200 || reply.data?.code !== 200) throw failure(refused(reply.status) ? reply.status : Number(reply.data?.code), reply.retryAfter);
      const data = reply.data, platform = source === 'xinghai-netease' ? 'netease' : 'qq';
      const url = audioUrl(data.url, platform, source);
      if (data.encrypted || data.ekey || data.key || url.searchParams.has('ekey') || url.searchParams.has('key')) {
        throw new ChannelError(502, '星海此歌曲为加密音频，暂不支持播放');
      }
      return await inspectAudio(scoped, url.href, platform, source, data.br);
    }
  } catch (error) {
    if (!client.signal.aborted && signal.aborted) throw new ChannelError(503, '星海连接超时，请切换渠道');
    throw error;
  }
}
