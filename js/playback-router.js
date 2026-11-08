import { MUSIC_CHANNELS, channelSourceId, channelTrackId } from './music-channels.js';
import { aggregateSongs, neteaseMetadataId, sourceBlocked } from './music-catalog.js';
import { RequestCancelledError } from './http.js';

// Default order for automatic choices and fallbacks. An explicitly selected
// search/catalog channel takes precedence over this order and latency scores.
export const PLAYBACK_SOURCE_ORDER = Object.freeze(['chksz', 'netease', 'gd', 'op-netease', 'at38-netease', 'jianbin-netease', 'qq', 'op-qq', 'at38-qq', 'jianbin-qq', 'op-applemusic', 'gequke', 'jianbin-kuwo', 'jianbin-kugou']);
const QUALITY_ORDER = ['jymaster', 'hires', 'lossless', 'exhigh', 'standard'];
const HEALTH_KEY = 'cp_playback_health_v1';
export function actualPlaybackQuality(data) {
  let path = '';
  try { path = new URL(data.url, 'https://player.invalid').pathname; } catch { /* Invalid URL is handled by the controller. */ }
  const format = path.match(/\.(mp3|flac|m4a|aac)(?:$)/i)?.[1]?.toLowerCase() || data.format;
  if (format === 'mp3' && ['jymaster','hires','lossless'].includes(data.level)) {
    const bitrate = Number(data.br) || 0;
    return { ...data, format, level:bitrate>=256000 && bitrate<=400000?'exhigh':'standard', br:bitrate<=400000?bitrate:0 };
  }
  return { ...data, ...(format ? {format} : {}) };
}
const platform = source => MUSIC_CHANNELS[source]?.platform || (['gd', 'chksz'].includes(source) ? 'netease' : source);
export function playbackLevels(provider, ceiling = 'jymaster') {
  const supported = provider === 'chksz' ? QUALITY_ORDER : provider === 'gd' ? QUALITY_ORDER.slice(1)
    : MUSIC_CHANNELS[provider]?.qualities.length ? [...MUSIC_CHANNELS[provider].qualities].reverse() : ['standard'];
  const start = Math.max(0, QUALITY_ORDER.indexOf(ceiling));
  return supported.filter(level => QUALITY_ORDER.indexOf(level) >= start);
}
export function samePlaybackRecording(left, right) {
  return Boolean(left?.name && right?.name && aggregateSongs([left, right]).length === 1);
}
const cancelled = (error, signal) => signal?.aborted || error instanceof RequestCancelledError || error?.name === 'AbortError';
const refusal = error => [401,402,403,429].includes(error?.status);
const providerFailure = error => refusal(error) || ['RequestTimeoutError','NetworkRequestError','TimeoutError'].includes(error?.name)
  || (error?.status >= 500 && !/音质|播放链接|此歌曲|未返回|未提供/.test(error?.payload?.error?.message || ''));

