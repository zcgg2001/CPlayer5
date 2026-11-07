import { extractMetadata } from '../js/music-catalog.js';
import { boundedBytes, USER_AGENT } from './channel-http.js';

// Completed, public metadata only. No credentials, streams or pending I/O cross requests.
const caches = new WeakMap();
const validId = value => /^\d{1,20}$/.test(String(value || ''));
const text = value => typeof value === 'string' ? value.trim().slice(0,8000) : '';
export async function handleMusicMetadata(request,env,url) {
  const json=(body,status=200)=>new Response(request.method==='HEAD'?null:JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':status===200?'public, max-age=300':'no-store','x-content-type-options':'nosniff'}});
  const id=url.searchParams.get('id');
  if(url.searchParams.get('source')!=='netease' || !validId(id))return json({error:{code:'invalid_metadata_request',message:'暂仅支持网易云歌曲 ID 的资料查询'}},400);
  const fetchImpl=env.METADATA_FETCH || globalThis.fetch;
  if(!caches.has(fetchImpl))caches.set(fetchImpl,new Map());const cache=caches.get(fetchImpl);
  const saved=cache.get(id);if(saved?.expires>Date.now())return json(saved.body);
  const signal=AbortSignal.any([request.signal,AbortSignal.timeout(12_000)]);
  const get=async path=>{
    const response=await fetchImpl(`https://music.163.com${path}`,{signal,redirect:'manual',headers:{'user-agent':USER_AGENT,referer:'https://music.163.com/'}});
    if(!response.ok){await response.body?.cancel();throw new Error('metadata unavailable');}
    const data=JSON.parse(new TextDecoder().decode(await boundedBytes(response,512*1024)));
    if(data.code!==200)throw new Error('metadata unavailable');return data;
  };
  try {
    const data=await get(`/api/song/detail/?${new URLSearchParams({id,ids:JSON.stringify([id])})}`);
    const song=data.songs?.find(song=>String(song.id)===id);if(!song)return json({error:{code:'metadata_not_found',message:'音源未提供此歌曲资料'}},404);
    const partial=[];
    const [albumResult,...artistResults]=await Promise.allSettled([
      validId(song.album?.id)?get(`/api/album/${song.album.id}`):Promise.resolve(null),
      ...(song.artists || []).slice(0,2).map(artist=>validId(artist.id)?get(`/api/artist/${artist.id}`):Promise.resolve(null)),
    ]);
    const album=albumResult.status==='fulfilled' && albumResult.value?.album?.id===song.album?.id?albumResult.value.album:song.album;
    if(albumResult.status==='rejected')partial.push('album');
    const artists=(song.artists || []).slice(0,10).map((artist,index)=>{
      const result=artistResults[index];const detail=result?.status==='fulfilled' && result.value?.artist?.id===artist.id?result.value.artist:artist;
      if(result?.status==='rejected')partial.push('artist');
      // NetEase's generic silhouette is not an artist portrait.
      const avatar=Number(detail.picId || detail.img1v1Id)>0?text(detail.picUrl || detail.img1v1Url):'';
      return {id:artist.id,name:text(artist.name),avatar,description:text(detail.briefDesc || detail.description)};
    });
    const normalized={...song,duration:Number(song.duration)/1000,language:text(song.language || album?.language),publishTime:song.publishTime || album?.publishTime,description:text(song.description),artists,album:{...album,description:text(album?.description || album?.briefDesc)}};
    const info=extractMetadata(normalized);
    const body={code:200,data:{...info,id:String(song.id),provider:'netease',name:text(song.name),artist:artists.map(a=>a.name).join(' / '),album:text(album?.name),cover:text(album?.picUrl),duration:info.metadata.duration,metadataSource:'网易云公开资料',retrievedAt:Date.now(),partial:[...new Set(partial)]}};
    cache.delete(id);if(JSON.stringify(body).length<32*1024)cache.set(id,{body,expires:Date.now()+300_000});
    while(cache.size>60)cache.delete(cache.keys().next().value);
    return json(body);
  } catch { return json({error:{code:'metadata_unavailable',message:'补充资料暂时不可用，已保留搜索结果'}},502); }
}
