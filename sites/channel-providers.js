// Independent fetch adapters based on the documented wire formats in
// https://github.com/markcxx/coco-downloader (see docs/music-channels.md).
import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { load } from 'cheerio/slim';
import { ChannelError, AT38, JBSOU, GEQUKE, audioUrl, jbsouUrl, boundedBytes, responseText } from './channel-http.js';

const EAPI_KEY = Buffer.from('e82ckenh8dichen8');
const withQuery = (base, params) => `${base}?${new URLSearchParams(params)}`;
const artist = items => (items || []).map(item => item.name).filter(Boolean).join(' / ');
const idPattern = platform => platform === 'netease' || platform === 'kuwo' ? /^\d{1,32}$/ : /^[a-zA-Z0-9]{1,128}$/;
function validateId(id, platform) { if (!idPattern(platform).test(id)) throw new ChannelError(400, '歌曲 ID 无效，请重新搜索'); }

async function netease(client, lyric, payload) {
  const path = lyric ? '/api/song/lyric/v1' : '/api/cloudsearch/pc';
  const header = { os: 'pc', appver: '3.1.19.204510', requestId: '0', deviceId: randomBytes(16).toString('hex'), MUSIC_U: '' };
  const text = JSON.stringify({ header, e_r: true, ...payload });
  const digest = createHash('md5').update(`nobody${path}use${text}md5forencrypt`).digest('hex');
  const cipher = createCipheriv('aes-128-ecb', EAPI_KEY, null);
  const encrypted = Buffer.concat([cipher.update(`${path}-36cd479b6b5-${text}-36cd479b6b5-${digest}`, 'utf8'), cipher.final()]).toString('hex').toUpperCase();
  const response = await client.fetch(`https://${lyric ? 'interface3' : 'interface'}.music.163.com/eapi${path.slice(4)}`, {
    method: 'POST', body: new URLSearchParams({ params: encrypted }),
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: new URLSearchParams(header).toString().replaceAll('&', '; ') },
  });
  if (!response.ok) { await response.body?.cancel(); throw new ChannelError(502, '网易云接口暂时不可用'); }
  const bytes = await boundedBytes(response);
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { /* eapi encrypts some JSON replies. */ }
  const decipher = createDecipheriv('aes-128-ecb', EAPI_KEY, null);
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(bytes)), decipher.final()]).toString());
}

