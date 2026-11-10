import { cleanSong, songKey } from './library-data.js';
export const MAX_AUDIO_BYTES = 64 * 1024 * 1024;
export const DEFAULT_OFFLINE_BYTES = 512 * 1024 * 1024;
export function createOfflineDatabase(indexedDB = globalThis.indexedDB) {
  let opening;
  const open=()=>opening ||= new Promise((resolve,reject)=>{
    if(!indexedDB)return reject(new Error('浏览器不支持离线存储'));
    const request=indexedDB.open('CPlayerPersonalOffline',1);
    request.onupgradeneeded=()=>{request.result.createObjectStore('files',{keyPath:'key'});const entries=request.result.createObjectStore('entries',{keyPath:'key'});entries.createIndex('owner','owner');};
    request.onerror=()=>reject(request.error);request.onblocked=()=>reject(new Error('请关闭其他播放器标签后重试'));
    request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>{db.close();opening=null;};resolve(db);};
  }).catch(error=>{opening=null;throw error;});
  const key=(owner,id)=>`${owner}|${id}`;
  async function transact(stores,mode,work) {const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction(stores,mode);let result;tx.oncomplete=()=>resolve(result);tx.onerror=tx.onabort=()=>reject(tx.error||new Error('离线存储失败或空间不足'));work(tx,value=>{result=value;},reject);});}
  return {
    list: owner=>transact(['entries'],'readonly',(tx,set)=>{const r=tx.objectStore('entries').index('owner').getAll(owner);r.onsuccess=()=>set(r.result);}),
    get: (owner,id)=>transact(['files'],'readonly',(tx,set)=>{const r=tx.objectStore('files').get(key(owner,id));r.onsuccess=()=>set(r.result?.blob||null);}),
    put: (owner,id,song,blob,limit)=>transact(['entries','files'],'readwrite',(tx,set,reject)=>{
      const entries=tx.objectStore('entries'), request=entries.index('owner').getAll(owner);
      request.onsuccess=()=>{const used=request.result.filter(r=>r.id!==id).reduce((n,r)=>n+r.bytes,0);if(used+blob.size>limit){reject(new Error('超过离线容量上限，请先清理歌曲或提高容量'));tx.abort();return;}
        const item={key:key(owner,id),owner,id,song:cleanSong(song),bytes:blob.size,savedAt:Date.now(),type:blob.type};entries.put(item);tx.objectStore('files').put({key:item.key,blob});set(item);};
    }),
    remove:(owner,id)=>transact(['entries','files'],'readwrite',(tx)=>{for(const name of ['entries','files'])tx.objectStore(name).delete(key(owner,id));}),
    clear:owner=>transact(['entries','files'],'readwrite',(tx)=>{const r=tx.objectStore('entries').index('owner').getAllKeys(owner);r.onsuccess=()=>{for(const k of r.result)for(const name of ['entries','files'])tx.objectStore(name).delete(k);};}),
  };
}
export async function boundedAudio(response,signal) {
  if(!response.ok || response.status===206 || response.type==='opaque')throw new Error('音源未返回可保存的完整音频');
  const mime=(response.headers.get('content-type')||'').split(';')[0];
  if(!/^audio\//.test(mime) && !['application/octet-stream','application/ogg'].includes(mime)){await response.body?.cancel();throw new Error('返回内容不是音频');}
  if(Number(response.headers.get('content-length'))>MAX_AUDIO_BYTES){await response.body?.cancel();throw new Error('单首离线文件最大 64 MB');}
  const reader=response.body?.getReader();if(!reader)throw new Error('音频内容为空');const chunks=[];let size=0;
  try {while(true){signal?.throwIfAborted();const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_AUDIO_BYTES)throw new Error('单首离线文件最大 64 MB');chunks.push(value);}}finally{await reader.cancel();}
  signal?.throwIfAborted();if(!size)throw new Error('音频内容为空');return new Blob(chunks,{type:mime});
}
export function createOfflineAudio({ storage, getOwner, database=createOfflineDatabase(), fetchImpl=fetch, urlAPI=URL }) {
  const urls=new Set(), controllers=new Set();
  const limit=()=>Math.max(64,Math.min(2048,Number(storage.getItem('cp_offline_mb'))||512))*1024*1024;
  const check=(owner,signal)=>{signal?.throwIfAborted();if(owner!==getOwner())throw new DOMException('账号已切换','AbortError');};
  return {
    list:()=>database.list(getOwner()),
    limit, setLimit(mb){if(!Number.isFinite(mb)||mb<64||mb>2048)throw new Error('容量范围为 64–2048 MB');storage.setItem('cp_offline_mb',String(Math.floor(mb)));},
    async download(song,resolve,{signal}={}) {
      const owner=getOwner(),controller=new AbortController();controllers.add(controller);
      const combined=AbortSignal.any([controller.signal,...(signal?[signal]:[]),AbortSignal.timeout(120000)]);
      try {const data=await resolve(song,combined);check(owner,combined);
        if(!data?.url)throw new Error('当前音源没有返回可下载的音频');
        if(data.downloadAllowed===false)throw new Error('当前音源不提供离线下载，可导入你已有的音频');
        const target=new URL(data.url,globalThis.location?.href);if(!['https:','http:'].includes(target.protocol)||target.username||target.password)throw new Error('音频地址无效');
        const response=await fetchImpl(target,{signal:combined,credentials:'omit'});const blob=await boundedAudio(response,combined);check(owner,combined);
        return await database.put(owner,songKey(song),song,blob,limit());
      }finally{controllers.delete(controller);}
    },
    async importFile(file,{signal}={}) {const owner=getOwner();if(!file.size || file.size>MAX_AUDIO_BYTES || !/\.(mp3|flac|m4a|aac|ogg|wav|opus)$/i.test(file.name))throw new Error('请选择 64 MB 以内的 MP3 / FLAC / M4A / AAC / OGG / WAV / Opus 文件');check(owner,signal);const song={id:crypto.randomUUID(),provider:'local',name:file.name.replace(/\.[^.]+$/,''),artist:'本地音频',downloadAllowed:false};await database.put(owner,songKey(song),song,file,limit());check(owner,signal);return song;},
    async resolve(song,signal) {if(!song)return null;const owner=getOwner(),blob=await database.get(owner,songKey(song));check(owner,signal);if(!blob)return null;const url=urlAPI.createObjectURL(blob);urls.add(url);const release=()=>{urlAPI.revokeObjectURL(url);urls.delete(url);};signal?.addEventListener('abort',release,{once:true});return {...song,url,offline:true,downloadAllowed:false,release};},
    remove:song=>database.remove(getOwner(),songKey(song)),
    clear:(owner=getOwner())=>database.clear(owner),
    reset(){for(const c of controllers)c.abort();for(const url of urls)urlAPI.revokeObjectURL(url);controllers.clear();urls.clear();},
  };
}
