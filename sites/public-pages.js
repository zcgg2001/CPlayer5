import { handleDiscoveryContent } from './discovery-content.js';
import { config, blockedText } from './operations-store.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const schemaType = { artist: 'MusicGroup', album: 'MusicAlbum', playlist: 'MusicPlaylist' };
const labels = { 'zh-CN': { artist: '歌手', album: '专辑', playlist: '歌单', browse: '公开音乐资料', open: '打开播放器', unavailable: '资料暂不可用', songs: '曲目', source: '资料来源：网易云公开曲库', back: '浏览公开曲库' }, en: { artist: 'Artist', album: 'Album', playlist: 'Playlist', browse: 'Explore music', open: 'Open player', unavailable: 'Content unavailable', songs: 'Tracks', source: 'Source: NetEase public music catalog', back: 'Browse public catalog' } };
function html(request, title, description, body, { origin, path, lang = 'zh-CN', schema, status = 200, index = true }) {
  const canonical = origin + path + (lang === 'en' ? '?lang=en' : '');
  const markup = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)} · CPlayer</title><meta name="description" content="${escape(description.slice(0, 180))}"><meta name="robots" content="${index ? 'index,follow' : 'noindex,nofollow'}"><link rel="canonical" href="${escape(canonical)}"><link rel="alternate" hreflang="zh-CN" href="${escape(origin + path)}"><link rel="alternate" hreflang="en" href="${escape(origin + path)}?lang=en"><meta property="og:title" content="${escape(title)}"><meta property="og:description" content="${escape(description.slice(0, 180))}"><meta property="og:url" content="${escape(canonical)}"><link rel="stylesheet" href="/css/operations.css">${schema ? `<script type="application/ld+json">${JSON.stringify(schema).replace(/</g, '\\u003c')}</script>` : ''}</head><body class="public-page"><header class="ops-header"><a class="brand" href="/">CPlayer<span> / ${lang === 'en' ? 'MUSIC' : '音乐资料'}</span></a><nav><a href="${escape(path)}${lang === 'en' ? '' : '?lang=en'}">${lang === 'en' ? '简体中文' : 'English'}</a><a href="/?lang=${lang}">${labels[lang].open}</a></nav></header><main><p class="eyebrow">CPLAYER / LIBRARY</p><h1>${escape(title)}</h1>${body}</main></body></html>`;
  return new Response(request.method === 'HEAD' ? null : markup, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': status === 200 ? 'public, max-age=60' : 'no-store', 'content-security-policy': "default-src 'none'; style-src 'self'; img-src 'self' https:; script-src 'none'; base-uri 'none'; frame-ancestors 'none'", 'x-content-type-options': 'nosniff', ...(index ? {} : { 'x-robots-tag': 'noindex' }) } });
}
export async function handlePublicPages(request, env) {
  const url = new URL(request.url), path = url.pathname;
  if (!['/robots.txt', '/sitemap.xml', '/library'].includes(path) && !/^\/(artist|album|playlist)\//.test(path)) return null;
  if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } });
  const origin = env.AUTH_URL ? new URL(env.AUTH_URL).origin : url.origin;
  const lang = url.searchParams.get('lang') === 'en' ? 'en' : 'zh-CN', l = labels[lang];
  const settings = await config(env), pages = settings.pages.filter(page => page.status === 'published');
  if (path === '/robots.txt') return new Response(request.method === 'HEAD' ? null : `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /admin\nSitemap: ${origin}/sitemap.xml\n`, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=300' } });
  if (path === '/sitemap.xml') return new Response(request.method === 'HEAD' ? null : `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${['/', '/library', ...pages.map(page => `/${page.type}/${page.id}`)].map(p => `<url><loc>${escape(origin + p)}</loc></url>`).join('')}</urlset>`, { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=60' } });
  if (path === '/library') return html(request, l.browse, l.source, `<p class="muted">${l.source}</p><ul class="public-collections">${pages.map(page => `<li><a href="/${page.type}/${page.id}${lang === 'en' ? '?lang=en' : ''}">${l[page.type]} · ${escape(page.id)}</a></li>`).join('')}</ul>`, { origin, path, lang });
  const match = path.match(/^\/(artist|album|playlist)\/(\d{1,20})$/), approved = match && pages.some(page => page.type === match[1] && page.id === match[2]);
  const unavailable = (status = 404) => html(request, l.unavailable, l.unavailable, `<p><a href="/library">${l.back}</a></p>`, { origin, path, lang, status, index: false });
  if (!approved) return unavailable();
  const target = new URL(`/api/v1/discovery/${match[1]}?id=${match[2]}`, origin);
  const response = await handleDiscoveryContent(new Request(target, { signal: request.signal }), env, target);
  if (!response.ok) return unavailable(response.status === 404 ? 404 : 503);
  const data = await response.json(), record = data.collection;
  if (blockedText([record.name, record.description].join(' '), settings)) return unavailable();
  const tracks = data.tracks.filter(track => !blockedText(`${track.name} ${track.artist} ${track.album}`, settings));
  const description = record.description || `${record.name} · ${record.trackCount} ${l.songs}`;
  return html(request, record.name, description, `<p class="muted">${l[match[1]]} · ${l.source}</p><p class="public-description">${escape(description)}</p><h2>${l.songs}</h2><ol class="public-tracks">${tracks.map(track => `<li><strong>${escape(track.name)}</strong><span>${escape(track.artist)} · ${escape(track.album)}</span></li>`).join('')}</ol><a class="primary" href="/?collection=${match[2]}&collectionType=${match[1]}&lang=${lang}">${l.open}</a><p><a href="/library">${l.back}</a></p>`, { origin, path, lang, schema: { '@context': 'https://schema.org', '@type': schemaType[match[1]], name: record.name, description, url: origin + path, ...(match[1] === 'artist' ? {} : { numTracks: tracks.length, track: tracks.map(track => ({ '@type': 'MusicRecording', name: track.name, byArtist: { '@type': 'MusicGroup', name: track.artist } })) }) } });
}
