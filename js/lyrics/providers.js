import { MUSIC_CHANNELS, channelSourceId } from '../music-channels.js';
import { samePlaybackRecording } from '../playback-router.js';

// Use IDs from their own catalog, never reinterpret another platform's number.
export function lyricPlatformIdentity(song) {
  const provider = MUSIC_CHANNELS[song?.provider]?.platform || (['gd', 'chksz'].includes(song?.provider) ? 'netease' : song?.provider);
  if (!['netease', 'qq', 'kugou'].includes(provider)) return null;
  try {
    let id = channelSourceId(song.provider, song.sourceId || song.id);
    if (song.provider.startsWith('jianbin-')) {
      const url = new URL(id), type = { netease: 'wy', qq: 'qq', kugou: 'kg' }[provider];
      if (!['https:', 'http:'].includes(url.protocol) || url.hostname !== 'www.jbsou.cn' || url.port
          || url.username || url.password || url.pathname !== '/api.php'
          || url.searchParams.get('type') !== type || url.searchParams.getAll('id').length !== 1) return null;
      id = url.searchParams.get('id');
    }
    if (provider === 'netease' && /^[1-9]\d{0,19}$/.test(id)) return { provider, id };
    if (provider === 'qq' && (/^[A-Za-z0-9]{14}$/.test(id) || /^[1-9]\d{0,11}$/.test(id))) return { provider, id };
    if (provider === 'kugou' && /^[a-f0-9]{32}$/i.test(id)) return { provider, id: id.toLowerCase() };
  } catch { /* Invalid wrappers remain opaque. */ }
  return null;
}

export function lyricRequestCandidates(song, defaultProvider = 'gd') {
  const current = { ...song, provider: song.provider || defaultProvider };
  const linked = [song.artworkSource, ...(Array.isArray(song.sources) ? song.sources : [])]
    .filter(candidate => candidate && samePlaybackRecording(current, candidate));
  // The wall's original recording can still provide lyrics after audio changes provider.
  const tracks = [...linked.filter(candidate => candidate === song.artworkSource), current, ...linked];
  const seen = new Set(), requests = [];
  const add = (provider, id) => {
    const key = `${provider}:${id}`;
    if (!id || seen.has(key)) return;
    seen.add(key); requests.push({ provider, id });
  };
  for (const track of tracks) {
    const provider = track.provider || defaultProvider;
    if (!['gd', 'chksz', 'bilibili'].includes(provider) && !Object.hasOwn(MUSIC_CHANNELS, provider)) continue;
    try {
      const identity = lyricPlatformIdentity({ ...track, provider });
      const id = channelSourceId(provider, track.sourceId || track.id);
      if (provider === 'chksz') { if (identity) add('netease', identity.id); }
      else add(provider, id);
      if (identity?.provider === 'netease' || identity?.provider === 'qq') add(identity.provider, identity.id);
    } catch { /* A malformed candidate must not prevent the remaining sources. */ }
  }
  return requests.slice(0, 4);
}
