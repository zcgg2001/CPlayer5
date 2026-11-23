import { MUSIC_CHANNELS, channelSourceId } from './music-channels.js';
import { sourceBlocked } from './music-catalog.js';
import { actualPlaybackQuality, DEFAULT_PLAYBACK_QUALITY } from './playback-router.js';
import { lxHttp, openLxSource, publicLxUrl } from './lx-source-runtime.js';

const STORAGE_KEY = 'cp_lx_sources_v1';
const MAX_SCRIPT = 512 * 1024;
const REPO = 'pdone/lx-music-source';
export const LX_DEFAULTS = Object.freeze({
  enabled: true,
  primary: `https://cdn.jsdelivr.net/gh/${REPO}@main/xinglan/latest.js`,
  backup: `https://cdn.jsdelivr.net/gh/${REPO}@main/qingliang/latest.js`,
});
const labels = { 'lx-primary': '导入主音源', 'lx-backup': '导入备用音源' };
const platforms = { netease: 'wy', qq: 'tx', kuwo: 'kw', kugou: 'kg' };
const qualities = [
  ['jymaster', ['master']], ['hires', ['hires', 'flac24bit']], ['lossless', ['flac']],
  ['exhigh', ['320k', '192k']], ['standard', ['128k']],
];

export const lxSourceLabel = provider => labels[provider];

