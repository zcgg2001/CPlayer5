import { MUSIC_CHANNELS, isMusicChannel, channelTrackId, channelSourceId } from './music-channels.js';
import {
  RequestCancelledError,
  requestErrorMessage,
  requestJson,
} from './http.js?v=37';
import {
  bilibiliVideoUrl,
  normalizeBilibiliPayload,
  normalizeLyricsPayload,
  normalizePlaylistCollectionPayload,
  normalizePlaylistPayload,
  normalizeSearchPayload,
  normalizeSongPayload,
} from './music-data.js';
import { downloadFallbackLevels } from './music-download.js';

export const MUSIC_API_BASE_URL = '/api/v1/music';
export const NEW_SONGS_PLAYLIST_ID = '3779629';
export const DEFAULT_QUALITY = 'lossless';
export const DEFAULT_MUSIC_SOURCE = 'gd';

export const MUSIC_SOURCE_OPTIONS = Object.freeze({
  gd: Object.freeze({
    label: 'GD 音乐台 · 网易云',
    detail: '搜索、播放与歌词免密钥；首页按主题发现音乐',
    provider: 'gd',
  }),
  ...MUSIC_CHANNELS,
  chksz: Object.freeze({
    label: 'ChKSz · 网易云',
    detail: '网易云搜索、解析与歌词；需要有效密钥与可用额度',
    provider: 'chksz',
  }),
  bilibili: Object.freeze({
    label: 'Bilibili · 哔哩哔哩',
    detail: '公开音乐视频 · AAC 音轨',
    provider: 'bilibili',
  }),
});

export function normalizeChannelSongs(payload, source) {
  if (payload?.code !== 200 || !Array.isArray(payload.data)) return [];
  return payload.data.filter(song => song?.id && song?.name).map(song => {
    const sourceId = String(song.sourceId || channelSourceId(source, song.id));
    return { ...song, id: channelTrackId(source, sourceId), sourceId, provider: source,
      source: musicSourceOption(source).label, artist: song.artist || '未知歌手', downloadAllowed: false };
  });
}

export const QUALITY_DETAILS = Object.freeze({
  standard: { name: '标准', summary: '标准 · 128K', meta: '128K · MP3', className: 'quality-standard' },
  exhigh: { name: '极高', summary: '极高 · 320K', meta: '320K · MP3', className: 'quality-high' },
  lossless: { name: '无损', summary: '无损 · FLAC', meta: 'FLAC · CD 级', className: 'quality-lossless' },
  hires: { name: 'Hi-Res', summary: 'Hi-Res · 高解析度', meta: '高解析度 · FLAC', className: 'quality-hires' },
  jymaster: { name: '超清母带', summary: '超清母带', meta: 'MASTER · 最高品质', className: 'quality-lossless' },
});

export function supportedQuality(level, fallback = DEFAULT_QUALITY) {
  return QUALITY_DETAILS[level] ? level : fallback;
}

export function supportedMusicSource(source, fallback = DEFAULT_MUSIC_SOURCE) {
  return Object.hasOwn(MUSIC_SOURCE_OPTIONS, source) ? source : fallback;
}

export function musicSourceOption(source) {
  return MUSIC_SOURCE_OPTIONS[supportedMusicSource(source)];
}

export function qualityDetails(level) {
  return QUALITY_DETAILS[supportedQuality(level)];
}

export class MusicService {
  constructor({ storage = globalThis.localStorage, location = globalThis.location } = {}) {
    this.storage = storage;
    this.location = location;
    this.loadSettings();
    this.baseUrl = MUSIC_API_BASE_URL;
  }

  loadSettings() {
    let quality = DEFAULT_QUALITY;
    let source = DEFAULT_MUSIC_SOURCE;
    try {
      quality = supportedQuality(this.storage?.getItem('cp_quality'));
      const initialSource = new URLSearchParams(this.location?.search || '').get('source');
      source = supportedMusicSource(initialSource || this.storage?.getItem('cp_source'));
    } catch (error) {
      console.warn('无法读取播放器偏好:', error);
    }
    this.config = { quality, source };
  }

  saveSettings(key, value) {
    if (key === 'quality') value = supportedQuality(value);
    if (key === 'source') value = supportedMusicSource(value);
    this.config[key] = value;
    try {
      this.storage?.setItem(`cp_${key}`, value);
    } catch (error) {
      console.warn('无法保存播放器设置:', error);
    }
  }

  sourceForSong(song = null) {
    if (song?.provider === 'bilibili' || bilibiliVideoUrl(song)) {
      return musicSourceOption('bilibili');
    }
    if (isMusicChannel(song?.provider)) return musicSourceOption(song.provider);
    const neteaseSource = ['gd', 'chksz'].includes(this.config.source)
      ? this.config.source : (song?.provider === 'chksz' ? 'chksz' : 'gd');
    if (song && !song.provider) return musicSourceOption(neteaseSource);
    if (
      ['chksz', 'gd'].includes(song?.provider)
      || ['ChKSz', 'id_search', 'netease'].includes(String(song?.source || ''))
    ) {
      return musicSourceOption(neteaseSource);
    }
    if (song?.provider) throw new Error('此歌曲的音乐源已移除，请重新搜索');
    return musicSourceOption(this.config.source);
  }

  sourceQuery(source = this.config.source) {
    return `source=${musicSourceOption(source).provider}`;
  }