export function createPlaybackRouter(service, { storage, now = Date.now } = {}) {
  const health = new Map();
  try {
    const saved = JSON.parse(storage?.getItem(HEALTH_KEY) || '{}');
    for (const provider of [...PLAYBACK_SOURCE_ORDER, 'bilibili']) {
      const item = saved[provider];
      if (item && Number.isFinite(item.at) && item.at > now() - 86400000) health.set(provider, {
        at:item.at, failures:Math.min(10, Math.max(0, Number(item.failures)||0)),
        latency:Math.min(30000, Math.max(0, Number(item.latency)||0)),
        until:Math.min(now()+3600000, Math.max(0, Number(item.until)||0)),
      });
    }
  } catch { /* Storage is optional. */ }
  const persist = () => { try { storage?.setItem(HEALTH_KEY, JSON.stringify(Object.fromEntries(health))); } catch { /* optional */ } };
  const cooling = provider => (health.get(provider)?.until || 0) > now();
  function success(data, ms) {
    if (!data?.provider) return;
    const previous = health.get(data.provider);
    health.set(data.provider, { at:now(), failures:0, until:0, latency:previous?.latency ? previous.latency*0.7+ms*0.3 : ms }); persist();
  }
  function failure(data, error) {
    if (!data?.provider || cancelled(error)) return;
    const previous = health.get(data.provider) || {}, failures = Math.min(10,(previous.failures||0)+1);
    const retry = Number(error?.retryAfter) * 1000 || Math.max(0, Date.parse(error?.retryAfter) - now()) || 0;
    const cooldown = [401,402,403].includes(error?.status) ? 900000 : error?.status === 429 ? Math.max(300000,retry) : Math.min(300000,30000*failures);
    health.set(data.provider, { ...previous, at:now(), failures, until:now()+Math.min(3600000,cooldown) }); persist();
  }
  function order(providers) {
    const score = p => { const h=health.get(p); return (h?.failures||0)*20000 + (h?.latency||0) + Math.max(0,PLAYBACK_SOURCE_ORDER.indexOf(p))*900; };
    return [...providers].sort((a,b)=>score(a)-score(b));
  }
  async function* candidates(id, { song, signal, fetchImpl, level = 'jymaster', onAttempt = () => {} } = {}) {
    const input = song || { id };
    const original = { ...input, provider:input.provider || service.sourceForSong(input).provider };
    const sources = original.sources?.length ? original.sources : [original];
    const direct = new Map();
    const add = candidate => {
      if (!candidate?.provider || !candidate.id) return;
      const entries=direct.get(candidate.provider)||[];
      if (!entries.some(item=>String(item.sourceId||item.id)===String(candidate.sourceId||candidate.id))) entries.push(candidate);
      direct.set(candidate.provider,entries);
    };
    for (const item of sources) add({ ...original, ...item, sources:undefined, provider:item.provider || service.sourceForSong(item).provider });
    const neteaseId = neteaseMetadataId(original);
    if (neteaseId) for (const provider of ['netease','chksz','gd','at38-netease','op-netease']) {
      if (!direct.has(provider)) add({ ...original, sources:undefined, provider, id:MUSIC_CHANNELS[provider]?channelTrackId(provider,neteaseId):neteaseId, sourceId:neteaseId, availability:undefined });
    }
    for (const item of sources) if (['qq','at38-qq','op-qq'].includes(item.provider)) {
      const mid=channelSourceId(item.provider,item.sourceId||item.id);
      if (/^[a-zA-Z0-9]{1,128}$/.test(mid)) for (const provider of ['qq','at38-qq','op-qq']) if(!direct.has(provider)) add({...item,provider,id:channelTrackId(provider,mid),sourceId:mid,availability:undefined});
    }
    const video = sources.some(item=>item.provider==='bilibili');
    const primaryPlatform=platform(sources[0]?.provider || service.sourceForSong(original).provider);
    const available=video?['bilibili']:order(PLAYBACK_SOURCE_ORDER);
    const preferred = available.includes(original.preferredProvider) && direct.has(original.preferredProvider) ? original.preferredProvider : null;
    const remaining = available.filter(provider => provider !== preferred);
    const providers=[...(preferred ? [preferred] : []),...remaining.filter(p=>direct.has(p)),...remaining.filter(p=>!direct.has(p)&&platform(p)===primaryPlatform),...remaining.filter(p=>!direct.has(p)&&platform(p)!==primaryPlatform)];
    let attempts=0, searches=0, spent=0, lastError;
    const bounded = async (fn, timeout) => { const start=now();try{return await fn(Math.max(1,Math.min(timeout,60000-spent)));}finally{spent+=Math.max(0,now()-start);} };
    for (const provider of providers) {
      signal?.throwIfAborted();
      if (attempts>=16 || spent>=60000) break;
      if (cooling(provider)) continue;
      let tracks=direct.get(provider);
      if (!tracks && !video && searches<5 && original.name && original.artist && !/未知|^unknown$/i.test(original.artist)) {
        searches++;
        try {
          onAttempt({provider,stage:'matching'});
          const found=await bounded(timeoutMs=>service.search(`${original.name} ${original.artist}`.slice(0,100),{source:provider,signal,fetchImpl,limit:10,timeoutMs}),8000);
          tracks=found.filter(candidate=>samePlaybackRecording(original,candidate)).slice(0,1);
        } catch(error) { if(cancelled(error,signal))throw error;lastError=error;if(providerFailure(error))failure({provider},error);continue; }
      }
      if(!tracks?.length)continue;
      let skipProvider=false;
      for(const track of tracks) {
        const seenUrls=new Set();
        let lastResolvedRank=-1;
        for(const requestedLevel of playbackLevels(provider,level)) {
          signal?.throwIfAborted();
          if(skipProvider || attempts>=16 || spent>=60000)break;
          if(sourceBlocked(track,requestedLevel))continue;
          if(QUALITY_ORDER.indexOf(requestedLevel)<=lastResolvedRank)continue;
          attempts++;
          onAttempt({provider,level:requestedLevel,stage:'resolving',attempt:attempts});
          const began=now();
          try {
            const resolved=await bounded(timeoutMs=>service.getSongAtLevel(track.id,requestedLevel,{song:track,source:provider,signal,fetchImpl,timeoutMs,exactQuality:true}),12000);
            if(!resolved?.url || seenUrls.has(resolved.url))continue;
            const data=actualPlaybackQuality(resolved);
            // Some catalogs (including OP) only reveal album/duration after
            // preparation. Keep that evidence for strict later source matching.
            if (!original.album && data.album) original.album = data.album;
            if (!original.duration && data.duration) original.duration = data.duration;
            seenUrls.add(data.url);
            const result={...data,id:original.id||id,catalogId:original.catalogId,sources:original.sources,requestedLevel,
              routing:{automatic:true,attempt:attempts,resolveMs:Math.max(0,now()-began)}};
            const feedback=yield result;
            spent += Math.max(0, Number(feedback?.waitMs) || 0);
            // A dead transport should move to another provider immediately;
            // unsupported media or unavailable high quality can try a lower tier.
            if(feedback?.skipProvider)skipProvider=true;
            // Do not re-request qualities the server already downgraded past.
            lastResolvedRank=Math.max(QUALITY_ORDER.indexOf(requestedLevel),QUALITY_ORDER.indexOf(data.level));
          } catch(error) {
            if(cancelled(error,signal))throw error;
            lastError=error;
            if(providerFailure(error)||!(Number.isInteger(error?.status))) {failure({provider},error);skipProvider=true;}
          }
        }
        if(skipProvider)break;
      }
    }
    const error=new Error('暂时找不到可播放的同一版本歌曲，请稍后重试');error.code='playback_exhausted';error.cause=lastError;throw error;
  }
  return { candidates, success, failure, health:()=>Object.fromEntries(health) };
}
