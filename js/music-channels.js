// Channel IDs follow coco-downloader; IDs never cross platform/provider boundaries.
export const MUSIC_CHANNELS = Object.freeze(Object.fromEntries([
  ['netease', 'Meting', '网易云', 'netease', ['standard', 'exhigh', 'lossless']],
  ['at38-netease', '51ape', '网易云', 'netease'],
  ['jianbin-netease', '煎饼', '网易云', 'netease'],
  ['at38-qq', '51ape', 'QQ 音乐', 'qq'],
  ['qq', 'VKeys', 'QQ 音乐', 'qq'],
  ['jianbin-qq', '煎饼', 'QQ 音乐', 'qq'],
  ['jianbin-kugou', '煎饼', '酷狗', 'kugou'],
  ['jianbin-kuwo', '煎饼', '酷我', 'kuwo'],
  ['gequke', '歌曲客', '酷我', 'kuwo'],
].map(([provider, channel, platformLabel, platform, qualities = []]) => [provider, Object.freeze({
  provider, platform, label: `${channel} · ${platformLabel}`, qualities: Object.freeze(qualities),
  detail: qualities.length ? '支持标准、极高、无损；实际音质以歌曲返回为准' : `${platformLabel}曲库 · ${channel}渠道 · 按实际返回音质播放`,
})])));
export const isMusicChannel = source => Object.hasOwn(MUSIC_CHANNELS, source);
export const channelTrackId = (source, id) => `${source}:${encodeURIComponent(String(id))}`;
export function channelSourceId(source, id) {
  const value = String(id || '');
  return value.startsWith(`${source}:`) ? decodeURIComponent(value.slice(source.length + 1)) : value;
}
