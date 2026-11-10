import { createPersonalLibraryStore, createListeningTracker } from './personal-library-store.js';
import { cleanSong, songKey, imageURL } from './library-data.js';
import { exportCSV, exportM3U, parseTransfer, mergeImport }  from './library-transfer.js';
import { createOfflineAudio } from './offline-audio.js';
import { cleanRecords } from './account-data.js';

export function initPersonalLibrary({ document, storage, account, musicService, audio, getSong, getQueue, onPlay, onQueue, onCollection, onSearch, notify, refreshFavorites }) {
  const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n;};
  const button=(label,action,cls='pl-button')=>{const b=el('button',cls,label);b.type='button';b.addEventListener('click',()=>run(action,b));return b;};
  const label=(title,input)=>{const n=el('label','pl-field');n.append(el('span','',title),input);return n;};
  const input=(value='',type='text',max=300)=>{const n=el('input');n.type=type;n.value=value;n.maxLength=max;return n;};
  const area=(value='',max=1200)=>{const n=el('textarea');n.value=value;n.maxLength=max;n.rows=3;return n;};
  const owner=()=>account.user()?.id || 'guest';
  const store=createPersonalLibraryStore({storage,onChange(){refreshFavorites();window.dispatchEvent(new Event('cplayer:library-changed'));}});
  const offline=createOfflineAudio({storage,getOwner:owner});musicService.offlineAudio=offline;
  musicService.offlineOnly=()=>account.isOffline();
  const tracker=createListeningTracker({audio,store,getSong,getOwner:owner,deviceId:account.library.deviceId});
  window.addEventListener('cplayer:account-switching',()=>{tracker.reset();offline.reset();dialog.close();});
  window.addEventListener('pagehide',()=>tracker.flush());
  document.addEventListener('visibilitychange',()=>{if(document.hidden)tracker.flush();});
  const dialog=el('dialog','personal-library');dialog.id='personalLibraryDialog';dialog.setAttribute('aria-labelledby','personalLibraryTitle');
  const header=el('header','pl-header'),heading=el('div');heading.append(el('p','pl-eyebrow','YOUR MUSIC, YOUR STORY'));
  const title=el('h2','','我的音乐');title.id='personalLibraryTitle';const identity=el('p','pl-muted');heading.append(title,identity);
  header.append(heading,button('关闭',()=>{if(guard())dialog.close();},'pl-close'));
  const nav=el('nav','pl-nav');nav.setAttribute('aria-label','个人库分类');
  const status=el('p','pl-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const body=el('div','pl-body');dialog.append(header,nav,status,body);document.body.append(dialog);
  let tab='favorites',favoriteType='song',opener=null,busy=false,viewVersion=0,dirty=false,downloadController=null,sectionRoot=false;
  const tabs=[['favorites','收藏'],['playlists','歌单'],['history','最近播放'],['stats','听歌报告'],['offline','离线'],['transfer','导入导出']];
  const navButtons=new Map(tabs.map(([key,name])=>{const b=button(name,()=>navigate(key),'pl-tab');nav.append(b);return [key,b];}));
  function message(text,error=false){status.textContent=text;status.classList.toggle('is-error',error);}
  async function run(action,trigger) {if(busy)return;busy=true;trigger?.setAttribute('aria-busy','true');try{await action();}catch(error){if(error.name!=='AbortError')message(error.message,true);}finally{busy=false;trigger?.removeAttribute('aria-busy');}}
  const request=(path,options)=>account.request(path,options);
  function showHeader(name,note,actions=[]) {const h=el('div','pl-section-heading'),copy=el('div');copy.append(el('h3','',name));if(note)copy.append(el('p','pl-muted',note));const tools=el('div','pl-actions');tools.append(...actions);h.append(copy,tools);body.append(h);}
  function empty(title,note){const block=el('div','pl-empty');block.append(el('span','pl-empty-mark','♪'),el('h4','',title),el('p','pl-muted',note));body.append(block);}
  function art(url,name=''){const n=el('div','pl-art');if(imageURL(url)){const img=el('img');img.src=url;img.alt='';img.loading='lazy';img.referrerPolicy='no-referrer';img.onerror=()=>img.remove();n.append(img);}else n.append(el('span','',name.slice(0,1)||'♪'));return n;}
  function resetBody(root=false){sectionRoot=root;viewVersion++;body.replaceChildren();dirty=false;body.scrollTop=0;return viewVersion;}
  function guard(){return !dirty || confirm('有未保存的编辑，确定放弃吗？');}
  async function navigate(key){if(!guard())return;tab=key;resetBody(true);message('');for(const [id,b] of navButtons)b.setAttribute('aria-current',id===key?'page':'false');identity.textContent=account.user()?`${account.user().username || account.user().name} · ${account.isOffline()?'离线资料，联网验证后同步':'私人资料随账号同步'}`:'游客个人库 · 保存在当前浏览器';await ({favorites:renderFavorites,playlists:renderPlaylists,history:renderHistory,stats:renderStats,offline:renderOffline,transfer:renderTransfer})[key]();}
  dialog.addEventListener('keydown',e=>e.stopPropagation());dialog.addEventListener('cancel',e=>{if(!guard())e.preventDefault();});
  dialog.addEventListener('close',()=>{viewVersion++;downloadController?.abort();opener?.focus();});
  window.addEventListener('cplayer:library-applied',()=>{if(dialog.open && sectionRoot && ['favorites','playlists','history'].includes(tab) && !dirty && !busy)void run(()=>navigate(tab));});
  function play(song,options){dialog.close();onPlay(song,options);}
  function saveFile(name,content,type){const url=URL.createObjectURL(new Blob([content],{type})),a=el('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function exportSongs(songs,kind,name='CPlayer'){saveFile(`${name.replace(/[\\/:*?"<>|]/g,'_').slice(0,80)}.${kind}`,kind==='csv'?exportCSV(songs):exportM3U(songs),kind==='csv'?'text/csv;charset=utf-8':'audio/x-mpegurl');}
  function songRows(songs,{edit=null,history=null}={}) {
    const list=el('div','pl-tracks');
    songs.forEach((song,index)=>{
      const row=el('article','pl-track'),copy=el('div','pl-track-copy'),name=button(song.name||song.id,()=>play(song),'pl-track-name');name.setAttribute('aria-label',`播放 ${song.name||song.id}`);
      const annotation=store.annotation(song);copy.append(name,el('p','pl-muted',`${song.artist||'未知歌手'}${song.album?' · '+song.album:''}`));
      if(annotation.rating || annotation.tags.length)copy.append(el('small','pl-tags',`${'★'.repeat(annotation.rating)} ${annotation.tags.join(' · ')}`));
      if(history)copy.append(el('small','pl-muted',new Date(history[index].at).toLocaleString()));
      const actions=el('div','pl-track-actions');
      if(edit){const up=button('↑',()=>edit(index,-1)),down=button('↓',()=>edit(index,1));up.setAttribute('aria-label',`上移 ${song.name}`);down.setAttribute('aria-label',`下移 ${song.name}`);up.disabled=index===0;down.disabled=index===songs.length-1;actions.append(up,down,button('移除',()=>edit(index,0)));}
      else {const heart=button(store.favorites().some(s=>songKey(s)===songKey(song))?'已喜欢':'喜欢',()=>{store.toggleSong(song);heart.textContent=store.favorites().some(s=>songKey(s)===songKey(song))?'已喜欢':'喜欢';heart.setAttribute('aria-pressed',String(store.favorites().some(s=>songKey(s)===songKey(song))));});heart.setAttribute('aria-pressed',String(store.favorites().some(s=>songKey(s)===songKey(song))));actions.append(heart,button('更多',()=>showSong(song)));}
      row.append(art(song.cover,song.name),copy,actions);list.append(row);
    });return list;
  }
  function renderFavorites(){
    const all=store.favorites(),filters=el('div','pl-filters');
    for(const [type,name] of [['song','歌曲'],['album','专辑'],['artist','歌手'],['playlist','歌单']]) {const count=type==='song'?all.length:store.entities(type).length;const b=button(`${name} ${count}`,()=>{favoriteType=type;resetBody();renderFavorites();},'pl-filter');b.setAttribute('aria-pressed',String(favoriteType===type));filters.append(b);}
    showHeader('每一次心动，都在这里','四类收藏独立保存。红心歌曲会自动进入「我喜欢」。');body.append(filters);
    if(favoriteType==='song') {if(!all.length)return empty('还没有喜欢的歌曲','点击歌曲旁的红心，或从当前播放队列添加。');body.append(songRows(all));}
    else {const values=store.entities(favoriteType);if(!values.length)return empty('收藏属于你的声音','在歌曲资料或专辑、歌手、歌单详情中点击收藏。');const grid=el('div','pl-grid');for(const item of values){const card=el('article','pl-card');card.append(art(item.cover,item.name),el('h4','',item.name),el('p','pl-muted',item.artist||({album:'专辑',artist:'歌手',playlist:'歌单'})[item.type]),button('查看作品',()=>{dialog.close();if(/^\d+$/.test(item.id) && item.provider==='netease')onCollection(item.type,item.id);else onSearch(item.name+' '+item.artist);}),button('取消收藏',()=>{store.removeEntity(item.key);resetBody();renderFavorites();}));grid.append(card);}body.append(grid);}
  }
  function showSong(song){
    resetBody();body.append(button('← 返回',()=>navigate(tab)));showHeader(song.name||song.id,`${song.artist||'未知歌手'} · ${song.album||'专辑未提供'}`);
    const actions=el('div','pl-actions');actions.append(button('播放',()=>play(song),'pl-button is-primary'),button('加入队列',()=>{onQueue(song);message('已加入播放队列');}),button('红心收藏 / 取消',()=>message(store.toggleSong(song)?'已加入我喜欢':'已取消喜欢')));
    const provider=['gd','netease','chksz',undefined].includes(song.provider)?'netease':song.provider;
    if(song.album)actions.append(button('收藏专辑',()=>message(store.toggleEntity({type:'album',provider,name:song.album,id:song.albumEntity?.id,artist:song.artist,cover:song.cover})?'专辑已收藏':'已取消专辑收藏')));
    const artists=song.artistEntities?.length?song.artistEntities:[{name:song.artist}];
    for(const artist of artists.filter(a=>a.name))actions.append(button(`收藏歌手 · ${artist.name}`,()=>message(store.toggleEntity({type:'artist',provider,...artist})?'歌手已收藏':'已取消歌手收藏')));
    body.append(actions);
    const lists=store.lists().filter(p=>!p.sharedId), select=el('select');select.append(new Option('选择自建歌单',''));lists.forEach(p=>select.append(new Option(p.name,p.id)));
    body.append(label('添加到歌单',select),button('添加歌曲',()=>{const p=lists.find(p=>p.id===select.value);if(!p)throw new Error('先选择歌单');store.updateList(p.id,{songs:[...p.songs,song]});message('已添加，重复歌曲自动合并');}),button('新建歌单并添加',()=>editPlaylist({name:'我的歌单',songs:[song]})));
    const annotation=store.annotation(song),tags=input(annotation.tags.join(', '),'text',360),rating=el('select'),note=area(annotation.note,2000);for(let i=0;i<=5;i++)rating.append(new Option(i?'★'.repeat(i):'未评分',String(i)));rating.value=String(annotation.rating);
    const form=el('form','pl-form');form.append(label('标签（逗号分隔，最多 12 个）',tags),label('我的评分',rating),label('听歌笔记',note));const submit=el('button','pl-button is-primary','保存标签与笔记');submit.type='submit';form.append(submit);form.addEventListener('input',()=>dirty=true);form.addEventListener('submit',e=>{e.preventDefault();void run(()=>{store.annotate(song,{tags:tags.value.split(/[,，]/).map(v=>v.trim()).filter(Boolean),rating:Number(rating.value),note:note.value});dirty=false;message('标签、评分与笔记已保存');},submit);});body.append(form);
  }
  async function renderPlaylists(){
    const version=viewVersion;
    showHeader('你的歌单','自建歌单默认私密；开启云端协作后可以管理成员或公开分享。',[button('新建歌单',()=>editPlaylist({name:'',songs:[]}),'pl-button is-primary'),button('保存当前队列',()=>editPlaylist({name:'我的播放队列',songs:getQueue().filter(s=>s?.id)}))]);
    const quick=el('div','pl-smart-lists');quick.append(button(`我喜欢 · ${store.favorites().length} 首`,()=>viewPlaylist({name:'我喜欢',songs:store.favorites()},false),'pl-smart-heart'),button(`最近播放 · ${store.history().length} 次`,()=>navigate('history'),'pl-smart-recent'));body.append(quick);
    const grid=el('div','pl-grid');body.append(grid);
    function card(list,shared=false){const node=el('article','pl-card');node.append(art(list.cover||list.songs[0]?.cover,list.name),el('h4','',list.name),el('p','pl-muted',`${list.songs.length} 首 · ${shared?(list.visibility==='public'?'公开':'私密')+' · '+({owner:'我创建的',editor:'可编辑',viewer:'只读'})[list.role]:'仅自己'}`));node.append(button('打开歌单',()=>viewPlaylist(list,shared)));if(!shared) {const tools=el('div','pl-actions');tools.append(button('上移',()=>{store.moveList(list.id,-1);return navigate('playlists');}),button('下移',()=>{store.moveList(list.id,1);return navigate('playlists');}));node.append(tools);}grid.append(node);}
    const local=store.lists();local.filter(p=>!p.sharedId).forEach(p=>card(p));
    if(!account.isSignedIn()){if(!local.length)empty('给一段时光起个名字','新建歌单，把喜欢的歌按自己的顺序放好。');body.append(button('登录以使用协作歌单',()=>{dialog.close();account.signIn();}));return;}
    const loading=el('p','pl-muted','正在同步协作歌单…');body.append(loading);
    try {const data=await request('/api/library/playlists');if(version!==viewVersion)return;loading.remove();data.lists.forEach(p=>card(p,true));
      const ids=new Set(data.lists.map(p=>p.id));for(const p of local.filter(p=>p.sharedId && !ids.has(p.sharedId)))card({...p,name:p.name+'（本地副本）'});
      if(data.invitations.length){const section=el('section','pl-invitations');section.append(el('h4','','协作邀请'));for(const invite of data.invitations){const row=el('div','pl-row');row.append(el('span','',`${invite.from} 邀请你加入「${invite.name}」`),button('接受',async()=>{await request(`/api/library/playlists/${invite.id}/invitation`,{method:'POST',body:{accept:true}});await navigate('playlists');}),button('拒绝',async()=>{await request(`/api/library/playlists/${invite.id}/invitation`,{method:'POST',body:{accept:false}});await navigate('playlists');}));section.append(row);}body.append(section);}
    }catch(error){if(version!==viewVersion)return;loading.textContent='协作歌单暂不可用；本地歌单仍可使用。';message(error.message,true);}
  }
  function viewPlaylist(list,shared){
    resetBody();body.append(button('← 所有歌单',()=>navigate('playlists')));
    showHeader(list.name,list.description||`${list.songs.length} 首歌曲`,[button('播放全部',()=>{dialog.close();if(list.songs.length){onQueue(list.songs,true);onPlay(list.songs[0]);}},'pl-button is-primary')]);
    const actions=el('div','pl-actions');actions.append(button('导出 CSV',()=>exportSongs(list.songs,'csv',list.name)),button('导出 M3U',()=>exportSongs(list.songs,'m3u',list.name)),button('保存为离线歌单',()=>downloadList(list)));
    if(list.id && (!shared || list.role!=='viewer'))actions.append(button('编辑歌单',()=>editPlaylist(list,shared)));
    if(list.id && !shared && !list.sharedId)actions.append(button('开启云端协作',async()=>{if(!account.isSignedIn())throw new Error('请先登录后开启协作');const result=await request('/api/library/playlists',{method:'POST',body:list});store.updateList(list.id,{sharedId:result.id});message('已创建私密协作歌单');await navigate('playlists');}));
    if(shared && list.role==='owner') {actions.append(button('管理协作者',()=>showMembers(list)),button(list.visibility==='public'?'设为私密':'公开分享',async()=>{if(list.visibility!=='public' && !confirm('公开后，任何获得链接的人都能查看歌单和曲目。确定公开吗？'))return;await request(`/api/library/playlists/${list.id}`,{method:'PUT',body:{...list,visibility:list.visibility==='public'?'private':'public'}});viewPlaylist(await request(`/api/library/playlists/${list.id}`),true);}));}
    if(shared && list.visibility==='public')actions.append(button('复制分享链接',async()=>{const url=new URL(location.origin);url.searchParams.set('sharedPlaylist',list.id);try{await navigator.clipboard.writeText(url.href);message('已复制公开歌单链接');}catch{message(url.href);}}));
    if(list.id && (!shared || list.role==='owner'))actions.append(button('删除歌单',async()=>{if(!confirm(`删除「${list.name}」？收藏的歌曲会保留。`))return;if(shared){await request(`/api/library/playlists/${list.id}`,{method:'DELETE',body:{revision:list.revision}});for(const p of store.lists())if(p.sharedId===list.id)store.removeList(p.id);}else store.removeList(list.id);await navigate('playlists');},'pl-button is-danger'));
    body.append(actions,songRows(list.songs));if(!list.songs.length)empty('歌单还是空的','编辑歌单可以加入播放队列，也可在歌曲的更多操作中添加。');
  }
  function editPlaylist(list,shared=false){
    resetBody();body.append(button('← 返回歌单',()=>navigate('playlists')));showHeader(list.id?'编辑歌单':'新建歌单','排序支持上下移动，也可按名称或歌手整理。封面使用 HTTPS 图片地址。');
    let songs=[...list.songs];const form=el('form','pl-form'),name=input(list.name,'text',80),description=area(list.description||''),cover=input(list.cover||'','url',1500);name.required=true;name.placeholder='为歌单起个名字';cover.placeholder='https://…';
    const preview=art(list.cover,list.name);preview.classList.add('pl-edit-cover');cover.addEventListener('change',()=>{const next=art(imageURL(cover.value),name.value);preview.replaceChildren(...next.childNodes);});
    form.append(preview,label('歌单名称',name),label('描述',description),label('封面图片地址（可留空）',cover));
    const tools=el('div','pl-actions'),tracks=el('div');const paint=()=>tracks.replaceChildren(songRows(songs,{edit(index,direction){if(direction===0)songs.splice(index,1);else [songs[index],songs[index+direction]]=[songs[index+direction],songs[index]];dirty=true;paint();}}));
    tools.append(button('加入当前队列',()=>{songs=[...new Map([...songs,...getQueue().filter(s=>s?.id)].map(s=>[songKey(s),s])).values()];dirty=true;paint();}),button('按歌曲名排序',()=>{songs.sort((a,b)=>(a.name||'').localeCompare(b.name||''));dirty=true;paint();}),button('按歌手排序',()=>{songs.sort((a,b)=>(a.artist||'').localeCompare(b.artist||''));dirty=true;paint();}));
    const submit=el('button','pl-button is-primary','保存歌单');submit.type='submit';form.append(tools,tracks,submit);paint();form.addEventListener('input',()=>dirty=true);
    form.addEventListener('submit',e=>{e.preventDefault();void run(async()=>{if(cover.value && !imageURL(cover.value))throw new Error('封面需为不含登录令牌的 HTTPS 图片地址');const next={...list,name:name.value,description:description.value,cover:cover.value,songs};if(shared){const result=await request(`/api/library/playlists/${list.id}`,{method:'PUT',body:{...next,visibility:undefined}});dirty=false;viewPlaylist({...next,revision:result.revision},true);}else {if(list.id && JSON.stringify(store.lists().find(p=>p.id===list.id))!==JSON.stringify(list))throw new Error('歌单已被其他设备更新。请复制未保存的描述后重新打开歌单再编辑。');const id=list.id?store.updateList(list.id,next):store.create(name.value,songs);if(!list.id)store.updateList(id,next);dirty=false;viewPlaylist(store.lists().find(p=>p.id===id),false);}message('歌单已保存');},submit);});body.append(form);
  }
  async function showMembers(list){
    resetBody();const version=viewVersion;body.append(button('← 返回歌单',()=>viewPlaylist(list,true)));showHeader('一起编写这张歌单','邀请已有用户名。对方接受后才获得权限；不会发送邮件或短信。');
    const username=input('','text',24),role=el('select');role.append(new Option('可编辑歌曲、顺序与资料','editor'),new Option('只读','viewer'));
    body.append(label('协作者用户名',username),label('权限',role),button('发送站内邀请',async()=>{await request(`/api/library/playlists/${list.id}/members`,{method:'POST',body:{username:username.value,role:role.value}});await showMembers(list);message('邀请已保存，对方可在个人库接受');}));
    const data=await request(`/api/library/playlists/${list.id}/members`);if(version!==viewVersion)return;
    for(const member of data.members){const row=el('div','pl-row');row.append(el('span','',`${member.username} · ${member.role==='editor'?'可编辑':'只读'} · ${member.status==='pending'?'待接受':'已加入'}`),button('移除',async()=>{await request(`/api/library/playlists/${list.id}/members`,{method:'DELETE',body:{username:member.username}});await showMembers(list);}));body.append(row);}
  }
  function renderHistory(){const history=store.history();showHeader('最近播放','只记录真正播放的歌曲。清空列表不会删除累计统计。',[button('清空最近播放',()=>{if(confirm('清空最近播放列表？')){store.clearHistory();resetBody();renderHistory();}})]);if(!history.length)return empty('你的音乐足迹从这里开始','听歌后会保存最近播放、断点和真实收听时长。');body.append(songRows(history.map(h=>h.song),{history}));}
  function renderStats(){
    tracker.flush();const years=new Set([String(new Date().getUTCFullYear()),...Object.keys(store.records()).filter(k=>k.startsWith('listen:')).map(k=>k.slice(7,11))]);
    showHeader('这一年，音乐陪你走过','按 UTC 日期累计实际播放时间；暂停、缓冲和拖动进度不会增加时长。历史统计从启用个人库后开始。');
    const year=el('select');[...years].sort().reverse().forEach(y=>year.append(new Option(`${y} 年`,y)));body.append(label('报告年份',year));const report=el('div');body.append(report);
    function paint(){const stats=store.stats(year.value);report.replaceChildren();const grid=el('div','pl-stat-grid');for(const [value,label] of [[`${Math.round(stats.seconds/60)}`,'听歌分钟'],[stats.plays,'播放次数'],[stats.activeDays,'有音乐的日子']]){const card=el('div','pl-stat');card.append(el('strong','',String(value)),el('span','',label));grid.append(card);}report.append(grid,el('h4','','每月听歌时长'));const bars=el('div','pl-bars'),max=Math.max(60,...stats.months);stats.months.forEach((seconds,i)=>{const item=el('div','pl-month'),bar=el('span','pl-bar');bar.style.height=`${Math.max(2,seconds/max*120)}px`;item.append(el('small','',`${Math.round(seconds/60)}m`),bar,el('span','',`${i+1}月`));bars.append(item);});report.append(bars,el('h4','','最常听的歌手'));if(!stats.artists.length)report.append(el('p','pl-muted','还没有统计，播放音乐后这里会慢慢丰富。'));stats.artists.forEach(([name,seconds],i)=>{const row=el('div','pl-row');row.append(el('strong','',`${String(i+1).padStart(2,'0')}  ${name}`),el('span','pl-muted',`${Math.round(seconds/60)} 分钟`));report.append(row);});}
    year.addEventListener('change',paint);paint();body.append(button('导出年度报告',()=>saveFile(`CPlayer-${year.value}-report.json`,JSON.stringify({year:year.value,...store.stats(year.value)},null,2),'application/json')),button('清空全部听歌统计',()=>{if(confirm('清空当前资料中的全部听歌统计？')){store.clearStats();paint();}}));
  }
  async function downloadList(list){
    downloadController?.abort();downloadController=new AbortController();const signal=downloadController.signal;
    const cancel=button('取消离线保存',()=>downloadController.abort());cancel.addEventListener('click',()=>downloadController.abort());body.prepend(cancel);
    let saved=0,failed=0;for(const song of list.songs){if(signal.aborted)break;message(`正在保存 ${saved+failed+1}/${list.songs.length} · ${song.name}`);try{await offline.download(song,resolveDownload,{signal});saved++;}catch(error){if(signal.aborted)break;failed++;message(`${song.name}：${error.message}`,true);}}
    cancel.remove();message(`${signal.aborted?'已取消。':''}离线保存完成 ${saved} 首，${failed} 首未提供下载或保存失败。可在离线页查看。`);
  }
  async function resolveDownload(song,signal){if(song.downloadAllowed===false || (song.provider && song.provider!=='chksz'))throw new Error('此音源不提供下载，可导入已有音频');return musicService.getSongAtLevel(song.id,'standard',{song,signal,source:'chksz'});}
  async function renderOffline(){
    const version=viewVersion;showHeader('让音乐留在身边','音频仅保存在当前设备、当前账号空间。浏览器清理数据会移除缓存；云同步与导出只包含曲目资料。');
    const limits=input(String(offline.limit()/1024/1024),'number');limits.min=64;limits.max=2048;body.append(label('离线容量上限（MB）',limits),button('设置容量',()=>{offline.setLimit(Number(limits.value));message('容量上限已更新');}));
    const files=input('','file');files.accept='audio/*,.flac,.opus';files.multiple=true;
    files.addEventListener('change',()=>run(async()=>{const songs=[];for(const file of files.files){songs.push(await offline.importFile(file));}if(songs.length)store.create('导入的本地音频',songs);await navigate('offline');message(`已导入 ${songs.length} 首本地音频，并创建歌单`);}));
    body.append(label('导入本地音频',files),button('申请保留离线存储',async()=>{const granted=await navigator.storage?.persist?.();message(granted?'浏览器已允许持久存储':'浏览器未授予持久存储，请保留原音频文件');}));
    const entries=await offline.list();if(version!==viewVersion)return;const bytes=entries.reduce((n,e)=>n+e.bytes,0);body.append(el('p','pl-capacity',`${entries.length} 首 · ${(bytes/1024/1024).toFixed(1)} MB / ${offline.limit()/1024/1024} MB`));
    try{const estimate=await navigator.storage?.estimate?.();if(version!==viewVersion)return;if(estimate)body.append(el('p','pl-muted',`浏览器估算站点空间 ${(estimate.usage/1024/1024).toFixed(1)} MB / ${(estimate.quota/1024/1024).toFixed(0)} MB`));}catch{}
    if(!entries.length)empty('离线库还是空的','从歌单选择“保存为离线歌单”，或导入你已有的音频。只保存当前音源明确提供的下载。');
    for(const entry of entries){const row=el('div','pl-row');row.append(el('span','',`${entry.song.name} · ${(entry.bytes/1024/1024).toFixed(1)} MB`),button('离线播放',()=>play(entry.song)),button('移除缓存',async()=>{await offline.remove(entry.song);await navigate('offline');}));body.append(row);}
    if(entries.length)body.append(button('清理当前账号全部离线音频',async()=>{if(!confirm('删除此设备中当前账号的离线音频？云端收藏和歌单将保留。'))return;await offline.clear();await navigate('offline');},'pl-button is-danger'));
  }
  function renderTransfer(){
    showHeader('把你的音乐带过来','解析网易云 / QQ 公开歌单，或使用 JSON、CSV、M3U 文件。导入前先预览，已有资料不会被替换。');
    const link=input('','text',1800);link.placeholder='网易云 / QQ 歌单完整链接';const preview=el('div','pl-import-preview');let pending=null,version=viewVersion;
    const confirm=button('确认导入',async()=>{if(!pending)return;if(pending.records){const combined=mergeImport(account.library.capture(),pending.records);account.library.apply(combined);account.changed();}else store.create(pending.name||'导入的歌单',pending.songs);message('已导入个人库');pending=null;confirm.disabled=true;});confirm.disabled=true;
    function display(value){pending=value;preview.replaceChildren(el('h4','',value.records?`备份资料 · ${Object.keys(value.records).length} 项`:`${value.name||'歌单'} · ${value.songs.length} 首`),el('p','pl-muted',value.partial?'上游只返回了部分歌曲，将仅导入预览中的曲目。':'确认后保存到当前个人库。'));if(value.songs)preview.append(songRows(value.songs.slice(0,5)));confirm.disabled=false;}
    body.append(label('歌单分享链接',link),button('解析并预览',async()=>{pending=null;confirm.disabled=true;message('正在解析公开歌单…');const data=await request('/api/v1/library/import?'+new URLSearchParams({url:link.value}));if(version!==viewVersion)return;if(!data.tracks?.length)throw new Error('这个公开歌单没有返回可导入的歌曲');display({songs:data.tracks,name:data.collection.name,partial:data.partial});message(`解析到 ${data.tracks.length} 首${data.partial?'，上游未返回全部曲目':''}`);}));
    const file=input('','file');file.accept='.json,.csv,.m3u,.m3u8';file.addEventListener('change',()=>run(async()=>{pending=null;confirm.disabled=true;const selected=file.files[0];if(!selected)return;if(selected.size>1990000)throw new Error('文件不能超过 2 MB');const data=parseTransfer(await selected.text(),selected.name);if(version!==viewVersion)return;display({...data,name:selected.name.replace(/\.[^.]+$/,'')});}));body.append(label('选择歌单或迁移备份文件',file),preview,confirm);
    const exports=el('section','pl-export');exports.append(el('h4','','导出与跨设备迁移'),el('p','pl-muted','JSON 包含四类收藏、歌单、标签笔记、历史与统计。M3U 保存曲目资料和原平台链接，可重新导入 CPlayer；它不包含音频文件。'),button('导出完整个人库 JSON',async()=>{tracker.flush();const records=account.library.capture();if(account.isSignedIn()){const data=await request('/api/library/playlists');for(const list of data.lists)records['playlist:shared-'+list.id]={...list,sharedId:undefined};}saveFile('CPlayer-library.json',JSON.stringify({format:'cplayer-library-v2',exportedAt:new Date().toISOString(),records:cleanRecords(records)},null,2),'application/json');}),button('导出红心歌曲 CSV',()=>exportSongs(store.favorites(),'csv','我喜欢')),button('导出红心歌曲 M3U',()=>exportSongs(store.favorites(),'m3u','我喜欢')));body.append(exports);
  }
  async function open({song=null,section='favorites',trigger=document.activeElement}={}){if(!account.canEnter())return;opener=trigger;if(!dialog.open)dialog.showModal();await navigate(section);if(song)showSong(song);}
  document.querySelectorAll('[data-open-personal-library]').forEach(b=>b.addEventListener('click',()=>run(()=>open({trigger:b,section:b.dataset.openPersonalLibrary||'favorites'}))));
  const shared=new URL(location.href).searchParams.get('sharedPlaylist');
  if(shared && /^[\w-]{1,80}$/.test(shared)){const load=()=>run(async()=>{await open({section:'playlists'});const value=await request(`/api/library/public/${shared}`);viewPlaylist({...value,id:undefined},false);const importButton=button('保存到我的歌单',()=>{store.create(value.name,value.songs);message('已保存为你的私密歌单');});body.prepend(importButton);});const entry=document.getElementById('accountEntryDialog');if(entry?.open)entry.addEventListener('close',load,{once:true});else void load();}
  return {open,store,offline,collect(item){const added=store.toggleEntity(item);notify(added?'已加入个人库':'已取消收藏');},song: song=>open({song}),tracker};
}
