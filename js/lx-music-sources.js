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
export const isLxSource = provider => Object.hasOwn(labels, provider);
const slots = { 'lx-primary': 'primary', 'lx-backup': 'backup' };

function mappedTracks(original, defaultProvider, level) {
  return [original, ...(Array.isArray(original.sources) ? original.sources : [])].flatMap(track => {
    try {
      const mapped = !sourceBlocked(track, level) && lxTrack(track, defaultProvider);
      return mapped ? [mapped] : [];
    } catch { return []; }
  });
}

function sourceDetails(name, sources) {
  return {
    name: typeof name === 'string' ? name.trim().slice(0, 60) : '',
    sources: Object.fromEntries(Object.values(platforms).flatMap(key => {
      const supported = sources?.[key]?.qualitys;
      if (Array.isArray(sources?.[key]?.actions) && !sources[key].actions.includes('musicUrl')) return [];
      return Array.isArray(supported) ? [[key, { qualitys: supported.filter(tag => qualities.some(([, tags]) => tags.includes(tag))) }]] : [];
    })),
  };
}

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
  const details = new Map();
  try {
    const saved = JSON.parse(storage?.getItem(STORAGE_KEY) || 'null');
    if (saved) settings = {
      enabled: saved.enabled !== false,
      primary: saved.primary ? publicLxUrl(saved.primary).href : '',
      backup: saved.backup ? publicLxUrl(saved.backup).href : '',
    };
    for (const url of [settings.primary, settings.backup].filter(Boolean)) {
      const info = saved?.details?.[url];
      if (info) details.set(url, sourceDetails(info.name, info.sources));
    }
  } catch {}
  const scripts = new Map();
  const cooldown = new Map();
  const listeners = new Set();
  let revision = 0;
  const notify = () => { for (const listener of listeners) listener(); };
  const storedSettings = (values, metadata) => JSON.stringify({ ...values,
    details: Object.fromEntries([...metadata].filter(([url]) => [values.primary, values.backup].includes(url))),
  });
  const rememberDetails = (url, code, sources) => {
    const info = sourceDetails(/^\s*\*\s*@name\s+(.+)$/m.exec(code)?.[1], sources);
    if (JSON.stringify(info) === JSON.stringify(details.get(url))) return;
    details.set(url, info);
    try { storage?.setItem(STORAGE_KEY, storedSettings(settings, details)); } catch { /* Metadata can stay in memory. */ }
    notify();
  };
  const isCurrent = data => !isLxSource(data?.playbackSource) || Boolean(settings.enabled
    && settings[slots[data.playbackSource]] && settings[slots[data.playbackSource]] === data.playbackSourceUrl);

  function list({ song, defaultProvider, level = DEFAULT_PLAYBACK_QUALITY } = {}) {
    const tracks = song ? mappedTracks(song, defaultProvider, level) : null;
    const tags = qualities.slice(Math.max(0, qualities.findIndex(([key]) => key === level))).flatMap(([, tags]) => tags);
    return Object.entries(slots).flatMap(([id, slot]) => {
      const url = settings[slot];
      if (!url) return [];
      const info = details.get(url);
      const disabledReason = !settings.enabled ? '自定义音源已关闭，请在设置中启用'
        : cooldown.get(url) > Date.now() ? '冷却中，请稍后重试'
        : tracks && !tracks.length ? '该歌曲暂无可用的平台标识'
        : tracks && info && !tracks.some(track => tags.some(tag => info.sources[track.source]?.qualitys.includes(tag)))
          ? '不支持这首歌的平台或音质' : '';
      return [{ id, url, label: info?.name || labels[id], role: slot === 'primary' ? '主用' : '备用',
        enabled: settings.enabled, disabledReason }];
    });
  }
  const freshScript = async (url, signal) => {
    const cached = scripts.get(url);
    if (cached?.until > Date.now()) return cached.code;
    const startedRevision = revision;
    const code = await download(url, signal);
    if (startedRevision === revision) scripts.set(url, { code, until: Date.now() + 30 * 60_000 });
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
    const metadata = new Map(details);
    if (next.enabled) await Promise.all([...new Set([next.primary, next.backup].filter(Boolean))].map(async url => {
      const signal = AbortSignal.timeout(8500);
      const code = await download(url, signal);
      const runtime = await open(code, signal);
      try { metadata.set(url, sourceDetails(/^\s*\*\s*@name\s+(.+)$/m.exec(code)?.[1], runtime.sources)); }
      finally { runtime.close(); }
      checked.set(url, { code, until: Date.now() + 30 * 60_000 });
    }));
    storage?.setItem(STORAGE_KEY, storedSettings(next, metadata));
    settings = next;
    revision++;
    scripts.clear();
    cooldown.clear();
    details.clear();
    for (const url of [next.primary, next.backup].filter(Boolean)) if (metadata.has(url)) details.set(url, metadata.get(url));
    for (const [url, entry] of checked) scripts.set(url, entry);
    notify();
  }

  async function* candidates(id, { song, defaultProvider, level = DEFAULT_PLAYBACK_QUALITY, signal, onAttempt, onlyProvider, preferredSource } = {}) {
    const manual = Boolean(onlyProvider);
    if (manual) {
      const choice = list({ song: song || { id }, defaultProvider, level }).find(item => item.id === onlyProvider);
      if (!choice || choice.disabledReason) throw new Error(choice?.disabledReason || '该自定义音源尚未导入');
    }
    if (!settings.enabled) return;
    const startedRevision = revision;
    const original = song || { id };
    const tracks = mappedTracks(original, defaultProvider, level);
    if (!tracks.length) return;
    const qualityIndex = Math.max(0, qualities.findIndex(([key]) => key === level));
    const seen = new Set();
    const order = [...new Set([preferredSource, ...Object.keys(slots)].filter(isLxSource))];
    for (const provider of manual ? [onlyProvider] : order) {
      signal?.throwIfAborted();
      if (startedRevision !== revision) {
        if (manual) throw new Error('自定义音源设置已更新，请重新选择');
        return;
      }
      const url = settings[slots[provider]];
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
        if (startedRevision === revision) rememberDetails(url, code, runtime.sources);
        const supported = sourceDetails('', runtime.sources).sources;
        for (const [requestedLevel, tags] of qualities.slice(qualityIndex)) {
          for (const track of tracks.filter(item => tags.some(tag => supported[item.source]?.qualitys.includes(tag)))) {
            const type = tags.find(tag => supported[track.source].qualitys.includes(tag));
            try {
              const audio = await runtime.resolve({ source: track.source, action: 'musicUrl', info: { type, musicInfo: track.musicInfo } });
              if (!audio) continue;
              const resolved = new URL(audio);
              if (resolved.protocol === 'http:') resolved.protocol = 'https:';
              const audioUrl = publicLxUrl(resolved.href).href;
              const format = /\.(?:flac|mp3|m4a|aac|ogg|opus)$/i.exec(resolved.pathname)?.[0].slice(1).toLowerCase();
              const sourceName = details.get(url)?.name || labels[provider];
              result = actualPlaybackQuality({
                ...original, id: original.id || id, provider: original.provider || defaultProvider,
                url: audioUrl, playbackSource: provider, playbackSourceUrl: url, source: sourceName,
                level: requestedLevel, requestedLevel, format, br: requestedLevel === 'exhigh' && type === '320k' ? 320000 : 0,
                downloadAllowed: false, routing: { automatic: true, manual: manual || Boolean(original.routing?.manual), resolveMs: Date.now() - began },
              });
              break;
            } catch { lifetime.throwIfAborted(); }
          }
          if (result) break;
        }
      } catch {
        signal?.throwIfAborted();
        if (startedRevision === revision && (!runtime || deadline.aborted)) { cooldown.set(url, Date.now() + 30_000); notify(); }
      } finally {
        runtime?.close();
        controller.abort();
      }
      signal?.throwIfAborted();
      if (startedRevision !== revision) {
        if (manual) throw new Error('自定义音源设置已更新，请重新选择');
        return;
      }
      if (result) yield result;
      else if (manual) throw new Error('该自定义音源暂时无法解析这首歌');
    }
  }

  return { get settings() { return { ...settings }; }, save, candidates, list, isCurrent,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    success(data) { if (isCurrent(data) && cooldown.delete(data.playbackSourceUrl)) notify(); },
    failure(data) { if (isCurrent(data)) { cooldown.set(data.playbackSourceUrl, Date.now() + 30_000); notify(); } },
  };
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
      status.textContent = enabled.checked ? '已导入，可在播放器切换或设为后续优先' : '已关闭自定义音源';
    } catch {
      status.textContent = '保存失败。请检查 HTTPS 链接、网络和 LX 脚本格式。';
      status.dataset.error = 'true';
    } finally {
      form.removeAttribute('aria-busy');
      for (const control of form.elements) control.disabled = false;
    }
  });
}
