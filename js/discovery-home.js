import { requestErrorMessage } from './http.js';
import { createDiscoveryProfile, PREFERENCE_GROUPS, SCENES, analyzeLibrary, artistNames, canRecommend, dayKey, matchesFilters, parseLibraryJson, parsePlaylistInput, recordingKey } from './recommendation-model.js';
import { createRecommendationService, createRadio } from './recommendation-service.js';
import { catalogRecord, groupAvailability, AVAILABILITY_LABELS } from './music-catalog.js';
import { durationLabel } from './discovery-table.js';

export function createDiscoveryHome({ document, root, musicService, storage, onPlay, onBatch, onDetails, getCurrentSong, getLibrary, notify = () => {} }) {
  const profileStore = createDiscoveryProfile({ storage }), { profile } = profileStore;
  const service = createRecommendationService({ musicService, profileStore, storage });
  let controller, modalController, daily = [], modalEntries = [], filters = {}, dialogOpener, lastDismissed, lastDay = dayKey(), homeLoading = true;
  const el = (tag, className, text) => { const node = document.createElement(tag); node.className = className || ''; if (text != null) node.textContent = text; return node; };
  const icon = name => { const node = el('i'); node.dataset.lucide = name; node.setAttribute('aria-hidden', 'true'); return node; };
  const button = (label, action, { glyph, className = 'discover-button', title = label } = {}) => {
    const node = el('button', className); node.type = 'button'; node.setAttribute('aria-label', title); node.title = title;
    if (glyph) node.append(icon(glyph)); if (label) node.append(el('span', '', label));
    node.addEventListener('click', action); return node;
  };
  const textStatus = (container, text) => { const node = el('p', 'discover-empty', text); node.setAttribute('role', 'status'); container.replaceChildren(node); };
  const skeleton = container => {
    container.setAttribute('aria-busy', 'true');
    container.setAttribute('aria-label', '正在加载歌曲');
    container.replaceChildren(...Array.from({ length: 4 }, () => {
      const row = el('div', 'discover-skeleton'); row.setAttribute('aria-hidden', 'true');
      row.append(el('span', 'discover-skeleton-cover'), el('span', 'discover-skeleton-copy')); return row;
    }));
  };
  const heading = (title, note) => { const node = el('header', 'discover-section-heading'); const copy = el('div'); copy.append(el('h2', '', title)); if (note) copy.append(el('p', '', note)); node.append(copy); return node; };
  const section = (title, note, action) => { const node = el('section', 'discover-section'), head = heading(title, note), content = el('div', 'discover-tracks'); if (action) head.append(action); node.append(head, content); root.append(node); return content; };
  const img = song => {
    const cover = el('span', 'discover-cover'); cover.append(icon('Music2'));
    try { const url = new URL(song.cover, document.baseURI); if (song.cover && ['http:', 'https:'].includes(url.protocol)) {
      const image = el('img'); image.src = url.href.replace(/^http:/, 'https:'); image.alt = ''; image.width = image.height = 48; image.loading = 'lazy'; image.referrerPolicy = 'no-referrer'; image.addEventListener('error', () => image.remove()); cover.append(image);
    } } catch { /* Keep the note fallback. */ }
    return cover;
  };
  root.classList.add('discovery-home');
  const toolbar = el('div', 'discover-home-toolbar'); toolbar.append(el('p', '', '为你的每一天，挑一些好音乐。'), button('音乐偏好', openPreferences, { glyph: 'SlidersHorizontal' })); root.append(toolbar);
  const hero = el('div', 'discover-hero');
  const dailyCard = el('section', 'discover-daily-card'), dailyCount = el('strong', 'discover-daily-count', '30'), dailyNote = el('p', '', '正在整理今日推荐…');
  dailyCard.append(el('span', 'discover-eyebrow', 'DAILY MIX'), dailyCount, el('h2', '', '每日推荐'), dailyNote);
  const dailyActions = el('div', 'discover-actions');
  const dailyPlay = button('播放今日推荐', () => playBatch(daily, '每日推荐'), { glyph: 'Play', className: 'discover-button is-primary' }); dailyPlay.disabled = true;
  const dailyView = button('查看全部', () => showTracks('每日推荐', daily, '每天按偏好与听歌记录整理 · 最多 30 首'));
  dailyActions.append(dailyPlay, dailyView); dailyCard.append(dailyActions);
  const radioCard = el('section', 'discover-radio-card'); radioCard.append(icon('Radio'), el('span', 'discover-eyebrow', 'JUST FOR YOU'), el('h2', '', '私人电台'), el('p', '', '从喜欢的声音出发，让下一首自然发生。'));
  const radioStatus = el('p', 'discover-radio-status', '随时可以退出，保留原播放队列'); radioStatus.setAttribute('role', 'status');
  const radioActions = el('div', 'discover-actions');
  const radioStart = button('开启电台', () => startRadio('personal'), { glyph: 'Play', className: 'discover-button is-primary' });
  const radioNext = button('下一首', () => advanceRadio(), { glyph: 'SkipForward' });
  const radioStop = button('退出电台', () => radio.stop()); radioNext.hidden = radioStop.hidden = true;
  radioActions.append(radioStart, radioNext, radioStop); radioCard.append(radioActions, radioStatus);
  const seeds = el('div', 'discover-actions'); seeds.append(button('歌曲电台', () => startRadio('song'), { glyph: 'Disc3' }), button('艺人电台', () => startRadio('artist'), { glyph: 'UserRound' })); radioCard.append(seeds);
  hero.append(dailyCard, radioCard); root.append(hero);
  const feedback = el('div', 'discover-feedback'); feedback.setAttribute('role', 'status'); root.append(feedback);
  const homeStatus = el('div', 'discover-home-status'); homeStatus.setAttribute('role', 'status'); root.append(homeStatus);
  const historyList = section('继续播放', '保留最近播放的位置', button('查看历史', () => showHistory()));
  const likesList = section('猜你喜欢', '每首歌都有推荐的理由', button('换一批', () => { variation++; renderRecommendations(); }));
  const newsList = section('新歌速递', '网易云新歌榜 · 保留榜单顺序', button('查看新歌榜', () => openPlaylist('3779629')));
  const sceneList = section('此刻，想听什么', '按场景挑选公开歌单'); sceneList.className = 'discover-scenes';
  SCENES.forEach(scene => { const card = button('', () => showCollections(scene.category, `${scene.name}歌单`), { className: 'discover-scene', title: `${scene.name}歌单` }); card.append(icon(scene.icon), el('strong', '', scene.name), el('span', '', scene.note)); sceneList.append(card); });
  const browse = el('div', 'discover-browse'); browse.append(button('全部榜单', () => showCharts(), { glyph: 'TrendingUp' }), button('按标签发现', () => showTags(), { glyph: 'Tags' }), button('导入歌单 / 本地库', openPreferences, { glyph: 'Library' })); root.append(browse);
  let variation = 0;
  const dialog = el('dialog', 'discovery-dialog'); dialog.setAttribute('aria-labelledby', 'discoveryDialogTitle');
  const dialogHead = el('header', 'discover-dialog-head'), dialogTitle = el('h2', '', '发现音乐'); dialogTitle.id = 'discoveryDialogTitle';
  dialogHead.append(dialogTitle, button('关闭', () => dialog.close(), { glyph: 'X' })); const dialogBody = el('div', 'discover-dialog-body'); dialog.append(dialogHead, dialogBody); document.body.append(dialog);
  dialog.addEventListener('keydown', event => { if (event.key === 'Escape' || event.key === 'Tab') event.stopPropagation(); });
  dialog.addEventListener('close', () => { modalController?.abort(); dialogOpener?.focus?.(); });
  function openDialog(title) {
    modalController?.abort(); modalController = new AbortController();
    dialogTitle.textContent = title; dialogBody.replaceChildren();
    if (!dialog.open) { dialogOpener = document.activeElement; dialog.showModal(); }
    dialogBody.scrollTop = 0; return modalController.signal;
  }
  const radio = createRadio({ fetchBatch: service.radioBatch, profile, onChange: state => {
    radioNext.hidden = radioStop.hidden = !state.active; radioStart.hidden = state.active; radioNext.disabled = state.loading;
    radioStatus.textContent = !state.active ? '随时可以退出，保留原播放队列' : state.loading ? '正在挑选下一首…' : state.error || state.reason || '电台已开启';
  } });
  async function advanceRadio() { const song = await radio.next(); if (song) await onPlay(song); }
  async function startRadio(mode, seed = null) {
    seed ||= mode === 'personal' ? null : getCurrentSong();
    if (mode !== 'personal' && (!seed || !artistNames(seed).length)) { notify('先播放或在歌曲列表中选择一首歌，再开启电台'); return; }
    const song = await radio.start(mode, seed); if (song) { if (dialog.open) dialog.close(); await onPlay(song); }
  }
  function playBatch(entries, label) {
    const songs = entries.map(entry => catalogRecord(entry.song || entry)).filter(canRecommend); if (!songs.length) return;
    radio.stop(); onBatch(songs, label); if (dialog.open) dialog.close();
  }
  function dismiss(song) {
    profileStore.dismiss(song); lastDismissed = song;
    feedback.replaceChildren(el('span', '', `已减少推荐《${song.name}》`), button('撤销', () => { profileStore.undoDismiss(lastDismissed); lastDismissed = null; feedback.replaceChildren(); renderRecommendations(); if (dialog.open && modalEntries.length) renderModalTracks(); }));
    renderRecommendations(); if (dialog.open && modalEntries.length) renderModalTracks();
  }
  function trackRow(entry, expanded = false) {
    const song = catalogRecord(entry.song || entry), row = el('article', 'discover-track'), main = button('', () => {
      if (dialog.open) dialog.close(); radio.stop(); onPlay(song, { position: entry.position || 0 });
    }, { className: 'discover-track-play', title: `${entry.position ? '继续播放' : '播放'} ${song.name} · ${song.artist || ''}` }); main.disabled = !canRecommend(song);
    const copy = el('span', 'discover-track-copy'); copy.append(el('strong', '', song.name), el('span', '', song.artist || '未知歌手'), el('small', 'discover-reason', entry.reason || `${song.album || '单曲'} · ${durationLabel(song.metadata?.duration || song.duration)}`));
    main.append(img(song), copy); row.append(main);
    const actions = el('div', 'discover-track-actions');
    actions.append(button('', () => { if (dialog.open) dialog.close(); onDetails(song, document.activeElement); }, { glyph: 'Info', title: `${song.name}的资料与音源` }), button('', () => dismiss(song), { glyph: 'ThumbsDown', title: `不感兴趣：${song.name}` }));
    row.append(actions);
    if (expanded) {
      const extra = el('div', 'discover-track-extra');
      extra.append(el('span', 'discover-availability', `${AVAILABILITY_LABELS[groupAvailability(song).status]} · ${durationLabel(song.metadata?.duration || song.duration)}`), button('歌曲电台', () => startRadio('song', song), { glyph: 'Radio' }), button('艺人电台', () => startRadio('artist', song), { glyph: 'UserRound' })); row.append(extra);
    }
    return row;
  }
  function paint(container, entries, limit = 6) {
    container.removeAttribute('aria-busy'); container.removeAttribute('aria-label');
    container.replaceChildren(...entries.slice(0, limit).map(entry => trackRow(entry)));
    if (!entries.length) textStatus(container, '暂时没有候选，选择偏好或导入歌单后再试试。');
  }
  function renderHistory() {
    const entries = profile.history.filter(h => h.position > 0).slice(0, 4).map(h => ({ ...h, reason: `上次听到 ${durationLabel(h.position)}` }));
    historyList.parentElement.hidden = !entries.length;
    if (entries.length) paint(historyList, entries, 4);
  }
  function renderRecommendations() {
    daily = service.rank({ limit: 30 }); dailyCount.textContent = homeLoading && !daily.length ? '—' : String(daily.length);
    dailyPlay.disabled = dailyView.disabled = !daily.length;
    dailyNote.textContent = daily.length ? `${dayKey().slice(5).replace('-', ' 月 ')} 日 · 为你整理 ${daily.length} 首`
      : homeLoading ? '正在整理今日推荐…' : '还没有足够的歌曲，试试选择偏好或导入歌单';
    const likes = service.rank({ day: `${dayKey()}:${variation}`, limit: 6 });
    if (homeLoading && !likes.length) skeleton(likesList); else paint(likesList, likes);
  }
  function showHistory() { showTracks('继续播放', profile.history.map(h => ({ ...h, reason: `上次听到 ${durationLabel(h.position)}` })), '播放进度保存在当前浏览器'); }
  let modalList, modalCount;
  function showTracks(title, entries, description = '') {
    openDialog(title); modalEntries = entries.map(entry => entry.song ? entry : { song: entry }); filters = {};
    dialogBody.append(el('p', 'discover-help', description));
    const controls = el('div', 'discover-actions'); controls.append(button('播放全部', () => playBatch(visibleEntries(), title), { glyph: 'Play', className: 'discover-button is-primary' }));
    modalCount = el('span', 'discover-help'); controls.append(modalCount); dialogBody.append(controls);
    const details = el('details', 'discover-filter-panel'); details.append(el('summary', '', '筛选：语种 / 年代 / 风格 / BPM / 时长'));
    const fields = el('form', 'discover-filter-fields'); fields.addEventListener('submit', event => event.preventDefault());
    for (const [key, label, choices] of [['language', '语种', PREFERENCE_GROUPS['语种']], ['era', '年代', PREFERENCE_GROUPS['年代']], ['genre', '风格', PREFERENCE_GROUPS['风格']]]) {
      const wrap = el('label', '', label), select = el('select'); select.setAttribute('aria-label', label); select.append(new Option('不限', ''), ...choices.map(value => new Option(value, value)));
      select.addEventListener('change', () => { filters[key] = select.value; renderModalTracks(); }); wrap.append(select); fields.append(wrap);
    }
    for (const [key, label] of [['bpmMin', '最低 BPM'], ['bpmMax', '最高 BPM'], ['durationMin', '最短时长（秒）'], ['durationMax', '最长时长（秒）']]) {
      const wrap = el('label', '', label), input = el('input'); input.type = 'number'; input.min = '0'; input.max = key.startsWith('bpm') ? '400' : '86400'; input.placeholder = '不限';
      input.addEventListener('input', () => { filters[key] = input.value; renderModalTracks(); }); wrap.append(input); fields.append(wrap);
    }
    fields.append(button('重置筛选', () => { filters = {}; fields.reset(); renderModalTracks(); })); details.append(fields, el('p', 'discover-help', '仅按已知的歌曲元数据筛选；缺失字段不会猜测。BPM 与风格可通过本地 JSON 歌单补充。')); dialogBody.append(details);
    modalList = el('div', 'discover-modal-tracks'); dialogBody.append(modalList); renderModalTracks();
  }
  const visibleEntries = () => modalEntries.filter(entry => !profile.dismissed.includes(recordingKey(entry.song)) && matchesFilters(entry.song, filters));
  function renderModalTracks() {
    if (!modalList?.isConnected) return;
    const entries = visibleEntries(); modalCount.textContent = `${entries.length} / ${modalEntries.length} 首`;
    modalList.replaceChildren(...entries.map(entry => trackRow(entry, true)));
    if (!entries.length) textStatus(modalList, '没有符合筛选条件的歌曲。可以重置筛选或补充歌曲元数据。');
  }
  async function openPlaylist(id) {
    const signal = openDialog('正在读取歌单'); textStatus(dialogBody, '正在读取公开歌单…');
    try { const data = await service.playlist(id, signal); if (signal.aborted) return;
      service.add(data.tracks, `来自歌单《${data.collection.name}》`);
      showTracks(data.collection.name, data.tracks, `${data.collection.source} · 已取得 ${data.tracks.length} / ${data.collection.trackCount} 首${data.partial ? '，上游仅提供部分内容' : ''}`);
    } catch (error) { if (!signal.aborted) { textStatus(dialogBody, requestErrorMessage(error)); dialogBody.append(button('重试', () => openPlaylist(id))); } }
  }
  function collectionCards(items) {
    const grid = el('div', 'discover-collections');
    for (const item of items) {
      const card = button('', () => openPlaylist(item.id), { className: 'discover-collection', title: `打开 ${item.name}` });
      card.append(img(item), el('strong', '', item.name), el('span', '', `${item.trackCount} 首 · ${item.tags?.join(' / ') || item.source}`)); grid.append(card);
    }
    return grid;
  }
  async function showCollections(category, title = `${category}主题歌单`) {
    const signal = openDialog(title); textStatus(dialogBody, '正在查找歌单…');
    try { const data = await service.playlists(category, signal); if (signal.aborted) return;
      dialogBody.replaceChildren(el('p', 'discover-help', `网易云公开歌单 · ${category}。主题标签属于歌单，不代表每首歌都有该元数据。`), collectionCards(data.items));
      if (!data.items.length) dialogBody.append(el('p', 'discover-empty', '暂无此分类歌单；可以在下方曲库中检索已知元数据。'));
      dialogBody.append(button('在当前曲库中筛选', () => showTracks(`${category} · 曲库筛选`, service.pool(), '打开筛选器选择精确条件')));
    } catch (error) { if (!signal.aborted) { textStatus(dialogBody, requestErrorMessage(error)); dialogBody.append(button('重试', () => showCollections(category, title))); } }
  }
  async function showCharts() {
    const signal = openDialog('音乐排行榜'); textStatus(dialogBody, '正在更新榜单目录…');
    try { const data = await service.charts(signal); if (signal.aborted) return;
      dialogBody.replaceChildren(el('p', 'discover-help', '网易云公开榜单 · 排名来自榜单原始顺序；分类依据榜单名称。'));
      const tabs = el('div', 'discover-chips'), content = el('div');
      const groups = { '综合榜': items => items.filter(x => /热歌榜|原创榜|网络热歌/.test(x.name)), '上升榜': items => items.filter(x => /飙升|上升/.test(x.name)), '新歌榜': items => items.filter(x => /新歌|新声/.test(x.name)), '风格榜': items => items.filter(x => /摇滚|说唱|电音|电子|民谣|爵士|古典|国风|ACG|嘻哈/.test(x.name)), '地区榜': items => items.filter(x => /欧美|日语|日文|韩语|韩国|日本|华语|粤语|英国|美国|Billboard|UK|Oricon|云音乐韩语/i.test(x.name)), '全部': items => items };
      for (const [name, select] of Object.entries(groups)) { const tab = button(name, () => {
        tabs.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === tab))); const rows = select(data.items);
        content.replaceChildren(collectionCards(rows)); if (!rows.length) textStatus(content, '上游暂无此类榜单，可查看全部榜单。');
      }); tab.setAttribute('aria-pressed', 'false'); tabs.append(tab); }
      dialogBody.append(tabs, content); tabs.firstElementChild.click();
    } catch (error) { if (!signal.aborted) { textStatus(dialogBody, requestErrorMessage(error)); dialogBody.append(button('重试', showCharts)); } }
  }
  function showTags() {
    openDialog('按标签发现'); dialogBody.append(el('p', 'discover-help', '先选主题探索歌单，或对已有曲库按真实元数据精确筛选。'));
    for (const [name, tags] of Object.entries(PREFERENCE_GROUPS)) { const chips = el('div', 'discover-chips'); dialogBody.append(el('h3', '', name), chips); tags.forEach(tag => chips.append(button(tag, () => showCollections(service.categoryFor(tag), `${tag}主题歌单`)))); }
    dialogBody.append(button('精确筛选当前曲库', () => showTracks('曲库 · 标签检索', service.pool(), '包含已加载的榜单、歌单与导入曲目'), { glyph: 'ListFilter' }));
  }
  function openPreferences() {
    const signal = openDialog('让推荐更懂你');
    dialogBody.append(el('p', 'discover-help', '选择最多 12 个偏好，或导入歌单开始。偏好、历史和反馈只保存在当前浏览器。'));
    const selected = new Set(profile.tags), preferenceStatus = el('p', 'discover-help'); preferenceStatus.setAttribute('role', 'status');
    for (const [name, tags] of Object.entries(PREFERENCE_GROUPS)) {
      dialogBody.append(el('h3', '', name)); const chips = el('div', 'discover-chips');
      tags.forEach(tag => { const chip = button(tag, () => { if (selected.has(tag)) selected.delete(tag); else if (selected.size < 12) selected.add(tag); else { preferenceStatus.textContent = '最多选择 12 个标签'; return; } chip.setAttribute('aria-pressed', String(selected.has(tag))); preferenceStatus.textContent = `已选择 ${selected.size} 个标签`; }); chip.setAttribute('aria-pressed', String(selected.has(tag))); chips.append(chip); }); dialogBody.append(chips);
    }
    dialogBody.append(preferenceStatus, button('保存偏好', () => { profileStore.setTags([...selected]); dialog.close(); load(); }, { className: 'discover-button is-primary' }));
    const importSection = el('section', 'discover-import'); importSection.append(el('h3', '', '导入歌单，找到熟悉的声音'));
    const linkLabel = el('label', '', '网易云公开歌单链接或 ID'), input = el('input'); input.type = 'text'; input.placeholder = 'https://music.163.com/#/playlist?id=…'; linkLabel.append(input);
    const status = el('p', 'discover-help'); status.setAttribute('role', 'status');
    let pending = [], requestVersion = 0;
    const preview = tracks => { pending = tracks; const analysis = analyzeLibrary(tracks); status.textContent = `已解析 ${tracks.length} 首${analysis.artists.length ? ` · 常见艺人：${analysis.artists.slice(0, 4).map(a => a.name).join('、')}` : ' · 尚缺艺人信息，补全后推荐更准确'}`; confirm.disabled = !tracks.length; };
    const confirm = button('将已解析歌曲用于推荐', () => { profileStore.import(pending); service.add(pending); status.textContent = `已导入 ${pending.length} 首，用于推荐；原播放队列已保留。`; confirm.disabled = true; renderRecommendations(); load(); }); confirm.disabled = true;
    const parse = button('解析链接', async () => {
      const version = ++requestVersion; pending = []; confirm.disabled = true;
      const id = parsePlaylistInput(input.value); if (!id) { status.textContent = '请填写网易云公开歌单链接或数字 ID'; return; }
      parse.disabled = true; status.textContent = '正在解析公开歌单…';
      try { const data = await service.playlist(id, signal); if (!signal.aborted && version === requestVersion) { preview(data.tracks); if (data.partial) status.textContent += ` · 上游共 ${data.collection.trackCount} 首，目前仅返回 ${data.tracks.length} 首`; } }
      catch (error) { if (!signal.aborted && version === requestVersion) status.textContent = error.name === 'HttpStatusError' ? requestErrorMessage(error) : error.message; }
      finally { if (!signal.aborted) parse.disabled = false; }
    });
    const fileLabel = el('label', '', '本地 JSON 歌单（最多 2 MB / 1,000 首）'), file = el('input'); file.type = 'file'; file.accept = '.json,application/json';
    file.addEventListener('change', async () => {
      const version = ++requestVersion; pending = []; confirm.disabled = true; const source = file.files[0]; if (!source) return;
      try { if (source.size > 2 * 1024 * 1024) throw new Error('文件不能超过 2 MB'); const tracks = parseLibraryJson(await source.text()); if (!signal.aborted && version === requestVersion) preview(tracks); }
      catch (error) { if (!signal.aborted && version === requestVersion) status.textContent = error.name === 'HttpStatusError' ? requestErrorMessage(error) : error.message; }
    }); fileLabel.append(file);
    importSection.append(linkLabel, parse, fileLabel, status, confirm, button('分析当前队列与收藏', () => { preview([...getLibrary(), ...service.favorites()].filter(song => song && typeof song === 'object' && song.id && song.name)); }));
    const analysis = analyzeLibrary(profile.library); importSection.append(el('p', 'discover-help', `当前本地推荐库 ${analysis.count} 首${analysis.genres.length ? ` · ${analysis.genres.map(g => g.name).join(' / ')}` : ''}。分析歌曲已有的艺人和风格信息，不读取音频文件内容。`));
    dialogBody.append(importSection, button(`重置“不感兴趣”记录（${profile.dismissed.length} 首）`, () => { profileStore.resetDismissed(); renderRecommendations(); openPreferences(); }));
  }
  async function load() {
    controller?.abort(); controller = new AbortController(); const signal = controller.signal;
    homeLoading = true;
    homeStatus.replaceChildren(el('span', '', '正在更新推荐…'));
    renderRecommendations(); renderHistory();
    try { await service.loadHome(signal, ({ errors, stale, loading, sections }) => {
      if (signal.aborted) return; homeLoading = loading; renderRecommendations();
      const news = service.newSongs();
      if (!news.length && sections.news === 'loading') skeleton(newsList);
      else {
        paint(newsList, news.map(song => ({ song, reason: `新歌榜 · ${song.metadata?.releaseDate || '发行日期未提供'}` })), 6);
        if (!news.length) textStatus(newsList, sections.news === 'error' ? '新歌榜暂时不可用，可稍后重试。' : '新歌榜暂无歌曲。');
      }
      homeStatus.replaceChildren(el('span', '', [...(loading ? ['正在更新推荐…'] : []), ...errors,
        ...(stale && service.pool().length ? ['当前展示本地已保存的候选'] : []),
        ...(sections.news === 'error' && news.length ? ['新歌榜保留上次内容'] : []),
        ...(!profileStore.persistent() ? ['浏览器存储不可用，偏好仅在本次会话有效'] : [])].join(' · ')));
      if (errors.length) homeStatus.append(button('重试', load));
    }); } catch (error) { if (!signal.aborted) { homeStatus.replaceChildren(el('span', '', error.message), button('重试', load)); } }
    finally { if (!signal.aborted) { homeLoading = false; renderRecommendations(); } }
  }
  let observedKey = '', lastTick = 0, accumulated = 0, lastSave = 0;
  function savePlayback(audio, force = false) {
    const song = getCurrentSong(); if (!song?.id || !audio.src || !Number.isFinite(audio.currentTime)) return;
    const key = recordingKey(song), now = Date.now();
    if (key !== observedKey) { observedKey = key; accumulated = 0; lastTick = now; lastSave = 0; }
    if (!audio.paused && lastTick) accumulated += Math.max(0, Math.min(2, (now - lastTick) / 1000)); lastTick = now;
    if (force || now - lastSave >= 10_000) { profileStore.record(song, audio.currentTime, accumulated); accumulated = 0; lastSave = now; renderHistory(); }
  }
  function connectAudio(audio) {
    audio.addEventListener('timeupdate', () => savePlayback(audio));
    for (const event of ['pause', 'ended']) audio.addEventListener(event, () => savePlayback(audio, true));
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') savePlayback(audio, true); else if (lastDay !== dayKey()) { lastDay = dayKey(); load(); } });
  }
  load();
  return { load, connectAudio, showCharts, startRadio, radio, advanceRadio,
    playbackFailed(error) { if (radio.active()) radioStatus.textContent = `这首暂时无法播放，点击下一首继续 · ${requestErrorMessage(error)}`; },
    beforePlay(song) { if (!radio.owns(song)) radio.stop(); },
    record: (song, position, delta) => profileStore.record(song, position, delta),
  };
}
