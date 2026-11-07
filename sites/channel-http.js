export class ChannelError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36';
export const JBSOU = 'https://www.jbsou.cn/';
export const AT38 = 'https://www.at38.cn/';
export const GEQUKE = 'https://www.gequke.com/';

export function checkedUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new ChannelError(400, '音源地址无效'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) throw new ChannelError(400, '音源地址无效');
  return url;
}
const AUDIO_HOSTS = {
  netease: ['music.126.net'], qq: ['stream.qqmusic.qq.com', 'aqqmusic.tc.qq.com'],
  kugou: ['kugou.com'], kuwo: ['kuwo.cn'],
};
export function audioUrl(value, platform) {
  let url;
  try { url = checkedUrl(value); } catch { throw new ChannelError(502, '渠道返回了无效的音频地址'); }
  if (!(AUDIO_HOSTS[platform] || []).some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) {
    throw new ChannelError(502, '渠道返回了不支持的音频地址');
  }
  if (!/\.(mp3|flac|m4a|aac|ogg|wav|opus)$/i.test(url.pathname)) throw new ChannelError(502, '渠道未返回音频直链');
  return url;
}
export function jbsouUrl(value) {
  let raw = String(value);
  for (let i = 0; i < 2 && !raw.startsWith('http'); i++) {
    try { raw = decodeURIComponent(raw); } catch { break; }
  }
  const url = checkedUrl(new URL(raw, JBSOU).href);
  if (url.origin !== new URL(JBSOU).origin || url.pathname !== '/api.php'
    || !['url', 'pic', 'lrc'].includes(url.searchParams.get('get'))
    || !['wy', 'qq', 'kg', 'kw'].includes(url.searchParams.get('type'))
    || !/^[a-zA-Z0-9_-]{1,128}$/.test(url.searchParams.get('id') || '')) throw new ChannelError(400, '煎饼歌曲地址无效，请重新搜索');
  return url;
}

export async function boundedBytes(response, max = 2 * 1024 * 1024) {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max) throw new ChannelError(502, '渠道响应过大，请缩小搜索范围');
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
export const responseText = async response => new TextDecoder().decode(await boundedBytes(response));
export async function responseJson(response) {
  try { return JSON.parse(await responseText(response)); }
  catch (error) { if (error instanceof ChannelError) throw error; throw new ChannelError(502, '渠道暂未返回有效数据，请切换渠道'); }
}

export function createChannelClient(fetchImpl, signal) {
  const fetch = async (url, options = {}) => {
    const response = await fetchImpl(String(url), {
      ...options, headers: { 'user-agent': USER_AGENT, ...options.headers }, redirect: 'manual',
      signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    });
    if (response.status === 429) { await response.body?.cancel(); throw new ChannelError(429, '渠道请求过于频繁，请稍后重试'); }
    return response;
  };
  const json = async (url, options) => {
    const response = await fetch(url, options);
    if (!response.ok) { await response.body?.cancel(); throw new ChannelError(502, '渠道暂时不可用，请切换渠道'); }
    return responseJson(response);
  };
  const session = base => {
    const cookies = new Map(); let referer = base;
    const cookie = () => [...cookies].map(([k,v]) => `${k}=${v}`).join('; ');
    const request = async (path = '', data, music = false) => {
      const url = new URL(path, base);
      if (url.origin !== new URL(base).origin) throw new ChannelError(400, '渠道地址无效');
      for (let attempt = 0; attempt < 3; attempt++) {
        const response = await fetch(url, {
          method: data ? 'POST' : 'GET', body: data ? new URLSearchParams(data) : undefined,
          headers: { referer, cookie: cookie(), 'accept-language': 'zh-CN,zh;q=0.9',
            ...(data ? { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8', origin: url.origin, 'x-requested-with': music ? 'Http' : 'XMLHttpRequest' } : {}),
            ...(music ? { 'x-custom-header': 'Key' } : {}),
          },
        });
        const values = response.headers.getSetCookie();
        for (const value of values) {
          const pair = value.split(';')[0]; const split = pair.indexOf('=');
          if (split > 0) cookies.set(pair.slice(0, split), pair.slice(split + 1));
        }
        const text = await responseText(response);
        const visit = text.match(/document\.cookie\s*=\s*["']mk_visit=([^;"']+)/);
        if (visit) { cookies.set('mk_visit', visit[1]); continue; }
        if (response.status === 403 && values.length && attempt === 0) continue;
        if (!response.ok) throw new ChannelError(502, '渠道暂时拒绝访问，请稍后重试或切换渠道');
        if (!data) referer = url.href;
        return text;
      }
      throw new ChannelError(502, '渠道会话建立失败，请稍后重试');
    };
    return { request, cookie, json: async (...args) => {
      try { return JSON.parse(await request(...args)); } catch (error) {
        if (error instanceof ChannelError) throw error;
        throw new ChannelError(502, '渠道暂未返回有效数据');
      }
    } };
  };
  return { fetch, json, session, signal };
}
