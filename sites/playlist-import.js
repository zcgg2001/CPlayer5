import { parsePlaylistLink } from '../js/library-transfer.js';
import { cleanSong } from '../js/library-data.js';
import { handleDiscoveryContent } from './discovery-content.js';
import { boundedBytes, USER_AGENT } from './channel-http.js';
import { json, opsError, config, blockedText } from './operations-store.js';
export async function importPlaylistLink(request,env) {
  if(request.method!=='GET')return opsError(405,'method','请使用 GET');
  let target;try{target=parsePlaylistLink(new URL(request.url).searchParams.get('url'));}catch(error){return opsError(400,'invalid_link',error.message);}
  let data;
  if(target.provider==='netease') {
    const url=new URL('/api/v1/discovery/playlist',request.url);url.searchParams.set('id',target.id);
    const response=await handleDiscoveryContent(new Request(url,{signal:request.signal}),env,url);
    if(!response.ok)return response;data=await response.json();
  } else {
    // The user link contributes a numeric ID only, never an upstream host/path.
    const url=new URL('https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg');
    url.search=new URLSearchParams({type:'1',json:'1',utf8:'1',onlysong:'0',format:'json',disstid:target.id});
    try {
      const response=await (env.LIBRARY_IMPORT_FETCH || fetch)(url,{redirect:'error',signal:AbortSignal.any([request.signal,AbortSignal.timeout(12000)]),headers:{referer:'https://y.qq.com/', 'user-agent':USER_AGENT}});
      if(!response.ok){await response.body?.cancel();throw new Error('upstream');}
      const payload=JSON.parse(new TextDecoder().decode(await boundedBytes(response,2*1024*1024))),list=payload.cdlist?.[0];
      if(payload.code!==0 || !list || !Array.isArray(list.songlist) || String(list.disstid)!==target.id)throw new Error('private_or_missing');
      const tracks=list.songlist.slice(0,1000).filter(s=>/^[\w-]{1,100}$/.test(s.songmid||s.mid||'')).map(s=>cleanSong({id:`at38-qq:${s.songmid||s.mid}`,sourceId:s.songmid||s.mid,provider:'at38-qq',name:s.songname||s.name,artist:(s.singer||[]).map(a=>a.name).join(' / '),album:s.albumname||s.album?.name,duration:s.interval,downloadAllowed:false}));
      data={collection:{id:target.id,name:String(list.dissname||'QQ 音乐歌单').slice(0,80),description:String(list.desc||'').slice(0,1200),trackCount:Number(list.total_song_num)||list.songlist.length},tracks,partial:tracks.length<(Number(list.total_song_num)||list.songlist.length)};
    }catch{return opsError(502,'import_unavailable','QQ 歌单暂不可访问，请确认已公开；也可以使用 CSV / JSON 导入');}
  }
  const settings=await config(env);
  if(blockedText(`${data.collection.name} ${data.collection.description||''}`,settings))return opsError(400,'content_restricted','歌单内容暂不可导入');
  data.tracks=data.tracks.filter(s=>!blockedText(`${s.name} ${s.artist}`,settings)).map(cleanSong);
  return json({...data,provider:target.provider});
}