  async search(query, { signal, source = this.config.source, fetchImpl } = {}) {
    const selectedSource = supportedMusicSource(source);
    const url = `${this.baseUrl}/search?${this.sourceQuery(selectedSource)}&keyword=${encodeURIComponent(query)}&limit=${selectedSource === 'gd' ? 10 : 30}`;
    const json = await requestJson(url, { signal, fetchImpl, timeoutMs: isMusicChannel(selectedSource) ? 45_000 : selectedSource === 'gd' ? 30_000 : 10_000 });
    const option = musicSourceOption(selectedSource);
    if (isMusicChannel(selectedSource)) return normalizeChannelSongs(json, selectedSource);
    return option.provider === 'bilibili'
      ? normalizeBilibiliPayload(json)
      : normalizeSearchPayload(json).map(song => ({ ...song, sourceId: song.id, provider: selectedSource, source: selectedSource === 'gd' ? 'GD 音乐台' : 'ChKSz' }));
  }

  async getNewSongs({ signal, source = this.config.source, category = 'all', fetchImpl } = {}) {
    const selectedSource = supportedMusicSource(source);
    if (selectedSource === 'gd' || isMusicChannel(selectedSource)) {
      return this.search('华语', { signal, source: selectedSource, fetchImpl });
    }
    if (selectedSource === 'bilibili') {
      const json = await requestJson(`${this.baseUrl}/discover?source=bilibili&category=${encodeURIComponent(category)}`, { signal, fetchImpl });
      return normalizeBilibiliPayload(json).slice(0, 12);
    }
    const json = await requestJson(`${this.baseUrl}/playlist?id=${NEW_SONGS_PLAYLIST_ID}&source=chksz`, { signal, fetchImpl, timeoutMs: 35_000 });
    return normalizePlaylistPayload(json).slice(0, 12).map(song => ({
      ...song,
      sourceId: song.id,
      provider: 'chksz',
      source: 'ChKSz',
    }));
  }

  async getPlaylistCollection(id, { signal, fetchImpl } = {}) {
    const url = `${this.baseUrl}/playlist?id=${encodeURIComponent(id)}&source=chksz`;
    const json = await requestJson(url, { signal, fetchImpl, timeoutMs: 35_000 });
    const collection = normalizePlaylistCollectionPayload(json);
    if (!collection) return null;
    return {
      ...collection,
      tracks: collection.tracks.map(song => ({
        ...song,
        sourceId: song.id,
        provider: 'chksz',
        source: 'ChKSz',
      })),
    };
  }

  async getSongAtLevel(id, level, { signal, song = null, fetchImpl, source } = {}) {
    const option = source ? musicSourceOption(source) : this.sourceForSong(song);
    const params = new URLSearchParams({
      source: option.provider,
      id: isMusicChannel(option.provider) ? channelSourceId(option.provider, song?.sourceId || id) : String(song?.sourceId || id),
      level: String(level),
    });
    const json = await requestJson(`${this.baseUrl}/song?${params}`, { signal, fetchImpl, timeoutMs: isMusicChannel(option.provider) ? 45_000 : option.provider === 'gd' ? 50_000 : 10_000 });
    if (option.provider === 'bilibili') return normalizeBilibiliPayload(json)[0] || null;
    const normalized = normalizeSongPayload(json, level);
    if (!normalized) return null;
    return {
      ...normalized, id: isMusicChannel(option.provider) ? channelTrackId(option.provider, normalized.id) : normalized.id,
      sourceId: normalized.id, provider: option.provider, format: json.data?.format,
      source: isMusicChannel(option.provider) ? option.label : option.provider === 'gd' ? 'GD 音乐台' : 'ChKSz',
      name: song?.name || normalized.name,
      artist: song?.artist || normalized.artist,
      album: song?.album || normalized.album,
      cover: song?.cover || normalized.cover,
      ...(option.provider === 'gd' || isMusicChannel(option.provider) ? { downloadAllowed: false } : {}),
    };
  }

  async getSong(id, { signal, level = this.config.quality, song: queueSong = null, fetchImpl } = {}) {
    const requestSong = queueSong || this.sourceForSong();
    const source = this.sourceForSong(requestSong).provider;
    const levels = source === 'gd' || isMusicChannel(source)
      ? [supportedQuality(level)] : downloadFallbackLevels(supportedQuality(level));
    for (const candidate of levels) {
      const song = await this.getSongAtLevel(id, candidate, { signal, song: requestSong, fetchImpl, source });
      if (song) return song;
    }
    throw new Error('音乐源未返回可播放地址');
  }

  async getLyric(id, { song = null, signal, fetchImpl } = {}) {
    const option = ['gd', 'chksz'].includes(song?.provider) ? musicSourceOption(song.provider) : this.sourceForSong(song);
    const params = new URLSearchParams({ source: option.provider, id: isMusicChannel(option.provider) ? channelSourceId(option.provider, song?.sourceId || id) : id });
    try {
      const json = await requestJson(`${this.baseUrl}/lyric?${params}`, { signal, fetchImpl, timeoutMs: isMusicChannel(option.provider) ? 45_000 : option.provider === 'gd' ? 30_000 : 10_000 });
      if (option.provider === 'bilibili') return json.data;
      return normalizeLyricsPayload(json);
    } catch (error) {
      if (!(error instanceof RequestCancelledError) && !signal?.aborted) {
        console.warn(`${option.label} 歌词获取失败:`, error);
      }
      if (option.provider === 'bilibili') {
        return { status: 'error', message: requestErrorMessage(error), lrc: '' };
      }
    }
    return null;
  }
}
