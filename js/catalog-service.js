import { requestJson } from './http.js?v=37';
import { mergeMetadata, neteaseMetadataId, aggregateSongs, CATALOG_SOURCES, sourceKey, sourceBlocked } from './music-catalog.js?v=2';

export async function mapConcurrent(items, concurrency, callback, signal) {
  let index = 0;
  await Promise.all(Array.from({length:Math.min(concurrency,items.length)}, async () => {
    while (index < items.length) { signal?.throwIfAborted(); const current = index++; await callback(items[current],current); }
  }));
}
async function bounded(operation, signal, timeoutMs) {
  signal?.throwIfAborted();
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal?.addEventListener('abort',abort,{once:true});
  const timer = setTimeout(()=>controller.abort(new DOMException('请求超时','TimeoutError')),timeoutMs);
  let abortListener;
  try {
    return await Promise.race([operation(controller.signal),new Promise((_,reject)=> {
      abortListener = () => reject(controller.signal.reason);
      controller.signal.addEventListener('abort',abortListener,{once:true});
    })]);
  } finally { clearTimeout(timer); signal?.removeEventListener('abort',abort); controller.signal.removeEventListener('abort',abortListener); }
}

export function failureAvailability(error, now = Date.now()) {
  const code = error?.payload?.error?.code || error?.code;
  const status = ({login_required:'login_required',no_copyright:'no_copyright',region_restricted:'region_restricted'})[code] || 'unavailable';
  return {status, checkedAt:now, expiresAt:now+60_000, evidence:status === 'unavailable' ? 'request_failed' : 'source', reason:status === 'unavailable' ? '未能验证此音源，请稍后重试；这不代表无版权。' : String(error?.payload?.error?.message || '')};
}
function audioSignature(bytes) {
  const head = new TextDecoder().decode(bytes.slice(0,12));
  return head.startsWith('ID3') || head.startsWith('fLaC') || head.startsWith('OggS') || (head.startsWith('RIFF') && head.endsWith('WAVE')) || head.slice(4,8) === 'ftyp' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) || (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3);
}
export async function probeAudio(url, {fetchImpl=globalThis.fetch,signal} = {}) {
  const response = await fetchImpl(url,{signal,headers:{Range:'bytes=0-4095'}});
  let reader;
  try {
    if (!response.ok || !response.body) return false;
    reader = response.body.getReader();
    let prefix = new Uint8Array();
    while (prefix.length < 12) {
      const {value,done} = await reader.read();
      if (done) break;
      const chunk = value.slice(0,4096-prefix.length), combined = new Uint8Array(prefix.length+chunk.length);
      combined.set(prefix); combined.set(chunk,prefix.length); prefix=combined;
    }
    // MIME alone can be a JSON/HTML upstream error mislabeled as audio.
    return prefix.length >= 4 && audioSignature(prefix);
  } finally { if (reader) await reader.cancel().catch(()=>{}); else await response.body?.cancel().catch(()=>{}); }
}

export function createCatalogService(musicService, {fetchImpl=globalThis.fetch,now=Date.now,timeoutMs=25_000} = {}) {
  const checks = new Map(), metadataCache = new Map();
  const hydrate = songs => {
    const groups = aggregateSongs(songs);
    for (const group of groups) for (const source of group.sources) {
      const cached = checks.get(`${sourceKey(source)}:${musicService.config.quality}`);
      if (cached?.expiresAt > now()) source.availability = {...cached};
    }
    return groups;
  };
  return {
    hydrate,
    async enrich(song,{signal}={}) {
      const id=neteaseMetadataId(song); if(!id)return song;
      const cached=metadataCache.get(id);
      if(cached?.expiresAt>now())return mergeMetadata(song,cached.data);
      const response=await requestJson(`/api/v1/music/metadata?${new URLSearchParams({source:'netease',id})}`,{signal,fetchImpl,timeoutMs:15_000});
      if(response?.code!==200 || String(response.data?.id)!==id)throw new Error('资料暂时不可用');
      metadataCache.set(id,{data:response.data,expiresAt:now()+300_000});
      if(metadataCache.size>60)metadataCache.delete(metadataCache.keys().next().value);
      return mergeMetadata(song,response.data);
    },
    async search(query,{signal,sources=CATALOG_SOURCES,offset=0,onProgress=()=>{}}={}) {
      const selected = [...new Set(sources)].filter(source=>CATALOG_SOURCES.includes(source));
      const results = new Array(selected.length), failures = [], completed = [];
      const snapshot = () => ({songs:hydrate(results.flat().filter(Boolean)),failures:[...failures],completed:completed.length,total:selected.length,rawCount:results.flat().filter(Boolean).length});
      await mapConcurrent(selected,3,async (source,index)=> {
        try { results[index] = await bounded(innerSignal=>musicService.search(query,{source,signal:innerSignal,fetchImpl,limit:10,offset}),signal,timeoutMs); }
        catch(error) { if (signal?.aborted) throw error; failures.push(source); }
        signal?.throwIfAborted(); completed.push(source); onProgress(snapshot());
      },signal);
      return snapshot();
    },
    async check(source,{signal,level=musicService.config.quality,force=false}={}) {
      const cacheKey = `${sourceKey(source)}:${level}`, cached = checks.get(cacheKey);
      if (!force && cached?.expiresAt > now()) return source.availability = {...cached};
      if (sourceBlocked(source,level) && !force) return source.availability;
      source.availability = {status:'checking'};
      let state;
      try {
        const data = await bounded(innerSignal=>musicService.getSongAtLevel(source.id,level,{song:source,source:source.provider,signal:innerSignal,fetchImpl}),signal,timeoutMs);
        if (!data?.url) throw new Error('音乐源未返回地址');
        let verified = false;
        try { verified = await bounded(innerSignal=>probeAudio(data.url,{fetchImpl,signal:innerSignal}),signal,8_000); }
        catch(error) { if (signal?.aborted) throw error; /* CORS/network uncertainty is not a restriction. */ }
        const bitrate=Number(data.br || data.bitrate) || null;
        state = {status:verified?'playable':'resolved',checkedAt:now(),expiresAt:now()+300_000,evidence:verified?'audio_bytes':'resolved_url',level:data.level || level,requestedLevel:level,bitrate:bitrate>10000?bitrate/1000:bitrate,format:data.format || '',reason:verified?'已收到音频数据；状态可能随音源变化。':'已获取播放地址，音频数据尚未验证。'};
      } catch(error) {
        if (signal?.aborted) { source.availability = {status:'unknown'}; throw error; }
        state = {...failureAvailability(error,now()),requestedLevel:level};
      }
      checks.delete(cacheKey); checks.set(cacheKey,state);
      if (checks.size>300) checks.delete(checks.keys().next().value);
      return source.availability = {...state};
    },
  };
}
