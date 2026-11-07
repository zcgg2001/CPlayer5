import { relatedMusic, availability, groupAvailability, sourceBlocked, AVAILABILITY_LABELS, CATALOG_SOURCES } from './music-catalog.js?v=1';
import { createCatalogService, mapConcurrent } from './catalog-service.js?v=1';
import { MUSIC_SOURCE_OPTIONS } from './music-service.js?v=10';

export function createCatalogBrowser({document, musicService, onPlay, onQueue}) {
  const service = createCatalogService(musicService);
  const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className=className; if (text != null) node.textContent=text; return node; };
  const button = (text, action, className='catalog-button') => { const node=el('button',className,text); node.type='button'; node.addEventListener('click',action); return node; };
  const label = source => source==='netease-metadata'?'网易云公开资料':MUSIC_SOURCE_OPTIONS[source]?.label || source;
  const badge = song => { const state=groupAvailability(song); const node=el('span',`catalog-badge is-${state.status}`,AVAILABILITY_LABELS[state.status]); node.title='状态以当前渠道最近一次检查为准'; return node; };
  const image = (url, alt, className) => {
    const node=el('img',className); node.alt=alt; node.loading='lazy'; node.referrerPolicy='no-referrer';
    try { const parsed=new URL(url,document.baseURI); node.src=['https:','http:'].includes(parsed.protocol)?parsed.href:'./img/icon.svg'; } catch { node.src='./img/icon.svg'; }
    node.addEventListener('error',()=>{ if (!node.src.endsWith('/img/icon.svg')) node.src='./img/icon.svg'; }); return node;
  };
  const dialog=el('dialog','catalog-dialog'); dialog.setAttribute('aria-labelledby','catalogTitle');
  const header=el('header','catalog-header'), heading=el('div'); heading.append(el('p','catalog-eyebrow','MUSIC LIBRARY'));
  const title=el('h2','','跨源曲库'); title.id='catalogTitle'; heading.append(title);
  const close=button('关闭',()=>dialog.close()); header.append(heading,close);
  const body=el('div','catalog-body'), searchView=el('section','catalog-search'), detailView=el('section','catalog-detail');
  detailView.hidden=true; body.append(searchView,detailView); dialog.append(header,body); document.body.append(dialog);
  // Native modal handles focus trapping; stop the legacy player's keyboard shortcuts.
  dialog.addEventListener('keydown',event=>event.stopPropagation());
  let opener=null, searchController=null, checkController=null, detailController=null, songs=[], rawSongs=[], selected=null, offset=0, query='';
  dialog.addEventListener('close',()=>{ searchController?.abort(); checkController?.abort(); detailController?.abort(); opener?.focus(); });
  const intro=el('p','catalog-muted','同一录音合并音源，Live、Remix、伴奏和纯音乐分别保留。');
  const form=el('form','catalog-search-form'); const input=el('input'); input.type='search'; input.placeholder='搜索歌曲、歌手或专辑'; input.setAttribute('aria-label','跨源搜索关键词'); input.required=true; input.maxLength=80;
  const submit=el('button','catalog-button catalog-primary','搜索并聚合'); submit.type='submit';
  const cancel=button('停止搜索',()=>searchController?.abort()); cancel.hidden=true; form.append(input,submit,cancel);
  const sourceOptions=el('details','catalog-source-options'); sourceOptions.append(el('summary','','选择参与搜索的音源'));
  const sourceFields=el('fieldset','catalog-source-fields'); sourceFields.append(el('legend','sr-only','参与聚合的音源'));
  for (const source of CATALOG_SOURCES) { const wrap=el('label'), checkbox=el('input'); checkbox.type='checkbox'; checkbox.value=source; checkbox.checked=true; wrap.append(checkbox,document.createTextNode(label(source))); sourceFields.append(wrap); }
  sourceOptions.append(sourceFields,el('p','catalog-muted','每个音源每页最多 10 条。聚合搜索不调用 ChKSz。'));
  const status=el('p','catalog-status','输入关键词开始搜索。'); status.setAttribute('role','status'); status.setAttribute('aria-live','polite');
  const tools=el('div','catalog-tools'), filter=el('select'); filter.setAttribute('aria-label','筛选可用性');
  for (const [value,text] of [['all','全部状态'],['playable','已验证可播'],['unknown','待验证'],['restricted','受限制 / 暂不可用']]) { const opt=el('option','',text); opt.value=value; filter.append(opt); }
  const check=button('检查前 10 首',()=>checkVisible()), list=el('div','catalog-results'); list.setAttribute('aria-label','聚合搜索结果');
  const more=button('加载更多',()=>runSearch(true)); more.hidden=true;
  tools.append(filter,check); check.disabled=true; searchView.append(intro,form,sourceOptions,status,tools,list,more);
  filter.addEventListener('change',renderResults);
  form.addEventListener('submit',event=>{ event.preventDefault(); runSearch(false); });

  function renderResults() {
    const focused=document.activeElement?.dataset.catalogAction;
    list.replaceChildren();
    const visible=songs.filter(song=>filter.value==='all' || (filter.value==='restricted'?['login_required','no_copyright','region_restricted','unavailable'].includes(groupAvailability(song).status):filter.value==='unknown'?['unknown','resolved','checking'].includes(groupAvailability(song).status):groupAvailability(song).status===filter.value));
    for (const song of visible) {
      const row=el('article','catalog-result'); row.append(image(song.cover || './img/icon.svg','', 'catalog-cover'));
      const copy=el('div','catalog-result-copy'), details=button(song.name,()=>showDetails(song),'catalog-track-title'); details.dataset.catalogAction=`details:${song.catalogId}`;
      const subtitle=el('p','catalog-muted',`${song.artist || '未知歌手'} · ${song.album || '专辑未提供'}`);
      const meta=el('div','catalog-tags'); meta.append(el('span','catalog-badge',song.version.label),el('span','catalog-badge',`${song.sources.length} 个音源`),badge(song)); copy.append(details,subtitle,meta);
      const play=button('播放',()=>playRecord(song)); play.disabled=song.sources.every(sourceBlocked); play.setAttribute('aria-label',`播放 ${song.name}`); play.dataset.catalogAction=`play:${song.catalogId}`;
      row.append(copy,play); list.append(row);
    }
    if (!visible.length && songs.length) list.append(el('p','catalog-muted','没有符合当前状态的结果。可切回全部状态并检查音源。'));
    check.disabled=!songs.length || Boolean(checkController);
    if (focused) [...list.querySelectorAll('[data-catalog-action]')].find(node=>node.dataset.catalogAction===focused)?.focus({preventScroll:true});
  }
  function playRecord(song,source=null) {
    const chosen=source?{...song,...source,sources:[source],catalogId:song.catalogId}:song;
    dialog.close(); onPlay(chosen);
  }
  function updateProgress(snapshot) {
    songs=service.hydrate([...rawSongs,...snapshot.songs]);
    status.textContent=`${snapshot.completed} / ${snapshot.total} 个音源完成 · ${songs.length} 首录音 · ${songs.reduce((sum,song)=>sum+song.sources.length,0)} 个音源结果${snapshot.failures.length?` · 未返回：${snapshot.failures.map(label).join('、')}`:''}`;
    renderResults();
  }
  async function runSearch(append) {
    const value=input.value.trim(); if (!value) { input.focus(); return; }
    const sources=[...sourceFields.querySelectorAll('input:checked')].map(node=>node.value);
    if (!sources.length) { status.textContent='请至少选择一个音源。'; return; }
    searchController?.abort(); checkController?.abort(); detailController?.abort(); checkController=null;
    const controller=new AbortController(); searchController=controller;
    if (!append || value!==query) { songs=[]; rawSongs=[]; offset=0; }
    else { rawSongs=songs; offset+=10; }
    query=value; renderResults(); status.textContent='正在搜索各音源，可随时停止并保留已返回的结果…';
    cancel.hidden=false; more.hidden=true; submit.disabled=true; sourceFields.disabled=true; list.setAttribute('aria-busy','true');
    try {
      const snapshot=await service.search(query,{signal:controller.signal,sources,offset,onProgress:updateProgress});
      if (!songs.length) status.textContent += ' · 暂无结果，请换关键词或稍后重试。';
      more.hidden=snapshot.rawCount===0 || offset>=90;
      if(offset>=90)status.textContent+=' · 已达到本次搜索上限，请缩小关键词范围';
    } catch(error) { if (searchController===controller) status.textContent += controller.signal.aborted?' · 搜索已停止':' · 搜索暂时失败，请重试'; }
    finally {
      if (searchController===controller) { cancel.hidden=true; submit.disabled=false; sourceFields.disabled=false; list.setAttribute('aria-busy','false'); searchController=null; }
    }
    // Small, bounded preflight before playback; other results remain honestly marked unverified.
    if (!controller.signal.aborted && dialog.open) checkVisible(3);
  }
  async function checkVisible(limit=10) {
    checkController?.abort(); const controller=new AbortController(); checkController=controller; check.disabled=true;
    const targets=songs.slice(0,limit);
    try {
      await mapConcurrent(targets,2,async song=>{
        const source=song.sources.find(item=>!sourceBlocked(item)); if (!source) return;
        const pending=service.check(source,{signal:controller.signal}); renderResults();
        await pending; if (!controller.signal.aborted) { renderResults(); if(selected?.catalogId===song.catalogId && !detailView.hidden) renderSourceStates(); }
      },controller.signal);
    } catch { /* Closing or a new search cancels pending checks. */ }
    finally { if(checkController===controller){checkController=null;check.disabled=!songs.length;} }
  }
  let sourceRows=[];
  function renderSourceStates() {
    const summary=detailView.querySelector('[data-catalog-summary]');
    if(summary && selected)summary.replaceChildren(badge(selected));
    for (const {source,state,checkButton,playButton} of sourceRows) {
      const current=availability(source); state.textContent=AVAILABILITY_LABELS[current.status]+(current.bitrate?` · ${current.bitrate} kbps`:'')+(current.format?` · ${current.format.toUpperCase()}`:''); state.className=`catalog-badge is-${current.status}`;
      state.title=[current.reason,current.checkedAt?`检查时间：${new Date(current.checkedAt).toLocaleTimeString()}`:'尚未检查',current.bitrate?`实际返回 ${current.bitrate} kbps`:'',current.level?`音质：${current.level}`:''].filter(Boolean).join(' · ');
      checkButton.disabled=current.status==='checking'; playButton.disabled=sourceBlocked(source);
    }
  }
  function showDetails(raw, {enrich = true} = {}) {
    detailController?.abort(); detailController=new AbortController();
    selected=raw.catalogId?raw:service.hydrate([raw])[0]; if(!selected)return;
    const song=selected; searchView.hidden=true; detailView.hidden=false; detailView.replaceChildren(); title.textContent='歌曲资料';
    const back=button('← 返回曲库',()=>{detailController?.abort();selected=null;detailView.hidden=true;searchView.hidden=false;title.textContent='跨源曲库';input.focus();renderResults();});
    const hero=el('div','catalog-hero'), art=el('div'), variants=song.albumEntity.artwork;
    art.append(image(variants.at(-1)?.url || song.cover || './img/icon.svg',`${song.album || song.name}封面`,'catalog-hero-cover'));
    const sizes=el('div','catalog-art-sizes');
    for (const variant of variants) { const link=el('a','',variant.label); const parsed=new URL(variant.url,document.baseURI); if(!['http:','https:'].includes(parsed.protocol))continue; link.href=parsed.href; link.target='_blank'; link.rel='noopener noreferrer'; sizes.append(link); }
    art.append(sizes);
    const copy=el('div'); copy.append(el('p','catalog-eyebrow',song.version.label),el('h3','',song.name),el('p','catalog-muted',song.artist));
    const actions=el('div','catalog-tools'); const play=button('播放可用音源',()=>playRecord(song),'catalog-button catalog-primary'); play.disabled=song.sources.every(sourceBlocked);
    const summary=el('span'); summary.dataset.catalogSummary=''; summary.append(badge(song));
    actions.append(play,button('加入队列',()=>{onQueue(song);}),summary); copy.append(actions); hero.append(art,copy);
    const fields=el('dl','catalog-metadata');
    const duration=song.metadata.duration; const values={duration:duration?`${Math.floor(duration/60)}:${String(Math.round(duration%60)).padStart(2,'0')}`:'',bitrate:song.metadata.bitrate?`${song.metadata.bitrate} kbps（元数据）`:'',releaseDate:song.metadata.releaseDate,language:song.metadata.language,genres:song.metadata.genres.join(' / '),label:song.metadata.label,isrc:song.metadata.isrc};
    for (const [field,name] of Object.entries({duration:'时长',bitrate:'码率',releaseDate:'发行日期',language:'语言',genres:'风格',label:'厂牌',isrc:'ISRC'})) {
      const cell=el('div'); cell.append(el('dt','',name),el('dd','',values[field] || '未提供'));
      const evidence=song.provenance[field] || [];
      if(evidence.length) { const note=el('small','catalog-muted',evidence.map(item=>label(item.provider)).join('、')); note.title=evidence.map(item=>`${label(item.provider)}：${Array.isArray(item.value)?item.value.join(' / '):item.value}`).join('\n'); cell.append(note); }
      fields.append(cell);
    }
    const metadataStatus=el('p','catalog-muted',song.metadataSource?`补充资料来源：${song.metadataSource}`:'字段来自各音乐源；未提供的信息不作推测。');
    detailView.append(back,hero,fields,metadataStatus,el('h3','catalog-section-title','可用音源'),el('p','catalog-muted','“可播”表示最近已收到音频数据，不保证永久有效。检查不通过时保留具体状态，不推断版权。'));
    sourceRows=[];
    for (const source of song.sources) {
      const row=el('div','catalog-source-row'), sourceCopy=el('div'), state=el('span','catalog-badge'); sourceCopy.append(el('strong','',label(source.provider)),state);
      const controls=el('div','catalog-tools');
      const checkButton=button('检查',async()=>{
        const controller=detailController; const pending=service.check(source,{signal:controller.signal,force:true}); renderSourceStates();
        try { await pending; } catch { /* Dialog closed. */ }
        if(!controller.signal.aborted) {renderSourceStates();renderResults();}
      });
      const playButton=button('用此音源播放',()=>playRecord(song,source)); controls.append(checkButton,playButton); row.append(sourceCopy,controls); detailView.append(row); sourceRows.push({source,state,checkButton,playButton});
    }
    renderSourceStates();
    const about=el('div','catalog-about');
    const album=el('section'); album.append(el('h3','catalog-section-title',`专辑 · ${song.albumEntity.name || '未提供'}`),el('p','catalog-muted',song.albumEntity.description || '音源未提供专辑介绍。'));
    const description=el('section'); description.append(el('h3','catalog-section-title','歌曲简介'),el('p','catalog-muted',song.metadata.description || '音源未提供歌曲简介。')); about.append(album,description); detailView.append(about);
    detailView.append(el('h3','catalog-section-title','歌手'));
    for (const artist of song.artists) { const row=el('div','catalog-artist'); if(artist.avatar)row.append(image(artist.avatar,`${artist.name}头像`,'catalog-cover')); const copy=el('div'); copy.append(el('strong','',artist.name),el('p','catalog-muted',artist.description || '音源未提供艺人介绍。')); row.append(copy); detailView.append(row); }
    const related=relatedMusic(song,songs), recommendations=el('section'); recommendations.append(el('h3','catalog-section-title','相似歌曲 · 当前搜索结果'));
    if(!related.songs.length)recommendations.append(el('p','catalog-muted','当前结果中没有足够的歌手、专辑或风格信息来推荐。'));
    for(const entry of related.songs)recommendations.append(button(`${entry.song.name} · ${entry.reasons.join(' / ')}`,()=>showDetails(entry.song),'catalog-related'));
    recommendations.append(el('h3','catalog-section-title','相似艺人 · 依据已知风格'));
    if(!related.artists.length)recommendations.append(el('p','catalog-muted','尚无足够的风格标签，不猜测相似艺人。'));
    for(const artist of related.artists)recommendations.append(button(`${artist.name} · ${artist.reason}`,()=>{detailView.hidden=true;searchView.hidden=false;title.textContent='跨源曲库';input.value=artist.name;runSearch(false);},'catalog-related'));
    detailView.append(recommendations); body.scrollTop=0; back.focus();
    if(enrich) {
      const controller=detailController;
      service.enrich(song,{signal:controller.signal}).then(updated=>{
        if(controller.signal.aborted || selected!==song || updated===song)return;
        const index=songs.findIndex(item=>item.catalogId===song.catalogId); if(index>=0)songs[index]=updated;
        const previousScroll=body.scrollTop,active=document.activeElement;
        // Avoid replacing a focused source control while the person is choosing it.
        if(active===back || !detailView.contains(active)) {showDetails(updated,{enrich:false});body.scrollTop=previousScroll;}
        else {Object.assign(song,updated);metadataStatus.replaceChildren(button('资料已补全 · 查看',()=>showDetails(song,{enrich:false})));}
      }).catch(()=>{if(!controller.signal.aborted)metadataStatus.textContent='补充资料暂时不可用，已保留搜索结果。';});
    }
  }
  return {
    decorateRow(row,song) {
      const details=button('资料 · '+AVAILABILITY_LABELS[groupAvailability(song).status],event=>{event.stopPropagation();this.open({song,trigger:details});},'catalog-entry');
      details.setAttribute('aria-label',`歌曲资料与音源：${song.name}`); row.append(details);
    },
    open({query:initial='',song=null,trigger=document.activeElement}={}) {
      opener=trigger; if(!dialog.open)dialog.showModal();
      if(song)showDetails(song);
      else {selected=null;detailView.hidden=true;searchView.hidden=false;title.textContent='跨源曲库';if(initial)input.value=initial;input.focus();}
    },
  };
}