function lxTrack(track, defaultProvider) {
  const provider = track.provider || defaultProvider;
  const platform = MUSIC_CHANNELS[provider]?.platform || (['gd', 'chksz'].includes(provider) ? 'netease' : provider);
  const source = platforms[platform];
  if (!source || provider === 'gequke') return null;
  let id = channelSourceId(provider, track.sourceId || track.id);
  if (provider.startsWith('jianbin-') && /^https?:\/\//.test(id)) id = new URL(id).searchParams.get('id') || '';
  if (source === 'tx') id = track.mid || track.songmid || id;
  if (source === 'kw') id = id.replace(/^MUSIC_/, '');
  const valid = source === 'tx' ? /^[a-z\d]{14}$/i : source === 'kg' ? /^[a-f\d]{32}$/i : /^\d{1,20}$/;
  if (!valid.test(id) || (source === 'tx' && /^\d+$/.test(id))) return null;
  const musicInfo = {
    id, songmid: id, source, name: String(track.name || '').slice(0, 200),
    singer: String(track.artist || '').slice(0, 200), albumName: String(track.album || '').slice(0, 200),
    duration: Number(track.duration || track.metadata?.duration) || 0,
    ...(source === 'kg' ? { hash: id } : source === 'kw' ? { rid: id } : {}),
  };
  return { source, musicInfo };
}

async function fetchScript(url, signal) {
  let code;
  const fetchFrom = async target => {
    const response = await lxHttp(target, {}, AbortSignal.any([signal, AbortSignal.timeout(2500)]));
    if (response.statusCode !== 200) throw new Error('音源链接无法下载');
    return response.body;
  };
  try { code = await fetchFrom(url); }
  catch (error) {
    signal.throwIfAborted();
    const slot = ['primary', 'backup'].find(key => LX_DEFAULTS[key] === url);
    if (!slot) throw error;
    const name = slot === 'primary' ? 'xinglan' : 'qingliang';
    const metadata = JSON.parse(await fetchFrom(`https://api.github.com/repos/${REPO}/contents/${name}/latest.js?ref=main`));
    if (metadata.encoding !== 'base64' || metadata.size > MAX_SCRIPT) throw new Error('音源脚本无法读取');
    code = new TextDecoder().decode(Uint8Array.from(atob(metadata.content), character => character.charCodeAt(0)));
  }
  if (!code?.trim() || code.length > MAX_SCRIPT) throw new Error('音源脚本为空或过大');
  return code;
}

export function createLxSources(storage, { open = openLxSource, download = fetchScript } = {}) {
  let settings = { ...LX_DEFAULTS };
  try {
    const saved = JSON.parse(storage?.getItem(STORAGE_KEY) || 'null');
    if (saved) settings = {
      enabled: saved.enabled !== false,
      primary: saved.primary ? publicLxUrl(saved.primary).href : '',
      backup: saved.backup ? publicLxUrl(saved.backup).href : '',
    };
  } catch {}
  const scripts = new Map();
  const cooldown = new Map();
  const freshScript = async (url, signal) => {
    const cached = scripts.get(url);
    if (cached?.until > Date.now()) return cached.code;
    const code = await download(url, signal);
    scripts.set(url, { code, until: Date.now() + 30 * 60_000 });
    return code;
  };

  async function save(values) {
    const next = {
      enabled: values.enabled,
      primary: values.primary.trim() ? publicLxUrl(values.primary).href : '',
      backup: values.backup.trim() ? publicLxUrl(values.backup).href : '',
    };
    if (next.enabled && !next.primary && !next.backup) throw new Error('至少填写一个音源链接');
    const checked = new Map();
    if (next.enabled) await Promise.all([...new Set([next.primary, next.backup].filter(Boolean))].map(async url => {
      const signal = AbortSignal.timeout(8500);
      const code = await download(url, signal);
      const runtime = await open(code, signal);
      runtime.close();
      checked.set(url, { code, until: Date.now() + 30 * 60_000 });
    }));
    storage?.setItem(STORAGE_KEY, JSON.stringify(next));
    settings = next;
    scripts.clear();
    cooldown.clear();
    for (const [url, entry] of checked) scripts.set(url, entry);
  }

  async function* candidates(id, { song, defaultProvider, level = DEFAULT_PLAYBACK_QUALITY, signal, onAttempt } = {}) {
    if (!settings.enabled) return;
    const original = song || { id };
    let tracks;
    try {
      tracks = [original, ...(original.sources || [])].flatMap(track => {
        if (sourceBlocked(track, level)) return [];
        try {
          const mapped = lxTrack(track, defaultProvider);
          return mapped ? [mapped] : [];
        } catch { return []; }
      });
    } catch { return; }
    if (!tracks.length) return;
    const qualityIndex = Math.max(0, qualities.findIndex(([key]) => key === level));
    const seen = new Set();
    for (const [provider, url] of [['lx-primary', settings.primary], ['lx-backup', settings.backup]]) {
      signal?.throwIfAborted();
      if (!url || seen.has(url) || cooldown.get(url) > Date.now()) continue;
      seen.add(url);
      const began = Date.now();
      const controller = new AbortController();
      const deadline = AbortSignal.timeout(8000);
      const lifetime = AbortSignal.any([controller.signal, deadline, ...(signal ? [signal] : [])]);
      let runtime;
      let result;
      try {
        onAttempt?.({ provider, level, stage: 'resolving' });
        const code = await freshScript(url, lifetime);
        runtime = await open(code, lifetime);
        for (const [requestedLevel, tags] of qualities.slice(qualityIndex)) {
          const track = tracks.find(item => tags.some(tag => runtime.sources[item.source]?.qualitys?.includes(tag)));
          if (!track) continue;
          const type = tags.find(tag => runtime.sources[track.source].qualitys.includes(tag));
          try {
            const audio = await runtime.resolve({ source: track.source, action: 'musicUrl', info: { type, musicInfo: track.musicInfo } });
            if (!audio) continue;
            const resolved = new URL(audio);
            if (resolved.protocol === 'http:') resolved.protocol = 'https:';
            const audioUrl = publicLxUrl(resolved.href).href;
            const format = /\.(?:flac|mp3|m4a|aac|ogg|opus)$/i.exec(resolved.pathname)?.[0].slice(1).toLowerCase();
            const sourceName = /^\s*\*\s*@name\s+(.+)$/m.exec(code)?.[1].trim().slice(0, 60) || labels[provider];
            result = actualPlaybackQuality({
              ...original, id: original.id || id, provider: original.provider || defaultProvider,
              url: audioUrl, playbackSource: provider, source: sourceName,
              level: requestedLevel, requestedLevel, format, br: requestedLevel === 'exhigh' && type === '320k' ? 320000 : 0,
              downloadAllowed: false, routing: { automatic: true, resolveMs: Date.now() - began },
            });
            break;
          } catch { lifetime.throwIfAborted(); }
        }
      } catch {
        signal?.throwIfAborted();
        if (!runtime || deadline.aborted) cooldown.set(url, Date.now() + 30_000);
      } finally {
        runtime?.close();
        controller.abort();
      }
      signal?.throwIfAborted();
      if (result) yield result;
    }
  }

  return { get settings() { return { ...settings }; }, save, candidates };
}

export function bindLxSettings(sources, documentRef = document) {
  const form = documentRef.getElementById('lxSourceForm');
  if (!form) return;
  const { lxSourceEnabled: enabled, lxSourcePrimary: primary, lxSourceBackup: backup, lxSourceSave: save } = form.elements;
  const status = documentRef.getElementById('lxSourceFeedback');
  const render = () => {
    const values = sources.settings;
    enabled.checked = values.enabled;
    primary.value = values.primary;
    backup.value = values.backup;
  };
  render();
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (save.disabled) return;
    form.setAttribute('aria-busy', 'true');
    for (const control of form.elements) control.disabled = true;
    status.textContent = enabled.checked ? '正在检查音源脚本…' : '正在保存…';
    status.dataset.error = 'false';
    try {
      await sources.save({ enabled: enabled.checked, primary: primary.value, backup: backup.value });
      render();
      status.textContent = enabled.checked ? '已导入，下次播放时优先使用' : '已关闭导入音源优先播放';
    } catch {
      status.textContent = '保存失败。请检查 HTTPS 链接、网络和 LX 脚本格式。';
      status.dataset.error = 'true';
    } finally {
      form.removeAttribute('aria-busy');
      for (const control of form.elements) control.disabled = false;
    }
  });
}
