import { cleanSong, songKey } from './library-data.js';
import { cleanRecords, MAX_SYNC_BYTES } from './account-data.js';
export function parsePlaylistLink(input) {
  const value=String(input || '').trim();
  if(/^\d{1,20}$/.test(value))return {provider:'netease',id:value};
  let url;try {url=new URL(value);}catch {throw new Error('请输入网易云或 QQ 音乐的完整歌单分享链接');}
  if(!['http:','https:'].includes(url.protocol) || url.username || url.password || url.port)throw new Error('分享链接无效');
  if(['music.163.com','y.music.163.com'].includes(url.hostname)) {
    const route=url.hash.startsWith('#/')?new URL(url.hash.slice(1),url.origin):url;
    const id=route.searchParams.get('id') || route.pathname.match(/\/playlist\/(\d+)/)?.[1];
    if(/\/playlist(?:\/|$)/.test(route.pathname) && /^\d{1,20}$/.test(id || ''))return {provider:'netease',id};
  }
  if(['y.qq.com','i.y.qq.com','m.y.qq.com'].includes(url.hostname)) {
    const id=url.searchParams.get('disstid') || url.searchParams.get('id') || url.pathname.match(/\/playlist\/(\d+)/)?.[1];
    if(/playlist|taoge|diss/i.test(url.pathname) && /^\d{1,20}$/.test(id || ''))return {provider:'qq',id};
  }
  throw new Error('暂支持网易云与 QQ 音乐完整歌单链接；短链接请在浏览器打开后复制完整地址');
}
const dedupe=songs=>[...new Map(songs.map(cleanSong).map(s=>[songKey(s),s])).values()];
export function songLink(song) {
  const id=song.sourceId || song.id;
  if(['gd','netease','chksz',undefined].includes(song.provider) && /^\d+$/.test(id))return `https://music.163.com/song?id=${id}`;
  if(song.provider?.includes('qq') && /^[\w-]+$/.test(id))return `https://y.qq.com/n/ryqq/songDetail/${id}`;
  return `https://music.505zc.tech/?${new URLSearchParams({source:song.provider || 'gd',q:`${song.name || ''} ${song.artist || ''}`.trim()})}`;
}
const csvCell=value=>'"'+String(value??'').replace(/^[=+@\-\t\r]/,"'$&").replaceAll('"','""')+'"';
export function exportCSV(songs) {return '\uFEFF'+[['id','name','artist','album','provider','sourceId'],...songs.map(cleanSong).map(s=>[s.id,s.name,s.artist,s.album,s.provider||'gd',s.sourceId||s.id])].map(row=>row.map(csvCell).join(',')).join('\r\n');}
export function parseCSV(input) {
  const rows=[];let row=[],value='',quoted=false;const source=input.replace(/^\uFEFF/,'');
  for(let i=0;i<source.length;i++) {const c=source[i];if(c==='"'){if(quoted && source[i+1]==='"'){value+='"';i++;}else quoted=!quoted;}else if(!quoted && (c===',' || c==='\n')){row.push(value);value='';if(c==='\n'){rows.push(row);row=[];}}else if(c!=='\r' || quoted)value+=c;}
  if(quoted)throw new Error('CSV 引号未闭合');if(value || row.length){row.push(value);rows.push(row);}const header=rows.shift()?.map(v=>v.trim());
  if(!header?.includes('id'))throw new Error('CSV 需包含 id 列，可选 name、artist、album、provider、sourceId');
  return dedupe(rows.filter(r=>r.some(Boolean)).map(r=>{const s=Object.fromEntries(header.map((k,i)=>[k,r[i]||'']));s.name||=`歌曲 ${s.id}`;s.provider||='gd';return s;}));
}
export function exportM3U(songs) {return '#EXTM3U\n'+songs.map(cleanSong).map(s=>`#EXTINF:${Math.round(s.duration||-1)},${((s.artist||'')+' - '+(s.name||s.id)).replace(/[\r\n]/g,' ')}\n#CPLAYER:${JSON.stringify(s)}\n${songLink(s)}`.replace(/\r/g,'')).join('\n')+'\n';}
export function parseM3U(input) {
  const songs=[];let pending=null;
  for(const line of input.split(/\r?\n/)) {
    if(line.startsWith('#CPLAYER:')){pending=cleanSong(JSON.parse(line.slice(9)));continue;}
    if(!line || line.startsWith('#'))continue;
    if(pending){songs.push(pending);pending=null;continue;}
    let url;try{url=new URL(line);}catch{throw new Error('本地文件路径需在离线管理中重新导入音频');}
    if(url.hostname==='music.163.com' && /^\d{1,20}$/.test(url.searchParams.get('id')||''))songs.push({id:url.searchParams.get('id'),name:`歌曲 ${url.searchParams.get('id')}`,provider:'gd'});
    else throw new Error('此 M3U 缺少 CPlayer 曲目元数据；不导入任意远程音频地址');
  }
  return dedupe(songs);
}
export function parseTransfer(input,filename='library.json') {
  if(new TextEncoder().encode(input).length>MAX_SYNC_BYTES)throw new Error('导入文件不能超过 2 MB');
  let songs,records;
  if(/\.csv$/i.test(filename))songs=parseCSV(input);
  else if(/\.m3u8?$/i.test(filename))songs=parseM3U(input);
  else {const data=JSON.parse(input);if(data.format==='cplayer-library-v2')records=cleanRecords(data.records);else if(data.format==='cplayer5-account-v1'){records=cleanRecords(data.cloud.records);for(const list of data.sharedPlaylists||[])records['playlist:shared-'+list.id]={...list,sharedId:undefined};records=cleanRecords(records);}else songs=dedupe(Array.isArray(data)?data:data.songs||data.tracks||data.playlist?.tracks||[]);}
  if(songs && (!songs.length || songs.length>1000))throw new Error('歌单需包含 1–1000 首歌曲');
  return records?{records}:{songs};
}

// Import merges assets, preserving current records; conflicting playlists become private copies.
export function mergeImport(existing, incoming, uuid = () => crypto.randomUUID()) {
  const result={...existing};
  for(const [key,value] of Object.entries(cleanRecords(incoming))) {
    if(value===null)continue;
    if(key.startsWith('playlist:')) {
      const clean={...value,sharedId:undefined};
      if(result[key] && JSON.stringify(result[key])!==JSON.stringify(clean))result[`playlist:${uuid()}`]={...clean,name:clean.name+'（导入）'};
      else result[key]=clean;
    } else if(result[key]==null)result[key]=value;
  }
  return cleanRecords(result);
}
