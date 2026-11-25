const paths = {
  down:'m6 9 6 6 6-6', right:'m9 6 6 6-6 6', close:'m6 6 12 12M6 18 18 6',
  settings:'M9 4h6l1 3 3 1v6l-3 1-1 3H9l-1-3-3-1V8l3-1Z M15 11a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  swap:'M4 7h15m-4-4 4 4-4 4M20 17H5m4-4-4 4 4 4',
  waves:'M4 10v4m4-7v10m4-14v18m4-14v10m4-7v4',
  prev:'M6 5v14m12-13-9 6 9 6V6Z', next:'M18 5v14M6 6l9 6-9 6V6Z',
  shuffle:'m3 7 3 0c4 0 8 10 12 10h3m-3-3 3 3-3 3M3 17h3c4 0 8-10 12-10h3m-3-3 3 3-3 3',
  queue:'M4 6h12M4 11h12M4 16h8m8-3v6m0-6 3-1m-3 7c0 2-4 2-4 0s4-2 4 0',
  pause:'M8 5h2v14H8Zm6 0h2v14h-2Z', wifi:'M3 8c5-5 13-5 18 0M6 11c3-3 9-3 12 0M9 14c2-1 4-1 6 0m-3 3h.01',
  signal:'M4 19v-3m5 3v-6m5 6V9m5 10V5', battery:'M3 6h16v12H3ZM21 10v4M6 9v6m3-6v6m3-6v6m3-6v6',check:'m5 12 4 4L19 6'
};
const icon = name => `<svg aria-hidden="true" viewBox="0 0 24 24" class="${name}"><path d="${paths[name]}"/></svg>`;
const button = (label, glyph, classes = '', attrs = '') => `<button type="button" class="icon-button ${classes}" aria-label="${label}" ${attrs}>${icon(glyph)}</button>`;
const plans = [
  {id:'a',title:'歌曲信息旁 · 音源胶囊',desc:'和音质放在一起，轻点展开平台与渠道选择面板。',tag:'推荐 · 最均衡',good:'来源常驻可见，入口明确，延续现有布局。',tradeoff:'需要打开面板，再选择并确认切换。'},
  {id:'b',title:'播放控制区 · 快速换源',desc:'在进度条上方放一个换源按钮，展开常用渠道。',tag:'适合频繁切换',good:'拇指容易够到，常用渠道两次点击即可切换。',tradeoff:'控制区多一行；完整平台列表放在「更多」。'},
  {id:'c',title:'顶部标题栏 · 音源下拉',desc:'把正在播放的来源放到顶部，点击就地展开菜单。',tag:'最简洁',good:'封面和播放区完整保留，画面更安静。',tradeoff:'顶部触达较远，入口容易被当成普通标题。'}
];
const quality = `<button type="button" class="quality static-control" aria-label="示意音质：标准"><span class="dot"></span>标准${icon('down')}</button>`;
function phone(id, expanded, suffix) {
 return `<div class="phone option-${id}${expanded?' expanded':''}" data-plan="${id}" data-current="GD 音乐台" data-platform="网易云" data-selected="Meting" data-initial="${expanded}" data-instance="${suffix}">
 <div class="status-bar"><span>9:41</span><div class="status-icons">${icon('signal')}${icon('wifi')}${icon('battery')}</div></div>
 <header class="player-header">${button('收起播放器（示意）','down','static-control')}${id==='c'?`<button type="button" class="source-top" data-open aria-label="切换音乐源" aria-expanded="${expanded}">${icon('waves')}<span><span class="top-current">GD</span> · 网易云</span>${icon('down')}</button>`:'<span class="label">正在播放</span>'}${button('播放器设置（示意）','settings','static-control')}</header>
 <div class="album-stage"><img class="art side prev" src="./cover.svg" alt=""><img class="art side next" src="./cover.svg" alt=""><img class="art" src="./cover.svg" alt="原创示意专辑：落日余温"></div>
 <section class="info"><div class="album-caption"><span>晚风留声 · EP</span><span>08 / 24</span></div><h3 class="song-title">落日余温</h3><p class="song-artist">林间回声</p><div class="meta">${id==='a'?`<button type="button" class="source-chip" data-open aria-label="切换音乐源" aria-expanded="${expanded}">${icon('swap')}<span class="source-short">GD · 网易云</span>${icon('down')}</button>`:''}${quality}${id!=='a'?'<span class="meta-note">点击封面查看歌词</span>':''}</div></section>
 ${id==='b'?`<button type="button" class="bottom-source" data-open aria-label="切换音乐源" aria-expanded="${expanded}"><span>${icon('waves')}<span class="bar-current">GD 音乐台 · 网易云</span></span><span class="action">换源 ${icon('swap')}</span></button>`:''}
 <div class="seek"><span>01:24</span><div class="seek-track"><div class="seek-fill"></div></div><span>03:42</span></div><div class="controls">${button('随机播放（示意）','shuffle','subtle static-control')}${button('上一曲（示意）','prev','skip static-control')}${button('暂停（示意）','pause','play static-control')}${button('下一曲（示意）','next','skip static-control')}${button('播放队列（示意）','queue','subtle static-control')}</div><div class="home-line"></div><div class="overlay-root"></div><div class="toast" role="status" hidden></div></div>`;
}
document.querySelector('#boards').innerHTML=plans.map(p=>`<section class="board" id="option-${p.id}" data-design="${p.id}"><header class="board-head"><div class="board-name"><span class="letter">${p.id.toUpperCase()}</span><div><h2>${p.title}</h2><p class="board-desc">${p.desc}</p></div></div><span class="recommendation">${p.tag}</span></header><div class="screens"><div class="screen-wrap"><p class="screen-label"><b>01</b> 播放器中的入口</p><div class="device">${phone(p.id,false,'left')}</div></div><div class="screen-wrap"><p class="screen-label"><b>02</b> 点击之后的界面</p><div class="device">${phone(p.id,true,'right')}</div></div></div><footer class="tradeoffs"><div><strong>适合</strong>${p.good}</div><div><strong>取舍</strong>${p.tradeoff}</div></footer></section>`).join('');
const channels={网易云:['GD 音乐台','Meting','星海'], 'QQ 音乐':['VKeys','OP Music','51ape'],酷狗:['煎饼']};
const initials={'GD 音乐台':'GD',Meting:'M',星海:'星',VKeys:'VK','OP Music':'OP','51ape':'51',煎饼:'饼'};
function rows(phone, immediate=false){
 const source=phone.dataset.current, selected=immediate?source:phone.dataset.selected;
 return channels[phone.dataset.platform].map(name=>`<button type="button" class="provider${name===selected?' chosen':''}" ${immediate?'data-apply':'data-select'}="${name}" aria-pressed="${name===selected}"><span class="provider-mark">${initials[name]}</span><span class="provider-copy"><strong>${name}</strong><small>${phone.dataset.platform} · ${name===source?'正在使用':'备选渠道'}</small></span>${name===source?'<span class="state">当前</span>':name===selected?'<span class="state">待切换</span>':''}<span class="radio"></span></button>`).join('');
}
function render(phone){
 const overlay=phone.querySelector('.overlay-root'),id=phone.dataset.plan,open=phone.classList.contains('expanded');
 phone.querySelector('[data-open]').setAttribute('aria-expanded',String(open));
 if(!open){overlay.replaceChildren();return;}
 if(id==='a'||phone.classList.contains('show-all')){
  overlay.innerHTML=`<div class="scrim" data-close></div><section class="source-sheet" role="dialog" aria-label="切换这首歌的音源"><div class="handle"></div><header class="sheet-heading"><div><h3>切换这首歌的音源</h3><p>落日余温 · 林间回声</p></div>${button('关闭音源面板','close','','data-close')}</header><div class="platforms" role="group" aria-label="音乐平台">${Object.keys(channels).map(p=>`<button type="button" class="${phone.dataset.platform===p?'active':''}" data-platform="${p}" aria-pressed="${phone.dataset.platform===p}">${p}</button>`).join('')}</div><div class="providers">${rows(phone)}</div><label class="default-row"><input type="checkbox" ${phone.dataset.default==='true'?'checked':''}>后续播放也优先使用</label><button type="button" class="confirm" data-apply="${phone.dataset.selected}">${icon('swap')}切换到 ${phone.dataset.selected}</button><p class="resume-note">保留当前进度 · 01:24</p></section>`;
 }else if(id==='b'){
  const alternatives=channels[phone.dataset.platform].filter(name=>name!==phone.dataset.current).slice(0,2);
  overlay.innerHTML=`<section class="quick-panel" aria-label="快速切换音乐源"><header class="quick-heading"><span>仅切当前歌曲 · ${phone.dataset.platform}</span>${button('关闭快捷换源','close','','data-close')}</header><div class="quick-choices">${alternatives.map(name=>`<button type="button" class="quick-choice" data-apply="${name}">${name}</button>`).join('')}<button type="button" class="quick-choice" data-more>更多${icon('right')}</button></div></section>`;
 }else{
  overlay.innerHTML=`<div class="scrim popover-scrim" data-close></div><section class="source-popover" role="dialog" aria-label="快捷音乐源菜单"><header class="popover-heading"><span>仅切当前歌曲</span><span>${phone.dataset.platform}</span></header><div class="providers">${rows(phone,true)}</div><button type="button" class="more-platforms" data-more>全部平台与渠道${icon('right')}</button></section>`;
 }
}
const phones=[...document.querySelectorAll('.phone')];phones.forEach(render);
function close(phone){phone.classList.remove('expanded','show-all');render(phone);}
for(const phone of phones){
 phone.addEventListener('change',e=>{if(e.target.matches('.default-row input'))phone.dataset.default=String(e.target.checked);});
 phone.addEventListener('click',e=>{
  const action=e.target.closest('button,[data-close]');if(!action)return;
  if(action.hasAttribute('data-open')){phone.classList.toggle('expanded');render(phone);}
  else if(action.hasAttribute('data-close'))close(phone);
  else if(action.hasAttribute('data-platform')){phone.dataset.platform=action.dataset.platform;phone.dataset.selected=channels[phone.dataset.platform][0];render(phone);}
  else if(action.hasAttribute('data-select')){phone.dataset.selected=action.dataset.select;render(phone);}
  else if(action.hasAttribute('data-more')){phone.classList.add('show-all');render(phone);}
  else if(action.hasAttribute('data-apply')){
   phone.dataset.current=action.dataset.apply;phone.dataset.selected=action.dataset.apply;close(phone);
   const short=action.dataset.apply==='GD 音乐台'?'GD':action.dataset.apply;
   const chip=phone.querySelector('.source-short'),bar=phone.querySelector('.bar-current'),top=phone.querySelector('.top-current');
   if(chip)chip.textContent=`${short} · ${phone.dataset.platform}`;
   if(bar)bar.textContent=`${action.dataset.apply} · ${phone.dataset.platform}`;
   if(top)top.parentElement.innerHTML=`<span class="top-current">${short}</span> · ${phone.dataset.platform}`;
   const toast=phone.querySelector('.toast');toast.innerHTML=`<b>切换效果演示 · ${action.dataset.apply}</b>${action.classList.contains('confirm')&&phone.dataset.default==='true'?'设为后续优先音源':'仅应用于当前歌曲'} · 进度保留在 01:24`;toast.hidden=false;clearTimeout(phone.toastTimer);phone.toastTimer=setTimeout(()=>{toast.hidden=true;},2500);
  }
 });
 phone.addEventListener('keydown',e=>{if(e.key==='Escape'){close(phone);phone.querySelector('[data-open]').focus();}});
}
document.querySelector('#theme').addEventListener('click',e=>{const light=!phones[0].classList.contains('light');phones.forEach(p=>p.classList.toggle('light',light));e.target.textContent=light?'查看深色':'查看浅色';});
document.querySelector('#reset').addEventListener('click',()=>location.reload());
const params=new URLSearchParams(location.search);if(params.has('capture'))document.body.classList.add('capture');
if(['a','b','c'].includes(params.get('only')))document.querySelectorAll('.board').forEach(b=>b.hidden=b.dataset.design!==params.get('only'));
function resize(){document.documentElement.style.setProperty('--phone-scale',Math.min(1,(innerWidth-36)/402));}resize();window.addEventListener('resize',resize);