export async function searchChannel(source, platform, keyword, limit, offset, client) {
  if (source === 'netease') {
    const data = await netease(client, false, { s: keyword, type: 1, limit, offset, total: true });
    if (data.code !== 200 || !Array.isArray(data.result?.songs)) throw new ChannelError(502, '网易云搜索暂时不可用');
    return data.result.songs.map(song => ({ id: String(song.id), name: song.name, artist: artist(song.ar || song.artists), album: (song.al || song.album)?.name, cover: (song.al || song.album)?.picUrl }));
  }
  if (source === 'qq') {
    const key = 'music.search.SearchCgiService.DoSearchForQQMusicMobile';
    const data = await client.json('https://u.y.qq.com/cgi-bin/musicu.fcg', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ comm: { ct: '19', cv: '1859', uin: '0' }, [key]: {
        module: 'music.search.SearchCgiService', method: 'DoSearchForQQMusicMobile',
        param: { grp: 1, num_per_page: limit, page_num: Math.floor(offset / limit) + 1, query: keyword, search_type: 0 },
      } }),
    });
    // QQ's public search occasionally rejects a Cloudflare egress. Both catalogs
    // return QQ mids, so only search falls back; playback still uses VKeys.
    if (data.code !== 0 || data[key]?.code !== 0) return searchChannel('at38-qq', 'qq', keyword, limit, offset, client);
    const body = data[key].data?.body;
    return (body?.item_song || body?.song?.list || []).filter(song => song.mid).map(song => ({
      id: song.mid, name: song.name, artist: artist(song.singer), album: song.album?.name || song.album?.title,
      cover: song.album?.mid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${song.album.mid}.jpg` : '',
    }));
  }
  if (source.startsWith('at38-')) {
    const session = client.session(AT38);
    const $ = load(await session.request(`?${new URLSearchParams({ keyword })}`));
    const songs = [];
    $('.music-card').each((_, element) => {
      const card = $(element), id = card.attr('data-id'), type = platform === 'netease' ? 'wy' : 'qq';
      if (card.attr('data-type') !== type || !idPattern(platform).test(id || '')) return;
      const meta = card.find('.music-info p').text().replace(/\s+/g, ' ');
      songs.push({ id, name: card.find('.music-info h3').text().trim(), artist: meta.match(/歌手[：:]\s*(.*?)\s*\|\s*专辑[：:]/)?.[1]?.trim(), album: meta.match(/专辑[：:]\s*(.*?)\s*\|\s*来源[：:]/)?.[1]?.trim() });
    });
    return songs.slice(offset, offset + limit);
  }
  if (source.startsWith('jianbin-')) {
    const session = client.session(JBSOU);
    await session.request();
    const data = await session.json('', { input: keyword, filter: 'name', type: platform, page: String(Math.floor(offset / 10) + 1) });
    if (!Array.isArray(data.data)) throw new ChannelError(502, '煎饼搜索暂时不可用');
    return data.data.filter(item => item.url).map(item => ({
      id: jbsouUrl(item.url).href, name: item.name, artist: item.artist, album: item.album,
      cover: item.cover ? `/api/v1/music/cover?source=${source}&id=${encodeURIComponent(jbsouUrl(item.cover).href)}` : '',
    })).slice(0, limit);
  }
  if (keyword.length > 50) throw new ChannelError(400, '歌曲客搜索关键词不能超过 50 个字');
  const session = client.session(GEQUKE);
  await session.request();
  let state = await session.json('/api/s', { keyword });
  for (let i = 0; state.code === 2 && i < 4; i++) {
    await new Promise(resolve => setTimeout(resolve, 1500)); client.signal.throwIfAborted();
    state = await session.json('/api/query-map', { keyword });
  }
  if (state.code !== 1) throw new ChannelError(502, '歌曲客正在整理结果，请稍后重新搜索');
  const $ = load(await session.request(`/search?${new URLSearchParams({ s: keyword })}`));
  const songs = [];
  $('#myTables tbody tr').each((_, row) => {
    const cells = $(row).find('td'), link = cells.eq(1).find('a').first();
    const id = link.attr('href')?.match(/^\/song\/(\d+)\/?$/)?.[1];
    if (id) songs.push({ id, name: link.text().trim(), artist: cells.eq(2).text().trim() });
  });
  return songs.slice(offset, offset + limit);
}

export async function resolveJbsou(id, platform, client, cover = false) {
  const url = jbsouUrl(id);
  if (url.searchParams.get('get') !== (cover ? 'pic' : 'url')
    || url.searchParams.get('type') !== ({ netease:'wy', qq:'qq', kugou:'kg', kuwo:'kw' })[platform]) throw new ChannelError(400, '煎饼歌曲与渠道不匹配');
  const session = client.session(JBSOU);
  await session.request();
  const response = await client.fetch(url, { headers: { cookie: session.cookie() } });
  const location = response.headers.get('location');
  await response.body?.cancel();
  if (![301,302,303,307,308].includes(response.status) || !location) throw new ChannelError(502, '煎饼直链已失效，请重新搜索');
  const destination = new URL(location, url).href;
  return cover ? destination : audioUrl(destination, platform).href;
}

const pageValue = (html, name) => html.match(new RegExp(`window\\.${name}\\s*=\\s*['"]([^'"]*)['"]`))?.[1] || '';
export async function resolveChannel(source, platform, id, level, client) {
  if (source.startsWith('jianbin-')) return { url: await resolveJbsou(id, platform, client) };
  validateId(id, source === 'gequke' ? 'kuwo' : platform);
  if (source === 'netease') {
    const response = await client.fetch(withQuery('https://api.qijieya.cn/meting/', { server: 'netease', type: 'url', id, br: ({ standard:128, exhigh:320, lossless:2000 })[level] || 2000 }));
    let value = response.headers.get('location');
    if (value) await response.body?.cancel();
    else {
      const text = await responseText(response);
      if (/^https?:\/\//.test(text.trim())) value = text.trim();
      else { try { const data = JSON.parse(text); value = data.url || data.data || data[0]?.url; } catch { /* Error below. */ } }
    }
    return { url: audioUrl(value, platform).href };
  }
  if (source === 'qq') {
    for (const quality of [8, 6]) {
      const data = await client.json(withQuery('https://api.vkeys.cn/music/tencent/song/link', { mid: id, quality }));
      if ([0,200].includes(data.code) && data.data?.url) return { url: audioUrl(data.data.url, platform).href, bitrate: Number(data.data.kbps) || 0 };
    }
    throw new ChannelError(502, 'VKeys 暂未返回播放链接，请选择 QQ 的其他渠道');
  }
  if (source.startsWith('at38-')) {
    const session = client.session(AT38);
    await session.request();
    const data = await session.json(`?${new URLSearchParams({ action: 'geturl', id, type: platform === 'netease' ? 'wy' : 'qq', filename: id })}`);
    if (data.code !== 1 || !data.url) throw new ChannelError(502, '51ape 暂未提供此歌曲的播放链接');
    return { url: audioUrl(data.url, platform).href };
  }
  const session = client.session(GEQUKE);
  const html = await session.request(`/song/${id}`), playId = pageValue(html, 'play_id');
  if (!playId) throw new ChannelError(502, '歌曲客未提供播放标识，请重新搜索');
  const data = await session.json('/api/music', { id: playId, type: '0' }, true);
  if (data.code !== 200 || !data.data?.url) throw new ChannelError(502, '歌曲客暂未提供此歌曲的在线音源');
  let url = new URL(data.data.url);
  if (url.hostname === 'antiserver.kuwo.cn') {
    if (url.username || url.password || url.port || !['http:', 'https:'].includes(url.protocol)) throw new ChannelError(502, '酷我音频地址无效');
    url.protocol = 'https:';
    url.searchParams.set('type', 'convert_url3'); url.searchParams.set('callback', 'gequkeCallback');
    const response = await client.fetch(url);
    const text = (await responseText(response)).trim().replace(/^gequkeCallback\(/, '').replace(/\);?$/, '');
    const resolved = JSON.parse(text);
    if (resolved.code !== 200 || !resolved.url) throw new ChannelError(502, '酷我音频转换失败');
    url = new URL(resolved.url);
  }
  return { url: audioUrl(url.href, platform).href, cover: pageValue(html, 'mp3_cover') };
}

export async function channelLyric(source, platform, id, client) {
  if (source.startsWith('jianbin-')) {
    const url = jbsouUrl(id), expected = { netease: 'wy', qq: 'qq', kugou: 'kg', kuwo: 'kw' };
    if (url.searchParams.get('type') !== expected[platform]) return { lrc: '' };
    id = url.searchParams.get('id') || '';
  }
  validateId(id, source === 'gequke' ? 'kuwo' : platform);
  if (source === 'gequke') {
    const $ = load(await client.session(GEQUKE).request(`/song/${id}`));
    return { lrc: $('#content-lrc2').text().trim() };
  }
  if (platform === 'netease') {
    const data = await netease(client, true, { id: Number(id), cp: false, tv: 0, lv: 0, rv: 0, kv: 0, yv: 0, ytv: 0, yrv: 0 });
    return { lrc: data.lrc?.lyric || '', tlyric: data.tlyric?.lyric || '', yrc: data.yrc?.lyric || '' };
  }
  if (platform === 'qq') {
    const data = await client.json(withQuery('https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg', { songmid: id, g_tk:5381, loginUin:0, hostUin:0, format:'json', inCharset:'utf8', outCharset:'utf-8', platform:'yqq' }), { headers: { referer:'https://y.qq.com/portal/player.html' } });
    return { lrc: Buffer.from(data.lyric || '', 'base64').toString('utf8') };
  }
  if (platform === 'kugou') {
    const data = await client.json(withQuery('http://lyrics.kugou.com/search', { hash: id, keyword: '', duration: '-1' }));
    const song = data.candidates?.[0];
    if (!song?.id || !song.accesskey) return { lrc: '' };
    const lyric = await client.json(withQuery('http://lyrics.kugou.com/download', { ver:1, client:'pc', id:song.id, accesskey:song.accesskey, fmt:'lrc', charset:'utf8' }));
    return { lrc: Buffer.from(lyric.content || '', 'base64').toString('utf8') };
  }
  const q = Buffer.from(`type=lyric&req=2&lrcx=1&rid=${id}&songname=&artist=&corp=kuwo&fromchannel=bodian`).toString('base64');
  const lyric = await client.json(withQuery('http://mlyric.kuwo.cn/mobi.s', { f:'bodian', q, uid:'-1', token:'' }));
  return { lrc: Buffer.from(lyric.data?.content || '', 'base64').toString('utf8').replace(/<-?\d+,-?\d+>/g, '') };
}
